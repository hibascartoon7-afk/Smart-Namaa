// NAMAA field node: a TEMPLATE for one sensor point. It joins the hub's Wi-Fi and sends the point's reading to the hub.
//
//   THIS NODE --Wi-Fi (hub's own network), http POST /reading--> namaa_hub --> Supabase
//
// !! The sensor driver is NOT included: your sensor model is not known to this project. Put it in readSensor() below.
// !! Until you do, this node sends "not measured" (null) for every value, which the app shows as "no reading". It never invents a number.
//
// Rules for readSensor(): set a value only when the sensor really gave it; leave NAN otherwise. Never use 0 for "no reading".
// Units the server expects: moisture in % of volume (0-100), soil temperature in deg C, EC in dS/m. The optional NPK values
// (nitrogen, phosphorus, potassium) are plain numbers; their unit and method are declared on the device in Supabase, not here.
//
// Board: any ESP32 (arduino-esp32 core 2.x or 3.x), no extra libraries.
#include <WiFi.h>
#include <HTTPClient.h>
#include <math.h>

#define HUB_SSID "NAMAA-HUB-1"            // = AP_SSID of the hub
#define HUB_PASSWORD "change-this-password"  // = AP_PASSWORD of the hub
#define HUB_URL "http://192.168.4.1/reading"  // = AP_IP of the hub
#define NODE_KEY ""                       // = NODE_KEY of the hub ("" = none)
#define SENSOR_NAME "1"                   // the NAME of this sensor point in the app. Letters, digits and spaces only (no quotes).
#define SEND_EVERY_S 300                  // one reading every 5 minutes
#define MAX_WAITING 30                    // readings kept in RAM while the hub cannot be reached (the oldest is dropped first)
#define MAX_AGE_S 85800                   // the hub and the server refuse readings older than this

struct Taken {
  uint32_t atMs;
  double moisture, soilTemperature, ec, nitrogen, phosphorus, potassium;
};
static Taken waiting[MAX_WAITING];
static int waitingCount = 0;
static uint32_t lastTakenMs = 0;
static bool firstDone = false;

// >>> PUT YOUR SENSOR DRIVER HERE <<<
// Fill what your sensor measures, leave the rest NAN. Return true if at least one value is a real measurement.
static bool readSensor(Taken& t) {
  (void)t;
  return false;
}

static String numberOrNull(double v) { return isnan(v) ? String("null") : String(v, 3); }

static int sendOne(const Taken& t) {
  const uint32_t age = (millis() - t.atMs) / 1000;
  String body = String("{\"sensor\":\"") + SENSOR_NAME + "\",\"moisture\":" + numberOrNull(t.moisture) +
                ",\"soil_temperature\":" + numberOrNull(t.soilTemperature) + ",\"ec\":" + numberOrNull(t.ec) +
                ",\"nitrogen\":" + numberOrNull(t.nitrogen) + ",\"phosphorus\":" + numberOrNull(t.phosphorus) +
                ",\"potassium\":" + numberOrNull(t.potassium) + ",\"age_s\":" + String(age) + "}";
  WiFiClient client;
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(8000);
  if (!http.begin(client, HUB_URL)) return -1;
  http.addHeader("Content-Type", "application/json");
  if (strlen(NODE_KEY) > 0) http.addHeader("X-Namaa-Node-Key", NODE_KEY);
  const int code = http.POST(body);
  if (code != 200) Serial.printf("[node] hub answered %d: %s\n", code, http.getString().c_str());
  http.end();
  return code;
}

static void dropFirst() {
  for (int i = 1; i < waitingCount; i++) waiting[i - 1] = waiting[i];
  waitingCount--;
}

/** sends the waiting readings, oldest first; stops at the first failure and keeps the rest for the next round */
static void flush() {
  while (waitingCount > 0) {
    if ((millis() - waiting[0].atMs) / 1000 > MAX_AGE_S) { Serial.println("[node] a reading is too old to send: dropped"); dropFirst(); continue; }
    const int code = sendOne(waiting[0]);
    if (code == 200) { dropFirst(); continue; }
    if (code == 400) { Serial.println("[node] the hub refused this reading for good: dropped"); dropFirst(); continue; }  // a bad name or value: retrying cannot help
    break;  // 503 (hub clock not set), 507 (hub buffer full), 401 (node key) or no connection: try again next round
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[node] NAMAA field node starting");
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(HUB_SSID, HUB_PASSWORD);
}

void loop() {
  const bool due = !firstDone || millis() - lastTakenMs >= SEND_EVERY_S * 1000UL;
  if (due) {
    firstDone = true;
    lastTakenMs = millis();
    Taken t;
    t.atMs = millis();
    t.moisture = t.soilTemperature = t.ec = t.nitrogen = t.phosphorus = t.potassium = NAN;
    if (!readSensor(t)) Serial.println("[node] no measurement (the sensor driver is missing or the sensor did not answer): sending 'not measured'");
    if (waitingCount == MAX_WAITING) dropFirst();
    waiting[waitingCount++] = t;
  }
  if (waitingCount > 0 && WiFi.status() == WL_CONNECTED) flush();
  delay(500);
}
