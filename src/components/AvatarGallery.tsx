import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchGallery,
  installAvatar,
  needsAttribution,
  type GalleryAvatar,
  type GalleryProject,
} from "../lib/avatarGallery";
import { onDownloadProgress } from "../lib/local";
import { useModal } from "../lib/useModal";
import { toast } from "../lib/toast";

/**
 * Browser for Open Source Avatars — a free CC0/CC-BY registry of VRM models.
 * Picking one downloads it into ~/.harnessx/avatars, exactly where an uploaded
 * .vrm lands, so both routes end up in the same picker.
 */
export function AvatarGallery({
  onClose,
  onInstalled,
}: {
  onClose: () => void;
  onInstalled: (file: string) => void;
}) {
  const panelRef = useModal(true, onClose);
  const [avatars, setAvatars] = useState<GalleryAvatar[]>([]);
  const [projects, setProjects] = useState<GalleryProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [pct, setPct] = useState(0);

  const load = (force = false) => {
    setLoading(true);
    setError(null);
    fetchGallery(force)
      .then((g) => {
        setAvatars(g.avatars);
        setProjects(g.projects);
      })
      .catch((e) => setError((e as Error).message || String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // The Rust downloader streams progress events; show them on the busy card.
  useEffect(() => {
    let un: (() => void) | undefined;
    void onDownloadProgress((p) => {
      if (!p.id.startsWith("avatar-")) return;
      setPct(p.total ? Math.round((p.received / p.total) * 100) : 0);
    }).then((f) => (un = f));
    return () => un?.();
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return avatars
      .filter((a) => !project || a.projectId === project)
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
      .slice(0, 300);
  }, [avatars, project, query]);

  const install = async (a: GalleryAvatar) => {
    setBusy(a.id);
    setPct(0);
    try {
      const file = await installAvatar(a);
      onInstalled(file);
      toast.success(`Added ${a.name}`);
      onClose();
    } catch (e) {
      toast.error(`Download failed: ${(e as Error).message || String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal avatar-gallery"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Free VRM avatars"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>
          Free avatars{" "}
          <a href="https://www.opensourceavatars.com/en" target="_blank" rel="noreferrer">
            Open Source Avatars
          </a>
        </h3>
        <p className="hint">
          Community VRM models, free to use. Most are CC0 (public domain); CC-BY ones ask you to
          credit the creator. Downloads go to your avatars folder.
        </p>

        <div className="provider-row">
          <input
            className="grow"
            placeholder="Search avatars…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search avatars"
          />
          <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Collection">
            <option value="">All collections</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.license})
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => load(true)} disabled={loading}>
            Refresh
          </button>
        </div>

        {loading && <p className="hint">Loading the catalogue…</p>}
        {error && (
          <div className="error-banner" role="alert">
            <span>Couldn't reach the avatar registry: {error}</span>
          </div>
        )}
        {!loading && !error && !shown.length && <p className="hint">Nothing matches that search.</p>}

        <div className="avatar-grid">
          {shown.map((a) => (
            <div key={a.id} className="avatar-card">
              {a.thumbnailUrl ? (
                <img src={a.thumbnailUrl} alt="" loading="lazy" className="avatar-thumb" />
              ) : (
                <div className="avatar-thumb avatar-thumb-empty">VRM</div>
              )}
              <div className="avatar-card-name" title={a.name}>
                {a.name}
              </div>
              <div className="avatar-card-meta">
                <span className={needsAttribution(a.license) ? "lic lic-by" : "lic"}>{a.license}</span>
              </div>
              <button
                className="btn small primary"
                disabled={!!busy}
                onClick={() => void install(a)}
              >
                {busy === a.id ? `${pct || 0}%` : "Use this"}
              </button>
            </div>
          ))}
        </div>

        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
