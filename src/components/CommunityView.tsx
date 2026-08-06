import { useEffect, useMemo, useState } from "react";
import {
  communityAvailable,
  communityImport,
  communityLike,
  communityList,
  communityReport,
  fetchTemplate,
  type CommunityItem,
  type CommunityKind,
  type CommunitySort,
  type TemplateSubtype,
} from "../lib/community";
import { toast } from "../lib/toast";
import { promptDialog } from "../lib/dialog";
import { CommunityAdmin } from "./CommunityAdmin";
import { TemplatePublish } from "./TemplatePublish";
import { EmptyState } from "./EmptyState";
import { IconHeart, IconDownload, IconSearch, IconGrid } from "./icons";

const KINDS: { id: CommunityKind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "skill", label: "Skills" },
  { id: "agent", label: "Agents" },
  { id: "workflow", label: "Workflows" },
  { id: "schedule", label: "Schedules" },
  { id: "template", label: "Templates" },
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
  template: "Template",
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
  const [moderating, setModerating] = useState(false);
  const [subFilter, setSubFilter] = useState<TemplateSubtype | "all">("all");
  const [showPublish, setShowPublish] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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
  }, [available, kind, sort, q, tag, refreshKey]);

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

  // UI templates aren't imported into the app — they're copied or exported as a
  // .tsx for the user's own project. Fetching the code counts as a download.
  const useUiTemplate = async (item: CommunityItem, action: "copy" | "export") => {
    setBusy(item.id);
    try {
      const t = await fetchTemplate(item);
      if (t.subtype !== "ui") throw new Error("Not a UI template.");
      setItems((list) => list.map((i) => (i.id === item.id ? { ...i, downloads: i.downloads + 1 } : i)));
      if (action === "copy") {
        await navigator.clipboard.writeText(t.code);
        toast.success("Code copied to clipboard.");
      } else {
        const slug =
          item.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "") || "component";
        const blob = new Blob([t.code], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${slug}.tsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${slug}.tsx`);
      }
    } catch (e) {
      toast.error(`Couldn't use that template: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  // Templates carry a subtype; the sub-filter narrows to setup vs ui client-side.
  const shown =
    kind === "template" && subFilter !== "all" ? items.filter((i) => i.subtype === subFilter) : items;

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

  if (moderating) return <CommunityAdmin onClose={() => setModerating(false)} />;

  return (
    <main className="settings-main">
      <div className="settings-header">
        <h1>Community library</h1>
        <span className="hint grow">
          Skills, agents, workflows, schedules and templates shared by others — free to import.
        </span>
        {kind === "template" && (
          <button className="btn small" onClick={() => setShowPublish(true)}>
            Publish template
          </button>
        )}
        <button className="link-btn" title="Moderate published items (admin)" onClick={() => setModerating(true)}>
          Moderate
        </button>
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

      {kind === "template" && (
        <div className="seg" style={{ margin: "0 0 8px" }}>
          {(["all", "setup", "ui"] as const).map((s) => (
            <button
              key={s}
              className={`seg-btn ${subFilter === s ? "active" : ""}`}
              onClick={() => setSubFilter(s)}
            >
              {s === "all" ? "All" : s === "setup" ? "Setup" : "UI"}
            </button>
          ))}
        </div>
      )}

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
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<IconGrid size={22} />}
          title="Nothing here yet"
          hint={
            q || tag
              ? "No matches — try a broader search."
              : kind === "template"
                ? "No templates yet — hit “Publish template” to add the first."
                : "Be the first to publish — open Skills, Agents, Workflows or Schedules and hit Publish."
          }
        />
      ) : (
        <div className="card-grid">
          {shown.map((item) => (
            <div key={item.id} className="cloud-card">
              <div className="cloud-card-head">
                <span className="cloud-logo">{item.name.slice(0, 1).toUpperCase()}</span>
                <div className="grow">
                  <div className="cloud-name">{item.name}</div>
                  <div className="cloud-by">
                    by {item.author} · {relTime(item.createdAt)}
                  </div>
                </div>
                <span className="tool-tag">
                  {item.type === "template"
                    ? item.subtype === "ui"
                      ? "UI template"
                      : "Setup template"
                    : KIND_LABEL[item.type]}
                </span>
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
                {item.type === "template" && item.subtype === "ui" ? (
                  <>
                    <button
                      className="btn small"
                      disabled={busy === item.id}
                      onClick={() => void useUiTemplate(item, "copy")}
                    >
                      Copy code
                    </button>
                    <button
                      className="btn primary small"
                      disabled={busy === item.id}
                      onClick={() => void useUiTemplate(item, "export")}
                    >
                      Export
                    </button>
                  </>
                ) : (
                  <button className="btn primary small" disabled={busy === item.id} onClick={() => void importItem(item)}>
                    {busy === item.id
                      ? item.type === "template"
                        ? "Using…"
                        : "Importing…"
                      : item.type === "template"
                        ? "Use"
                        : "Import"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {showPublish && (
        <TemplatePublish onClose={() => setShowPublish(false)} onPublished={() => setRefreshKey((k) => k + 1)} />
      )}
    </main>
  );
}
