import { useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../lib/store";
import { useModal } from "../lib/useModal";
import { CLOUD_PROVIDERS } from "../lib/catalog";
import { IconBolt, IconBox, IconCloud, IconWrench, LogoMark } from "./icons";

const SEEN_KEY = "hs-onboarded";

export function hasOnboarded(): boolean {
  return localStorage.getItem(SEEN_KEY) === "1";
}

export function Onboarding({ onClose }: { onClose: () => void }) {
  const { setView } = useStore();
  const [dismissing, setDismissing] = useState(false);

  const finish = () => {
    localStorage.setItem(SEEN_KEY, "1");
    setDismissing(true);
    onClose();
  };

  const panelRef = useModal(!dismissing, finish);

  const go = (view: "discover" | "settings", opts?: { tab?: "cloud" | "local" }) => {
    if (opts?.tab) sessionStorage.setItem("hs-discover-tab", opts.tab);
    setView(view);
    finish();
  };

  if (dismissing) return null;

  const codingIds = ["zai", "minimax", "moonshot"] as const;
  const codingCount = CLOUD_PROVIDERS.filter((p) => (codingIds as readonly string[]).includes(p.id)).length;
  const codingTag = codingCount > 0 ? `${codingCount} plans` : "Flat-rate";

  return createPortal(
    <div className="modal-backdrop" onClick={finish}>
      <div
        className="onboard"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to HarnessStation"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="onboard-head">
          <LogoMark size={34} />
          <div>
            <h2>Run any model as an agent</h2>
            <p className="hint">Local, free-cloud, or a flat-rate coding plan — with tools, files, and knowledge, in one app. Pick how you want to start; every option below works today.</p>
          </div>
        </div>

        <div className="onboard-grid">
          <button className="onboard-card" onClick={() => go("discover", { tab: "local" })}>
            <span className="onboard-ic"><IconBox size={22} /></span>
            <b>Run a model locally</b>
            <span className="hint">Free & private. Download a small model and run it on your own hardware — no account, no key.</span>
            <span className="onboard-tag ok">Free</span>
          </button>

          <button className="onboard-card" onClick={() => go("discover", { tab: "cloud" })}>
            <span className="onboard-ic"><IconBolt size={22} /></span>
            <b>Use a free cloud model</b>
            <span className="hint">Groq, Gemini, Cerebras and more have real free tiers. Sign up, paste a key, start chatting.</span>
            <span className="onboard-tag ok">Free tier</span>
          </button>

          <button className="onboard-card" onClick={() => go("discover", { tab: "cloud" })}>
            <span className="onboard-ic"><IconCloud size={22} /></span>
            <b>Flat-rate coding plan</b>
            <span className="hint">z.ai, MiniMax and Kimi offer strong models on a fixed monthly plan — use them all day.</span>
            <span className="onboard-tag">{codingTag}</span>
          </button>

          <button className="onboard-card" onClick={() => go("settings")}>
            <span className="onboard-ic"><IconWrench size={22} /></span>
            <b>Bring your own API key</b>
            <span className="hint">Already have OpenAI, Anthropic, or another key? Add it in Settings and go.</span>
            <span className="onboard-tag">Any provider</span>
          </button>
        </div>

        <div className="onboard-foot">
          <button className="link-btn" onClick={finish}>Skip — I'll explore on my own</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
