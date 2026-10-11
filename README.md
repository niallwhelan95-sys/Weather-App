# Weather Blend

A personal weather app that blends **7–10 forecasts** into one consensus instead of trusting a single source, then tells you what to wear.

## Where the forecast comes from

| Source | Key needed? | Notes |
|---|---|---|
| ECMWF, GFS, ICON, UK Met Office, Météo-France, GEM, KNMI Harmonie | No | All via Open-Meteo's free API |
| MET Norway (Yr) | No | High-res European model |
| Met Éireann | No | Auto-enabled in Ireland/UK |
| WeatherAPI.com | Free key (optional) | Also adds official **weather warnings** |
| OpenWeather | Free key (optional) | 3-hourly forecast |

Each hour uses the **median** of all sources (one bad model can't skew it). Rain chance combines each source's own % with how many models actually predict rain. The app shows how well sources agree, so you know when to trust it.

## Features

- 👔 **Outfit advice** for the hours you're actually out (set in ⚙️ — overnight windows like 17:00–02:00 work), with "heading out" vs "coming home" conditions
- 🥶 "I run cold / warm" slider shifts the advice
- ☔ 15-minute rain nowcast for the next 3 hours
- 🌤 Best dry window for a walk/run, 👕 washing-line drying score
- ☂️ Warns you when it's too windy for an umbrella
- 📡 Source comparison table + agreement meter
- 24h chart with a shaded "range across sources" band, 7-day forecast
- Search any place, °C/°F, background matches the sky

## Deploy to Vercel (≈5 min, free)

1. Create a GitHub repo and upload everything in this folder (keep the `api/` folder).
2. Go to vercel.com → **Add New → Project** → import the repo → **Deploy** (no build settings needed).
3. In the project: **Settings → Environment Variables**, add:
   - `CONTACT_UA` = `weather-blend/1.0 you@example.com` (MET Norway asks for a contact; use your email)
   - Optional: `WEATHERAPI_KEY` (free at weatherapi.com) and/or `OPENWEATHER_KEY` (free at openweathermap.org)
4. Redeploy (Deployments → ⋯ → Redeploy) after adding variables.

Test the API: `https://YOUR-PROJECT.vercel.app/api/weather?lat=53.35&lon=-6.26`

## Put it on your iPhone

**App:** open your Vercel URL in **Safari** → Share → **Add to Home Screen**. Allow location when asked. It opens full-screen like a native app.

**Home-screen widget** (iOS doesn't let websites make widgets, so we use the free *Scriptable* app):
1. Install **Scriptable** from the App Store.
2. Open it → **+** → paste `widget/scriptable-widget.js` → change `APP_URL` to your Vercel URL (and your out hours) → name it "Weather".
3. Long-press home screen → **+** → Scriptable → Small or Medium → add → tap it → **Script: Weather**.

The widget shows temp, what to wear, when rain starts, and (medium) the next 15 hours. Tapping it opens the app.
