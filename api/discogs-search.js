// Vercel serverless function — proxies Discogs search requests so the
// Discogs personal access token never has to live in the browser.
// The token is read from an environment variable (set in Vercel's
// dashboard: Project -> Settings -> Environment Variables -> DISCOGS_TOKEN),
// never from anything shipped in the frontend bundle.

export default async function handler(req, res) {
  const { q, type, per_page } = req.query;

  if (!q || !type) {
    res.status(400).json({ error: "Missing required query params: q, type" });
    return;
  }
  if (type !== "master" && type !== "release") {
    res.status(400).json({ error: "type must be 'master' or 'release'" });
    return;
  }

  const token = process.env.DISCOGS_TOKEN;
  if (!token) {
    res.status(500).json({ error: "Server is missing DISCOGS_TOKEN" });
    return;
  }

  const safePerPage = Math.min(parseInt(per_page, 10) || 12, 25);
  const url = `https://api.discogs.com/database/search?q=${encodeURIComponent(
    q
  )}&type=${type}&per_page=${safePerPage}&token=${token}`;

  try {
    const discogsRes = await fetch(url, {
      headers: { "User-Agent": "VolverRecordsWantList/1.0" },
    });
    const data = await discogsRes.json();
    res.status(discogsRes.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "Couldn't reach Discogs" });
  }
}
