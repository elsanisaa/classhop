# ClassHop

ClassHop helps HKS students check whether a cross-registered week works before they commit. Enter your HKS classes and your classes at other Harvard schools, MIT or Tufts Fletcher, and every move between campuses is rated comfortable, tight or impossible on foot, by bike, by the T or by Harvard shuttle. It also flags days with no lunch break and shows live Red Line departures and service alerts.

Unofficial student project for HKS DPI-681 (Fall 2026) by Elsa Nisa. Not affiliated with or endorsed by Harvard, MIT, Tufts, the MBTA or Citymapper.

## How it works

- `index.html` – the whole app (HTML, CSS and JavaScript, no framework). Schedules stay in the visitor's browser.
- `netlify/functions/mbta.mjs` – a small server-side function that fetches live Red Line predictions and alerts from the [MBTA V3 API](https://www.mbta.com/developers/v3-api) and passes them to the page at `/api/mbta`.
- `netlify.toml` – tells Netlify where the site and the function are.

## API key handling

The MBTA API key is **not** in this repository. It is stored only as the environment variable `MBTA_API_KEY` in the Netlify site settings, and only the server-side function reads it. Never commit keys to GitHub.

## Data sources

HKS academic calendar (Spring 2027), HBS and Fletcher cross-registration rules, FAS class schedule, MIT time (+5 minutes), Harvard shuttle schedule, Harvard Open Data Project Red Line measurements, Fletcher directions, and live MBTA data. Walking and cycling times are estimates from distance. Full list inside the app under "How the times are worked out".
