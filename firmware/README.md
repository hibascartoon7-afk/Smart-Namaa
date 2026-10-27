# NAMAA firmware (ESP32)

Status (2026-10-24): **written, not yet run on a real ESP32.** The logic is tested on a computer (see "Tests"); the Wi-Fi, flash and TLS parts are only type-checked, so expect to fix small things on the first real flash.

```
field nodes (one per sensor point)                 THIS HUB (one per environment)                     Supabase
  sensor --> node --Wi-Fi of the hub, http--> POST /reading --> buffer on the flash --https, every 5 min--> sensor-ingest --> sensor_readings
```

| Folder | What it is |
|---|---|
| `namaa_hub/` | The hub. Opens its own Wi-Fi, takes the readings of the nodes, keeps them on the flash and uploads them. |
| `namaa_node_example/` | A **template** for a field node. The sensor driver is missing on purpose: your sensor model is not known to this project. |
| `tests/` | Tests of the hub logic (`hub_logic.h`), run on a normal computer. |

## What the hub does

- Opens the Wi-Fi `AP_SSID` (password `AP_PASSWORD`). Nodes join it and `POST` one JSON reading per sensor point to `http://192.168.4.1/reading`.
- Also joins the farm's internet Wi-Fi (`STA_SSID`), because it needs the internet to upload and to learn the time (NTP).
- Writes every reading to the flash **first**; removes it only after the server answered 200. A power cut or an internet outage loses nothing (up to `MAX_BUFFER_LINES`, and nothing older than 24 hours: the server refuses older readings).
- Every `UPLOAD_INTERVAL_S` seconds it groups the buffer by minute: **one request per minute**, one reading per sensor (the newest), at most 50 sensors, oldest minute first.
- A value that is missing or `null` stays "not measured": it is left out of the request and never turned into 0. A real 0 stays 0.
- The hub does **not** judge the numbers. An impossible value (moisture 140) is forwarded; the server marks it `suspect`.
- The hub never decides irrigation or fertilization. It only moves readings.

## Setup

1. **Create the device in the app** (environment tools). The token is shown **once**. Create the sensor points in the app first: the name a node sends (`"sensor":"1"`) must be the name of a sensor point (case and extra spaces are ignored). A reading with an unknown name is **not stored** by the server; the hub shows this in `/status` under `warning`.
2. **Arduino IDE**: install the board package *esp32 by Espressif* (core 2.x or 3.x), choose *ESP32 Dev Module*. No extra libraries are needed.
3. Copy `namaa_hub/config.example.h` to `namaa_hub/config.h` and fill it in (`config.h` is in `.gitignore`: it holds the token).
4. **The root certificate** (needed for the https upload, step below).
5. Upload `namaa_hub/namaa_hub.ino`. Open the Serial Monitor at 115200 baud: you see the Wi-Fi, the time and every upload.
6. From a phone: join the hub's Wi-Fi and open `http://192.168.4.1/status`.

### The root certificate

The hub only sends the token to a server it can identify. `ROOT_CA` in `config.h` must hold the root certificate of the authority that signed `<project>.supabase.co`:

```bash
openssl s_client -showcerts -connect YOUR-PROJECT-REF.supabase.co:443 -servername YOUR-PROJECT-REF.supabase.co </dev/null
```

Look at the **last** certificate in the answer and at its `i:` (issuer) line. Download that issuer's *root* certificate (PEM) from the authority's own web page, and paste it between the quotes of `ROOT_CA`, `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----` lines included. Authorities rotate roots now and then: if uploads suddenly fail with a TLS error in `/status` (`last_error`), repeat this step.

Without `ROOT_CA` the hub still collects readings but uploads nothing, and says so in `/status` (`tls_ready: false`). For a quick test on your desk you can set `ALLOW_INSECURE_TLS 1`; then anyone on the network could read the device token, so never leave it on.

## Test without any node

