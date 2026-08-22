// api/discogs-inventory.js
// Vercel serverless function: fetches a Discogs user's "For Sale" inventory,
// paginating through all pages, and returns a flat array of listings.
//
// Usage: GET /api/discogs-inventory?username=someseller
//
// Env vars required (set in Vercel project settings):
//   DISCOGS_TOKEN        - your Discogs personal access token (server-side only)
//   DISCOGS_USER_AGENT   - e.g. "VolverRecordsTradeList/1.0 +https://yourdomain.com"

const DISCOGS_BASE = "https://api.discogs.com";
const PER_PAGE = 100; // Discogs max per_page

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { username } = req.query;
  if (!username || typeof username !== "string") {
    return res.status(400).json({ error: "Missing 'username' query param" });
  }

  const token = process.env.DISCOGS_TOKEN;
  const userAgent = process.env.DISCOGS_USER_AGENT || "TradeListApp/1.0";

  if (!token) {
    return res.status(500).json({ error: "Server misconfigured: missing DISCOGS_TOKEN" });
  }

  try {
    const allListings = [];
    let page = 1;
    let totalPages = 1;

    do {
      const url = new URL(`${DISCOGS_BASE}/users/${encodeURIComponent(username)}/inventory`);
      url.searchParams.set("status", "For Sale"); // unauthenticated/non-owner view only ever returns For Sale anyway
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
        // If the username doesn't exist or has no public inventory, Discogs returns 404/403
        const errText = await response.text();
        return res.status(response.status).json({
          error: `Discogs API error (${response.status})`,
          detail: errText,
        });
      }

      const data = await response.json();

      totalPages = data?.pagination?.pages ?? 1;

      const mapped = (data.listings || []).map((listing) => ({
        discogs_listing_id: listing.id,
        discogs_release_id: listing.release?.id ?? null,
        title: listing.release?.title ?? "",
        artist: listing.release?.artist ?? "",
        format: Array.isArray(listing.release?.format)
          ? listing.release.format.join(", ")
          : listing.release?.format ?? "",
        condition: listing.condition ?? null,
        sleeve_condition: listing.sleeve_condition ?? null,
        price: listing.price?.value ?? null,
        currency: listing.price?.currency ?? null,
        comments: listing.comments ?? "",
        // Note: the inventory list endpoint returns a small thumb; for a full-size
        // image you'd need a second call to the release detail endpoint, same
        // two-step pattern used elsewhere in the want-list app.
        thumb_url: listing.release?.thumbnail ?? null,
        listed_at: listing.listed ?? null,
        source: "discogs_inventory",
      }));

      allListings.push(...mapped);
      page += 1;
    } while (page <= totalPages);

    return res.status(200).json({
      username,
      count: allListings.length,
      listings: allListings,
    });
  } catch (err) {
    console.error("discogs-inventory error:", err);
    return res.status(500).json({ error: "Failed to fetch Discogs inventory" });
  }
}
