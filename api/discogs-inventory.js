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
          title: release.title || "",
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

    return res.status(200).json({ username: username.trim(), items });
  } catch (err) {
    console.error("discogs-inventory error:", err);
    return res.status(500).json({ error: "Failed to fetch Discogs inventory" });
  }
}
