// ClassHop: a small server-side proxy for the MBTA V3 API.
// The MBTA key lives only in Netlify's environment variable MBTA_API_KEY,
// never in this code or on GitHub. Visitors' browsers never see it.
// Only two kinds of request are allowed, so this can't be used as an open proxy.

const BASE = "https://api-v3.mbta.com";
const STOPS = new Set(["place-harsq", "place-knncl", "place-dav"]); // Harvard, Kendall/MIT, Davis

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async (req) => {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  let path;

  if (kind === "predictions") {
    const stop = url.searchParams.get("stop");
    if (!STOPS.has(stop)) return json({ error: "Unknown stop" }, 400);
    // No sort/limit here: entries without times (e.g. skipped stops) would crowd out real ones.
    // The page picks the next two departures per direction itself.
    path = `/predictions?filter[stop]=${stop}&filter[route]=Red&fields[prediction]=arrival_time,departure_time,direction_id,schedule_relationship`;
  } else if (kind === "alerts") {
    path = `/alerts?filter[route]=Red&filter[datetime]=NOW`;
  } else {
    return json({ error: "Unknown request" }, 400);
  }

  const key =
    (globalThis.Netlify && Netlify.env && Netlify.env.get("MBTA_API_KEY")) ||
    process.env.MBTA_API_KEY ||
    "";
  const headers = { accept: "application/vnd.api+json" };
  if (key) headers["x-api-key"] = key;

  try {
    const res = await fetch(BASE + path, { headers });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=20",
      },
    });
  } catch (err) {
    return json({ error: "Could not reach the MBTA" }, 502);
  }
};

export const config = { path: "/api/mbta" };
