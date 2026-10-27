// NAMAA hub: ESP32 that collects the readings of the sensor points of ONE field and uploads them to Supabase.
//
//   sensor nodes (field) --Wi-Fi, http POST /reading--> THIS HUB --https, every UPLOAD_INTERVAL_S--> sensor-ingest --> sensor_readings
//
// - The hub opens its own Wi-Fi (AP_SSID). A node sends one JSON reading per sensor point: {"sensor":"1","moisture":31.2,...}
//   ("sensor" = the name of the sensor point in the app). A value that is missing or null is "not measured": it is never turned into 0.
// - Every reading is written to the flash first (a power cut or no internet loses nothing) and removed only after the server said 200.
// - The hub groups the buffered readings by minute, one request per minute (at most 50 sensors), oldest first.
// - The hub's clock comes from the internet (NTP). Until it is set the hub answers 503 and the node tries again; nothing is guessed.
//
// Board: ESP32 (arduino-esp32 core 2.x or 3.x). No extra libraries: everything used ships with the core.
// Setup, wiring of the nodes and the tests: firmware/README.md.
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <LittleFS.h>
#include <time.h>
#include <string>
#include <vector>

#include "hub_logic.h"
#include "config.h"

using namespace namaa;

static_assert(sizeof(AP_PASSWORD) >= 9, "AP_PASSWORD must have at least 8 characters (config.h)");

static const char* BUFFER_PATH = "/buffer.tsv";
static const char* TMP_PATH = "/buffer.tmp";
static const size_t LINES_PER_CYCLE = 400;       // readings handled per upload cycle: keeps the RAM use small
static const uint32_t HTTP_TIMEOUT_MS = 10000;

WebServer server(80);

// ---- state (shown by GET /status; none of it is secret)
static size_t bufferedLines = 0;
static uint32_t nextUploadMs = 0;
static int failuresInARow = 0;
static uint32_t uploadsOk = 0, uploadsFailed = 0, readingsAccepted = 0, readingsRejected = 0, readingsDropped = 0, batchesDropped = 0;
static int64_t lastUploadEpoch = 0;
static std::string lastError;
static std::string lastWarning;
static bool wifiWasUp = false;
static bool warnedNoTls = false;
static uint32_t lastWifiTryMs = 0, lastNtpKickMs = 0;

static bool clockSet() { return static_cast<int64_t>(time(nullptr)) >= MIN_VALID_EPOCH; }
static int64_t nowEpoch() { return static_cast<int64_t>(time(nullptr)); }
static bool tlsConfigured() { return ROOT_CA[0] != '\0' || ALLOW_INSECURE_TLS; }

static void setWarning(const std::string& text) {
  lastWarning = text.substr(0, 200);
  Serial.printf("[hub] WARNING: %s\n", lastWarning.c_str());
}

static void setError(const std::string& text) {
  lastError = text.substr(0, 160);
  Serial.printf("[hub] %s\n", lastError.c_str());
}

// ---------------------------------------------------------------------------------------------------------------------
// The buffer file (one reading per line, see hub_logic.h)

static void recoverBuffer() {
  // a power cut while the buffer was being rewritten leaves the finished copy under TMP_PATH: use it, never lose both
  if (LittleFS.exists(TMP_PATH)) {
    if (!LittleFS.exists(BUFFER_PATH)) LittleFS.rename(TMP_PATH, BUFFER_PATH);
    else LittleFS.remove(TMP_PATH);
  }
}

static size_t countLines() {
  File f = LittleFS.open(BUFFER_PATH, "r");
  if (!f) return 0;
  size_t n = 0;
  while (f.available()) {
    String line = f.readStringUntil('\n');
    if (line.length() > 1) n++;
  }
  f.close();
  return n;
}

static bool appendLine(const std::string& line) {
  File f = LittleFS.open(BUFFER_PATH, "a");
  if (!f) return false;
  size_t written = f.print(line.c_str());
  written += f.print('\n');
  f.close();
  return written == line.size() + 1;
}

