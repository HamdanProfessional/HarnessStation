import { useEffect, useState } from "react";
import { communityAdminAct, communityAdminList, type AdminItem } from "../lib/community";
import { confirmDialog } from "../lib/dialog";
import { toast } from "../lib/toast";
import { EmptyState } from "./EmptyState";
import { IconGrid } from "./icons";

const TOKEN_KEY = "hs-lib-admin";

/**
 * Community moderation. Review reported items and hide / restore / remove them
 * with the admin bearer token (from the gateway's LIBRARY_ADMIN_TOKEN). The token
 * is kept in this browser's local storage — it's the moderator's credential.
 */
export function CommunityAdmin({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [entry, setEntry] = useState("");
  const [items, setItems] = useState<AdminItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async (tok: string) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await communityAdminList(tok);
      setItems(rows);
      localStorage.setItem(TOKEN_KEY, tok);
      setToken(tok);
    } catch (e) {
      setError((e as Error).message.includes("forbidden") ? "That token was rejected." : (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) void load(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (item: AdminItem, action: "hide" | "restore" | "remove") => {
    if (action === "remove" && !(await confirmDialog(`Permanently remove “${item.name}”?`, { danger: true }))) return;
    setBusy(item.id);
    try {
      await communityAdminAct(token, item.id, action);
      await load(token);
      toast.success(`${action === "remove" ? "Removed" : action === "restore" ? "Restored" : "Hidden"}: ${item.name}`);
    } catch (e) {
      toast.error(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const signOut = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setItems([]);
  };

  return (
    <main className="settings-main">
      <div className="settings-header">
        <h1>Moderation</h1>
        <div className="grow" />
        {token && (
          <button className="btn" onClick={() => void load(token)}>
            Refresh
          </button>
        )}
        <button className="btn" onClick={onClose}>
          ← Back to library
        </button>
      </div>

      {!token ? (
        <div className="provider-card" style={{ maxWidth: 520 }}>
          <p className="hint" style={{ marginTop: 0 }}>
            Enter the community <b>admin token</b> (the gateway's{" "}
            <code>LIBRARY_ADMIN_TOKEN</code>) to review and moderate published items. It's stored in
            this browser only.
          </p>
          <div className="provider-row">
            <input
              className="grow"
              type="password"
              value={entry}
              placeholder="Admin token"
              onChange={(e) => setEntry(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && entry.trim() && void load(entry.trim())}
            />
            <button className="btn primary" disabled={!entry.trim()} onClick={() => void load(entry.trim())}>
              Unlock
            </button>
          </div>
          {error && <p className="field-error">{error}</p>}
        </div>
      ) : (
        <>
          <div className="provider-row" style={{ marginBottom: 12 }}>
            <span className="hint grow">
              {items.length} item{items.length === 1 ? "" : "s"} ·{" "}
              {items.filter((i) => i.reportCount > 0).length} reported ·{" "}
              {items.filter((i) => i.hidden).length} hidden
            </span>
            <button className="link-btn" onClick={signOut}>
              Forget token
            </button>
          </div>
          {error && <div className="error-banner">{error}</div>}
          {loading ? (
            <p className="hint">Loading…</p>
          ) : items.length === 0 ? (
            <EmptyState icon={<IconGrid size={22} />} title="Nothing published yet" hint="When people publish items, they'll appear here." />
          ) : (
            items.map((item) => (
              <div key={item.id} className={`provider-card ${item.hidden ? "muted-card" : ""}`}>
                <div className="provider-row">
                  <div className="grow">
                    <b>{item.name}</b> <span className="tool-tag">{item.type}</span>{" "}
                    {item.hidden && <span className="pill warn">Hidden</span>}
                    {item.reportCount > 0 && <span className="pill warn">{item.reportCount} report{item.reportCount === 1 ? "" : "s"}</span>}
                    <div className="hint">
                      by {item.author} · {item.downloads} downloads · {item.likes} likes
                    </div>
                  </div>
                  {item.hidden ? (
                    <button className="btn small" disabled={busy === item.id} onClick={() => void act(item, "restore")}>
                      Restore
                    </button>
                  ) : (
                    <button className="btn small" disabled={busy === item.id} onClick={() => void act(item, "hide")}>
                      Hide
                    </button>
                  )}
                  <button className="btn small danger" disabled={busy === item.id} onClick={() => void act(item, "remove")}>
                    Remove
                  </button>
                </div>
                {item.reasons.length > 0 && (
                  <div className="hint" style={{ marginTop: 4 }}>
                    Reports: {item.reasons.slice(0, 8).map((r) => `“${r}”`).join(", ")}
                  </div>
                )}
              </div>
            ))
          )}
        </>
      )}
    </main>
  );
}
