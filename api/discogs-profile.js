// GET /api/discogs-profile?username=<discogs username>
//
// Thin proxy around Discogs' public GET /users/{username} endpoint, used to
// pull a user's Discogs avatar into their Trade List profile. No Discogs
// auth is required for this endpoint — it's the same "public data point"
// Discogs added avatar_url to — but Discogs does require every caller to
// send a unique, descriptive User-Agent or it'll throttle/block the request.
// Mirrors the existing /api/discogs-wantlist and /api/discogs-inventory
// proxies: same reason to route through our own backend (avoid CORS, keep
// a single place that sets the User-Agent) even though no secret is used.

const USER_AGENT = "VolverRecordsTradeList/1.0 +https://volverrecords.com";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const username = (req.query.username || "").trim();
  if (!username) {
    res.status(400).json({ error: "Missing username" });
    return;
  }

  try {
    const discogsRes = await fetch(
      `https://api.discogs.com/users/${encodeURIComponent(username)}`,
      { headers: { "User-Agent": USER_AGENT } }
    );

    if (discogsRes.status === 404) {
      res.status(404).json({ error: `No Discogs user found for "${username}".` });
      return;
    }
    if (!discogsRes.ok) {
      res.status(discogsRes.status).json({ error: "Discogs couldn't be reached right now." });
      return;
    }

    const data = await discogsRes.json();
    // Discogs' avatar field falls back to a Gravatar-generated default even
    // when the user never set a custom photo, so this can never be missing
    // for a valid username — but guard anyway rather than trust that.
    if (!data.avatar_url) {
      res.status(404).json({ error: `${username} doesn't have a Discogs photo set.` });
      return;
    }

    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).json({ avatar_url: data.avatar_url });
  } catch (err) {
    res.status(502).json({ error: "Couldn't reach Discogs — try again." });
  }
}
