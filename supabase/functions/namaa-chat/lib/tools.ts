import { supabase } from "./supabase.ts";
import { validateReadings } from "./validation.ts";
import {
  calculateIrrigationPriority, calculateFertilizerPriority,
  calculateWaterScarcityPriority,
} from "./calculations.ts";
import { retrieveRelevantKnowledge } from "./rag.ts";
import type {
  FieldMeter, MeterReading, WeatherForecast, Advisory, Savings,
  ValidatedReading,
} from "./types.ts";

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const TOOL_DEFINITIONS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_field_meters",
      description: "Get all field meter/sensor installations with coordinates, elevation, slope, aspect, and crop.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_latest_sensor_readings",
      description: "Get the latest 7-in-1 sensor readings (N, P, K, EC, temp, pH, VWC) for all meters or a specific meter. Includes staleness validation.",
      parameters: {
        type: "object",
        properties: { meter_id: { type: "string", description: "Specific meter ID like 'M1'. If omitted, returns all meters." } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sensor_history",
      description: "Get historical sensor readings for a meter within a time range. Use for trend analysis.",
      parameters: {
        type: "object",
        properties: {
          meter_id: { type: "string", description: "Meter ID like 'M1'" },
          hours_back: { type: "number", description: "How many hours of history to retrieve (default 24, max 168)" },
        },
        required: ["meter_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather conditions for the field.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather_forecast",
      description: "Get weather forecast including precipitation probability, expected rainfall, temperature, humidity, wind, and evapotranspiration.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_irrigation_priority",
      description: "Calculate irrigation priority ranking for all meters using VWC, elevation, slope, weather, and evapotranspiration. Use when user asks which meter to irrigate first.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_fertilizer_priority",
      description: "Determine nutrient deficiency priority (N, P, K) based on sensor readings, EC/salinity, and rain forecast. Use when user asks about fertilizer.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_water_scarcity_priority",
      description: "Rank meters when available water is limited. Returns top 3 most urgent meters.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_advisories",
      description: "Retrieve current generated advisories/alerts for all meters.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sustainability_metrics",
      description: "Retrieve current sustainability metrics: water saved, fertilizer saved, CO2e reduction, yield improvement, cost savings.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_agronomic_knowledge",
      description: "Search the scientific knowledge base (FAO, USDA-NRCS, extension resources) for relevant agronomic guidance. Use when answering technical questions about irrigation thresholds, fertilizer rates, salinity management, pH, or topography effects. Returns sourced content with citations.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query describing the agronomic topic, e.g. 'irrigation threshold for tomato on loam soil' or 'salinity management high EC'" }
        },
        required: ["query"],
      },
    },
  },
];

