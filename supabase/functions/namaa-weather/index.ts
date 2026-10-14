import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface OpenMeteoCurrent {
  temperature_2m: number;
  relative_humidity_2m: number;
  wind_speed_10m: number;
  weather_code: number;
}

interface OpenMeteoHourly {
  time: string[];
  temperature_2m: number[];
  precipitation_probability: number[];
  precipitation: number[];
  evapotranspiration: number[];
}

interface FieldSettings {
  latitude: number;
  longitude: number;
  field_name: string;
  weather_cache_minutes: number;
}

const WEATHER_CODE_MAP: Record<number, string> = {
  0: "Clear", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
  45: "Fog", 48: "Rime Fog", 51: "Light Drizzle", 53: "Drizzle",
  55: "Heavy Drizzle", 56: "Freezing Drizzle", 57: "Heavy Freezing Drizzle",
  61: "Light Rain", 63: "Rain", 65: "Heavy Rain", 66: "Freezing Rain",
  67: "Heavy Freezing Rain", 71: "Light Snow", 73: "Snow", 75: "Heavy Snow",
  77: "Snow Grains", 80: "Light Showers", 81: "Showers", 82: "Violent Showers",
  85: "Snow Showers", 86: "Heavy Snow Showers", 95: "Thunderstorm",
  96: "Thunderstorm with Hail", 99: "Heavy Thunderstorm with Hail",
};

async function fetchWeatherFromOpenMeteo(lat: number, lon: number): Promise<{
  current: OpenMeteoCurrent;
  hourly: OpenMeteoHourly;
}> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    current: "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
    hourly: "temperature_2m,precipitation_probability,precipitation,evapotranspiration",
    timezone: "auto",
    forecast_days: "3",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      current: data.current as OpenMeteoCurrent,
      hourly: data.hourly as OpenMeteoHourly,
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

function processWeatherData(
  current: OpenMeteoCurrent,
  hourly: OpenMeteoHourly,
  fieldName: string,
  lat: number,
  lon: number,
): {
  location: string;
  now_temp: number;
  now_humidity: number;
  now_wind: number;
  now_condition: string;
  now_icon: string;
  rain_probability_3h: number;
  rain_start_minutes: number;
  expected_rainfall_mm: number;
  evapotranspiration: number;
  hourly: Array<{ hour: string; temp: number; rain: number }>;
} {
  const now = new Date();
  const condition = WEATHER_CODE_MAP[current.weather_code] ?? "Unknown";

  // Find rain start time
  let rainStartMinutes = 999;
  let maxRainProb3h = 0;
  let totalRain3h = 0;

  for (let i = 0; i < Math.min(24, hourly.time.length); i++) {
    const hourTime = new Date(hourly.time[i]);
    const diffMin = (hourTime.getTime() - now.getTime()) / 60000;

    if (diffMin > 0 && diffMin < 180) {
      const prob = hourly.precipitation_probability[i] ?? 0;
      const rain = hourly.precipitation[i] ?? 0;
      if (prob > maxRainProb3h) maxRainProb3h = prob;
      totalRain3h += rain;

      if (rain > 0.1 && rainStartMinutes === 999) {
        rainStartMinutes = Math.round(diffMin);
      }
    }
  }

  // Daily evapotranspiration (sum of hourly ET for next 24h)
  let dailyET = 0;
  for (let i = 0; i < Math.min(24, hourly.evapotranspiration.length); i++) {
    dailyET += hourly.evapotranspiration[i] ?? 0;
  }

  // Build hourly summary (next 8 hours)
  const hourlySummary: Array<{ hour: string; temp: number; rain: number }> = [];
  for (let i = 0; i < Math.min(8, hourly.time.length); i++) {
    const hourTime = new Date(hourly.time[i]);
    if (hourTime.getTime() < now.getTime()) continue;
    hourlySummary.push({
      hour: hourTime.toLocaleTimeString("en-US", { hour: "2-digit", hour12: false }),
      temp: Math.round(hourly.temperature_2m[i] ?? 0),
      rain: hourly.precipitation_probability[i] ?? 0,
    });
  }

  return {
    location: `${fieldName} · ${lat}°N, ${lon}°E`,
    now_temp: Math.round(current.temperature_2m),
    now_humidity: Math.round(current.relative_humidity_2m),
    now_wind: Math.round(current.wind_speed_10m),
    now_condition: condition,
    now_icon: condition.toLowerCase().includes("rain") ? "rain"
      : condition.toLowerCase().includes("snow") ? "snow"
      : condition.toLowerCase().includes("cloud") ? "cloud" : "sun",
    rain_probability_3h: Math.round(maxRainProb3h),
    rain_start_minutes: rainStartMinutes,
    expected_rainfall_mm: Math.round(totalRain3h * 10) / 10,
    evapotranspiration: Math.round(dailyET * 100) / 100,
    hourly: hourlySummary,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    // Load field settings for coordinates
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("field_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle() as { data: FieldSettings | null; error: { message: string } | null };

    if (settingsError || !settings) {
      return json({ error: "Field settings not configured." }, 500);
    }

    // Check if cached weather is still fresh
    const { data: cached, error: cacheError } = await supabaseAdmin
      .from("weather_forecasts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const cacheAgeMin = cached ? (Date.now() - new Date(cached.created_at).getTime()) / 60000 : 999;
    const forceRefresh = req.method === "POST" || new URL(req.url).searchParams.get("force") === "true";

    if (!forceRefresh && !cacheError && cached && cacheAgeMin < settings.weather_cache_minutes) {
      return json({
        source: "cache",
        age_minutes: Math.round(cacheAgeMin),
        weather: cached,
      });
    }

    // Fetch fresh weather from Open-Meteo
    try {
      const { current, hourly } = await fetchWeatherFromOpenMeteo(
        settings.latitude,
        settings.longitude,
      );

      const processed = processWeatherData(current, hourly, settings.field_name, settings.latitude, settings.longitude);

      // Store in database
      const { data: stored, error: storeError } = await supabaseAdmin
        .from("weather_forecasts")
        .insert(processed)
        .select("*")
        .maybeSingle();

      if (storeError) {
        console.error("Failed to store weather:", storeError.message);
      }

      // Update last sync time
      await supabaseAdmin
        .from("field_settings")
        .update({ weather_last_sync: new Date().toISOString() })
        .eq("id", 1);

      return json({
        source: "open-meteo",
        age_minutes: 0,
        weather: stored ?? processed,
      });
    } catch (fetchErr) {
      // If fresh fetch fails, return cached data if available
      if (cached) {
        return json({
          source: "cache (fallback)",
          age_minutes: Math.round(cacheAgeMin),
          warning: "Live weather API unavailable, showing cached data.",
          weather: cached,
        });
      }
      throw fetchErr;
    }
  } catch (error) {
    console.error("Weather sync error:", error);
    return json({ error: "Failed to fetch weather data." }, 502);
  }
});
