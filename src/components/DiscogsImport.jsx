// src/components/DiscogsImport.jsx
// Lets a logged-in user pull their public Discogs "For Sale" inventory
// and insert it into the trade_items table, tagged to their own owner_id.

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function DiscogsImport({ user, onImported }) {
  const [discogsUsername, setDiscogsUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const handleImport = async () => {
    if (!discogsUsername.trim()) {
      setError("Enter your Discogs username first.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(
        `/api/discogs-inventory?username=${encodeURIComponent(discogsUsername.trim())}`
      );
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch Discogs inventory");
      }

      if (data.listings.length === 0) {
        setResult({ imported: 0 });
        return;
      }

      const rows = data.listings.map((listing) => ({
        owner_id: user.id,
        discogs_release_id: listing.discogs_release_id,
        title: listing.title,
        artist: listing.artist,
        condition: listing.condition,
        price: listing.price,
        thumb_url: listing.thumb_url,
        source: "discogs_inventory",
        status: "pending", // goes through moderation, same as manual/CSV adds
      }));

      // Upsert on (owner_id, discogs_release_id) to avoid duplicate imports
      // if you re-run the import later. Add a matching unique constraint in Postgres:
      //   alter table trade_items
      //     add constraint trade_items_owner_release_unique
      //     unique (owner_id, discogs_release_id);
      const { data: inserted, error: insertError } = await supabase
        .from("trade_items")
        .upsert(rows, { onConflict: "owner_id,discogs_release_id" })
        .select();

      if (insertError) throw insertError;

      setResult({ imported: inserted.length });
      if (onImported) onImported(inserted);
    } catch (err) {
      setError(err.message || "Import failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="discogs-import-card">
      <h3>Import from Discogs</h3>
      <p>Pull your current "For Sale" listings into your trade list.</p>

      <input
        type="text"
        placeholder="Your Discogs username"
        value={discogsUsername}
        onChange={(e) => setDiscogsUsername(e.target.value)}
        disabled={loading}
      />

      <button onClick={handleImport} disabled={loading}>
        {loading ? "Importing..." : "Import inventory"}
      </button>

      {error && <p className="import-error">{error}</p>}
      {result && (
        <p className="import-success">
          Imported {result.imported} item{result.imported === 1 ? "" : "s"}.
          {result.imported > 0 && " Pending review before they go public."}
        </p>
      )}
    </div>
  );
}
