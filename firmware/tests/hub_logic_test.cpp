// Tests of firmware/namaa_hub/hub_logic.h on a normal computer (no ESP32 needed): bash firmware/tests/run.sh
#include <cstdio>
#include <cstdlib>
#include <string>
#include "../namaa_hub/hub_logic.h"

using namespace namaa;

static int checks = 0, failures = 0;
#define CHECK(cond) do { checks++; if (!(cond)) { failures++; std::printf("FAIL line %d: %s\n", __LINE__, #cond); } } while (0)
#define CHECK_EQ(a, b) do { checks++; std::string _a = (a), _b = (b); if (_a != _b) { failures++; std::printf("FAIL line %d:\n  got      %s\n  expected %s\n", __LINE__, _a.c_str(), _b.c_str()); } } while (0)

static const int64_t NOW = 1793005200;  // 2026-10-26T09:00:00Z

static Reading mk(int64_t epoch, const char* sensor, double moisture = NAN) {
  Reading r; r.epoch = epoch; r.sensor = sensor; r.moisture = moisture; return r;
}

static void testJson() {
  std::map<std::string, JsonValue> j; std::string err;
  CHECK(parseFlatJson(" { \"a\" : 1.5 , \"b\":null,\"c\":\"x\\\"y\\u00e9\",\"d\":true } ", j, err));
  CHECK(j["a"].type == JsonValue::Number && j["a"].number == 1.5);
  CHECK(j["b"].type == JsonValue::Null);
  CHECK_EQ(j["c"].text, "x\"y\xC3\xA9");
  CHECK(j["d"].type == JsonValue::Bool && j["d"].flag);
  CHECK(parseFlatJson("{}", j, err) && j.empty());
  CHECK(parseFlatJson("{\"a\":1,\"a\":2}", j, err) && j["a"].number == 2);  // last one wins

  const char* bad[] = {"", "[]", "{", "{\"a\"}", "{\"a\":}", "{\"a\":1,}", "{\"a\":01}", "{\"a\":1.}", "{\"a\":-}", "{\"a\":1e}", "{\"a\":NaN}", "{\"a\":Infinity}",
                       "{\"a\":{\"b\":1}}", "{\"a\":[1]}", "{\"a\":\"x}", "{\"a\":1} extra", "{\"a\":1e999}", "{\"a\":\"\\q\"}", "{\"a\":\"\\ud800\"}", "{\"a\":\"\n\"}"};
  for (const char* b : bad) { CHECK(!parseFlatJson(b, j, err)); }
  CHECK(parseFlatJson("{\"a\":-0.5e2}", j, err) && j["a"].number == -50);
}

static void testNodeReading() {
  ParseResult r = parseNodeReading("{\"sensor\":\"1\",\"moisture\":31.2,\"soil_temperature\":24.1,\"ec\":null,\"nitrogen\":14,\"unknown\":\"ignored\"}", NOW);
  CHECK(r.ok);
  CHECK_EQ(r.reading.sensor, "1");
  CHECK(r.reading.epoch == NOW);
  CHECK(r.reading.moisture == 31.2 && r.reading.soilTemperature == 24.1 && r.reading.nitrogen == 14);
  CHECK(std::isnan(r.reading.ec) && std::isnan(r.reading.phosphorus) && std::isnan(r.reading.potassium));  // never 0

  CHECK(parseNodeReading("{\"sensor\":7}", NOW).ok);
  CHECK_EQ(parseNodeReading("{\"sensor\":7}", NOW).reading.sensor, "7");
  CHECK_EQ(parseNodeReading("{\"sensor\":\"  left   side \"}", NOW).reading.sensor, "left side");
  CHECK(parseNodeReading("{\"sensor\":\"1\"}", NOW).ok);  // all values missing = "alive, nothing measured"; the server stores not_measured
  CHECK(parseNodeReading("{\"sensor\":\"1\",\"moisture\":0}", NOW).reading.moisture == 0);  // a real zero stays a zero

  CHECK(parseNodeReading("{\"sensor\":\"1\",\"age_s\":120}", NOW).reading.epoch == NOW - 120);
  CHECK(!parseNodeReading("{\"sensor\":\"1\",\"age_s\":-1}", NOW).ok);
  CHECK(!parseNodeReading("{\"sensor\":\"1\",\"age_s\":86400}", NOW).ok);  // the server refuses older than 24 h
  CHECK(!parseNodeReading("{\"sensor\":\"1\",\"age_s\":\"5\"}", NOW).ok);

  CHECK(!parseNodeReading("{\"moisture\":3}", NOW).ok);                      // no sensor name
  CHECK(!parseNodeReading("{\"sensor\":null}", NOW).ok);
  CHECK(!parseNodeReading("{\"sensor\":\"\"}", NOW).ok);
  CHECK(!parseNodeReading("{\"sensor\":\"   \"}", NOW).ok);
  CHECK(!parseNodeReading("{\"sensor\":1.5}", NOW).ok);                       // not a whole number
  CHECK(!parseNodeReading("{\"sensor\":true}", NOW).ok);
  CHECK(!parseNodeReading("{\"sensor\":\"" + std::string(51, 'x') + "\"}", NOW).ok);
  CHECK(parseNodeReading("{\"sensor\":\"" + std::string(50, 'x') + "\"}", NOW).ok);
  CHECK(!parseNodeReading("{\"sensor\":\"a\\u0001b\"}", NOW).ok);             // control character
  CHECK(!parseNodeReading("{\"sensor\":\"1\",\"moisture\":\"31\"}", NOW).ok);  // text where a number belongs: a node bug, not silently dropped
  CHECK(!parseNodeReading("{\"sensor\":\"1\",\"ec\":false}", NOW).ok);
  CHECK(!parseNodeReading(std::string(MAX_BODY_BYTES + 1, ' '), NOW).ok);
  CHECK(!parseNodeReading("not json", NOW).ok);
}

