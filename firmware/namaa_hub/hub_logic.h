// NAMAA hub: the logic that does NOT depend on the ESP32 (so it is tested on a normal computer: firmware/tests).
// What it does:
//   - checks one reading sent by a field node (flat JSON) and keeps "not measured" as NaN (never 0, never a guess);
//   - writes / reads a reading as one text line (the buffer file on the flash);
//   - groups buffered readings into the requests sensor-ingest accepts (same minute, one reading per sensor, at most 50);
//   - builds the JSON body, and decides what to do with the answer of the server.
// Rules: docs/guide-5-setup-deploy-and-tests.md (section 5) and src/engine/ingest.ts describe what the server accepts.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <vector>

namespace namaa {

constexpr size_t MAX_SENSOR_NAME = 50;            // the server refuses longer names
constexpr size_t MAX_READINGS_PER_REQUEST = 50;   // the server refuses more readings per request
constexpr size_t MAX_BODY_BYTES = 1024;           // a node reading is tiny; anything bigger is a mistake or an attack
constexpr int64_t MAX_AGE_S = 23 * 3600 + 50 * 60;  // the server refuses a measured_at older than 24 h: drop before that
constexpr int64_t MAX_FUTURE_S = 300;             // the server refuses a measured_at more than 5 min ahead
constexpr int64_t BUCKET_S = 60;                  // readings of the same minute travel in one request
constexpr int64_t MIN_VALID_EPOCH = 1700000000;   // 2023-11-14: an earlier clock was never set

inline bool isMeasured(double v) { return !std::isnan(v); }

/** one reading of one sensor point. NaN = not measured. */
struct Reading {
  int64_t epoch = 0;  // seconds since 1970 (UTC), set by the hub
  std::string sensor;
  double moisture = NAN;
  double soilTemperature = NAN;
  double ec = NAN;
  double nitrogen = NAN;
  double phosphorus = NAN;
  double potassium = NAN;
};

// ---------------------------------------------------------------------------------------------------------------------
// 1) A flat JSON object: {"sensor":"1","moisture":31.2,"ec":null}. No nesting, no arrays: a node has nothing to nest.

struct JsonValue {
  enum Type { Null, Number, String, Bool } type = Null;
  double number = 0;
  std::string text;
  bool flag = false;
};

namespace detail {

inline void skipSpace(const std::string& s, size_t& i) {
  while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\r' || s[i] == '\n')) i++;
}

inline void appendUtf8(std::string& out, uint32_t cp) {
  if (cp < 0x80) out += static_cast<char>(cp);
  else if (cp < 0x800) { out += static_cast<char>(0xC0 | (cp >> 6)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
  else { out += static_cast<char>(0xE0 | (cp >> 12)); out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
}

inline bool parseString(const std::string& s, size_t& i, std::string& out, std::string& err) {
  out.clear();
  if (i >= s.size() || s[i] != '"') { err = "expected a string"; return false; }
  i++;
  while (i < s.size()) {
    unsigned char c = static_cast<unsigned char>(s[i]);
    if (c == '"') { i++; return true; }
    if (c < 0x20) { err = "control character inside a string"; return false; }
    if (c != '\\') { out += static_cast<char>(c); i++; continue; }
    i++;
    if (i >= s.size()) break;
    char e = s[i++];
    switch (e) {
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case '/': out += '/'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'u': {
        if (i + 4 > s.size()) { err = "bad \\u escape"; return false; }
        uint32_t cp = 0;
        for (int k = 0; k < 4; k++) {
          char h = s[i + k];
          cp <<= 4;
          if (h >= '0' && h <= '9') cp |= static_cast<uint32_t>(h - '0');
          else if (h >= 'a' && h <= 'f') cp |= static_cast<uint32_t>(h - 'a' + 10);
          else if (h >= 'A' && h <= 'F') cp |= static_cast<uint32_t>(h - 'A' + 10);
          else { err = "bad \\u escape"; return false; }
        }
        i += 4;
        if (cp >= 0xD800 && cp <= 0xDFFF) { err = "surrogate pairs are not supported"; return false; }
        appendUtf8(out, cp);
        break;
      }
      default: err = "bad escape in a string"; return false;
    }
  }
  err = "unterminated string";
  return false;
}

/** JSON number grammar: -?(0|[1-9][0-9]*)(.[0-9]+)?([eE][+-]?[0-9]+)? */
inline bool parseNumber(const std::string& s, size_t& i, double& out, std::string& err) {
  size_t start = i;
  if (i < s.size() && s[i] == '-') i++;
  if (i >= s.size() || !(s[i] >= '0' && s[i] <= '9')) { err = "bad number"; return false; }
  if (s[i] == '0') i++;
  else while (i < s.size() && s[i] >= '0' && s[i] <= '9') i++;
  if (i < s.size() && s[i] == '.') {
    i++;
    if (i >= s.size() || !(s[i] >= '0' && s[i] <= '9')) { err = "bad number"; return false; }
    while (i < s.size() && s[i] >= '0' && s[i] <= '9') i++;
  }
  if (i < s.size() && (s[i] == 'e' || s[i] == 'E')) {
    i++;
    if (i < s.size() && (s[i] == '+' || s[i] == '-')) i++;
    if (i >= s.size() || !(s[i] >= '0' && s[i] <= '9')) { err = "bad number"; return false; }
    while (i < s.size() && s[i] >= '0' && s[i] <= '9') i++;
  }
  out = std::strtod(s.substr(start, i - start).c_str(), nullptr);
  if (!std::isfinite(out)) { err = "number out of range"; return false; }
  return true;
}

}  // namespace detail

inline bool parseFlatJson(const std::string& s, std::map<std::string, JsonValue>& out, std::string& err) {
  out.clear();
  size_t i = 0;
  detail::skipSpace(s, i);
  if (i >= s.size() || s[i] != '{') { err = "body must be a JSON object"; return false; }
  i++;
  detail::skipSpace(s, i);
  if (i < s.size() && s[i] == '}') { i++; }
  else {
    for (;;) {
      detail::skipSpace(s, i);
      std::string key;
      if (!detail::parseString(s, i, key, err)) return false;
      detail::skipSpace(s, i);
      if (i >= s.size() || s[i] != ':') { err = "expected ':'"; return false; }
      i++;
      detail::skipSpace(s, i);
      if (i >= s.size()) { err = "unexpected end"; return false; }
      JsonValue v;
      char c = s[i];
      if (c == '"') { v.type = JsonValue::String; if (!detail::parseString(s, i, v.text, err)) return false; }
      else if (c == '-' || (c >= '0' && c <= '9')) { v.type = JsonValue::Number; if (!detail::parseNumber(s, i, v.number, err)) return false; }
      else if (s.compare(i, 4, "null") == 0) { v.type = JsonValue::Null; i += 4; }
      else if (s.compare(i, 4, "true") == 0) { v.type = JsonValue::Bool; v.flag = true; i += 4; }
      else if (s.compare(i, 5, "false") == 0) { v.type = JsonValue::Bool; v.flag = false; i += 5; }
      else { err = (c == '{' || c == '[') ? "nested objects and arrays are not accepted" : "bad value"; return false; }
      out[key] = v;
      detail::skipSpace(s, i);
      if (i < s.size() && s[i] == ',') { i++; continue; }
      if (i < s.size() && s[i] == '}') { i++; break; }
      err = "expected ',' or '}'";
      return false;
    }
  }
  detail::skipSpace(s, i);
  if (i != s.size()) { err = "extra text after the JSON object"; return false; }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// 2) One reading sent by a field node

struct ParseResult {
  bool ok = false;
  std::string error;
  Reading reading;
};

/** collapses runs of spaces / tabs / newlines to one space and trims, like the server does with sensor names */
inline std::string cleanName(const std::string& raw) {
  std::string out;
  bool pendingSpace = false;
  for (char ch : raw) {
    if (ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n') { pendingSpace = !out.empty(); continue; }
    if (pendingSpace) { out += ' '; pendingSpace = false; }
    out += ch;
  }
  return out;
}

/**
 * Node body: {"sensor":"1","moisture":31.2,"soil_temperature":24.1,"ec":1.3,"nitrogen":..,"phosphorus":..,"potassium":..,"age_s":0}
 *  - "sensor" is the NAME of the sensor point in the app (text or a whole number);
 *  - a value that is null or missing is "not measured" (NaN); a text or true/false there is a node bug and is refused;
 *  - the values are forwarded as sent: the SERVER marks impossible ones as suspect (the hub does not judge physics);
 *  - "age_s" (optional): seconds since the node measured it (a node that kept the reading while the hub was away).
 */
inline ParseResult parseNodeReading(const std::string& body, int64_t nowEpoch) {
  ParseResult r;
  if (body.size() > MAX_BODY_BYTES) { r.error = "body is too big"; return r; }
  std::map<std::string, JsonValue> j;
  if (!parseFlatJson(body, j, r.error)) return r;

  auto s = j.find("sensor");
  if (s == j.end() || s->second.type == JsonValue::Null) { r.error = "sensor (the name of the sensor point) is required"; return r; }
  std::string name;
  if (s->second.type == JsonValue::String) name = cleanName(s->second.text);
  else if (s->second.type == JsonValue::Number && s->second.number == std::floor(s->second.number) && std::fabs(s->second.number) < 1e9) {
    char buf[24];
    std::snprintf(buf, sizeof buf, "%lld", static_cast<long long>(s->second.number));
    name = buf;
  } else { r.error = "sensor must be text or a whole number"; return r; }
  if (name.empty() || name.size() > MAX_SENSOR_NAME) { r.error = "sensor must be 1-50 characters"; return r; }
  for (char ch : name) if (static_cast<unsigned char>(ch) < 0x20) { r.error = "sensor has a control character"; return r; }

  struct Field { const char* key; double* target; };
  Field fields[] = {
    {"moisture", &r.reading.moisture}, {"soil_temperature", &r.reading.soilTemperature}, {"ec", &r.reading.ec},
    {"nitrogen", &r.reading.nitrogen}, {"phosphorus", &r.reading.phosphorus}, {"potassium", &r.reading.potassium},
  };
  for (const Field& f : fields) {
    auto it = j.find(f.key);
    if (it == j.end() || it->second.type == JsonValue::Null) continue;  // not measured
    if (it->second.type != JsonValue::Number) { r.error = std::string(f.key) + " must be a number or null"; return r; }
    *f.target = it->second.number;
  }

  int64_t age = 0;
  auto a = j.find("age_s");
  if (a != j.end() && a->second.type != JsonValue::Null) {
    if (a->second.type != JsonValue::Number || a->second.number < 0 || a->second.number > static_cast<double>(MAX_AGE_S)) { r.error = "age_s must be a number from 0 to 85800"; return r; }
    age = static_cast<int64_t>(a->second.number);
  }
  r.reading.sensor = name;
  r.reading.epoch = nowEpoch - age;
  r.ok = true;
  return r;
}

// ---------------------------------------------------------------------------------------------------------------------
// 3) The buffer file: one reading per line, tab separated: epoch sensor moisture soil_temperature ec nitrogen phosphorus potassium
//    (an empty field = not measured). A sensor name cannot hold a tab or a newline (cleanName / parseNodeReading make sure).

inline std::string numberText(double v) {
  char buf[40];
  std::snprintf(buf, sizeof buf, "%.9g", v);
  return buf;
}

inline std::string encodeLine(const Reading& r) {
  std::string line = std::to_string(static_cast<long long>(r.epoch)) + "\t" + r.sensor;
  const double vals[] = {r.moisture, r.soilTemperature, r.ec, r.nitrogen, r.phosphorus, r.potassium};
  for (double v : vals) { line += '\t'; if (isMeasured(v)) line += numberText(v); }
  return line;
}

inline bool decodeLine(const std::string& line, Reading& out) {
  std::vector<std::string> parts;
  size_t start = 0;
  for (;;) {
    size_t tab = line.find('\t', start);
    if (tab == std::string::npos) { parts.push_back(line.substr(start)); break; }
    parts.push_back(line.substr(start, tab - start));
    start = tab + 1;
  }
  if (parts.size() != 8 || parts[0].empty() || parts[1].empty()) return false;
  char* end = nullptr;
  long long e = std::strtoll(parts[0].c_str(), &end, 10);
  if (*end != '\0' || e <= 0) return false;
  Reading r;
  r.epoch = e;
  r.sensor = parts[1];
  double* targets[] = {&r.moisture, &r.soilTemperature, &r.ec, &r.nitrogen, &r.phosphorus, &r.potassium};
  for (int k = 0; k < 6; k++) {
    const std::string& p = parts[2 + k];
    if (p.empty()) continue;
    double v = std::strtod(p.c_str(), &end);
    if (*end != '\0' || !std::isfinite(v)) return false;
    *targets[k] = v;
  }
  out = r;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// 4) Requests for sensor-ingest

struct Batch {
  int64_t measuredAt = 0;              // start of the minute: the server gets ONE measured_at per request
  std::vector<Reading> readings;       // one per sensor, at most 50
  std::vector<size_t> consumed;        // positions (in the list given to buildBatches) that are done once this batch is accepted
};

struct BatchPlan {
  std::vector<Batch> batches;          // oldest minute first
  std::vector<size_t> dropped;         // positions that can never be sent (older than the server accepts, or from the future)
};

inline std::string lowerKey(const std::string& s) {
  std::string k = s;
  for (char& c : k) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  return k;
}

/**
 * Groups readings by minute. Inside one minute a sensor appears once: the NEWEST reading is sent and the older ones of the same
 * sensor are marked consumed with it (the server refuses a sensor named twice in one request).
 */
inline BatchPlan buildBatches(const std::vector<Reading>& all, int64_t nowEpoch) {
  BatchPlan plan;
  std::map<int64_t, std::vector<size_t> > byMinute;
  for (size_t i = 0; i < all.size(); i++) {
    const int64_t e = all[i].epoch;
    if (e < nowEpoch - MAX_AGE_S || e > nowEpoch + MAX_FUTURE_S) { plan.dropped.push_back(i); continue; }
    byMinute[e / BUCKET_S].push_back(i);
  }
  // (C++11 style on purpose: older ESP32 Arduino cores compile with -std=gnu++11)
  for (std::map<int64_t, std::vector<size_t> >::iterator mit = byMinute.begin(); mit != byMinute.end(); ++mit) {
    const int64_t minute = mit->first;
    const std::vector<size_t>& idx = mit->second;
    std::map<std::string, size_t> newest;  // sensor (any case) -> position of its newest reading
    for (size_t i : idx) {
      std::string key = lowerKey(all[i].sensor);
      auto it = newest.find(key);
      if (it == newest.end() || all[i].epoch >= all[it->second].epoch) newest[key] = i;
    }
    std::vector<size_t> keep;
    for (auto& kv : newest) keep.push_back(kv.second);
    std::sort(keep.begin(), keep.end());  // the order the readings arrived in
    for (size_t from = 0; from < keep.size(); from += MAX_READINGS_PER_REQUEST) {
      Batch b;
      b.measuredAt = minute * BUCKET_S;
      for (size_t k = from; k < (std::min)(keep.size(), from + MAX_READINGS_PER_REQUEST); k++) {
        b.readings.push_back(all[keep[k]]);
        b.consumed.push_back(keep[k]);
      }
      if (from == 0) {
        // the older duplicates of the same minute ride with the first batch: they are replaced by a newer reading
        for (size_t i : idx) if (std::find(keep.begin(), keep.end(), i) == keep.end()) b.consumed.push_back(i);
      }
      plan.batches.push_back(b);
    }
  }
  return plan;
}

/** 2026-10-24T09:00:00Z from seconds since 1970 (no time zone database needed) */
inline std::string isoUtc(int64_t epoch) {
  int64_t days = epoch / 86400;
  int64_t rem = epoch % 86400;
  if (rem < 0) { rem += 86400; days--; }
  // civil date from days since 1970-01-01 (Howard Hinnant's algorithm)
  int64_t z = days + 719468;
  int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  int64_t doe = z - era * 146097;
  int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  int64_t y = yoe + era * 400;
  int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  int64_t mp = (5 * doy + 2) / 153;
  int64_t d = doy - (153 * mp + 2) / 5 + 1;
  int64_t m = mp < 10 ? mp + 3 : mp - 9;
  if (m <= 2) y++;
  char buf[96];
  std::snprintf(buf, sizeof buf, "%04lld-%02lld-%02lldT%02lld:%02lld:%02lldZ", static_cast<long long>(y), static_cast<long long>(m), static_cast<long long>(d),
                static_cast<long long>(rem / 3600), static_cast<long long>((rem % 3600) / 60), static_cast<long long>(rem % 60));
  return buf;
}

inline std::string jsonString(const std::string& s) {
  std::string out = "\"";
  for (char ch : s) {
    unsigned char c = static_cast<unsigned char>(ch);
    if (c == '"') out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); out += b; }
    else out += ch;
  }
  return out + "\"";
}

/** the body for sensor-ingest. A value that was not measured is left out (the server reads that as "not measured"). */
inline std::string buildPayload(const Batch& b) {
  std::string out = "{\"measured_at\":\"" + isoUtc(b.measuredAt) + "\",\"readings\":[";
  for (size_t i = 0; i < b.readings.size(); i++) {
    const Reading& r = b.readings[i];
    if (i) out += ',';
    out += "{\"sensor\":" + jsonString(r.sensor);
    auto add = [&](const char* key, double v) { if (isMeasured(v)) out += std::string(",\"") + key + "\":" + numberText(v); };
    add("moisture", r.moisture);
    add("soil_temperature", r.soilTemperature);
    add("ec", r.ec);
    add("nitrogen", r.nitrogen);
    add("phosphorus", r.phosphorus);
    add("potassium", r.potassium);
    out += '}';
  }
  return out + "]}";
}

// ---------------------------------------------------------------------------------------------------------------------
// 5) What to do with the answer of the server

enum class Verdict {
  Done,           // 200: stored, remove the readings from the buffer
  RetrySoon,      // no network / server busy / server error: keep the readings, try again with a growing pause
  DropBatch,      // 400: the server will never accept this body (for example older than 24 h): remove it, say so loudly
  FixSettings,    // 401 token wrong or revoked, 409 device not attached, 404/403 wrong address: keep the readings, wait long, tell the owner
};

inline Verdict classifyHttp(int code) {
  if (code == 200) return Verdict::Done;
  if (code <= 0 || code == 408 || code == 425 || code == 429 || code >= 500) return Verdict::RetrySoon;
  if (code == 400 || code == 413 || code == 422) return Verdict::DropBatch;
  return Verdict::FixSettings;
}

/** seconds to wait after `failures` failures in a row: 30, 60, 120 ... up to 30 minutes */
inline int64_t backoffSeconds(int failures, bool settingsProblem) {
  const int64_t maxS = 1800;
  if (settingsProblem) return maxS;
  int64_t s = 30;
  for (int i = 1; i < failures && s < maxS; i++) s *= 2;
  return (std::min<int64_t>)(s, maxS);
}

/** compares two texts without stopping at the first difference (the node key must not leak through timing) */
inline bool sameText(const std::string& a, const std::string& b) {
  unsigned char diff = static_cast<unsigned char>(a.size() != b.size());
  const size_t n = (std::min)(a.size(), b.size());
  for (size_t i = 0; i < n; i++) diff |= static_cast<unsigned char>(a[i] ^ b[i]);
  return diff == 0;
}

}  // namespace namaa
