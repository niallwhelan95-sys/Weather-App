// Weather Blend — multi-source forecast API (Vercel serverless function)
// GET /api/weather?lat=53.35&lon=-6.26&from=8&to=22&bias=0
//   from/to = hours you'll be out (local time, 0-23; overnight like 17→2 works)
//   bias    = -3..3  (positive = "I run cold", negative = "I run warm")

const H = 3600000;
const OM_MODELS = {
  ecmwf_ifs025: 'ECMWF (Europe)',
  gfs_seamless: 'GFS (NOAA, US)',
  icon_seamless: 'ICON (DWD, Germany)',
  ukmo_seamless: 'UK Met Office',
  meteofrance_seamless: 'Météo-France',
  gem_seamless: 'GEM (Canada)',
  knmi_seamless: 'KNMI Harmonie (NL)',
};
const FALLBACK_MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless'];
const UA = process.env.CONTACT_UA || 'weather-blend/1.0 (personal weather app)';

// ---------------------------------------------------------------- helpers
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(+v) ? null : +v);
const hourKey = (ms) => new Date(Math.floor(ms / H) * H).toISOString().slice(0, 13);
const clean = (a) => a.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
const median = (a) => {
  const v = clean(a).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const mean = (a) => {
  const v = clean(a);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};
const round = (v, d = 1) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);
const mode = (a) => {
  const counts = new Map();
  for (const x of clean(a)) counts.set(x, (counts.get(x) || 0) + 1);
  let best = null, n = 0;
  for (const [k, c] of counts) if (c > n || (c === n && k > best)) { best = k; n = c; }
  return best;
};

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: c.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  } finally {
    clearTimeout(t);
  }
}
const getJSON = async (url, opts, ms) => (await fetchWithTimeout(url, opts, ms)).json();
const getText = async (url, opts, ms) => (await fetchWithTimeout(url, opts, ms)).text();

// Australian apparent temperature (same idea Open-Meteo uses), wind chill fallback
function apparent(t, windKmh, rh) {
  if (t == null) return null;
  if (rh != null) {
    const e = (rh / 100) * 6.105 * Math.exp((17.27 * t) / (237.7 + t));
    return t + 0.33 * e - 0.7 * ((windKmh ?? 0) / 3.6) - 4;
  }
  if (t <= 10 && windKmh != null && windKmh > 4.8) {
    const v = Math.pow(windKmh, 0.16);
    return 13.12 + 0.6215 * t - 11.37 * v + 0.3965 * t * v;
  }
  return t;
}

// MET Norway / Met Éireann symbol names → WMO weather codes
function symbolToWmo(s) {
  if (!s) return null;
  s = String(s).toLowerCase().replace(/_(day|night|polartwilight)$/, '');
  if (s.includes('thunder')) return 95;
  if (s.includes('snow')) return s.includes('heavy') ? 75 : s.includes('light') ? 71 : 73;
  if (s.includes('sleet')) return 66;
  if (s.includes('showers')) return s.includes('heavy') ? 82 : s.includes('light') ? 80 : 81;
  if (s.includes('drizzle')) return 53;
  if (s.includes('rain')) return s.includes('heavy') ? 65 : s.includes('light') ? 61 : 63;
  return { clearsky: 0, sun: 0, fair: 1, lightcloud: 1, partlycloudy: 2, partlycloud: 2, cloudy: 3, cloud: 3, fog: 45 }[s] ?? null;
}

const combinePop = (popMean, wetFrac) => {
  if (popMean != null && wetFrac != null) return Math.round(0.5 * popMean + 50 * wetFrac);
  if (popMean != null) return Math.round(popMean);
  if (wetFrac != null) return Math.round(wetFrac * 100);
  return null;
};
const fixCode = (code, pop) => {
  if (code == null) return pop != null && pop >= 50 ? 61 : 2;
  if (pop != null && pop < 20 && code >= 51 && code <= 67) return 3;
  if (pop != null && pop >= 60 && code <= 3) return 61;
  return code;
};

