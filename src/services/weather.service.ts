export async function getWeather(
  latitude: number,
  longitude: number
) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude}` +
    `&longitude=${longitude}` +
    `&hourly=temperature_2m,relative_humidity_2m` +
    `&daily=precipitation_sum` +
    `&forecast_days=1`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Weather API failed");
  }

  return response.json();
}