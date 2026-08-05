import { useEffect, useMemo, useState } from "react";
import {
  communityAvailable,
  communityImport,
  communityLike,
  communityList,
  communityReport,
  type CommunityItem,
  type CommunityKind,
  type CommunitySort,
} from "../lib/community";
import { toast } from "../lib/toast";
import { promptDialog } from "../lib/dialog";
import { EmptyState } from "./EmptyState";
import { IconHeart, IconDownload, IconSearch, IconGrid } from "./icons";

const KINDS: { id: CommunityKind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "skill", label: "Skills" },
  { id: "agent", label: "Agents" },
  { id: "workflow", label: "Workflows" },
  { id: "schedule", label: "Schedules" },
];

const SORTS: { id: CommunitySort; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "recommended", label: "Recommended" },
  { id: "downloaded", label: "Most downloaded" },
  { id: "newest", label: "Newest" },
];

const KIND_LABEL: Record<CommunityKind, string> = {
  skill: "Skill",
  agent: "Agent",
  workflow: "Workflow",
  schedule: "Schedule",
};

function relTime(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  if (d < 1) return "today";
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function CommunityView() {
  const [kind, setKind] = useState<CommunityKind | "all">("all");
  const [sort, setSort] = useState<CommunitySort>("trending");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [items, setItems] = useState<CommunityItem[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const available = useMemo(() => communityAvailable(), []);

  // Debounce the search box so typing doesn't hammer the gateway.
  useEffect(() => {
    const t = setTimeout(() => setQ(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!available) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    communityList({ kind, sort, q, tag: tag ?? undefined })
      .then((r) => {
        if (!live) return;
        setItems(r.items);
        setTags(r.tags);
      })
      .catch((e) => live && setError((e as Error).message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [available, kind, sort, q, tag]);

  const like = async (item: CommunityItem) => {
    // Optimistic — flip locally, reconcile with the server's count.
    setItems((list) =>
      list.map((i) => (i.id === item.id ? { ...i, liked: !i.liked, likes: i.likes + (i.liked ? -1 : 1) } : i)),
    );
    try {
      const r = await communityLike(item.id);
      setItems((list) => list.map((i) => (i.id === item.id ? { ...i, liked: r.liked, likes: r.likes } : i)));
    } catch (e) {
      toast.error(`Couldn't register that like: ${(e as Error).message}`);
    }
  };

  const report = async (item: CommunityItem) => {
    const reason = await promptDialog(`Report “${item.name}”`, {
      message: "What's wrong with it? (spam, malicious, broken, offensive…)",
      placeholder: "reason",
    });
    if (reason === null) return;
    try {
      await communityReport(item.id, reason.trim());
      toast.success("Thanks — reported for review.");
    } catch (e) {
      toast.error(`Couldn't report that: ${(e as Error).message}`);
    }
  };

  const importItem = async (item: CommunityItem) => {
    setBusy(item.id);
    try {
      const msg = await communityImport(item);
      setItems((list) => list.map((i) => (i.id === item.id ? { ...i, downloads: i.downloads + 1 } : i)));
      toast.success(msg);
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  if (!available) {
    return (
      <main className="settings-main">
        <div className="settings-header">
          <h1>Community library</h1>
        </div>
        <EmptyState
          icon={<IconGrid size={22} />}
          title="No gateway configured"
          hint="The community library is served by the HarnessStation gateway. Set a server URL in Settings › Providers, or use a build that ships one."
        />
      </main>
    );
  }

  return (
    <main className="settings-main">
      <div className="settings-header">
        <h1>Community library</h1>
        <span className="hint">Skills, agents, workflows and schedules shared by others — free to import.</span>
      </div>

      <div className="community-controls">
        <div className="seg">
          {KINDS.map((k) => (
            <button key={k.id} className={`seg-btn ${kind === k.id ? "active" : ""}`} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="seg">
          {SORTS.map((s) => (
            <button key={s.id} className={`seg-btn ${sort === s.id ? "active" : ""}`} onClick={() => setSort(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="search-wrap community-search">
          <span className="search-icon">
            <IconSearch size={14} />
          </span>
          <input
            className="search"
            placeholder="Search the library…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {tags.length > 0 && (
        <div className="tag-row">
          <button className={`tag-chip ${tag === null ? "active" : ""}`} onClick={() => setTag(null)}>
            all tags
          </button>
          {tags.map((t) => (
            <button key={t} className={`tag-chip ${tag === t ? "active" : ""}`} onClick={() => setTag(tag === t ? null : t)}>
              {t}
            </button>
          ))}
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <p className="hint">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<IconGrid size={22} />}
          title="Nothing here yet"
          hint={q || tag ? "No matches — try a broader search." : "Be the first to publish — open Skills, Agents, Workflows or Schedules and hit Publish."}
        />
      ) : (
        <div className="card-grid">
          {items.map((item) => (
            <div key={item.id} className="cloud-card">
              <div className="cloud-card-head">
                <span className="cloud-logo">{item.name.slice(0, 1).toUpperCase()}</span>
                <div className="grow">
                  <div className="cloud-name">{item.name}</div>
                  <div className="cloud-by">
                    by {item.author} · {relTime(item.createdAt)}
                  </div>
                </div>
                <span className="tool-tag">{KIND_LABEL[item.type]}</span>
              </div>
              <div className="cloud-blurb">{item.description || <span className="hint">No description.</span>}</div>
              {item.tags.length > 0 && (
                <div className="tag-row compact">
                  {item.tags.map((t) => (
                    <span key={t} className="tag-chip static">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="cloud-foot">
                <button
                  className={`like-btn ${item.liked ? "liked" : ""}`}
                  title={item.liked ? "Remove like" : "Like"}
                  onClick={() => void like(item)}
                >
                  <IconHeart size={15} filled={item.liked} />
                  {item.likes}
                </button>
                <span className="dl-count" title="Downloads">
                  <IconDownload size={14} /> {item.downloads}
                </span>
                <span className="grow" />
                <button className="link-btn report-link" title="Report this item" onClick={() => void report(item)}>
                  Report
                </button>
                <button className="btn primary small" disabled={busy === item.id} onClick={() => void importItem(item)}>
                  {busy === item.id ? "Importing…" : "Import"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
