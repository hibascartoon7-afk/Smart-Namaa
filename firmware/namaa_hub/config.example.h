// Copy this file to config.h (same folder) and fill it in. config.h is in .gitignore: it holds the device token.
#pragma once

// ---- 1) The internet: the Wi-Fi of the farm (router or phone hotspot). The hub needs it to upload and to learn the time (NTP).
#define STA_SSID "farm-wifi"
#define STA_PASSWORD "change-me"

// ---- 2) The hub's OWN Wi-Fi: the field nodes (the sensors) connect to it and send their readings.
#define AP_SSID "NAMAA-HUB-1"
#define AP_PASSWORD "change-this-password"  // at least 8 characters
// Address of the hub on its own network. Change it only if your farm router uses 192.168.4.x too.
#define AP_IP 192, 168, 4, 1
// Optional: a node must send this text in the header "X-Namaa-Node-Key" ("" = no key). The Wi-Fi password already protects the hub.
#define NODE_KEY ""

// ---- 3) Supabase. The token is shown ONCE when you create the device in the app (environment tools). Never publish it.
#define INGEST_URL "https://YOUR-PROJECT-REF.supabase.co/functions/v1/sensor-ingest"
#define DEVICE_TOKEN "nmd_paste-the-token-here"

// ---- 4) Timing and memory
#define UPLOAD_INTERVAL_S 300  // the hub sends what it collected every 5 minutes
#define MAX_BUFFER_LINES 8000  // readings kept on the flash while the internet is down (about 500 KB)

// ---- 5) Secure connection (TLS). The hub only talks to Supabase over https and checks who answers.
// Paste the ROOT certificate that signs your project's address (README: "The root certificate"), including the BEGIN / END lines.
static const char ROOT_CA[] = "";
// 1 = do NOT check who answers. Only for a quick test on your desk: anyone on the network could then read the device token.
#define ALLOW_INSECURE_TLS 0
