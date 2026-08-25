import { useEffect, useRef, useState } from "react";
import { Spinner } from "./Loading";
import { createMotionDriver } from "../lib/avatarMotion";
import { currentSpeechLevel } from "../lib/tts";
import { pointerPosition } from "../lib/pointerTrack";
import type { VoiceState } from "../lib/voice";

/**
 * VRM avatar for the talking head.
 *
 * VRM is the open VTuber model standard, so any .vrm from VRoid Hub (or made in
 * VRoid Studio) works — male, female, whatever you like. Everything here is
 * driven by data the voice session already produces:
 *
 *   mouth      mic level while listening, a synthetic jaw while speaking
 *   expression the session state (idle / listening / thinking / speaking)
 *   blink      an eased curve on a randomised timer
 *   posture    slow breathing + a little head sway, so it never looks frozen
 *
 * three.js and @pixiv/three-vrm are heavy, so this whole module is lazy-loaded —
 * nothing here is in the initial bundle.
 */

interface Props {
  /** Bytes of the .vrm file. */
  data: Uint8Array;
  state: VoiceState;
  /** Mic level, 0..1-ish, as reported by the voice session. */
  level: number;
  onError?: (message: string) => void;
}

export function VrmAvatar({ data, state, level, onError }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  // Live values the animation loop reads without re-running the effect.
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

    void (async () => {
      try {
        const THREE = await import("three");
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
        const { VRMLoaderPlugin, VRMUtils } = await import("@pixiv/three-vrm");

        if (disposed) return;

        const width = mount.clientWidth || 320;
        const height = mount.clientHeight || 420;

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height);
        renderer.setClearAlpha(0);
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(28, width / height, 0.1, 20);

        // Soft three-point-ish lighting: VRM toon materials look flat under one lamp.
        scene.add(new THREE.AmbientLight(0xffffff, 1.6));
        const key = new THREE.DirectionalLight(0xffffff, 1.5);
        key.position.set(1, 1.6, 2.2);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x99bbff, 0.7);
        rim.position.set(-1.5, 1.2, -1.5);
        scene.add(rim);

        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));

        const blob = new Blob([data as BlobPart], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        let gltf;
        try {
          gltf = await loader.loadAsync(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        if (disposed) return;

        const vrm = gltf.userData.vrm;
        if (!vrm) throw new Error("that file doesn't contain a VRM model");

        // VRM 0.x models face away from the camera; 1.0 already faces forward.
        VRMUtils.rotateVRM0(vrm);
        // Fewer skeletons and morph targets to update per frame. (The older
        // removeUnnecessaryJoints is deprecated in three-vrm v3.)
        VRMUtils.combineSkeletons(gltf.scene);
        VRMUtils.combineMorphs(vrm);
        vrm.scene.traverse((o: { frustumCulled?: boolean }) => (o.frustumCulled = false));
        scene.add(vrm.scene);

        // Frame the head and shoulders on the model's own proportions rather than
        // assuming a height — VRM models vary a lot.
        const head = vrm.humanoid?.getNormalizedBoneNode("head");
        const headY = head ? head.getWorldPosition(new THREE.Vector3()).y : 1.4;
        camera.position.set(0, headY - 0.03, 1.05);
        camera.lookAt(0, headY - 0.05, 0);

        const spine = vrm.humanoid?.getNormalizedBoneNode("spine");
        const em = vrm.expressionManager;

        // Only drive expressions the model actually ships with.
        const has = (name: string) => !!em?.getExpression?.(name);
        const setExp = (name: string, v: number) => {
          if (has(name)) em?.setValue(name, v);
        };

        setLoading(false);

        const clock = new THREE.Clock();
        const driver = createMotionDriver();

        const tick = () => {
          raf = requestAnimationFrame(tick);
          const dt = Math.min(clock.getDelta(), 0.1);
          const st = stateRef.current;
          // Real lip-sync when the playing voice can be measured; pointer
          // tracking so the character watches where you work.
          const f = driver.update(dt, st, levelRef.current, {
            speechLevel: currentSpeechLevel(),
            pointer: pointerPosition(),
          });

          setExp("aa", f.mouth);
          setExp("ih", f.mouth * 0.25);
          setExp("blink", f.blink);
          setExp("happy", f.happy);
          setExp("relaxed", st === "idle" ? 0.25 : 0);

          if (head) {
            head.rotation.x = f.headX;
            head.rotation.y = f.headY;
            head.rotation.z = f.headZ;
          }
          if (spine) {
            spine.rotation.x = f.breath;
            spine.position.y = f.breath * 0.35;
          }

          vrm.update(dt);
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
          VRMUtils.deepDispose(vrm.scene);
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
    };
    // Reloading on every state/level change would rebuild the scene each frame;
    // the loop reads those through refs instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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
