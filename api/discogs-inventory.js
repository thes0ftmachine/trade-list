// api/discogs-inventory.js
// Vercel serverless function: fetches a Discogs user's "For Sale" inventory
// (their seller listings), paginating through all pages, and returns items
// shaped the same way /api/discogs-wantlist does — so the same
// deriveGenre/deriveFormat/isDuplicate helpers in App.js work unchanged.
//
// GET /api/discogs-inventory?username=someseller
//
// Env vars (same ones discogs-wantlist.js already uses):
//   DISCOGS_TOKEN
//   DISCOGS_USER_AGENT

const DISCOGS_BASE = "https://api.discogs.com";
const PER_PAGE = 100;
// How many /releases/{id} lookups to run at once when backfilling artist
// names — keeps us well under Discogs' authenticated rate limit (60/min)
// even for a seller with a big inventory full of distinct releases.
const ARTIST_FETCH_CONCURRENCY = 5;

// Discogs appends " (2)", " (3)", etc. to artist names to disambiguate
// same-named artists — strip that back off for a cleaner display name.
// (Same helper as discogs-wantlist.js.)
const stripDisambiguation = (str) => (str || "").replace(/\s*\(\d+\)$/, "");

// The inventory endpoint's embedded release object (id, title, description,
// thumbnail, format, year) doesn't include the artist at all — description
// is just "Title (Format details)", not "Artist - Title". So for each
// distinct release referenced by the seller's listings, fetch the full
// release resource (which does have an `artists` array) and cache the
// result by release id, since the same release can appear more than once.
async function fetchArtistsByReleaseId(releaseIds, token, userAgent) {
  const artistByReleaseId = new Map();
  const ids = [...releaseIds];
  let cursor = 0;

  async function worker() {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        const response = await fetch(`${DISCOGS_BASE}/releases/${id}`, {
          headers: {
            "User-Agent": userAgent,
            Authorization: `Discogs token=${token}`,
          },
        });
        if (response.ok) {
          const data = await response.json();
          const artist = (data.artists || [])
            .map((a) => stripDisambiguation(a.name))
            .join(", ");
          artistByReleaseId.set(id, artist || null);
        } else {
          artistByReleaseId.set(id, null);
        }
      } catch {
        artistByReleaseId.set(id, null);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ARTIST_FETCH_CONCURRENCY, ids.length) }, worker)
  );

  return artistByReleaseId;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { username } = req.query;
  if (!username || typeof username !== "string" || !username.trim()) {
    return res.status(400).json({ error: "Missing 'username' query param" });
  }

  const token = process.env.DISCOGS_TOKEN;
  const userAgent = process.env.DISCOGS_USER_AGENT || "VolverTradeList/1.0";

  if (!token) {
    return res.status(500).json({ error: "Server misconfigured: missing DISCOGS_TOKEN" });
  }

  try {
    const items = [];
    let page = 1;
    let totalPages = 1;

    do {
      const url = new URL(`${DISCOGS_BASE}/users/${encodeURIComponent(username.trim())}/inventory`);
      // Not authenticated as the inventory's owner, so Discogs only ever
      // returns "For Sale" listings here regardless of this param — set it
      // explicitly anyway for clarity.
      url.searchParams.set("status", "For Sale");
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(PER_PAGE));
      url.searchParams.set("sort", "listed");
      url.searchParams.set("sort_order", "desc");

      const response = await fetch(url.toString(), {
        headers: {
          "User-Agent": userAgent,
          Authorization: `Discogs token=${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return res.status(404).json({ error: `No Discogs user named "${username}"` });
        }
        const detail = await response.text();
        return res.status(response.status).json({ error: "Discogs API error", detail });
      }

      const data = await response.json();
      totalPages = data?.pagination?.pages ?? 1;

      for (const listing of data.listings || []) {
        const release = listing.release || {};
        items.push({
          // Prefix so a listing id can never collide with a wantlist item's
          // release id in React key / selection maps.
          id: `inv-${listing.id}`,
          releaseId: release.id || null, // used below to backfill artist, stripped before responding
          title: release.title || "",
          artist: null, // filled in after pagination via fetchArtistsByReleaseId
          thumb: release.thumbnail || null,
          image_full: release.thumbnail || null,
          url: listing.uri || (release.id ? `https://www.discogs.com/release/${release.id}` : null),
          year: release.year || null,
          format: release.format || null, // array, same shape deriveFormat() expects
          genre: null, // the inventory endpoint doesn't return genre/style — deriveGenre() falls back to style below
          style: null,
          discogsNotes: listing.comments || null,
          condition: listing.condition || null,
          sleeve_condition: listing.sleeve_condition || null,
          price: listing.price?.value != null ? String(listing.price.value) : null,
          currency: listing.price?.currency || null,
        });
      }

      page += 1;
    } while (page <= totalPages);

    // Backfill artist names with one lookup per distinct release rather
    // than one per listing, since the same release can be listed more than
    // once (different condition/price).
    const uniqueReleaseIds = [...new Set(items.map((it) => it.releaseId).filter(Boolean))];
    const artistByReleaseId = await fetchArtistsByReleaseId(uniqueReleaseIds, token, userAgent);
    // App.js only reads it.title (there's no separate artist column on
    // trade_items), so fold the artist into the title here — same
    // "Artist - Title" convention discogs-wantlist.js already uses.
    const finalItems = items.map(({ releaseId, title, ...item }) => {
      const artist = releaseId ? artistByReleaseId.get(releaseId) : null;
      return {
        ...item,
        title: artist ? `${artist} - ${title}` : title,
        artist: artist || null,
      };
    });

    return res.status(200).json({ username: username.trim(), items: finalItems });
  } catch (err) {
    console.error("discogs-inventory error:", err);
    return res.status(500).json({ error: "Failed to fetch Discogs inventory" });
  }
}
