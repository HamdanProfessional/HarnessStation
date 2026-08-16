import { useCallback, useEffect, useState } from "react";
import { Markdown } from "./Markdown";
import { EmptyState } from "./EmptyState";
import { Spinner } from "./Loading";
import { IconFolder } from "./icons";
import { confirmDialog, promptDialog } from "../lib/dialog";
import { toast } from "../lib/toast";
import {
  fsList,
  fsRead,
  fsWrite,
  fsMkdir,
  fsRemove,
  joinPath,
  looksTextual,
  langFor,
  type FsEntry,
} from "../lib/files";

/**
 * A file browser for the workspace — on the web build this is the tree the v86
 * Linux VM mounts at /mnt, so it's how you actually see the VM's files and their
 * content. On desktop it browses the app's working directory. Left pane lists a
 * directory; clicking a file opens it in the viewer on the right.
 */

const MAX_PREVIEW = 500_000; // don't try to render a huge file into the DOM

export function FilesView() {
  const [cwd, setCwd] = useState(""); // path relative to the workspace root
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [openFile, setOpenFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileErr, setFileErr] = useState<string | null>(null);

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    setErr(null);
    try {
      const rows = await fsList(path || ".");
      // directories first, then alphabetical
      rows.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      setEntries(rows);
    } catch (e) {
      setErr((e as Error).message || String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDir(cwd);
  }, [cwd, loadDir]);

  const openDir = (name: string) => {
    setOpenFile(null);
    setCwd(cwd ? joinPath(cwd, name) : name);
  };

  const goUp = () => {
    setOpenFile(null);
    setCwd(cwd.split("/").slice(0, -1).join("/"));
  };

  const openText = async (name: string) => {
    const path = cwd ? joinPath(cwd, name) : name;
    setOpenFile(path);
    setContent("");
    setFileErr(null);
    if (!looksTextual(name)) {
      setFileErr("Binary or unsupported file — preview not available. Use Download.");
      return;
    }
    setFileLoading(true);
    try {
      const text = await fsRead(path);
      if (text.length > MAX_PREVIEW) {
        setContent(text.slice(0, MAX_PREVIEW));
        setFileErr(`Showing the first ${MAX_PREVIEW.toLocaleString()} of ${text.length.toLocaleString()} characters.`);
      } else {
        setContent(text);
      }
    } catch (e) {
      setFileErr((e as Error).message || String(e));
    } finally {
      setFileLoading(false);
    }
  };

  const download = async (name: string) => {
    const path = cwd ? joinPath(cwd, name) : name;
    try {
      const text = await fsRead(path);
      const blob = new Blob([text], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(`Download failed: ${(e as Error).message || String(e)}`);
    }
  };

  const removeEntry = async (e: FsEntry) => {
    const path = cwd ? joinPath(cwd, e.name) : e.name;
    const ok = await confirmDialog(`Delete ${e.dir ? "folder" : "file"} "${e.name}"?`, {
      danger: true,
      message: e.dir ? "Everything inside it is removed too." : undefined,
    });
    if (!ok) return;
    try {
      await fsRemove(path);
      if (openFile === path) setOpenFile(null);
      toast.success(`Deleted ${e.name}`);
      void loadDir(cwd);
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message || String(err)}`);
    }
  };

  const newFolder = async () => {
    const name = await promptDialog("New folder", { placeholder: "name" });
    if (!name?.trim()) return;
    try {
      await fsMkdir(cwd ? joinPath(cwd, name.trim()) : name.trim());
      void loadDir(cwd);
    } catch (e) {
      toast.error(`Could not create folder: ${(e as Error).message || String(e)}`);
    }
  };

  const newFile = async () => {
    const name = await promptDialog("New file", { placeholder: "e.g. notes.txt" });
    if (!name?.trim()) return;
    try {
      await fsWrite(cwd ? joinPath(cwd, name.trim()) : name.trim(), "");
      void loadDir(cwd);
    } catch (e) {
      toast.error(`Could not create file: ${(e as Error).message || String(e)}`);
    }
  };

  const crumbs = cwd ? cwd.split("/") : [];

  return (
    <main className="files-view">
      <div className="settings-header">
        <h1>Files</h1>
        <div className="files-actions">
          <button className="btn small" onClick={() => void loadDir(cwd)}>Refresh</button>
          <button className="btn small" onClick={() => void newFolder()}>+ Folder</button>
          <button className="btn small" onClick={() => void newFile()}>+ File</button>
        </div>
      </div>

      <p className="hint files-hint">
        The shared workspace — on the web build this is the same tree the Linux VM sees at{" "}
        <code>/mnt</code>. Files created by the model, the terminal, and Linux all appear here.
      </p>

      <div className="files-crumbs">
        <button className="crumb" onClick={() => setCwd("")} disabled={!cwd}>
          workspace
        </button>
        {crumbs.map((c, i) => (
          <span key={i}>
            <span className="crumb-sep">/</span>
            <button className="crumb" onClick={() => setCwd(crumbs.slice(0, i + 1).join("/"))}>
              {c}
            </button>
          </span>
        ))}
      </div>

      <div className="files-body">
        <div className="files-list">
          {loading ? (
            <div className="files-center"><Spinner /></div>
          ) : err ? (
            <div className="files-center files-err">{err}</div>
          ) : entries.length === 0 && !cwd ? (
            <EmptyState
              icon={<IconFolder size={26} />}
              title="Workspace is empty"
              hint="Files the model or the VM creates will show up here."
            />
          ) : (
            <>
              {cwd && (
                <button className="file-row" onClick={goUp}>
                  <span className="file-ic">↑</span> ..
                </button>
              )}
              {entries.map((e) => (
                <div key={e.name} className={`file-row ${openFile && !e.dir && openFile.endsWith("/" + e.name) ? "active" : ""}`}>
                  <button
                    className="file-open"
                    onClick={() => (e.dir ? openDir(e.name) : void openText(e.name))}
                  >
                    <span className="file-ic">{e.dir ? <IconFolder size={15} /> : "📄"}</span>
                    <span className="file-name">{e.name}</span>
                  </button>
                  {!e.dir && (
                    <button className="file-mini" title="Download" onClick={() => void download(e.name)}>
                      ↓
                    </button>
                  )}
                  <button className="file-mini danger" title="Delete" onClick={() => void removeEntry(e)}>
                    ×
                  </button>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="files-viewer">
          {!openFile ? (
            <div className="files-center files-placeholder">Select a file to view its contents.</div>
          ) : (
            <>
              <div className="files-viewer-head">
                <span className="files-viewer-name">{openFile}</span>
                <button
                  className="btn small"
                  onClick={() => void download(openFile.split("/").pop() ?? openFile)}
                >
                  Download
                </button>
              </div>
              {fileLoading ? (
                <div className="files-center"><Spinner /></div>
              ) : fileErr && !content ? (
                <div className="files-center files-err">{fileErr}</div>
              ) : (
                <div className="files-content">
                  {fileErr && <div className="files-note">{fileErr}</div>}
                  <Markdown>{"```" + langFor(openFile) + "\n" + content + "\n```"}</Markdown>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
