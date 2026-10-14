// NAMAA sensor ingestion endpoint — receives readings from IoT devices
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Sensor-Token",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Validation ranges based on agronomic standards
const RANGES = {
  n: [0, 200],      // nitrogen mg/kg
  p: [0, 100],      // phosphorus mg/kg
  k: [0, 500],      // potassium mg/kg
  ec: [0, 15],      // electrical conductivity mS/cm
  temp: [-10, 50],  // soil temperature °C
  ph: [3, 10],      // soil pH
  vwc: [0, 100],    // volumetric water content %
};

interface SensorReading {
  meter_id: string;
  n?: number;
  p?: number;
  k?: number;
  ec?: number;
  temp?: number;
  ph?: number;
  vwc?: number;
  ts?: string;
}

function validateReading(reading: SensorReading): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!reading.meter_id || typeof reading.meter_id !== "string") {
    errors.push("meter_id is required");
  }

  for (const [field, [min, max]] of Object.entries(RANGES)) {
    const value = reading[field as keyof SensorReading];
    if (value !== undefined && value !== null) {
      if (typeof value !== "number" || isNaN(value)) {
        errors.push(`${field} must be a number, got ${typeof value}`);
      } else if (value < min || value > max) {
        errors.push(`${field} value ${value} is out of range [${min}, ${max}]`);
      }
    }
  }

  // Timestamp validation
  if (reading.ts) {
    const ts = new Date(reading.ts);
    if (isNaN(ts.getTime())) {
      errors.push("ts is not a valid ISO timestamp");
    } else {
      const ageHours = (Date.now() - ts.getTime()) / 3600000;
      if (ageHours > 24) {
        errors.push(`ts is too old (${Math.round(ageHours)}h) — readings older than 24h are rejected`);
      }
      if (ageHours < -1) {
        errors.push("ts is in the future — clock sync issue suspected");
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Only POST requests are supported." }, 405);

    // Authenticate via sensor token or user session
    const sensorToken = req.headers.get("X-Sensor-Token");
    const authHeader = req.headers.get("Authorization");

    let authorized = false;

    if (sensorToken) {
      // IoT devices authenticate with a pre-shared sensor token
      const expectedToken = Deno.env.get("SENSOR_INGEST_TOKEN");
      if (expectedToken && sensorToken === expectedToken) {
        authorized = true;
      }
    }

    if (!authorized && authHeader?.startsWith("Bearer ")) {
      // Also allow authenticated users (for manual ingestion/testing)
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && user) {
        authorized = true;
      }
    }

    if (!authorized) {
      return json({ error: "Authentication required. Use X-Sensor-Token header or Bearer token." }, 401);
    }

    const body = await req.json();

    // Support both single reading and batch readings
    const readings: SensorReading[] = Array.isArray(body) ? body : [body];

    if (readings.length === 0) {
      return json({ error: "No readings provided." }, 400);
    }

    if (readings.length > 100) {
      return json({ error: "Batch too large. Maximum 100 readings per request." }, 400);
    }

    const results: Array<{ meter_id: string; status: string; errors?: string[] }> = [];
    const validReadings: Array<Record<string, unknown>> = [];

    // Verify all meter_ids exist in field_meters
    const meterIds = [...new Set(readings.map((r) => r.meter_id).filter(Boolean))];
    const { data: meters } = await supabaseAdmin
      .from("field_meters")
      .select("id")
      .in("id", meterIds);

    const validMeterIds = new Set((meters ?? []).map((m) => m.id));

    for (const reading of readings) {
      const validation = validateReading(reading);

      if (!validation.valid) {
        results.push({ meter_id: reading.meter_id ?? "unknown", status: "rejected", errors: validation.errors });
        continue;
      }

      if (!validMeterIds.has(reading.meter_id)) {
        results.push({ meter_id: reading.meter_id, status: "rejected", errors: ["meter_id not found in field_meters"] });
        continue;
      }

      // Check for duplicate (same meter_id + ts)
      if (reading.ts) {
        const { data: existing } = await supabaseAdmin
          .from("meter_readings")
          .select("id")
          .eq("meter_id", reading.meter_id)
          .eq("ts", reading.ts)
          .maybeSingle();

        if (existing) {
          results.push({ meter_id: reading.meter_id, status: "duplicate" });
          continue;
        }
      }

      validReadings.push({
        meter_id: reading.meter_id,
        n: reading.n ?? 0,
        p: reading.p ?? 0,
        k: reading.k ?? 0,
        ec: reading.ec ?? 0,
        temp: reading.temp ?? 0,
        ph: reading.ph ?? 0,
        vwc: reading.vwc ?? 0,
        ts: reading.ts ?? new Date().toISOString(),
      });

      results.push({ meter_id: reading.meter_id, status: "accepted" });
    }

    if (validReadings.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from("meter_readings")
        .insert(validReadings);

      if (insertError) {
        console.error("Insert error:", insertError.message);
        return json({ error: "Failed to store readings.", details: insertError.message }, 500);
      }
    }

    const accepted = results.filter((r) => r.status === "accepted").length;
    const rejected = results.filter((r) => r.status === "rejected").length;
    const duplicates = results.filter((r) => r.status === "duplicate").length;

    return json({
      total: readings.length,
      accepted,
      rejected,
      duplicates,
      results,
    });
  } catch (error) {
    console.error("Sensor ingest error:", error);
    return json({ error: "An unexpected error occurred during sensor ingestion." }, 500);
  }
});
