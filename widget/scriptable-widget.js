// Weather Blend — iOS home-screen widget for the free "Scriptable" app.
// 1. Install Scriptable from the App Store.
// 2. New script → paste this whole file → set APP_URL below to your Vercel URL.
// 3. Long-press home screen → + → Scriptable → pick Small or Medium → Edit Widget → Script: this one.

const APP_URL = 'https://weather-app-jet-two-47.vercel.app';
const OUT_FROM = 8;   // hour you usually head out
const OUT_TO = 22;    // hour you usually get home
const BIAS = 0;       // -3 (run warm) … +3 (run cold)
const FAHRENHEIT = false;

const ICON = {0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',66:'🌧️',67:'🌧️',71:'🌨️',73:'❄️',75:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',85:'🌨️',86:'🌨️',95:'⛈️',96:'⛈️',99:'⛈️'};
const T = (c) => c == null ? '–' : Math.round(FAHRENHEIT ? c * 9 / 5 + 32 : c) + '°';

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

async function build() {
  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [new Color('#2a5298'), new Color('#1e3c72')];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.url = APP_URL;
  w.refreshAfterDate = new Date(Date.now() + 20 * 60 * 1000);

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

  const white = Color.white(), dim = new Color('#ffffff', 0.7);
  const family = config.widgetFamily || 'medium';
  const top = w.addStack(); top.centerAlignContent();
  const big = top.addText(`${ICON[d.now.code] || '🌡️'} ${T(d.now.temp)}`);
  big.font = Font.boldSystemFont(family === 'small' ? 28 : 32); big.textColor = white;
  top.addSpacer();
  if (family !== 'small') {
    const hl = top.addText(`H ${T(d.daily[0]?.max)}  L ${T(d.daily[0]?.min)}`);
    hl.font = Font.systemFont(13); hl.textColor = dim;
  }
  const feels = w.addText(`Feels ${T(d.now.feels)} · ${d.sources.filter((s) => s.ok).length} sources`);
  feels.font = Font.systemFont(11); feels.textColor = dim;
  w.addSpacer(6);

  const wear = w.addText(`👔 ${family === 'small' ? d.outfit.short : d.outfit.headline}`);
  wear.font = Font.semiboldSystemFont(family === 'small' ? 13 : 14); wear.textColor = white; wear.minimumScaleFactor = 0.7;
  w.addSpacer(4);

  const rain = d.insights.rainStart ? `☔ Rain from ${d.insights.rainStart.time}` : '🌤 Dry for the next 24h';
  const r = w.addText(rain); r.font = Font.systemFont(12); r.textColor = dim;

  if (family !== 'small') {
    w.addSpacer(6);
    const row = w.addStack();
    for (const h of d.hours.filter((_, i) => i % 3 === 0).slice(0, 6)) {
      const col = row.addStack(); col.layoutVertically(); col.centerAlignContent();
      const tt = col.addText(new Date(h.t).getHours() + 'h'); tt.font = Font.systemFont(10); tt.textColor = dim;
      const ic = col.addText(ICON[h.code] || '·'); ic.font = Font.systemFont(14);
      const tv = col.addText(T(h.temp)); tv.font = Font.semiboldSystemFont(11); tv.textColor = white;
      row.addSpacer();
    }
  }
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
