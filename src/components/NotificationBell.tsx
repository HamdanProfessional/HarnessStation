import { useState } from "react";
import { useToast } from "../lib/toast";
import { IconBell } from "./icons";

function ago(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 60000);
  if (d < 1) return "now";
  if (d < 60) return `${d}m`;
  if (d < 1440) return `${Math.floor(d / 60)}h`;
  return `${Math.floor(d / 1440)}d`;
}

export function NotificationBell() {
  const { history, unread, clearUnread, clearHistory } = useToast();
  const [open, setOpen] = useState(false);

  return (
    <div className="bell-wrap">
      <button
        className="icon-btn bell-btn"
        title="Notifications"
        onClick={() => {
          setOpen((o) => !o);
          clearUnread();
        }}
      >
        <IconBell size={16} />
        {unread > 0 && <span className="bell-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <>
          <div className="menu-overlay" onClick={() => setOpen(false)} />
          <div className="bell-panel">
            <div className="bell-head">
              <span>Notifications</span>
              {history.length > 0 && (
                <button className="link-btn" onClick={clearHistory}>
                  Clear
                </button>
              )}
            </div>
            {history.length === 0 && <div className="hint" style={{ padding: 12 }}>No notifications yet.</div>}
            {history.map((h) => (
              <div key={h.id} className={`bell-item bell-${h.kind}`}>
                <span className="bell-item-msg">{h.message}</span>
                <span className="bell-item-time">{ago(h.at)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
