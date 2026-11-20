// ClassHop: a small server-side proxy for the MBTA V3 API.
// The MBTA key lives only in Netlify's environment variable MBTA_API_KEY,
// never in this code or on GitHub. Visitors' browsers never see it.
// Only a fixed set of requests is allowed, so this can't be used as an open proxy.
//
//   /api/mbta?kind=predictions&stop=place-harsq   Red Line departures at Harvard, Kendall/MIT or Davis
//   /api/mbta?kind=alerts                         Service alerts for the Red Line and bus routes 1 and 96
//   /api/mbta?kind=buspreds&at=harvard            Live bus departures near Harvard, MIT or Tufts
//   /api/mbta?kind=busplan                        Typical bus frequency and ride time, from the MBTA timetable

const BASE = "https://api-v3.mbta.com";
const STOPS = new Set(["place-harsq", "place-knncl", "place-dav"]); // Harvard, Kendall/MIT, Davis

// Places where ClassHop students catch or leave the bus. Stops are found by the MBTA near these points.
const PLACES = {
  harvard: { lat: 42.3730, lon: -71.1186, routes: "1,96" }, // Harvard Square / Harvard station
  mit: { lat: 42.3597, lon: -71.0938, routes: "1" },        // Mass Ave at MIT (77 Mass Ave)
  tufts: { lat: 42.4066, lon: -71.1192, routes: "96" },     // College Ave by the Tufts campus
};
const BUS_TRIPS = [
  { route: "1", far: "mit" },    // Harvard <-> MIT
  { route: "96", far: "tufts" }, // Harvard <-> Tufts (Fletcher)
];
const RADIUS = 0.004; // degrees, about 400 m

const json = (obj, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });

function apiKey() {
  return (
    (globalThis.Netlify && Netlify.env && Netlify.env.get("MBTA_API_KEY")) ||
    process.env.MBTA_API_KEY ||
    ""
  );
}

async function mbta(path) {
  const headers = { accept: "application/vnd.api+json" };
  const key = apiKey();
  if (key) headers["x-api-key"] = key;
  const res = await fetch(BASE + path, { headers });
  if (!res.ok) throw new Error(`MBTA returned ${res.status}`);
  return res.json();
}

// ---- Bus timetable summary (cached for 6 hours per function instance) ----
let planCache = { at: 0, data: null };

function nextWeekdayInBoston() {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  let d = new Date();
  for (let i = 0; i < 7; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
    if (!["Sat", "Sun"].includes(parts.weekday)) return `${parts.year}-${parts.month}-${parts.day}`;
    d = new Date(d.getTime() + 86400000);
  }
  return null;
}
const minutesOfDay = (iso) => (iso ? Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)) : null);
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

async function stopsNear(route, place) {
  const p = PLACES[place];
  const body = await mbta(`/stops?filter[route]=${route}&filter[latitude]=${p.lat}&filter[longitude]=${p.lon}&filter[radius]=${RADIUS}`);
  const map = {};
  for (const s of body.data || []) map[s.id] = { id: s.id, name: s.attributes.name, lat: s.attributes.latitude, lon: s.attributes.longitude };
  return map;
}

// (No sparse fieldsets on schedules/bus predictions: they would also drop the trip, stop and route links we need.)
// For one direction (board near A, get off near B): typical gap between buses and ride time, 9:00–17:00.
function summarize(rows, aStops, bStops) {
  const byTrip = {};
  for (const r of rows) {
    const trip = r.relationships && r.relationships.trip && r.relationships.trip.data && r.relationships.trip.data.id;
    const stop = r.relationships && r.relationships.stop && r.relationships.stop.data && r.relationships.stop.data.id;
    if (!trip || !stop) continue;
    (byTrip[trip] = byTrip[trip] || []).push({ stop, seq: r.attributes.stop_sequence, dep: r.attributes.departure_time, arr: r.attributes.arrival_time });
  }
  const departures = [], rides = [], boardCount = {}, alightCount = {};
  for (const list of Object.values(byTrip)) {
    list.sort((x, y) => x.seq - y.seq);
    let board = null;
    for (const e of list) {
      if (aStops[e.stop] && e.dep) board = e; // last stop near A before reaching B
      else if (bStops[e.stop] && board && (e.arr || e.dep)) {
        const d = minutesOfDay(board.dep), a = minutesOfDay(e.arr || e.dep);
        if (d >= 540 && d <= 1020 && a > d) {
          departures.push(d); rides.push(a - d);
          boardCount[board.stop] = (boardCount[board.stop] || 0) + 1;
          alightCount[e.stop] = (alightCount[e.stop] || 0) + 1;
        }
        break;
      }
    }
  }
  departures.sort((x, y) => x - y);
  const gaps = departures.slice(1).map((d, i) => d - departures[i]).filter((g) => g > 0);
  const top = (counts, stops) => { const id = Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0]; return id ? stops[id] : null; };
  return {
    trips: departures.length,
    headway: median(gaps),
    ride: median(rides),
    board: top(boardCount, aStops),
    alight: top(alightCount, bStops),
  };
}

async function busPlan() {
  if (planCache.data && Date.now() - planCache.at < 6 * 3600 * 1000) return planCache.data;
  const date = nextWeekdayInBoston();
  const out = { date, routes: {} };
  for (const t of BUS_TRIPS) {
    const home = await stopsNear(t.route, "harvard");
    const far = await stopsNear(t.route, t.far);
    const ids = [...Object.keys(home), ...Object.keys(far)].join(",");
    if (!ids) { out.routes[t.route] = null; continue; }
    const sched = await mbta(`/schedules?filter[route]=${t.route}&filter[date]=${date}&filter[stop]=${ids}`);
    out.routes[t.route] = {
      out: summarize(sched.data || [], home, far),  // from Harvard
      back: summarize(sched.data || [], far, home), // to Harvard
    };
  }
  planCache = { at: Date.now(), data: out };
  return out;
}

export default async (req) => {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  try {
    if (kind === "predictions") {
      const stop = url.searchParams.get("stop");
      if (!STOPS.has(stop)) return json({ error: "Unknown stop" }, 400);
      // No sort/limit: entries without times (e.g. skipped stops) would crowd out real ones.
      return json(await mbta(`/predictions?filter[stop]=${stop}&filter[route]=Red&fields[prediction]=arrival_time,departure_time,direction_id,schedule_relationship`), 200, 20);
    }
    if (kind === "alerts") {
      return json(await mbta(`/alerts?filter[route]=Red,1,96&filter[datetime]=NOW`), 200, 60);
    }
    if (kind === "buspreds") {
      const p = PLACES[url.searchParams.get("at")];
      if (!p) return json({ error: "Unknown place" }, 400);
      return json(await mbta(`/predictions?filter[route]=${p.routes}&filter[latitude]=${p.lat}&filter[longitude]=${p.lon}&filter[radius]=${RADIUS}&include=route`), 200, 20);
    }
    if (kind === "busplan") {
      return json(await busPlan(), 200, 3600);
    }
    return json({ error: "Unknown request" }, 400);
  } catch (err) {
    return json({ error: "Could not get data from the MBTA" }, 502);
  }
};

export const config = { path: "/api/mbta" };