static void testLines() {
  Reading r = mk(NOW, "left side", 31.2);
  r.ec = 1.3; r.potassium = 110;
  std::string line = encodeLine(r);
  CHECK_EQ(line, "1793005200\tleft side\t31.2\t\t1.3\t\t\t110");
  Reading back;
  CHECK(decodeLine(line, back));
  CHECK(back.epoch == NOW && back.sensor == "left side" && back.moisture == 31.2 && back.ec == 1.3 && back.potassium == 110);
  CHECK(std::isnan(back.soilTemperature) && std::isnan(back.nitrogen) && std::isnan(back.phosphorus));
  CHECK(decodeLine(encodeLine(mk(NOW, "1", 0)), back) && back.moisture == 0);  // zero survives, only empty means not measured
  CHECK(decodeLine(encodeLine(mk(NOW, "1", 23.456789)), back) && std::fabs(back.moisture - 23.456789) < 1e-9);

  const char* corrupt[] = {"", "garbage", "1793005200\t1", "1793005200\t1\t\t\t\t\t\t\textra", "abc\t1\t\t\t\t\t\t", "0\t1\t\t\t\t\t\t", "1793005200\t\t\t\t\t\t\t", "1793005200\t1\tx\t\t\t\t\t", "1793005200\t1\tnan\t\t\t\t\t", "-5\t1\t\t\t\t\t\t"};
  for (const char* c : corrupt) { CHECK(!decodeLine(c, back)); }
}

static void testBatches() {
  // three sensors in the same minute -> one request
  std::vector<Reading> all = {mk(NOW - 30, "1", 20), mk(NOW - 25, "2", 21), mk(NOW - 20, "left", 22)};
  BatchPlan p = buildBatches(all, NOW);
  CHECK(p.dropped.empty() && p.batches.size() == 1);
  CHECK(p.batches[0].measuredAt == (NOW - 30) / 60 * 60);
  CHECK(p.batches[0].readings.size() == 3 && p.batches[0].consumed.size() == 3);

  // two minutes -> two requests, the oldest first
  all = {mk(NOW - 10, "1", 1), mk(NOW - 130, "1", 2)};
  p = buildBatches(all, NOW);
  CHECK(p.batches.size() == 2 && p.batches[0].measuredAt < p.batches[1].measuredAt);
  CHECK(p.batches[0].readings[0].moisture == 2);

  // the same sensor twice in a minute (any case): only the newest is sent, the older one is consumed with it
  all = {mk(NOW - 50, "Left", 10), mk(NOW - 40, "left", 11), mk(NOW - 45, "2", 5)};
  p = buildBatches(all, NOW);
  CHECK(p.batches.size() == 1 && p.batches[0].readings.size() == 2);
  double sentLeft = NAN;
  for (const Reading& r : p.batches[0].readings) if (lowerKey(r.sensor) == "left") sentLeft = r.moisture;
  CHECK(sentLeft == 11);
  CHECK(p.batches[0].consumed.size() == 3);  // all three lines leave the buffer once the batch is accepted

  // too old (the server refuses > 24 h) and from the future are dropped, never sent
  all = {mk(NOW - MAX_AGE_S - 1, "1", 1), mk(NOW - MAX_AGE_S, "1", 2), mk(NOW + MAX_FUTURE_S + 1, "1", 3), mk(NOW + MAX_FUTURE_S, "2", 4)};
  p = buildBatches(all, NOW);
  CHECK(p.dropped.size() == 2 && p.dropped[0] == 0 && p.dropped[1] == 2);
  size_t sent = 0;
  for (const Batch& b : p.batches) sent += b.readings.size();
  CHECK(sent == 2);

  // more than 50 sensors in one minute -> split, same measured_at
  all.clear();
  for (int i = 0; i < 120; i++) all.push_back(mk(NOW - 20, ("s" + std::to_string(i)).c_str(), i));
  p = buildBatches(all, NOW);
  CHECK(p.batches.size() == 3);
  CHECK(p.batches[0].readings.size() == 50 && p.batches[1].readings.size() == 50 && p.batches[2].readings.size() == 20);
  CHECK(p.batches[0].measuredAt == p.batches[2].measuredAt);
  size_t consumed = 0;
  for (const Batch& b : p.batches) consumed += b.consumed.size();
  CHECK(consumed == 120);  // every line is accounted for exactly once

  CHECK(buildBatches({}, NOW).batches.empty());
}

