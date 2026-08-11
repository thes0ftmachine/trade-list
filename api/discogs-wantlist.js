// Vercel serverless function — proxies a public Discogs wantlist lookup so
// results can be imported into our want list. Uses the same DISCOGS_TOKEN
// personal access token as discogs-search.js / discogs-detail.js, sent
// purely to get friendlier rate limits — the /users/{username}/wants
// endpoint itself is unauthenticated and public by default.
//
// If the target user has set their Discogs wantlist to private, Discogs
// returns 403 regardless of whose token is used; that's passed through as
// a clear error rather than treated as a server failure. Importing a
// private wantlist requires full user OAuth 1.0a (the requesting user
// authorizing on Discogs, not just our app's own token) and is intentionally
// out of scope here — see the DISCOGS_CONSUMER_KEY/SECRET notes below for
// where that would plug in.

// Discogs appends " (2)", " (3)", etc. to artist names to disambiguate
// same-named artists — strip that back off for a cleaner display title.
const stripDisambiguation = (str) => (str || "").replace(/\s*\(\d+\)$/, "");

export default async function handler(req, res) {
  const { username } = req.query;

  if (!username || !username.trim()) {
    res.status(400).json({ error: "Missing required query param: username" });
    return;
  }

  const token = process.env.DISCOGS_TOKEN;
  if (!token) {
    res.status(500).json({ error: "Server is missing DISCOGS_TOKEN" });
    return;
  }

  const cleanUsername = username.trim();
  const perPage = 100;
  const maxPages = 10; // safety cap — 1000 items covers any wantlist someone would actually import by hand
  let page = 1;
  let allWants = [];

  try {
    while (page <= maxPages) {
      const url = `https://api.discogs.com/users/${encodeURIComponent(
        cleanUsername
      )}/wants?page=${page}&per_page=${perPage}&token=${token}`;

      const discogsRes = await fetch(url, {
        headers: { "User-Agent": "VolverRecordsWantList/1.0" },
      });

      if (discogsRes.status === 404) {
        res.status(404).json({ error: `No Discogs user found named "${cleanUsername}".` });
        return;
      }
      if (discogsRes.status === 403) {
        res.status(403).json({
          error: `${cleanUsername}'s Discogs wantlist is private — public wantlists only for now.`,
        });
        return;
      }
      if (!discogsRes.ok) {
        res.status(discogsRes.status).json({ error: "Discogs returned an error." });
        return;
      }

      const data = await discogsRes.json();
      allWants = allWants.concat(data.wants || []);

      const totalPages = data.pagination ? data.pagination.pages : 1;
      if (page >= totalPages) break;
      page += 1;
    }

    // Normalize each want to look like the shape our existing Discogs search
    // results already use (item.genre / item.style as arrays, item.format as
    // an array of strings) so the frontend can reuse deriveGenre/deriveFormat
    // instead of duplicating that logic here.
    const items = allWants.map((w) => {
      const info = w.basic_information || {};
      const artists = (info.artists || []).map((a) => stripDisambiguation(a.name)).join(", ");
      const title = artists ? `${artists} – ${info.title || "Untitled"}` : info.title || "Untitled";
      const format = (info.formats || [])
        .flatMap((f) => [f.name, ...(f.descriptions || [])])
        .filter(Boolean);
      const isMaster = (info.resource_url || "").includes("/masters/");
      const url = info.id ? `https://www.discogs.com/${isMaster ? "master" : "release"}/${info.id}` : null;

      return {
        id: w.id,
        title,
        year: info.year || null,
        thumb: info.thumb || null,
        image_full: info.cover_image || info.thumb || null,
        url,
        genre: info.genres || [],
        style: info.styles || [],
        format,
        discogsNotes: w.notes || null,
      };
    });

    res.status(200).json({ items });
  } catch (err) {
    res.status(502).json({ error: "Couldn't reach Discogs." });
  }
}

// --- Phase 2 notes: private wantlist import via OAuth 1.0a ---
// The Discogs app credentials for this (Consumer Key / Consumer Secret) are
// already registered but not used here — that flow needs:
//   1. POST to https://api.discogs.com/oauth/request_token (signed with the
//      consumer key/secret) to get a request token + secret.
//   2. Redirect the user to https://www.discogs.com/oauth/authorize with
//      that request token; Discogs redirects back to our callback URL
//      (currently blank in the Discogs app settings — needs to be set to
//      this site's callback route before this phase starts) with a verifier.
//   3. POST to https://api.discogs.com/oauth/access_token to exchange for a
//      per-user access token + secret.
//   4. Sign each /users/{username}/wants request with that access token via
//      HMAC-SHA1, per Discogs' OAuth 1.0a spec (their OAuth2-style bearer
//      tokens don't apply here — Discogs still uses 1.0a for user auth).
// That access token/secret would need to be held somewhere for the length
// of the session (or persisted, if we want to avoid re-authorizing every
// visit) — probably a new Supabase table keyed to a device/session id,
// since there's no existing user-auth layer to hang it off of.
