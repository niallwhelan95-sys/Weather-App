// Weather Blend — iOS home-screen widget for the free "Scriptable" app.
// Small  = now + feels-like + rain summary + 4 slots (every 2h)
// Medium = the same + 8 hours, hour by hour (best size)
// Large  = 16 hours + the next 4 days
//
// 1. Install Scriptable from the App Store.
// 2. New script → paste this whole file.
// 3. Long-press home screen → + → Scriptable → pick a size → Edit Widget → Script: this one.

const APP_URL = 'https://weather-app-jet-two-47.vercel.app';
const OUT_FROM = 8;   // hour you usually head out
const OUT_TO = 22;    // hour you usually get home
const BIAS = 0;       // -3 (run warm) … +3 (run cold)
const FAHRENHEIT = false;

const ICON = {0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',66:'🌧️',67:'🌧️',71:'🌨️',73:'❄️',75:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',85:'🌨️',86:'🌨️',95:'⛈️',96:'⛈️',99:'⛈️'};
const icon = (c) => {
  const k = Math.round(c);
  return ICON[k] || (k >= 95 ? '⛈️' : k >= 71 ? '❄️' : k >= 61 ? '🌧️' : k >= 51 ? '🌦️' : k >= 45 ? '🌫️' : k >= 3 ? '☁️' : '⛅');
};
const T = (c) => c == null ? '–' : Math.round(FAHRENHEIT ? c * 9 / 5 + 32 : c) + '°';
const H12 = (ms) => { const h = new Date(ms).getHours(); return h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p'; };
const HH = (ms) => String(new Date(ms).getHours()).padStart(2, '0') + ':00';

// how cold does it feel? (word + colour)
function coldness(feels) {
  if (feels < 0)  return ['Freezing', '#9fd8ff'];
  if (feels < 5)  return ['Very cold', '#8fc7ff'];
  if (feels < 10) return ['Cold', '#a9d4ff'];
  if (feels < 15) return ['Chilly', '#cfe6ff'];
  if (feels < 20) return ['Mild', '#ffffff'];
  if (feels < 25) return ['Warm', '#ffe29a'];
  return ['Hot', '#ffb199'];
}

const isWet = (h) => (h.pop ?? 0) >= 50 || (h.precip ?? 0) >= 0.3;

// group consecutive wet hours in the next 24h → "21:00–02:00"
function rainRanges(hours) {
  const out = []; let cur = null;
  hours.slice(0, 24).forEach((h) => {
    if (isWet(h)) { if (!cur) cur = { from: h.t, to: h.t + 3600000, mm: 0 }; cur.to = h.t + 3600000; cur.mm += h.precip ?? 0; }
    else if (cur) { out.push(cur); cur = null; }
  });
  if (cur) out.push(cur);
  return out;
}

function rainSummary(d) {
  const r = rainRanges(d.hours);
  if (!r.length) return { text: '🌤 Dry for the next 24h', wet: false };
  const first = r[0], now = Date.now();
  const total = r.reduce((s, x) => s + x.mm, 0);
  const mm = total >= 0.1 ? ` · ${total.toFixed(1)}mm` : '';
  const text = first.from <= now + 1800000
    ? `🌧 Raining now, until ${HH(first.to)}${mm}`
    : `☔ Rain ${HH(first.from)}–${HH(first.to)}${r.length > 1 ? ` +${r.length - 1} more` : ''}${mm}`;
  return { text, wet: true };
}

async function getLocation() {
  const fm = FileManager.local();
  const cache = fm.joinPath(fm.documentsDirectory(), 'weather-blend-loc.json');
  try {
    Location.setAccuracyToThreeKilometers();
    const l = await Location.current();
    fm.writeString(cache, JSON.stringify(l));
    return l;
  } catch {
    if (fm.fileExists(cache)) return JSON.parse(fm.readString(cache));
    throw new Error('Allow location for Scriptable');
  }
}

// one hourly column: time / icon / temp / rain%
function hourCol(row, h, white, dim, rainBlue, w) {
  const col = row.addStack(); col.layoutVertically(); col.centerAlignContent();
  col.size = new Size(w, 0);
  const add = (txt, font, color) => { const s = col.addStack(); s.centerAlignContent(); s.addSpacer(); const t = s.addText(txt); t.font = font; t.textColor = color; t.lineLimit = 1; s.addSpacer(); return t; };
  add(H12(h.t), Font.systemFont(10), dim);
  add(icon(h.code), Font.systemFont(15), white);
  add(T(h.temp), Font.semiboldSystemFont(12), white);
  add((h.pop ?? 0) >= 20 ? Math.round(h.pop) + '%' : ' ', Font.mediumSystemFont(10), rainBlue);
}

async function build() {
  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [new Color('#2a5298'), new Color('#1e3c72')];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.url = APP_URL;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  w.setPadding(12, 14, 10, 14);

  let d;
  try {
    const loc = await getLocation();
    const req = new Request(`${APP_URL}/api/weather?lat=${loc.latitude.toFixed(3)}&lon=${loc.longitude.toFixed(3)}&from=${OUT_FROM}&to=${OUT_TO}&bias=${BIAS}`);
    req.timeoutInterval = 20;
    d = await req.loadJSON();
    if (d.error) throw new Error(d.error);
  } catch (e) {
    const t = w.addText('⚠️ ' + e.message);
    t.textColor = Color.white(); t.font = Font.systemFont(12);
    return w;
  }

  const white = Color.white(), dim = new Color('#ffffff', 0.7), rainBlue = new Color('#7cc4ff');
  const family = config.widgetFamily || 'medium';
  const small = family === 'small', large = family === 'large';
  const today = d.daily[0] || {};
  const [coldWord, coldColor] = coldness(d.now.feels);

  // — header: icon + temp, H/L on the right
  const top = w.addStack(); top.centerAlignContent();
  const big = top.addText(`${icon(d.now.code)} ${T(d.now.temp)}`);
  big.font = Font.boldSystemFont(small ? 28 : 32); big.textColor = white;
  top.addSpacer();
  if (!small) {
    const right = top.addStack(); right.layoutVertically();
    const hl = right.addText(`H ${T(today.max)}  L ${T(today.min)}`);
    hl.font = Font.semiboldSystemFont(13); hl.textColor = white; hl.rightAlignText();
    const wd = right.addText(`💨 ${Math.round(d.now.wind)} km/h`);
    wd.font = Font.systemFont(11); wd.textColor = dim; wd.rightAlignText();
  }

  // — how cold: "Feels 11° · Chilly"
  const f = w.addStack(); f.centerAlignContent();
  const ft = f.addText(`Feels ${T(d.now.feels)} · `); ft.font = Font.systemFont(12); ft.textColor = dim;
  const fc = f.addText(coldWord); fc.font = Font.boldSystemFont(12); fc.textColor = new Color(coldColor);
  if (small) { f.addSpacer(); }
  if (small) {
    const hl = w.addText(`H ${T(today.max)} · L ${T(today.min)}`);
    hl.font = Font.systemFont(11); hl.textColor = dim;
  }
  w.addSpacer(4);

  // — rain for the day
  const rs = rainSummary(d);
  const r = w.addText(rs.text);
  r.font = Font.semiboldSystemFont(small ? 11 : 12); r.textColor = rs.wet ? rainBlue : dim; r.minimumScaleFactor = 0.7; r.lineLimit = 1;

  // — what to wear (medium/large only; small is too tight)
  if (!small) {
    w.addSpacer(2);
    const wear = w.addText(`👔 ${d.outfit.headline}`);
    wear.font = Font.systemFont(11); wear.textColor = dim; wear.minimumScaleFactor = 0.6; wear.lineLimit = 1;
  }
  w.addSpacer(small ? 5 : 7);

  // — hour by hour
  const hrs = d.hours;
  if (small) {
    const row = w.addStack();
    const picks = [0, 2, 4, 6].map((i) => hrs[i]).filter(Boolean);
    picks.forEach((h, i) => { hourCol(row, h, white, dim, rainBlue, 31); });
  } else {
    const perRow = 8, width = large ? 36 : 36;
    const rows = large ? 2 : 1;
    for (let r2 = 0; r2 < rows; r2++) {
      const row = w.addStack();
      hrs.slice(r2 * perRow, (r2 + 1) * perRow).forEach((h) => hourCol(row, h, white, dim, rainBlue, width));
      if (r2 < rows - 1) w.addSpacer(4);
    }
  }

  // — next days (large)
  if (large) {
    w.addSpacer(8);
    for (const x of d.daily.slice(1, 5)) {
      const row = w.addStack(); row.centerAlignContent();
      const day = row.addText(new Date(x.t).toLocaleDateString('en-IE', { weekday: 'short' })); day.font = Font.mediumSystemFont(13); day.textColor = white;
      row.addSpacer(8);
      row.addText(icon(x.code)).font = Font.systemFont(14);
      row.addSpacer(8);
      const p = row.addText(x.pop >= 20 ? `${Math.round(x.pop)}%` : ''); p.font = Font.mediumSystemFont(11); p.textColor = rainBlue;
      row.addSpacer();
      const lo = row.addText(T(x.min)); lo.font = Font.systemFont(13); lo.textColor = dim;
      row.addSpacer(8);
      const hi = row.addText(T(x.max)); hi.font = Font.semiboldSystemFont(13); hi.textColor = white;
      w.addSpacer(3);
    }
  }
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else if (config.widgetFamily === 'small') await widget.presentSmall();
else if (config.widgetFamily === 'large') await widget.presentLarge();
else await widget.presentMedium();
Script.complete();