/** reads the first maxLines lines of the buffer; a damaged line becomes a reading with epoch 0 (it is dropped later) */
static size_t readChunk(std::vector<Reading>& out, size_t maxLines) {
  File f = LittleFS.open(BUFFER_PATH, "r");
  if (!f) return 0;
  size_t n = 0;
  while (f.available() && n < maxLines) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;
    Reading r;
    if (!decodeLine(line.c_str(), r)) { r = Reading(); r.epoch = 0; r.sensor = "?"; }
    out.push_back(r);
    n++;
  }
  f.close();
  return n;
}

/** removes the lines among the first chunkLines that are marked in `gone`; every other line is kept as it is */
static bool rewriteBuffer(size_t chunkLines, const std::vector<bool>& gone) {
  File in = LittleFS.open(BUFFER_PATH, "r");
  if (!in) return true;  // nothing there, nothing to remove
  File out = LittleFS.open(TMP_PATH, "w");
  if (!out) { in.close(); return false; }
  size_t i = 0;
  bool ok = true;
  while (in.available()) {
    String line = in.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;
    const bool drop = i < chunkLines && i < gone.size() && gone[i];
    i++;
    if (drop) continue;
    size_t written = out.print(line);
    written += out.print('\n');
    if (written != line.length() + 1) ok = false;
  }
  in.close();
  out.close();
  if (!ok) { LittleFS.remove(TMP_PATH); return false; }  // the old buffer is still complete
  LittleFS.remove(BUFFER_PATH);
  LittleFS.rename(TMP_PATH, BUFFER_PATH);
  bufferedLines = countLines();
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Upload to sensor-ingest

/** one https POST. Returns the HTTP code, or a negative number when there was no answer. */
static int postBatch(const std::string& payload, std::string& answer) {
  WiFiClientSecure client;
  if (ROOT_CA[0] != '\0') client.setCACert(ROOT_CA);
  else client.setInsecure();  // only reachable when ALLOW_INSECURE_TLS is 1 (checked before)
  HTTPClient http;
  http.setConnectTimeout(8000);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(client, INGEST_URL)) { answer = "bad INGEST_URL"; return -1; }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  const int code = http.POST(reinterpret_cast<const uint8_t*>(payload.c_str()), payload.size());
  answer = code > 0 ? std::string(http.getString().c_str()) : std::string(HTTPClient::errorToString(code).c_str());
  http.end();
  return code;
}

static void scheduleIn(uint32_t seconds) { nextUploadMs = millis() + seconds * 1000UL; }

