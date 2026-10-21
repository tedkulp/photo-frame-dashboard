// Builds the dashboard's weather from a Home Assistant weather entity (PirateWeather in practice):
// the current reading plus hourly and daily forecasts, and the next sunrise and sunset from sun.sun.
// Temperatures are converted to whole degrees Fahrenheit and wind speeds to whole mph here, so the
// dashboard never sees the entity's own units. HA's conditions are mapped onto the dashboard's
// seven. Everything past temperature and condition (feels-like, humidity, wind, UV, sun) is left
// out when the entity doesn't give it; it never fails the load.

export const HOURS = 48;
export const DAYS = 7;

// HA condition → dashboard condition (sun, moon, partly, cloud, rain, snow, storm).
export const CONDITIONS = {
  'sunny': 'sun',
  'clear-night': 'moon',
  'partlycloudy': 'partly',
  'cloudy': 'cloud',
  'fog': 'cloud',
  'windy': 'cloud',
  'windy-variant': 'cloud',
  'exceptional': 'cloud',
  'rainy': 'rain',
  'pouring': 'rain',
  'hail': 'rain',
  'snowy': 'snow',
  'snowy-rainy': 'snow',
  'lightning': 'storm',
  'lightning-rainy': 'storm',
};
const condition = (c) => CONDITIONS[c] || 'cloud';

const isNum = (v) => typeof v === 'number' && isFinite(v);

// A converter from the entity's temperature unit to whole °F.
function toFahrenheit(unit) {
  if (unit === '°F') return (v) => Math.round(v);
  if (unit === '°C') return (v) => Math.round(v * 9 / 5 + 32);
  if (unit === 'K') return (v) => Math.round((v - 273.15) * 9 / 5 + 32);
  throw new Error(`Weather entity reports temperatures in "${unit}", expected °C, °F or K`);
}

// A converter from the entity's wind speed unit to whole mph, or null for a unit we don't know.
const MPH = { 'mph': 1, 'km/h': 0.621371, 'm/s': 2.236936, 'kn': 1.150779, 'ft/s': 0.681818 };
function toMph(unit) {
  return MPH.hasOwnProperty(unit) ? (v) => Math.round(v * MPH[unit]) : null;
}

// HA allows a bearing as degrees or a compass point; either way → whole degrees, 0–359.
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function bearing(v) {
  if (typeof v === 'string' && POINTS.indexOf(v.toUpperCase()) > -1) v = POINTS.indexOf(v.toUpperCase()) * 22.5;
  return isNum(v) ? ((Math.round(v) % 360) + 360) % 360 : undefined;
}

// Copies the fields that came out as numbers (or strings) onto `into`; missing ones stay out.
function set(into, fields) {
  for (const k in fields) if (fields[k] !== undefined) into[k] = fields[k];
  return into;
}
const whole = (v) => (isNum(v) ? Math.round(v) : undefined);

export function createWeather({ ha, entity, now = Date.now }) {
  async function load() {
    const t = now();
    const [state, hourly, daily, sun] = await Promise.all([
      ha.state(entity),
      ha.forecasts(entity, 'hourly'),
      ha.forecasts(entity, 'daily'),
      ha.state('sun.sun').catch(() => null), // no sun.sun: no sunrise or sunset
    ]);
    const a = state.attributes || {};
    if (!isNum(a.temperature)) throw new Error(`${entity} has no current temperature (state "${state.state}")`);
    const f = toFahrenheit(a.temperature_unit);
    const fNum = (v) => (isNum(v) ? f(v) : undefined);
    const mph = toMph(a.wind_speed_unit);
    const speed = (v) => (mph && isNum(v) ? mph(v) : undefined);
    const pop = (v) => (isNum(v) ? Math.round(v) : 0);

    // The forecast hour covering now gives feels-like and UV (the entity itself rarely has them).
    const cur = hourly.find((h) => {
      const at = Date.parse(h.datetime);
      return at <= t && t - at < 3600 * 1000;
    }) || {};
    const s = (sun && sun.attributes) || {};
    const time = (v) => (typeof v === 'string' && !isNaN(Date.parse(v)) ? v : undefined);

    return {
      configured: true,
      now: set({ temp: f(a.temperature), cond: condition(state.state) }, {
        feels: fNum(isNum(cur.apparent_temperature) ? cur.apparent_temperature : a.apparent_temperature),
        humidity: whole(a.humidity),
        wind: speed(a.wind_speed),
        gust: speed(a.wind_gust_speed),
        bearing: bearing(a.wind_bearing),
        uv: whole(isNum(cur.uv_index) ? cur.uv_index : a.uv_index),
        sunrise: time(s.next_rising),
        sunset: time(s.next_setting),
      }),
      hourly: hourly.filter((h) => h.datetime && isNum(h.temperature)).slice(0, HOURS).map((h) => set({
        at: h.datetime,
        temp: f(h.temperature),
        cond: condition(h.condition),
        pop: pop(h.precipitation_probability),
      }, { wind: speed(h.wind_speed), bearing: bearing(h.wind_bearing), humidity: whole(h.humidity) })),
      daily: daily.filter((d) => d.datetime && isNum(d.temperature) && isNum(d.templow)).slice(0, DAYS).map((d) => set({
        at: d.datetime,
        hi: f(d.temperature),
        lo: f(d.templow),
        cond: condition(d.condition),
        pop: pop(d.precipitation_probability),
      }, { wind: speed(d.wind_speed), gust: speed(d.wind_gust_speed), bearing: bearing(d.wind_bearing), humidity: whole(d.humidity) })),
      updatedAt: new Date(t).toISOString(),
    };
  }

  return { load };
}