// ---------------------------------------------------------------- sources
async function openMeteo(lat, lon) {
  const hourly = 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,relative_humidity_2m,uv_index';
  const daily = 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,wind_gusts_10m_max';
  const base = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&timeformat=unixtime&forecast_days=7&wind_speed_unit=kmh`;
  const bestUrl = `${base}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,relative_humidity_2m,is_day,precipitation&minutely_15=precipitation&forecast_minutely_15=12&daily=sunrise,sunset,uv_index_max`;
  const multiUrl = (m) => `${base}&hourly=${hourly}&daily=${daily}&models=${m.join(',')}`;

  const bestP = getJSON(bestUrl).catch(() => null);
  let models = Object.keys(OM_MODELS);
  let multi;
  try {
    multi = await getJSON(multiUrl(models));
  } catch {
    models = FALLBACK_MODELS;
    multi = await getJSON(multiUrl(models));
  }
  const best = await bestP;

  const sources = [];
  const ht = multi.hourly.time;
  const dt = multi.daily.time;
  for (const m of models) {
    const g = (k) => multi.hourly[`${k}_${m}`];
    const temps = g('temperature_2m');
    if (!temps || !temps.some((v) => v != null)) continue;
    const hours = new Map();
    ht.forEach((t, i) => {
      const temp = num(temps[i]);
      if (temp == null) return;
      hours.set(hourKey(t * 1000), {
        temp,
        feels: num(g('apparent_temperature')?.[i]),
        pop: num(g('precipitation_probability')?.[i]),
        precip: num(g('precipitation')?.[i]),
        code: num(g('weather_code')?.[i]),
        wind: num(g('wind_speed_10m')?.[i]),
        gust: num(g('wind_gusts_10m')?.[i]),
        rh: num(g('relative_humidity_2m')?.[i]),
        uv: num(g('uv_index')?.[i]),
      });
    });
    const gd = (k) => multi.daily[`${k}_${m}`];
    const daily = dt.map((t, i) => ({
      t: t * 1000,
      max: num(gd('temperature_2m_max')?.[i]),
      min: num(gd('temperature_2m_min')?.[i]),
      precip: num(gd('precipitation_sum')?.[i]),
      pop: num(gd('precipitation_probability_max')?.[i]),
      code: num(gd('weather_code')?.[i]),
      gust: num(gd('wind_gusts_10m_max')?.[i]),
    }));
    sources.push({ id: m, name: OM_MODELS[m], kind: 'model', hours, daily });
  }
  return { sources, best, offset: multi.utc_offset_seconds, tz: multi.timezone };
}

async function metNorway(lat, lon) {
  const j = await getJSON(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${(+lat).toFixed(4)}&lon=${(+lon).toFixed(4)}`,
    { headers: { 'User-Agent': UA } }
  );
  const hours = new Map();
  for (const ts of j.properties.timeseries) {
    const t = Date.parse(ts.time);
    const d = ts.data.instant.details;
    const wind = d.wind_speed != null ? d.wind_speed * 3.6 : null;
    const temp = num(d.air_temperature);
    const row = {
      temp,
      feels: apparent(temp, wind, num(d.relative_humidity)),
      wind,
      gust: d.wind_speed_of_gust != null ? d.wind_speed_of_gust * 3.6 : null,
      rh: num(d.relative_humidity),
      code: symbolToWmo(ts.data.next_1_hours?.summary?.symbol_code),
    };
    hours.set(hourKey(t), { ...(hours.get(hourKey(t)) || {}), ...row });
    const p = ts.data.next_1_hours?.details?.precipitation_amount;
    if (p != null) {
      // store as "precip in the hour ending at key" (same convention as Open-Meteo)
      const k = hourKey(t + H);
      hours.set(k, { ...(hours.get(k) || {}), precip: num(p) });
    }
  }
  for (const [k, v] of hours) if (v.temp == null) hours.delete(k);
  return { hours };
}