static void uploadCycle() {
  if (WiFi.status() != WL_CONNECTED || !clockSet()) { scheduleIn(15); return; }
  if (!tlsConfigured()) {
    if (!warnedNoTls) { setError("ROOT_CA is empty and ALLOW_INSECURE_TLS is 0: nothing is uploaded (see firmware/README.md, The root certificate)"); warnedNoTls = true; }
    scheduleIn(60);
    return;
  }
  if (bufferedLines == 0) { scheduleIn(UPLOAD_INTERVAL_S); return; }

  std::vector<Reading> chunk;
  const size_t chunkLines = readChunk(chunk, LINES_PER_CYCLE);
  const BatchPlan plan = buildBatches(chunk, nowEpoch());
  std::vector<bool> gone(chunkLines, false);
  for (size_t i : plan.dropped) { gone[i] = true; readingsDropped++; }
  if (!plan.dropped.empty()) Serial.printf("[hub] %u readings dropped (older than the server accepts, damaged, or from a wrong clock)\n", static_cast<unsigned>(plan.dropped.size()));

  Verdict last = Verdict::Done;
  for (size_t b = 0; b < plan.batches.size(); b++) {
    const Batch& batch = plan.batches[b];
    std::string answer;
    const int code = postBatch(buildPayload(batch), answer);
    last = classifyHttp(code);
    Serial.printf("[hub] POST %u readings of %s -> HTTP %d\n", static_cast<unsigned>(batch.readings.size()), isoUtc(batch.measuredAt).c_str(), code);
    if (last == Verdict::Done || last == Verdict::DropBatch) {
      for (size_t i : batch.consumed) gone[i] = true;
      if (last == Verdict::Done) {
        uploadsOk++;
        lastUploadEpoch = nowEpoch();
        // the server answers 200 even for a sensor name it does not know, and does NOT store that reading: say so
        if (answer.find("\"unknown_sensors\":[\"") != std::string::npos) setWarning("the server does not know some sensor names, those readings were NOT stored: " + answer.substr(0, 150));
      }
      else { batchesDropped++; setError("the server refused a batch for good (HTTP " + std::to_string(code) + "): " + answer.substr(0, 100)); }
      continue;
    }
    uploadsFailed++;
    if (last == Verdict::FixSettings) setError("HTTP " + std::to_string(code) + ": " + answer.substr(0, 100) + " (check DEVICE_TOKEN, INGEST_URL and that the device is attached to an environment)");
    else setError("no upload (" + std::to_string(code) + "): " + answer.substr(0, 100));
    break;  // keep this batch and everything after it; try again later
  }

  rewriteBuffer(chunkLines, gone);

  if (last == Verdict::Done || last == Verdict::DropBatch) {
    failuresInARow = 0;
    if (last == Verdict::Done) lastError.clear();
    scheduleIn(bufferedLines > 0 ? 3 : UPLOAD_INTERVAL_S);  // a backlog is sent in several quick rounds
  } else {
    failuresInARow++;
    scheduleIn(static_cast<uint32_t>(backoffSeconds(failuresInARow, last == Verdict::FixSettings)));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// What the nodes talk to

static void sendJson(int code, const std::string& body) { server.send(code, "application/json", body.c_str()); }
static std::string errorJson(const std::string& text) { return "{\"error\":" + jsonString(text) + "}"; }

static void handleReading() {
  if (strlen(NODE_KEY) > 0 && !sameText(NODE_KEY, server.header("X-Namaa-Node-Key").c_str())) { sendJson(401, errorJson("missing or wrong X-Namaa-Node-Key")); return; }
  if (!clockSet()) { sendJson(503, errorJson("the hub clock is not set yet (it needs internet time): try again in a minute")); return; }
  if (bufferedLines >= MAX_BUFFER_LINES) { sendJson(507, errorJson("the hub buffer is full: the hub has no internet or no valid token")); return; }
  const std::string body = server.arg("plain").c_str();
  const ParseResult r = parseNodeReading(body, nowEpoch());
  if (!r.ok) { readingsRejected++; sendJson(400, errorJson(r.error)); return; }
  if (!appendLine(encodeLine(r.reading))) { sendJson(500, errorJson("the hub could not write to its flash")); return; }
  bufferedLines++;
  readingsAccepted++;
  sendJson(200, "{\"ok\":true,\"buffered\":" + std::to_string(bufferedLines) + "}");
}

static void handleStatus() {
  const bool staUp = WiFi.status() == WL_CONNECTED;
  std::string j = "{";
  j += "\"clock_set\":" + std::string(clockSet() ? "true" : "false");
  j += ",\"epoch\":" + std::to_string(static_cast<long long>(nowEpoch()));
  j += ",\"internet_wifi\":" + std::string(staUp ? "true" : "false");
  j += ",\"tls_ready\":" + std::string(tlsConfigured() ? "true" : "false");
  j += ",\"buffered_readings\":" + std::to_string(bufferedLines);
  j += ",\"readings_accepted\":" + std::to_string(readingsAccepted);
  j += ",\"readings_rejected\":" + std::to_string(readingsRejected);
  j += ",\"readings_dropped\":" + std::to_string(readingsDropped);
  j += ",\"uploads_ok\":" + std::to_string(uploadsOk);
  j += ",\"uploads_failed\":" + std::to_string(uploadsFailed);
  j += ",\"batches_refused_for_good\":" + std::to_string(batchesDropped);
  j += ",\"last_upload\":" + (lastUploadEpoch > 0 ? "\"" + isoUtc(lastUploadEpoch) + "\"" : std::string("null"));
  j += ",\"last_error\":" + (lastError.empty() ? std::string("null") : jsonString(lastError));
  j += ",\"warning\":" + (lastWarning.empty() ? std::string("null") : jsonString(lastWarning));
  j += ",\"nodes_connected\":" + std::to_string(WiFi.softAPgetStationNum());
  j += ",\"uptime_s\":" + std::to_string(static_cast<unsigned long>(millis() / 1000));
  j += ",\"free_heap\":" + std::to_string(static_cast<unsigned long>(ESP.getFreeHeap()));
  j += "}";
  sendJson(200, j);
}

// ---------------------------------------------------------------------------------------------------------------------

static void keepInternetWifi() {
  const bool up = WiFi.status() == WL_CONNECTED;
  if (up != wifiWasUp) {
    wifiWasUp = up;
    if (up) Serial.printf("[hub] internet Wi-Fi connected, IP %s\n", WiFi.localIP().toString().c_str());
    else Serial.println("[hub] internet Wi-Fi lost");
  }
  if (!up && millis() - lastWifiTryMs > 15000) { lastWifiTryMs = millis(); WiFi.reconnect(); }
  // the clock: ask the time servers again until the clock is set (the first request may have been sent before Wi-Fi was up)
  if (up && !clockSet() && millis() - lastNtpKickMs > 30000) {
    lastNtpKickMs = millis();
    configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[hub] NAMAA hub starting");

  if (!LittleFS.begin(true)) Serial.println("[hub] WARNING: the flash file system did not start: readings cannot be buffered");
  recoverBuffer();
  bufferedLines = countLines();
  Serial.printf("[hub] %u readings waiting in the buffer\n", static_cast<unsigned>(bufferedLines));

  if (strncmp(DEVICE_TOKEN, "nmd_", 4) != 0 || strstr(DEVICE_TOKEN, "paste") != nullptr) setError("DEVICE_TOKEN in config.h is not a real token (it starts with nmd_)");
  if (strncmp(INGEST_URL, "https://", 8) != 0 || strstr(INGEST_URL, "YOUR-PROJECT") != nullptr) setError("INGEST_URL in config.h must be your https://<project>.supabase.co/functions/v1/sensor-ingest");
  if (!tlsConfigured()) setError("ROOT_CA is empty: the hub collects readings but uploads nothing until you paste the root certificate (firmware/README.md)");
  if (ALLOW_INSECURE_TLS && ROOT_CA[0] == '\0') Serial.println("[hub] WARNING: ALLOW_INSECURE_TLS is 1: the hub does not check who it sends the token to. Use it for a desk test only.");

  WiFi.persistent(false);
  WiFi.mode(WIFI_AP_STA);
  WiFi.setAutoReconnect(true);
  IPAddress apIp(AP_IP);
  WiFi.softAPConfig(apIp, apIp, IPAddress(255, 255, 255, 0));
  if (WiFi.softAP(AP_SSID, AP_PASSWORD)) Serial.printf("[hub] nodes: join Wi-Fi \"%s\" and POST to http://%s/reading\n", AP_SSID, WiFi.softAPIP().toString().c_str());
  else Serial.println("[hub] ERROR: the hub's own Wi-Fi did not start (is AP_PASSWORD at least 8 characters?)");
  WiFi.begin(STA_SSID, STA_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");

  const char* headerKeys[] = {"X-Namaa-Node-Key"};
  server.collectHeaders(headerKeys, 1);
  server.on("/reading", HTTP_POST, handleReading);
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/", HTTP_GET, []() { server.send(200, "text/plain", "NAMAA hub. POST /reading (nodes), GET /status"); });
  server.onNotFound([]() { sendJson(404, errorJson("unknown address or method")); });
  server.begin();

  scheduleIn(30);
}

void loop() {
  server.handleClient();
  keepInternetWifi();
  if (static_cast<int32_t>(millis() - nextUploadMs) >= 0) uploadCycle();
  delay(2);
}