export async function executeTool(name: string, args: Record<string, unknown>): Promise<{ output: unknown; latency_ms: number }> {
  const start = Date.now();
  try {
    let output: unknown;

    switch (name) {
      case "get_field_meters": {
        const { data, error } = await supabase.from("field_meters").select("*").order("id");
        if (error) throw new Error(`Database error: ${error.message}`);
        output = data as FieldMeter[];
        break;
      }

      case "get_latest_sensor_readings": {
        const meterId = args.meter_id as string | undefined;
        let query = supabase.from("meter_readings").select("*");
        if (meterId) query = query.eq("meter_id", meterId);
        const { data: readings, error } = await query.order("ts", { ascending: false });
        if (error) throw new Error(`Database error: ${error.message}`);

        const latestByMeter = new Map<string, MeterReading>();
        for (const r of readings ?? []) {
          if (!latestByMeter.has(r.meter_id)) latestByMeter.set(r.meter_id, r);
        }
        const latest = Array.from(latestByMeter.values());
        const validated = validateReadings(latest);
        output = validated.map((v) => ({
          meter_id: v.meter_id, n: v.n, p: v.p, k: v.k, ec: v.ec,
          temp: v.temp, ph: v.ph, vwc: v.vwc, ts: v.ts,
          is_stale: v.is_stale, age_minutes: v.age_minutes,
          warnings: v.warnings,
        }));
        break;
      }

      case "get_sensor_history": {
        const meterId = args.meter_id as string;
        const hoursBack = Math.min(168, Math.max(1, (args.hours_back as number) ?? 24));
        const since = new Date(Date.now() - hoursBack * 3600000).toISOString();
        const { data, error } = await supabase
          .from("meter_readings").select("*")
          .eq("meter_id", meterId).gte("ts", since).order("ts", { ascending: true });
        if (error) throw new Error(`Database error: ${error.message}`);
        output = validateReadings((data ?? []) as MeterReading[]);
        break;
      }

      case "get_weather":
      case "get_weather_forecast": {
        // Try to sync live weather first (uses Open-Meteo, no API key needed)
        try {
          const settings = await supabase
            .from("field_settings")
            .select("latitude, longitude, field_name, weather_cache_minutes")
            .eq("id", 1)
            .maybeSingle();

          if (settings.data) {
            const cached = await supabase
              .from("weather_forecasts")
              .select("*")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            const cacheAgeMin = cached.data
              ? (Date.now() - new Date(cached.data.created_at).getTime()) / 60000
              : 999;

            // If cache is stale, fetch fresh weather from Open-Meteo
            if (cacheAgeMin >= (settings.data.weather_cache_minutes ?? 30)) {
              const params = new URLSearchParams({
                latitude: settings.data.latitude.toString(),
                longitude: settings.data.longitude.toString(),
                current: "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
                hourly: "temperature_2m,precipitation_probability,precipitation,evapotranspiration",
                timezone: "auto",
                forecast_days: "3",
              });

              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 10000);

              try {
                const weatherResp = await fetch(
                  `https://api.open-meteo.com/v1/forecast?${params}`,
                  { signal: controller.signal },
                );
                clearTimeout(timeout);

                if (weatherResp.ok) {
                  const wData = await weatherResp.json();
                  const cur = wData.current;
                  const hr = wData.hourly;
                  const now = new Date();

                  let rainStart = 999;
                  let maxProb = 0;
                  let totalRain = 0;
                  for (let i = 0; i < Math.min(24, hr.time.length); i++) {
                    const hTime = new Date(hr.time[i]);
                    const diffMin = (hTime.getTime() - now.getTime()) / 60000;
                    if (diffMin > 0 && diffMin < 180) {
                      const prob = hr.precipitation_probability[i] ?? 0;
                      const rain = hr.precipitation[i] ?? 0;
                      if (prob > maxProb) maxProb = prob;
                      totalRain += rain;
                      if (rain > 0.1 && rainStart === 999) rainStart = Math.round(diffMin);
                    }
                  }

                  let dailyET = 0;
                  for (let i = 0; i < Math.min(24, hr.evapotranspiration.length); i++) {
                    dailyET += hr.evapotranspiration[i] ?? 0;
                  }

                  const conditionMap: Record<number, string> = {
                    0: "Clear", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
                    45: "Fog", 48: "Rime Fog", 51: "Light Drizzle", 53: "Drizzle",
                    55: "Heavy Drizzle", 61: "Light Rain", 63: "Rain", 65: "Heavy Rain",
                    71: "Light Snow", 73: "Snow", 75: "Heavy Snow", 80: "Light Showers",
                    81: "Showers", 82: "Violent Showers", 95: "Thunderstorm",
                  };
                  const condition = conditionMap[cur.weather_code] ?? "Unknown";

                  const hourlySummary: Array<{ hour: string; temp: number; rain: number }> = [];
                  for (let i = 0; i < Math.min(8, hr.time.length); i++) {
                    const hTime = new Date(hr.time[i]);
                    if (hTime.getTime() < now.getTime()) continue;
                    hourlySummary.push({
                      hour: hTime.toLocaleTimeString("en-US", { hour: "2-digit", hour12: false }),
                      temp: Math.round(hr.temperature_2m[i] ?? 0),
                      rain: hr.precipitation_probability[i] ?? 0,
                    });
                  }

                  const processed = {
                    location: `${settings.data.field_name} · ${settings.data.latitude}°N, ${settings.data.longitude}°E`,
                    now_temp: Math.round(cur.temperature_2m),
                    now_humidity: Math.round(cur.relative_humidity_2m),
                    now_wind: Math.round(cur.wind_speed_10m),
                    now_condition: condition,
                    now_icon: condition.toLowerCase().includes("rain") ? "rain"
                      : condition.toLowerCase().includes("cloud") ? "cloud" : "sun",
                    rain_probability_3h: Math.round(maxProb),
                    rain_start_minutes: rainStart,
                    expected_rainfall_mm: Math.round(totalRain * 10) / 10,
                    evapotranspiration: Math.round(dailyET * 100) / 100,
                    hourly: hourlySummary,
                  };

                  await supabase.from("weather_forecasts").insert(processed);
                  await supabase.from("field_settings").update({ weather_last_sync: new Date().toISOString() }).eq("id", 1);

                  output = {
                    location: processed.location,
                    current: { temp: processed.now_temp, humidity: processed.now_humidity, wind: processed.now_wind, condition: processed.now_condition },
                    rain_probability_3h: processed.rain_probability_3h,
                    rain_start_minutes: processed.rain_start_minutes,
                    expected_rainfall_mm: processed.expected_rainfall_mm,
                    evapotranspiration: processed.evapotranspiration,
                    hourly: processed.hourly,
                    source: "live (open-meteo)",
                  } as WeatherForecast;
                  break;
                }
              } catch (fetchErr) {
                clearTimeout(timeout);
                console.error("Live weather fetch failed, using cache:", fetchErr);
              }
            }

            // Return cached data
            if (cached.data) {
              output = {
                location: cached.data.location,
                current: { temp: cached.data.now_temp, humidity: cached.data.now_humidity, wind: cached.data.now_wind, condition: cached.data.now_condition },
                rain_probability_3h: cached.data.rain_probability_3h,
                rain_start_minutes: cached.data.rain_start_minutes,
                expected_rainfall_mm: cached.data.expected_rainfall_mm,
                evapotranspiration: cached.data.evapotranspiration,
                hourly: cached.data.hourly,
                source: `cache (${Math.round(cacheAgeMin)}min old)`,
              } as WeatherForecast;
              break;
            }
          }
        } catch (weatherErr) {
          console.error("Weather tool error:", weatherErr);
        }

        output = { error: "No weather data available" };
        break;
      }

      case "calculate_irrigation_priority":
      case "calculate_water_scarcity_priority": {
        const [metersRes, readingsRes, weatherRes] = await Promise.all([
          supabase.from("field_meters").select("*"),
          supabase.from("meter_readings").select("*").order("ts", { ascending: false }),
          supabase.from("weather_forecasts").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        ]);
        if (metersRes.error || readingsRes.error) throw new Error("Database error loading field data");

        const meters = metersRes.data as FieldMeter[];
        const latestByMeter = new Map<string, MeterReading>();
        for (const r of readingsRes.data ?? []) if (!latestByMeter.has(r.meter_id)) latestByMeter.set(r.meter_id, r);
        const validated = validateReadings(Array.from(latestByMeter.values()));
        const weather = weatherRes.data as WeatherForecast | null;

        output = name === "calculate_irrigation_priority"
          ? calculateIrrigationPriority(meters, validated, weather)
          : calculateWaterScarcityPriority(meters, validated, weather);
        break;
      }

      case "calculate_fertilizer_priority": {
        const [metersRes, readingsRes, weatherRes] = await Promise.all([
          supabase.from("field_meters").select("*"),
          supabase.from("meter_readings").select("*").order("ts", { ascending: false }),
          supabase.from("weather_forecasts").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        ]);
        if (metersRes.error || readingsRes.error) throw new Error("Database error loading field data");

        const meters = metersRes.data as FieldMeter[];
        const latestByMeter = new Map<string, MeterReading>();
        for (const r of readingsRes.data ?? []) if (!latestByMeter.has(r.meter_id)) latestByMeter.set(r.meter_id, r);
        const validated = validateReadings(Array.from(latestByMeter.values()));
        const weather = weatherRes.data as WeatherForecast | null;

        output = calculateFertilizerPriority(meters, validated, weather);
        break;
      }

      case "get_advisories": {
        const { data, error } = await supabase.from("advisories").select("*").order("created_at", { ascending: false });
        if (error) throw new Error(`Database error: ${error.message}`);
        output = (data ?? []) as Advisory[];
        break;
      }

      case "get_sustainability_metrics": {
        const { data, error } = await supabase.from("savings").select("*").eq("id", 1).maybeSingle();
        if (error) throw new Error(`Database error: ${error.message}`);
        output = data as Savings | null;
        break;
      }

      case "search_agronomic_knowledge": {
        const query = args.query as string;
        if (!query || typeof query !== "string") {
          output = { error: "Query is required" };
          break;
        }
        const chunks = await retrieveRelevantKnowledge(query, 3, 0.68);
        output = chunks.map((c) => ({
          source: c.source,
          title: c.title,
          url: c.url,
          topic: c.topic,
          content: c.chunk_text,
          similarity: Math.round(c.similarity * 100) / 100,
        }));
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return { output, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      output: { error: err instanceof Error ? err.message : "Tool execution failed" },
      latency_ms: Date.now() - start,
    };
  }
}
