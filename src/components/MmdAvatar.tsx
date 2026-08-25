import { useEffect, useRef, useState } from "react";
import { Spinner } from "./Loading";
import { createMotionDriver, MMD_MORPHS } from "../lib/avatarMotion";
import { currentSpeechLevel } from "../lib/tts";
import { pointerPosition } from "../lib/pointerTrack";
import type { VoiceState } from "../lib/voice";

/**
 * MikuMikuDance avatar (.pmx / .pmd).
 *
 * Unlike a VRM, an MMD model is a folder: the .pmx references its textures by
 * relative path. There's no file server in front of the data folder, so the whole
 * folder is read into memory and a LoadingManager URL modifier maps each texture
 * request onto a blob URL. That keeps everything inside the webview and avoids
 * widening the app's filesystem exposure just to draw a character.
 *
 * Physics (ammo.js) and VMD motion are deliberately not wired up — the avatar
 * drives morph targets directly, exactly as the VRM one does, so hair and skirts
 * stay static. See src/vendor/mmd/README.md.
 */

interface Props {
  /** Every file in the model's folder, keyed by path relative to it. */
  bundle: Map<string, Uint8Array>;
  /** Path of the .pmx/.pmd within the bundle. */
  modelPath: string;
  state: VoiceState;
  level: number;
  onError?: (message: string) => void;
}

/** Normalise a texture reference so lookups survive Windows paths and case. */
function keyOf(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

export function MmdAvatar({ bundle, modelPath, state, level, onError }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  const stateRef = useRef(state);
  const levelRef = useRef(level);
  stateRef.current = state;
  levelRef.current = level;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let raf = 0;
    let cleanup: (() => void) | null = null;
    const urls: string[] = [];

    void (async () => {
      try {
        const THREE = await import("three");
        const { MMDLoader } = await import("../vendor/mmd/MMDLoader.js");
        if (disposed) return;

        // Blob URL per file, indexed by full relative path and by bare file name.
        // Models reference textures inconsistently ("tex/face.png", ".\\face.png",
        // "face.png"), so both lookups are needed in practice.
        const byPath = new Map<string, string>();
        for (const [rel, bytes] of bundle) {
          const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
          urls.push(url);
          byPath.set(keyOf(rel), url);
          const base = keyOf(rel.split("/").pop() ?? rel);
          if (!byPath.has(base)) byPath.set(base, url);
        }

        const modelUrl = byPath.get(keyOf(modelPath));
        if (!modelUrl) throw new Error(`couldn't find ${modelPath} in the model folder`);

        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url) => {
          if (url.startsWith("blob:") || url.startsWith("data:")) return url;
          // The loader resolves textures against the .pmx's blob URL, which yields
          // nonsense; recover the original reference from the tail of the request.
          const decoded = decodeURIComponent(url);
          const cleaned = keyOf(decoded.split("?")[0]);
          const hit =
            byPath.get(cleaned) ??
            byPath.get(keyOf(cleaned.split("/").pop() ?? "")) ??
            // Fall back to the longest suffix that matches a known path.
            [...byPath.entries()].find(([k]) => cleaned.endsWith(k))?.[1];
          return hit ?? url;
        });

        const width = mount.clientWidth || 320;
        const height = mount.clientHeight || 420;

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height);
        renderer.setClearAlpha(0);
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(28, width / height, 0.1, 2000);
        scene.add(new THREE.AmbientLight(0xffffff, 1.5));
        const key = new THREE.DirectionalLight(0xffffff, 1.4);
        key.position.set(1, 1.6, 2.2);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x99bbff, 0.6);
        rim.position.set(-1.5, 1.2, -1.5);
        scene.add(rim);

        const loader = new MMDLoader(manager);
        const mesh = await new Promise<import("three").SkinnedMesh>((resolve, reject) =>
          loader.load(modelUrl, resolve, undefined, reject),
        );
        if (disposed) return;
        scene.add(mesh);

        // MMD units are ~1/8 the scale of VRM and the model faces +Z already.
        // Frame the head from the actual bounding box rather than guessing.
        const box = new THREE.Box3().setFromObject(mesh);
        const top = box.max.y;
        const headY = top * 0.94;
        camera.position.set(0, headY, top * 0.62);
        camera.lookAt(0, headY - top * 0.03, 0);

        // Resolve each morph once — name lookups per frame would be wasteful.
        const dict = (mesh.morphTargetDictionary ?? {}) as Record<string, number>;
        const pick = (names: readonly string[]) => {
          for (const n of names) if (n in dict) return dict[n];
          return -1;
        };
        const idx = {
          mouth: pick(MMD_MORPHS.mouth),
          blink: pick(MMD_MORPHS.blink),
          happy: pick(MMD_MORPHS.happy),
        };
        const setMorph = (i: number, v: number) => {
          if (i >= 0 && mesh.morphTargetInfluences) mesh.morphTargetInfluences[i] = v;
        };

        const bones = mesh.skeleton?.bones ?? [];
        const head =
          bones.find((b) => b.name === "頭") ?? bones.find((b) => /head/i.test(b.name)) ?? null;
        const headRest = head ? head.rotation.clone() : null;

        setLoading(false);

        const driver = createMotionDriver();
        const clock = new THREE.Clock();

        const tick = () => {
          raf = requestAnimationFrame(tick);
          const f = driver.update(Math.min(clock.getDelta(), 0.1), stateRef.current, levelRef.current, {
            speechLevel: currentSpeechLevel(),
            pointer: pointerPosition(),
          });

          setMorph(idx.mouth, f.mouth);
          setMorph(idx.blink, f.blink);
          setMorph(idx.happy, f.happy);

          if (head && headRest) {
            head.rotation.set(headRest.x + f.headX, headRest.y + f.headY, headRest.z + f.headZ);
          }
          renderer.render(scene, camera);
        };
        tick();

        const onResize = () => {
          const w = mount.clientWidth || width;
          const h = mount.clientHeight || height;
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        window.addEventListener("resize", onResize);

        cleanup = () => {
          window.removeEventListener("resize", onResize);
          cancelAnimationFrame(raf);
          scene.remove(mesh);
          mesh.geometry.dispose();
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            m.dispose();
          }
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch (e) {
        if (disposed) return;
        setLoading(false);
        onError?.((e as Error).message || String(e));
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanup?.();
      for (const u of urls) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, modelPath]);

  return (
    <div className="vrm-stage" ref={mountRef}>
      {loading && (
        <div className="vrm-loading">
          <Spinner /> Loading avatar…
        </div>
      )}
    </div>
  );
}
