import { useState } from "react";
import { useStore } from "../lib/store";
import { cloudAvailable, deleteAccount, login, logout, pullNow, pushNow, signup, startAutoSync } from "../lib/cloud";
import { confirmDialog } from "../lib/dialog";
import { toast } from "../lib/toast";

function rel(ms?: number): string {
  if (!ms) return "never";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ms).toLocaleString();
}

/**
 * Settings › Cloud sync. Opt-in, end-to-end encrypted backup/sync of your data
 * (chats, agents, skills, workflows, schedules, settings) — API keys stay on the
 * device. Zero-knowledge: the server only ever stores ciphertext.
 */
export function CloudSyncPanel() {
  const { settings } = useStore();
  const cloud = settings.cloud;
  // The session token lives in the keychain; the account flags in settings say
  // whether a session exists. (A pre-migration token in settings also counts —
  // cloud.ts moves it to the keychain on first use.)
  const signedIn = !!(cloud?.enabled && (cloud.token || cloud.email));

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!cloudAvailable()) {
    return (
      <>
        <h2>Cloud sync</h2>
        <p className="hint">
          Cloud sync is served by the HarnessStation gateway, which isn't configured in this build.
          Set a server URL in Settings › Providers, or use a build that ships one.
        </p>
      </>
    );
  }

  const submit = async () => {
    if (!email.trim() || password.length < 8) {
      setError("Enter an email and a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        await signup(email, password);
        await pushNow(); // seed the new account with this device's data
        startAutoSync();
        toast.success("Account created — your data is now backed up, encrypted.");
      } else {
        const { hasBlob } = await login(email, password);
        if (hasBlob) {
          const adopt = await confirmDialog("This account already has cloud data.", {
            message: "Adopt the cloud copy (merge it into this device)? Choose Cancel to upload THIS device's data instead (overwrites the cloud copy).",
          });
          if (adopt) {
            await pullNow();
            toast.success("Pulled your data from the cloud.");
          } else {
            await pushNow();
            toast.success("Uploaded this device's data to the cloud.");
          }
        } else {
          await pushNow();
          toast.success("Signed in — your data is now backed up.");
        }
        startAutoSync();
      }
      setPassword("");
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const setAutoSync = (on: boolean) =>
    void useStore.getState().saveSettings({ ...settings, cloud: { ...cloud!, autoSync: on } });

  const doPush = async () => {
    setBusy(true);
    try {
      await pushNow();
      toast.success("Synced to the cloud.");
    } catch (e) {
      toast.error(`Sync failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doPull = async () => {
    if (!(await confirmDialog("Restore from the cloud?", { message: "This merges the cloud copy into this device (items with the same id are overwritten). Your API keys are untouched." }))) return;
    setBusy(true);
    try {
      (await pullNow()) ? toast.success("Restored from the cloud.") : toast.info("Nothing stored in the cloud yet.");
    } catch (e) {
      toast.error(`Restore failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>Cloud sync</h2>
      <p className="hint">
        Optional, <b>end-to-end encrypted</b> backup of your chats, agents, skills, workflows,
        schedules and settings. The server only ever stores ciphertext — it can't read your data.
        <b> Your API keys and secrets stay on this device</b> and are never uploaded; you re-enter
        them once per machine.
      </p>

      {!signedIn ? (
        <div className="provider-card" style={{ maxWidth: 540 }}>
          <div className="seg" style={{ marginBottom: 12 }}>
            <button className={`seg-btn ${mode === "signin" ? "active" : ""}`} onClick={() => setMode("signin")}>
              Sign in
            </button>
            <button className={`seg-btn ${mode === "signup" ? "active" : ""}`} onClick={() => setMode("signup")}>
              Create account
            </button>
          </div>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              placeholder="at least 8 characters"
            />
          </label>
          {error && <p className="field-error">{error}</p>}
          <button className="btn primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "Working…" : mode === "signup" ? "Create account & back up" : "Sign in"}
          </button>
          {mode === "signup" && (
            <p className="hint" style={{ marginTop: 10 }}>
              ⚠ Because it's end-to-end encrypted, <b>we can't recover a forgotten password</b> — the
              cloud copy would be unreadable. Use a password you won't lose (a password manager is ideal).
            </p>
          )}
        </div>
      ) : (
        <div className="provider-card" style={{ maxWidth: 540 }}>
          <div className="provider-row">
            <div className="grow">
              <b>{cloud!.email}</b> <span className="pill ok">Signed in</span>
              <div className="hint">Last synced: {rel(cloud!.lastSyncedAt)}</div>
            </div>
          </div>
          <label className="agent-check">
            <input type="checkbox" checked={cloud!.autoSync ?? true} onChange={(e) => setAutoSync(e.target.checked)} />
            Sync automatically after changes
          </label>
          <div className="provider-row" style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={busy} onClick={() => void doPush()}>
              Sync now
            </button>
            <button className="btn" disabled={busy} onClick={() => void doPull()}>
              Restore from cloud
            </button>
            <span className="grow" />
            <button className="btn" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
          <button
            className="link-btn danger-link"
            style={{ marginTop: 12 }}
            onClick={async () => {
              if (await confirmDialog("Delete your cloud account and all its data?", { danger: true, message: "This removes the encrypted blob from the server. Your local data on this device is untouched." })) {
                await deleteAccount();
                toast.success("Cloud account deleted.");
              }
            }}
          >
            Delete cloud account
          </button>
        </div>
      )}
    </>
  );
}
