import { DESKTOP_URL, DESKTOP_ONLY } from "../lib/web";
import { IconBox } from "./icons";

/**
 * "This needs the desktop app" advert. Shown in the web build wherever a feature
 * can't work in a browser, so the user has a clear next step instead of a dead
 * end. Pass a known feature key for a consistent reason, or a custom `reason`.
 */
export function GetDesktopApp({
  feature,
  reason,
  compact,
}: {
  feature?: keyof typeof DESKTOP_ONLY;
  reason?: string;
  compact?: boolean;
}) {
  const text = reason ?? (feature ? DESKTOP_ONLY[feature] : "This feature needs the HarnessStation desktop app.");
  return (
    <div className={`desktop-cta ${compact ? "compact" : ""}`}>
      <span className="desktop-cta-icon">
        <IconBox size={compact ? 18 : 22} />
      </span>
      <div className="desktop-cta-body">
        <b>Get the desktop app</b>
        <p>{text}</p>
      </div>
      <a className="btn primary" href={DESKTOP_URL} target="_blank" rel="noreferrer">
        Download
      </a>
    </div>
  );
}