static void testPayload() {
  Batch b; b.measuredAt = NOW;
  Reading a = mk(0, "1", 31.2); a.soilTemperature = 24.1; a.ec = 1.3;
  Reading n = mk(0, "left \"x\"", NAN); n.nitrogen = 14; n.phosphorus = 0; n.potassium = 110.5;
  Reading empty = mk(0, "3");
  b.readings = {a, n, empty};
  CHECK_EQ(buildPayload(b),
    "{\"measured_at\":\"2026-10-26T09:00:00Z\",\"readings\":["
    "{\"sensor\":\"1\",\"moisture\":31.2,\"soil_temperature\":24.1,\"ec\":1.3},"
    "{\"sensor\":\"left \\\"x\\\"\",\"nitrogen\":14,\"phosphorus\":0,\"potassium\":110.5},"  // a not-measured value is left out, a real 0 is kept
    "{\"sensor\":\"3\"}]}");
  // what we send must be parseable by the same strict parser (no extra characters, no NaN)
  CHECK(buildPayload(b).find("nan") == std::string::npos);
}

static void testTime() {
  CHECK_EQ(isoUtc(0), "1970-01-01T00:00:00Z");
  CHECK_EQ(isoUtc(1709164800), "2024-02-29T00:00:00Z");  // leap day
  CHECK_EQ(isoUtc(1790000000), "2026-09-21T14:13:20Z");
  CHECK_EQ(isoUtc(NOW), "2026-10-26T09:00:00Z");
  CHECK_EQ(isoUtc(NOW + 86399), "2026-10-27T08:59:59Z");
  CHECK_EQ(isoUtc(951782400), "2000-02-29T00:00:00Z");
}

static void testServerAnswers() {
  CHECK(classifyHttp(200) == Verdict::Done);
  CHECK(classifyHttp(-1) == Verdict::RetrySoon);    // no connection
  CHECK(classifyHttp(0) == Verdict::RetrySoon);
  CHECK(classifyHttp(500) == Verdict::RetrySoon);
  CHECK(classifyHttp(503) == Verdict::RetrySoon);
  CHECK(classifyHttp(429) == Verdict::RetrySoon);
  CHECK(classifyHttp(400) == Verdict::DropBatch);   // the server will never accept this body
  CHECK(classifyHttp(401) == Verdict::FixSettings); // wrong or revoked token: keep the readings
  CHECK(classifyHttp(409) == Verdict::FixSettings); // device not attached to an environment
  CHECK(classifyHttp(404) == Verdict::FixSettings);
  CHECK(backoffSeconds(1, false) == 30 && backoffSeconds(2, false) == 60 && backoffSeconds(3, false) == 120);
  CHECK(backoffSeconds(50, false) == 1800);
  CHECK(backoffSeconds(1, true) == 1800);
}

static void testSameText() {
  CHECK(sameText("secret", "secret"));
  CHECK(!sameText("secret", "secreT"));
  CHECK(!sameText("secret", "secre"));
  CHECK(!sameText("", "x"));
  CHECK(sameText("", ""));
}

int main() {
  testJson(); testNodeReading(); testLines(); testBatches(); testPayload(); testTime(); testServerAnswers(); testSameText();
  std::printf("%d checks, %d failed\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
