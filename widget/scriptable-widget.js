// Weather Blend — iOS home-screen widget for the free "Scriptable" app.
// Small  = temp, feels-like + how cold, rain window, 4 slots (every 2h)
// Medium = the same + outfit tip + 8 hours, hour by hour (best size)
// Large  = 16 hours + outfit advice + the next 4 days
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

// group consecutive wet hours in the next 24h
function rainRanges(hours) {
  const out = []; let cur = null;
  hours.slice(0, 24).forEach((h) => {
    if (isWet(h)) { if (!cur) cur = { from: h.t, to: h.t + 3600000, mm: 0 }; cur.to = h.t + 3600000; cur.mm += h.precip ?? 0; }
    else if (cur) { out.push(cur); cur = null; }
  });
  if (cur) out.push(cur);
  return out;
}

function rainSummary(d, short) {
  const r = rainRanges(d.hours);
  if (!r.length) return { text: short ? '🌤 Dry next 24h' : '🌤 Dry for the next 24h', wet: false };
  const first = r[0], now = Date.now();
  const total = r.reduce((s, x) => s + x.mm, 0);
  const mm = !short && total >= 0.1 ? ` · ${total.toFixed(1)}mm` : '';
  const text = first.from <= now + 1800000
    ? `🌧 Rain now → ${HH(first.to)}${mm}`
    : `☔ ${HH(first.from)}–${HH(first.to)}${r.length > 1 && !short ? ` +${r.length - 1} more` : ''}${mm}`;
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

// small helper: add a text line to a stack
function line(stack, txt, font, color) {
  const t = stack.addText(String(txt));
  t.font = font; t.textColor = color; t.lineLimit = 1; t.minimumScaleFactor = 0.7;
  return t;
}

// a row of hourly columns: time / icon / temp / rain%
function hourRow(parent, list, sz, white, dim, rainBlue) {
  const row = parent.addStack();
  row.layoutHorizontally();
  list.forEach((h, i) => {
    if (i) row.addSpacer();
    const col = row.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    line(col, H12(h.t), Font.systemFont(sz.time), dim);
    line(col, icon(h.code), Font.systemFont(sz.icon), white);
    line(col, T(h.temp), Font.semiboldSystemFont(sz.temp), white);
    line(col, (h.pop ?? 0) >= 20 ? Math.round(h.pop) + '%' : ' ', Font.mediumSystemFont(sz.rain), rainBlue);
  });
}

async function build() {
  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [new Color('#2a5298'), new Color('#1e3c72')];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.url = APP_URL;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

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

  const white = Color.white(), dim = new Color('#ffffff', 0.72), rainBlue = new Color('#8fd0ff');
  const family = config.widgetFamily || 'medium';
  const small = family === 'small', large = family === 'large';
  const today = d.daily[0] || {};
  const [coldWord, coldColor] = coldness(d.now.feels);
  const hrs = d.hours;

  w.setPadding(small ? 10 : 12, small ? 12 : 16, small ? 8 : 10, small ? 12 : 16);

  // ── header: icon + temp (left), H/L + outfit (right, medium/large)
  const top = w.addStack(); top.centerAlignContent();
  line(top, `${icon(d.now.code)} ${T(d.now.temp)}`, Font.boldSystemFont(small ? 24 : 30), white);
  top.addSpacer();
  if (!small) {
    const right = top.addStack(); right.layoutVertically();
    const hl = line(right, `H ${T(today.max)}   L ${T(today.min)}`, Font.semiboldSystemFont(13), white); hl.rightAlignText();
    const ot = line(right, `👔 ${d.outfit.short}`, Font.systemFont(12), dim); ot.rightAlignText();
  }

  // ── feels like + how cold
  const f = w.addStack(); f.centerAlignContent();
  line(f, `Feels ${T(d.now.feels)} · `, Font.systemFont(small ? 11 : 12), dim);
  line(f, coldWord, Font.boldSystemFont(small ? 11 : 12), new Color(coldColor));
  f.addSpacer();

  // ── rain for the day
  const rs = rainSummary(d, small);
  w.addSpacer(small ? 2 : 3);
  line(w, rs.text, Font.semiboldSystemFont(small ? 11 : 12), rs.wet ? rainBlue : dim);
  w.addSpacer(small ? 4 : 6);

  // ── hour by hour
  if (small) {
    hourRow(w, [0, 2, 4, 6].map((i) => hrs[i]).filter(Boolean), { time: 9, icon: 14, temp: 11, rain: 9 }, white, dim, rainBlue);
  } else {
    hourRow(w, hrs.slice(0, 8), { time: 10, icon: 15, temp: 12, rain: 10 }, white, dim, rainBlue);
    if (large) {
      w.addSpacer(8);
      hourRow(w, hrs.slice(8, 16), { time: 10, icon: 15, temp: 12, rain: 10 }, white, dim, rainBlue);
      w.addSpacer(8);
      line(w, d.outfit.headline, Font.semiboldSystemFont(12), white);
      w.addSpacer(8);
      for (const x of d.daily.slice(1, 5)) {
        const row = w.addStack(); row.centerAlignContent();
        line(row, new Date(x.t).toLocaleDateString('en-IE', { weekday: 'short' }), Font.mediumSystemFont(13), white);
        row.addSpacer(10);
        line(row, icon(x.code), Font.systemFont(14), white);
        row.addSpacer(10);
        line(row, x.pop >= 20 ? `${Math.round(x.pop)}%` : '', Font.mediumSystemFont(11), rainBlue);
        row.addSpacer();
        line(row, T(x.min), Font.systemFont(13), dim);
        row.addSpacer(10);
        line(row, T(x.max), Font.semiboldSystemFont(13), white);
        w.addSpacer(3);
      }
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
