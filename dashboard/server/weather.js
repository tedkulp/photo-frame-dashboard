// Builds the dashboard's weather from a Home Assistant weather entity (PirateWeather in practice):
// the current reading plus hourly and daily forecasts. Temperatures are converted to whole degrees
// Fahrenheit here, so the dashboard never sees the entity's own units. HA's conditions are mapped
// onto the dashboard's seven.

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
  throw new Error(`Weather entity reports temperatures in "${unit}", expected °C or °F`);
}

export function createWeather({ ha, entity, now = Date.now }) {
  async function load() {
    const t = now();
    const [state, hourly, daily] = await Promise.all([
      ha.state(entity),
      ha.forecasts(entity, 'hourly'),
      ha.forecasts(entity, 'daily'),
    ]);
    const a = state.attributes || {};
    if (!isNum(a.temperature)) throw new Error(`${entity} has no current temperature (state "${state.state}")`);
    const f = toFahrenheit(a.temperature_unit);

    return {
      configured: true,
      now: { temp: f(a.temperature), cond: condition(state.state) },
      hourly: hourly.filter((h) => h.datetime && isNum(h.temperature)).slice(0, HOURS).map((h) => ({
        at: h.datetime,
        temp: f(h.temperature),
        cond: condition(h.condition),
        pop: isNum(h.precipitation_probability) ? Math.round(h.precipitation_probability) : 0,
      })),
      daily: daily.filter((d) => d.datetime && isNum(d.temperature) && isNum(d.templow)).slice(0, DAYS).map((d) => ({
        at: d.datetime,
        hi: f(d.temperature),
        lo: f(d.templow),
        cond: condition(d.condition),
      })),
      updatedAt: new Date(t).toISOString(),
    };
  }

  return { load };
}