const inIrelandUK = (lat, lon) => lat > 49 && lat < 61.5 && lon > -16 && lon < 3;

async function metEireann(lat, lon) {
  const xml = await getText(`http://openaccess.pf.api.met.ie/metno-wdb2ts/locationforecast?lat=${lat};long=${lon}`);
  const hours = new Map();
  const attr = (block, tag, a) => {
    const m = block.match(new RegExp(`<${tag}\\b[^>]*\\b${a}="([^"]+)"`));
    return m ? m[1] : null;
  };
  const re = /<time[^>]*from="([^"]+)"[^>]*to="([^"]+)"[^>]*>([\s\S]*?)<\/time>/g;
  let m;
  while ((m = re.exec(xml))) {
    const from = Date.parse(m[1]), to = Date.parse(m[2]), b = m[3];
    if (from === to) {
      const temp = num(attr(b, 'temperature', 'value'));
      if (temp == null) continue;
      const ws = num(attr(b, 'windSpeed', 'mps'));
      const wg = num(attr(b, 'windGust', 'mps'));
      const rh = num(attr(b, 'humidity', 'value'));
      const wind = ws != null ? ws * 3.6 : null;
      const k = hourKey(from);
      hours.set(k, { ...(hours.get(k) || {}), temp, wind, gust: wg != null ? wg * 3.6 : null, rh, feels: apparent(temp, wind, rh) });
    } else if (to - from === H) {
      const k = hourKey(to);
      hours.set(k, {
        ...(hours.get(k) || {}),
        precip: num(attr(b, 'precipitation', 'value')),
        pop: num(attr(b, 'precipitation', 'probability')),
        code: symbolToWmo(attr(b, 'symbol', 'id')),
      });
    }
  }
  for (const [k, v] of hours) if (v.temp == null) hours.delete(k);
  if (!hours.size) throw new Error('no data for this location');
  return { hours };
}

async function weatherApi(lat, lon, key) {
  const j = await getJSON(`https://api.weatherapi.com/v1/forecast.json?key=${key}&q=${lat},${lon}&days=3&aqi=no&alerts=yes`);
  const hours = new Map();
  for (const day of j.forecast.forecastday) {
    for (const h of day.hour) {
      hours.set(hourKey(h.time_epoch * 1000), {
        temp: h.temp_c, feels: h.feelslike_c, pop: Math.max(h.chance_of_rain ?? 0, h.chance_of_snow ?? 0),
        precip: h.precip_mm, wind: h.wind_kph, gust: h.gust_kph, rh: h.humidity, uv: h.uv,
      });
    }
  }
  const alerts = (j.alerts?.alert || []).map((a) => ({
    title: a.headline || a.event, severity: a.severity, until: a.expires, text: (a.desc || '').slice(0, 400),
  }));
  return { hours, alerts };
}

async function openWeather(lat, lon, key) {
  const j = await getJSON(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${key}&units=metric`);
  const hours = new Map();
  for (const it of j.list) {
    const t = it.dt * 1000;
    const p3 = (it.rain?.['3h'] ?? 0) + (it.snow?.['3h'] ?? 0);
    // 3-hourly data: spread across the 3 hours it covers
    for (const back of [2, 1, 0]) {
      hours.set(hourKey(t - back * H), {
        temp: it.main.temp, feels: it.main.feels_like, rh: it.main.humidity,
        wind: it.wind.speed * 3.6, gust: it.wind.gust != null ? it.wind.gust * 3.6 : null,
        pop: Math.round((it.pop ?? 0) * 100), precip: p3 / 3,
      });
    }
  }
  return { hours };
}

// ---------------------------------------------------------------- blending
function blendHours(sources, start, count = 48) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = start + i * H;
    const k = hourKey(t);
    const rows = sources.map((s) => s.hours.get(k)).filter(Boolean);
    const temps = clean(rows.map((r) => r.temp));
    if (!temps.length) continue;
    const precs = clean(rows.map((r) => r.precip));
    const wet = precs.length ? precs.filter((p) => p >= 0.1).length / precs.length : null;
    const pop = combinePop(mean(rows.map((r) => r.pop)), wet);
    out.push({
      t,
      temp: round(median(temps)),
      tMin: round(Math.min(...temps)),
      tMax: round(Math.max(...temps)),
      feels: round(median(rows.map((r) => r.feels ?? apparent(r.temp, r.wind, r.rh)))),
      pop,
      wet: wet == null ? null : round(wet, 2),
      precip: round(median(precs)),
      wind: round(median(rows.map((r) => r.wind)), 0),
      gust: round(median(rows.map((r) => r.gust)), 0),
      rh: round(median(rows.map((r) => r.rh)), 0),
      uv: round(median(rows.map((r) => r.uv)), 1),
      code: fixCode(mode(rows.map((r) => r.code)), pop),
      n: temps.length,
    });
  }
  return out;
}

function blendDaily(models, best) {
  const n = models[0]?.daily.length || 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const rows = models.map((s) => s.daily[i]).filter((r) => r && r.max != null);
    if (!rows.length) continue;
    const maxes = rows.map((r) => r.max);
    const precs = clean(rows.map((r) => r.precip));
    const wet = precs.length ? precs.filter((p) => p >= 1).length / precs.length : null;
    const pop = combinePop(mean(rows.map((r) => r.pop)), wet);
    out.push({
      t: rows[0].t,
      max: round(median(maxes)),
      min: round(median(rows.map((r) => r.min))),
      spread: round(Math.max(...maxes) - Math.min(...maxes)),
      precip: round(median(precs)),
      pop,
      code: fixCode(mode(rows.map((r) => r.code)), pop),
      gust: round(median(rows.map((r) => r.gust)), 0),
      sunrise: best?.daily?.sunrise?.[i] ? best.daily.sunrise[i] * 1000 : null,
      sunset: best?.daily?.sunset?.[i] ? best.daily.sunset[i] * 1000 : null,
      uv: num(best?.daily?.uv_index_max?.[i]),
      models: rows.length,
    });
  }
  return out;
}

function summarizeSource(src, start) {
  const temps = [], pops = [];
  let rain = 0, haveRain = false;
  for (let i = 0; i < 24; i++) {
    const r = src.hours.get(hourKey(start + i * H));
    if (!r || r.temp == null) continue;
    temps.push(r.temp);
    if (r.precip != null) { rain += r.precip; haveRain = true; }
    if (r.pop != null) pops.push(r.pop);
  }
  if (!temps.length) return null;
  return {
    now: round(temps[0]), hi: round(Math.max(...temps)), lo: round(Math.min(...temps)),
    rain: haveRain ? round(rain) : null, pop: pops.length ? Math.round(Math.max(...pops)) : null,
  };
}

// ---------------------------------------------------------------- advice
const localHHMM = (t, off) => new Date(t + off).toISOString().slice(11, 16);
const localDay = (t, off) => new Date(t + off).toISOString().slice(0, 10);

function outWindow(offsetMs, from, to) {
  const now = Date.now();
  const lh = new Date(now + offsetMs).getUTCHours();
  const cur = Math.floor(now / H) * H;
  const dur = ((to - from + 24) % 24) || 24;
  const since = (lh - from + 24) % 24;
  let start, end, started = false;
  if (since < dur) { start = cur; end = cur + (dur - since) * H; started = true; }
  else { start = cur + ((from - lh + 24) % 24) * H; end = start + dur * H; }
  const label = started ? 'Rest of today' : localDay(start, offsetMs) === localDay(now, offsetMs) ? 'Later today' : 'Tomorrow';
  return { start, end, started, label };
}

function outfitAdvice(hours, { from, to, bias, offsetMs }) {
  const w = outWindow(offsetMs, from, to);
  let win = hours.filter((h) => h.t >= w.start && h.t < w.end);
  if (!win.length) win = hours.slice(0, 12);
  const eff = win.map((h) => (h.feels ?? h.temp) - bias);
  const fMin = Math.min(...eff), fMax = Math.max(...eff), fAvg = mean(eff);
  const pops = win.map((h) => h.pop ?? 0);
  const popMax = Math.max(0, ...pops);
  const wetHours = pops.filter((p) => p >= 50).length;
  const rainTotal = win.reduce((s, h) => s + (h.precip ?? 0), 0);
  const gustMax = Math.max(0, ...win.map((h) => h.gust ?? 0));
  const uvMax = Math.max(0, ...win.map((h) => h.uv ?? 0));
  const snow = win.some((h) => [71, 73, 75, 77, 85, 86].includes(h.code));
  const rainy = popMax >= 60 || wetHours >= 2 || rainTotal >= 2;
  const showery = !rainy && popMax >= 35;
  const windy = gustMax >= 45;

  const items = [], tips = [];
  let outer = fMin < 0 ? 'Heavy insulated coat' : fMin < 7 ? 'Warm winter coat' : fMin < 12 ? 'Medium jacket' : fMin < 16 ? 'Light jacket' : null;
  if (rainy) outer = outer ? `${outer}, waterproof` : 'Light rain jacket';
  else if (showery && !outer) outer = 'Packable rain jacket';
  if (outer) items.push({ icon: '🧥', label: outer });
  items.push({
    icon: fAvg < 14 ? '🧶' : '👕',
    label: fAvg < 8 ? 'Thermal base + warm jumper' : fAvg < 14 ? 'Jumper or fleece' : fAvg < 19 ? 'Long sleeves' : fAvg < 24 ? 'T-shirt' : 'Light, breathable top',
  });
  items.push({ icon: '👖', label: fAvg < 2 ? 'Trousers + thermal leggings' : fAvg < 22 ? 'Jeans or trousers' : 'Shorts or light trousers' });
  items.push({
    icon: '👟',
    label: snow || (rainy && rainTotal >= 3) ? 'Waterproof boots' : fMin < 3 ? 'Warm boots' : fAvg >= 22 ? 'Sandals or trainers' : 'Trainers',
  });
  if (fMin < 4) items.push({ icon: '🧤', label: 'Hat & gloves' });
  else if (fMin < 8) items.push({ icon: '🧣', label: 'Scarf' });
  if ((rainy || showery) && !windy) items.push({ icon: '☂️', label: rainy ? 'Umbrella' : 'Compact umbrella, just in case' });
  if (uvMax >= 3) items.push({ icon: '🕶️', label: uvMax >= 6 ? 'Sunglasses, SPF & a cap' : 'Sunglasses + SPF' });

  if ((rainy || showery) && windy) tips.push(`Leave the umbrella — gusts up to ${Math.round(gustMax)} km/h will flip it. Hood up instead.`);
  else if (gustMax >= 60) tips.push(`Strong gusts up to ${Math.round(gustMax)} km/h — skip loose hats.`);
  if (fMax - fMin >= 6) tips.push(`Feels like ${Math.round(fMin)}° to ${Math.round(fMax)}° while you're out — wear layers you can peel off.`);
  const firstWet = win.find((h) => (h.pop ?? 0) >= 50);
  if (firstWet && (rainy || showery)) tips.push(`Rain most likely from around ${localHHMM(firstWet.t, offsetMs)}.`);
  if (!rainy && !showery && popMax < 15) tips.push('Dry while you\'re out — leave the brolly at home.');

  const word = fAvg < 3 ? 'Bitter' : fAvg < 8 ? 'Cold' : fAvg < 13 ? 'Chilly' : fAvg < 18 ? 'Mild' : fAvg < 23 ? 'Warm' : 'Hot';
  const wx = rainy ? ' & wet' : showery ? ' & showery' : '';
  const headline = `${word}${wx}${windy ? ', windy' : ''} — ${outer ? outer.toLowerCase().replace(', waterproof', ' (waterproof)') : 'no jacket needed'}${rainy && !windy ? ' + umbrella' : ''}`;
  const short = [
    outer ? (fMin < 7 ? 'Coat' : 'Jacket') : fAvg >= 19 ? 'T-shirt' : 'Layers',
    rainy ? (windy ? 'hood' : 'umbrella') : showery ? 'brolly?' : null,
    uvMax >= 5 ? 'SPF' : null,
  ].filter(Boolean).join(' + ');

  const at = (t) => hours.find((h) => h.t >= t) || hours[hours.length - 1];
  const legOut = at(w.start), legBack = at(w.end - H);
  const leg = (label, h) => h && { label, time: localHHMM(h.t, offsetMs), temp: h.temp, feels: h.feels, pop: h.pop, code: h.code, wind: h.wind };
  return {
    window: { label: w.label, from: `${String(from).padStart(2, '0')}:00`, to: `${String(to).padStart(2, '0')}:00` },
    headline, short, items, tips,
    legs: [leg(w.started ? 'Now' : 'Heading out', legOut), leg('Coming home', legBack)].filter(Boolean),
    stats: { feelsMin: round(fMin), feelsMax: round(fMax), popMax, rainTotal: round(rainTotal), gustMax: Math.round(gustMax), uvMax: round(uvMax) },
  };
}

function insights(hours, offsetMs) {
  // longest dry spell in the next 18 hours
  const next = hours.slice(0, 18);
  let best = { len: 0 }, run = null;
  next.forEach((h, i) => {
    const dry = (h.pop ?? 0) < 25 && (h.precip ?? 0) < 0.1;
    if (dry) { run = run ? { ...run, len: run.len + 1 } : { i, len: 1 }; if (run.len > best.len) best = run; }
    else run = null;
  });
  const dryWindow = best.len
    ? { from: localHHMM(next[best.i].t, offsetMs), to: localHHMM(next[best.i].t + best.len * H, offsetMs), hours: best.len, allDay: best.len === next.length }
    : null;
  const rainStart = hours.slice(0, 24).find((h) => (h.pop ?? 0) >= 50);

  // drying-the-washing score for the next 09:00–18:00
  const w = outWindow(offsetMs, 9, 18);
  const day = hours.filter((h) => h.t >= w.start && h.t < w.end);
  let score = null, dryingLabel = null;
  if (day.length >= 3) {
    const good = day.reduce((s, h) => {
      if ((h.pop ?? 0) >= 25) return s;
      let v = (h.rh ?? 80) < 70 ? 1 : (h.rh ?? 80) < 85 ? 0.7 : 0.35;
      if ((h.wind ?? 0) >= 10) v += 0.2;
      return s + Math.min(1, v);
    }, 0);
    score = Math.round((good / day.length) * 10);
    dryingLabel = score >= 7 ? 'Great drying day' : score >= 4 ? 'Okay for washing — keep an eye out' : 'Dry it indoors';
  }
  return {
    dryWindow,
    rainStart: rainStart ? { time: localHHMM(rainStart.t, offsetMs), pop: rainStart.pop } : null,
    drying: score == null ? null : { score, label: dryingLabel, when: w.label },
  };
}

// ---------------------------------------------------------------- handler
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = req.query || {};
  const lat = num(q.lat), lon = num(q.lon);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'Pass ?lat=..&lon=..' });
  }
  const clampHour = (v, d) => { const n = num(v); return n == null ? d : Math.max(0, Math.min(23, Math.round(n))); };
  const from = clampHour(q.from, 8), to = clampHour(q.to, 22);
  const bias = Math.max(-3, Math.min(3, num(q.bias) ?? 0));
  const la = lat.toFixed(3), lo = lon.toFixed(3);

  const jobs = [
    { id: 'openmeteo', run: () => openMeteo(la, lo) },
    { id: 'metno', name: 'MET Norway (Yr)', run: () => metNorway(la, lo) },
  ];
  if (inIrelandUK(lat, lon)) jobs.push({ id: 'meteireann', name: 'Met Éireann', run: () => metEireann(la, lo) });
  if (process.env.WEATHERAPI_KEY) jobs.push({ id: 'weatherapi', name: 'WeatherAPI.com', run: () => weatherApi(la, lo, process.env.WEATHERAPI_KEY) });
  if (process.env.OPENWEATHER_KEY) jobs.push({ id: 'openweather', name: 'OpenWeather', run: () => openWeather(la, lo, process.env.OPENWEATHER_KEY) });

  const results = await Promise.allSettled(jobs.map((j) => j.run()));
  const sources = [], status = [];
  let om = null, alerts = [];
  results.forEach((r, i) => {
    const job = jobs[i];
    if (r.status === 'rejected') {
      status.push({ id: job.id, name: job.name || 'Open-Meteo models', ok: false, error: String(r.reason?.message || r.reason) });
      return;
    }
    if (job.id === 'openmeteo') {
      om = r.value;
      for (const s of om.sources) sources.push(s);
    } else {
      sources.push({ id: job.id, name: job.name, kind: 'service', hours: r.value.hours });
      if (r.value.alerts) alerts = alerts.concat(r.value.alerts);
    }
  });
  if (!sources.length) return res.status(502).json({ error: 'All weather sources failed', status });

  const offsetSec = om?.offset ?? Math.round(lon / 15) * 3600;
  const offsetMs = offsetSec * 1000;
  const start = Math.floor(Date.now() / H) * H;
  const hours = blendHours(sources, start, 48);
  if (!hours.length) return res.status(502).json({ error: 'No usable forecast data', status });

  const models = sources.filter((s) => s.kind === 'model');
  const daily = blendDaily(models, om?.best);

  for (const s of sources) {
    const summary = summarizeSource(s, start);
    status.push({ id: s.id, name: s.name, kind: s.kind, ok: !!summary, summary });
  }

  // agreement over the next 24h
  const next24 = hours.slice(0, 24);
  const avgSpread = mean(next24.map((h) => h.tMax - h.tMin)) ?? 0;
  const rainSplit = next24.filter((h) => h.wet != null && h.wet > 0.3 && h.wet < 0.7).length;
  const level = avgSpread < 1.5 && rainSplit < 4 ? 'high' : avgSpread < 3 && rainSplit < 8 ? 'medium' : 'low';
  const agreement = {
    level, avgSpread: round(avgSpread), rainSplitHours: rainSplit,
    note: rainSplit >= 4 ? 'Sources disagree on when it will rain' : avgSpread >= 3 ? 'Sources disagree on temperatures' : 'Sources broadly agree',
  };

  const c = om?.best?.current;
  const now = {
    temp: round(median([c?.temperature_2m, hours[0].temp])),
    feels: round(median([c?.apparent_temperature, hours[0].feels])),
    code: c?.weather_code ?? hours[0].code,
    isDay: c ? !!c.is_day : true,
    wind: round(c?.wind_speed_10m ?? hours[0].wind, 0),
    gust: round(c?.wind_gusts_10m ?? hours[0].gust, 0),
    rh: c?.relative_humidity_2m ?? hours[0].rh,
  };

  const mq = om?.best?.minutely_15;
  const nowcast = mq
    ? mq.time.map((t, i) => ({ t: t * 1000, mm: num(mq.precipitation[i]) ?? 0 })).filter((x) => x.t >= Date.now() - 15 * 60000).slice(0, 12)
    : [];

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
  return res.status(200).json({
    generated: Date.now(),
    location: { lat, lon, timezone: om?.tz || null, utcOffsetSeconds: offsetSec },
    now, agreement, sources: status, alerts,
    outfit: outfitAdvice(hours, { from, to, bias, offsetMs }),
    insights: insights(hours, offsetMs),
    nowcast, hours, daily,
  });
}
