// Vercel serverless function — proxies a single release/master detail
// lookup (used to backfill thumbnail + full-resolution image data, since
// Discogs' search endpoint never includes images). Same token-hiding
// purpose as discogs-search.js.
//
// The `url` param must already be a real Discogs API resource_url returned
// by our own search proxy — this handler validates that before fetching,
// so it can't be used as an open proxy to arbitrary URLs.

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    res.status(400).json({ error: "Missing required query param: url" });
    return;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    res.status(400).json({ error: "Invalid url" });
    return;
  }

  const isDiscogsApiHost = parsed.hostname === "api.discogs.com";
  const isReleaseOrMasterPath = /^\/(releases|masters)\/\d+$/.test(parsed.pathname);
  if (!isDiscogsApiHost || !isReleaseOrMasterPath) {
    res.status(400).json({ error: "url must be a Discogs release or master resource_url" });
    return;
  }

  const token = process.env.DISCOGS_TOKEN;
  if (!token) {
    res.status(500).json({ error: "Server is missing DISCOGS_TOKEN" });
    return;
  }

  try {
    const discogsRes = await fetch(`${url}?token=${token}`, {
      headers: { "User-Agent": "VolverRecordsWantList/1.0" },
    });
    const data = await discogsRes.json();
    res.status(discogsRes.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "Couldn't reach Discogs" });
  }
}
