import type { LoadingManager, SkinnedMesh, AnimationClip } from "three";

/**
 * Minimal typings for the vendored r171 loader — only the surface the avatar
 * uses. The upstream file is plain JS with no bundled declarations.
 */
export declare class MMDLoader {
  constructor(manager?: LoadingManager);
  load(
    url: string,
    onLoad: (mesh: SkinnedMesh) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void;
  loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<SkinnedMesh>;
  loadAnimation(
    url: string | string[],
    object: SkinnedMesh,
    onLoad: (clip: AnimationClip) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void;
  setResourcePath(path: string): this;
}
