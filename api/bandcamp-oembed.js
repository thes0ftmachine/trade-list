// /api/bandcamp-oembed.js
//
// Bandcamp has no public, CORS-friendly oEmbed endpoint, so the Listening
// tab can't fetch a preview for bandcamp.com links directly from the
// browser. Every track/album page does carry standard OpenGraph meta tags
// though, and fetching a page server-side has no CORS restriction — so this
// proxies the request, reads the tags, and hands back the same shape the
// frontend already gets from Spotify/YouTube's oEmbed responses.
//
// Mirrors the pattern used by /api/discogs-search: keep the fetch (and, for
// Discogs, the token) off the client.

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url || typeof url !== "string" || !url.includes("bandcamp.com")) {
    res.status(400).json({ error: "A bandcamp.com URL is required" });
    return;
  }

  try {
    const pageRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VolverRecordsBot/1.0)" },
    });

    if (!pageRes.ok) {
      res.status(502).json({ error: "Couldn't fetch that Bandcamp page" });
      return;
    }

    const html = await pageRes.text();

    const readMeta = (property) => {
      // og:* tags can appear with property before or after content in the
      // markup, so try both attribute orders.
      const forward = html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"));
      if (forward) return forward[1];
      const backward = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, "i"));
      return backward ? backward[1] : null;
    };

    const rawTitle = readMeta("og:title");
    const thumbnailUrl = readMeta("og:image");
    const ogType = readMeta("og:type") || "";

    // Bandcamp's og:type reads "music.album" for albums/full releases and
    // "song" (or similar) for individual tracks — anything album-shaped, or
    // an /album/ URL, is treated as a playlist-style post.
    const kind = ogType.includes("album") || url.includes("/album/") ? "playlist" : "song";

    // Track/album pages title as "Track Name, by Artist Name" — split that
    // out so the card can show the artist on its own line, same as the
    // Spotify/YouTube previews (title + author_name).
    let title = rawTitle;
    let authorName = null;
    if (rawTitle && rawTitle.includes(", by ")) {
      const [namePart, artistPart] = rawTitle.split(", by ");
      title = namePart.trim();
      authorName = artistPart.trim();
    }

    res.status(200).json({
      title: title || null,
      author_name: authorName,
      thumbnail_url: thumbnailUrl || null,
      kind,
    });
  } catch (e) {
    res.status(500).json({ error: "Bandcamp preview failed" });
  }
}