```bash
curl -X POST http://192.168.4.1/reading -H "Content-Type: application/json" \
     -d '{"sensor":"1","moisture":31.2,"soil_temperature":24.1,"ec":1.3}'
```

Use the name of a real sensor point. Answer `{"ok":true,"buffered":1}`. After at most `UPLOAD_INTERVAL_S` seconds the Serial Monitor shows `POST 1 readings of ... -> HTTP 200` and the reading appears in the app.

## What a node sends

`POST http://192.168.4.1/reading`, `Content-Type: application/json`, body = one flat JSON object (no nesting):

| Field | Meaning |
|---|---|
| `sensor` | **Required.** Name of the sensor point in the app (text or a whole number). |
| `moisture` | % of volume, 0-100 |
| `soil_temperature` | deg C |
| `ec` | dS/m |
| `nitrogen`, `phosphorus`, `potassium` | Only for an NPK sensor. Plain numbers; their unit and method are declared on the device in Supabase, not sent (see `docs/guide-5-setup-deploy-and-tests.md`). |
| `age_s` | Optional. Seconds since the node measured it (a node that kept the reading while the hub was away). 0 to 85800. |

Every value is optional: `null` or missing = not measured. Text or `true`/`false` where a number belongs is refused (a node bug must be visible, not silently dropped). Unknown fields are ignored. If `NODE_KEY` is set, send it in the header `X-Namaa-Node-Key`.

| Answer of the hub | Node should |
|---|---|
| `200` | forget the reading |
| `400` | the reading is invalid for good (bad name, text instead of a number): drop it |
| `401` | wrong or missing node key |
| `503` | the hub's clock is not set yet (no internet time): keep the reading, retry in a minute |
| `507` | the hub buffer is full (the hub has no internet or a wrong token): keep the reading, retry later |

`GET /status` shows the hub's state (clock, internet, buffer size, uploads, last error, warning). It never shows the token.

## What the hub does with the server's answers

| Server answer | Hub |
|---|---|
| `200` | removes those readings from the buffer |
| no answer, `408`, `429`, `5xx` | keeps them, retries after 30 s, 60 s, 120 s ... up to 30 min |
| `400` (the server will never accept it, e.g. older than 24 h) | removes that batch and shows it in `/status` (`last_error`, `batches_refused_for_good`) |
| `401`, `403`, `404`, `409` (wrong or revoked token, wrong address, device not attached to an environment) | keeps the readings, retries every 30 min, shows the cause in `last_error` |

## Known limits

- **A lost answer can duplicate a reading.** If the server stores a batch but the answer never reaches the hub, the hub sends it again. `sensor_readings` has no unique constraint on (sensor point, time), so the same reading is stored twice. The engine uses the latest reading of each point, so decisions do not change, but history has a double row. A server-side fix (unique index + upsert in `sensor-ingest`) is possible and not done yet.
- Readings are timed to the minute (the server accepts one `measured_at` per request); this moves a reading by less than 60 seconds.
- While the hub uploads (up to about 10 s per request) it does not answer nodes; a node that gets no answer must retry (the template does).
- The clock comes from the internet. After a reboot without internet the hub answers 503 until it knows the time; it never guesses.
- No over-the-air update and no Wi-Fi setup page: change `config.h` and flash again.
- If your farm router uses `192.168.4.x`, change `AP_IP` in `config.h`.
- The sketches were not run on a real ESP32 and the TLS certificate step depends on your project's certificate chain.

## Tests

```bash
npm run test:firmware        # or: bash firmware/tests/run.sh      (needs g++)
```

112 checks of `namaa_hub/hub_logic.h`, compiled as C++11 with the address and undefined-behaviour sanitizers: the JSON check (valid and broken bodies), "not measured" is never 0, the buffer line format and damaged lines, the grouping by minute (same sensor twice, more than 50 sensors, too old, from the future), the exact request body, the date text (leap years), and what to do with each HTTP code. The request body built by this code was also given to the server's own `parseIngestPayload` and accepted.
