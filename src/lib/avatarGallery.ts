import { fetch } from "@tauri-apps/plugin-http";
import { downloadFile } from "./local";

/**
 * Open Source Avatars — a free registry of VRM avatars for VTubing/VR.
 *
 * The site is a Next.js gallery, but the data behind it is a plain JSON registry
 * in a public GitHub repo, so we read that directly rather than scraping:
 *
 *   data/projects.json          collections, each with the licence
 *   data/avatars/<file>.json    the avatars in that collection
 *
 * Licence lives on the *project*, not the avatar, so it's resolved by joining on
 * project_id and shown next to every model — most are CC0, some are CC-BY, which
 * requires attribution.
 *
 * https://github.com/ToxSam/open-source-avatars
 */

const RAW = "https://raw.githubusercontent.com/ToxSam/open-source-avatars/main/data";
const CACHE_KEY = "hs-avatar-gallery-v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface GalleryProject {
  id: string;
  name: string;
  license: string;
  creator_id?: string;
  description?: string;
  avatar_data_file?: string;
}

export interface GalleryAvatar {
  id: string;
  name: string;
  projectId: string;
  /** Resolved from the avatar's project. */
  license: string;
  description: string;
  modelUrl: string;
  thumbnailUrl: string;
  format: string;
}

/** Shapes as they appear in the registry, before normalising. */
interface RawProject extends GalleryProject {
  is_public?: boolean;
}
interface RawAvatar {
  id?: string;
  name?: string;
  project_id?: string;
  description?: string;
  model_file_url?: string;
  thumbnail_url?: string;
  format?: string;
  is_public?: boolean;
  is_draft?: boolean;
}

interface Cached {
  at: number;
  projects: GalleryProject[];
  avatars: GalleryAvatar[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

function readCache(): Cached | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Cached | null;
    if (raw && Array.isArray(raw.avatars) && Date.now() - raw.at < CACHE_TTL_MS) return raw;
  } catch {
    /* absent or corrupt */
  }
  return null;
}

/** The registry file name for a collection, falling back to `<id>.json`. */
function dataFile(p: RawProject): string {
  const f = p.avatar_data_file?.trim();
  if (!f) return `${p.id}.json`;
  return f.endsWith(".json") ? f.split("/").pop()! : `${f}.json`;
}

/**
 * Every public avatar in the registry, with its licence resolved.
 * Cached for a day; a collection that fails to load is skipped rather than
 * failing the whole gallery.
 */
export async function fetchGallery(force = false): Promise<Cached> {
  if (!force) {
    const hit = readCache();
    if (hit) return hit;
  }

  const rawProjects = await getJson<RawProject[]>(`${RAW}/projects.json`);
  const projects = rawProjects
    .filter((p) => p.is_public !== false)
    .map((p) => ({
      id: p.id,
      name: p.name,
      license: p.license || "unknown",
      creator_id: p.creator_id,
      description: p.description,
      avatar_data_file: p.avatar_data_file,
    }));

  const licenseOf = new Map(projects.map((p) => [p.id, p.license]));

  const lists = await Promise.all(
    rawProjects.map(async (p) => {
      try {
        return await getJson<RawAvatar[]>(`${RAW}/avatars/${dataFile(p)}`);
      } catch {
        return [] as RawAvatar[]; // one bad collection shouldn't empty the gallery
      }
    }),
  );

  const avatars: GalleryAvatar[] = [];
  for (const list of lists) {
    for (const a of Array.isArray(list) ? list : []) {
      if (!a.model_file_url || a.is_public === false || a.is_draft) continue;
      // The registry is VRM-first but carries the odd FBX/GLB entry.
      if (a.format && !/vrm/i.test(a.format)) continue;
      avatars.push({
        id: a.id || a.model_file_url,
        name: a.name?.trim() || "Untitled",
        projectId: a.project_id ?? "",
        license: licenseOf.get(a.project_id ?? "") ?? "unknown",
        description: a.description?.trim() ?? "",
        modelUrl: a.model_file_url,
        thumbnailUrl: a.thumbnail_url ?? "",
        format: a.format ?? "VRM",
      });
    }
  }
  avatars.sort((a, b) => a.name.localeCompare(b.name));

  const out: Cached = { at: Date.now(), projects, avatars };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(out));
  } catch {
    /* over quota — the gallery just re-fetches next time */
  }
  return out;
}

/** File name to store a gallery avatar under, kept readable and path-safe. */
export function avatarFileName(a: GalleryAvatar): string {
  const stem =
    a.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "avatar";
  return `${stem}.vrm`;
}

/**
 * Download a gallery avatar into ~/.harnessx/avatars and return its file name.
 * Goes through the Rust downloader so large models stream to disk with progress
 * instead of being buffered in the webview.
 */
export async function installAvatar(a: GalleryAvatar): Promise<string> {
  const file = avatarFileName(a);
  await downloadFile(a.modelUrl, `avatars/${file}`, `avatar-${a.id}`);
  return file;
}

/** True when the licence obliges the user to credit the creator. */
export function needsAttribution(license: string): boolean {
  return /by/i.test(license) && !/cc0/i.test(license);
}
