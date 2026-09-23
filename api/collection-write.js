import { readSignedCookie } from "./_lib/cookies.js";
import { signedRequestHeader } from "./_lib/discogsAuth.js";

const DISCOGS_BASE = "https://api.discogs.com";
const USER_AGENT = "RandomDiscovery/1.0";
// Folder 1 always exists on every Discogs account ("Uncategorized") and, unlike folder 0
// (the virtual "All" folder), can actually be posted to — so it's the only safe default
// without asking the person to pick a folder first.
const UNCATEGORIZED_FOLDER_ID = 1;

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed.");

  const session = readSignedCookie(req, "discogs_session");
  if (!session) return sendError(res, 401, "You're not logged in to Discogs.");

  const consumerKey = process.env.DISCOGS_CONSUMER_KEY;
  const consumerSecret = process.env.DISCOGS_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) return sendError(res, 500, "The Discogs connection has not been configured.");

  const { action, releaseId } = req.body || {};
  const id = String(releaseId ?? "").trim();
  if (!/^\d+$/.test(id)) return sendError(res, 400, "That doesn't look like a valid release.");
  if (action !== "collection" && action !== "wantlist") return sendError(res, 400, "Unrecognized action.");

  // Discogs' two "add" endpoints use different verbs and paths for historical reasons:
  // collection additions are POSTed to a folder, wantlist additions are PUT directly to
  // /wants/{release_id}.
  const method = action === "collection" ? "POST" : "PUT";
  const path =
    action === "collection"
      ? `/users/${encodeURIComponent(session.username)}/collection/folders/${UNCATEGORIZED_FOLDER_ID}/releases/${id}`
      : `/users/${encodeURIComponent(session.username)}/wants/${id}`;
  const url = DISCOGS_BASE + path;

  const authHeader = signedRequestHeader({
    method,
    url,
    consumerKey,
    consumerSecret,
    token: session.token,
    tokenSecret: session.tokenSecret,
  });

  try {
    const upstream = await fetch(url, {
      method,
      headers: { Authorization: authHeader, "User-Agent": USER_AGENT },
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message =
        upstream.status === 401
          ? "Discogs rejected this login — try logging out and back in."
          : upstream.status === 404
            ? "That release couldn't be found on Discogs."
            : data.message || `Discogs couldn't complete that request (${upstream.status}).`;
      return sendError(res, upstream.status, message);
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ success: true, ...data });
  } catch {
    return sendError(res, 502, "Discogs is temporarily unavailable. Please try again.");
  }
}
