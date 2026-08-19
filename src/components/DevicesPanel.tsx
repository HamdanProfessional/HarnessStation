import { useCallback, useEffect, useRef, useState } from "react";
import {
  addPeerByAddress,
  addressExposure,
  armPairing,
  callPeer,
  deviceName,
  disarmPairing,
  exposureNote,
  forgetPeer,
  looksLikeCode,
  meshStatus,
  needsWarning,
  newPairingCode,
  pairWith,
  setDeviceName,
  type MeshPeer,
  type MeshShare,
  type MeshStatus,
} from "../lib/mesh";
import { saveMeshPeers, startMesh, stopMesh } from "../lib/meshRuntime";
import { DEFAULT_LOCAL_API_PORT, localApiStatus } from "../lib/localApi";
import { useStore } from "../lib/store";
import { Spinner } from "./Loading";
import { IconX } from "./icons";
import { isWeb } from "../lib/web";
import { GetDesktopApp } from "./GetDesktopApp";

/**
 * Settings › Devices.
 *
 * Two halves, because pairing has two ends and people get them muddled: the top
 * shows a code for *this* device, the bottom takes a code from another one.
 */

const SHARE_KEY = "hs-mesh-share";
const AUTO_KEY = "hs-mesh-auto";

export function loadShare(): MeshShare {
  try {
    const raw = JSON.parse(localStorage.getItem(SHARE_KEY) || "{}");
    return { models: !!raw.models, tools: !!raw.tools, knowledge: !!raw.knowledge };
  } catch {
    return { models: false, tools: false, knowledge: false };
  }
}

export function saveShare(share: MeshShare): void {
  localStorage.setItem(SHARE_KEY, JSON.stringify(share));
}

export function meshAutoStart(): boolean {
  return localStorage.getItem(AUTO_KEY) === "1";
}

export function DevicesPanel() {
  const [status, setStatus] = useState<MeshStatus | null>(null);
  const [share, setShare] = useState<MeshShare>(loadShare);
  const [auto, setAuto] = useState(meshAutoStart);
  const [name, setName] = useState(deviceName);
  const [code, setCode] = useState<string | null>(null);
  const [joinAddr, setJoinAddr] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** A warning the user must acknowledge before an unencrypted link goes out. */
  const [pending, setPending] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await meshStatus());
    } catch {
      /* mesh not started yet */
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Discovery is a broadcast every few seconds, so the list genuinely changes
    // under us — poll while this panel is open, and stop when it isn't.
    timer.current = window.setInterval(() => void refresh(), 3000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [refresh]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setBusy(null);
      void refresh();
      // Pairings live in Rust for the session; this is what survives a restart.
      void saveMeshPeers();
    }
  };

  const toggleMesh = () =>
    run("mesh", async () => {
      if (status?.running) {
        await stopMesh();
        setCode(null);
      } else {
        setDeviceName(name);
        await startMesh();
      }
    });

  const startPairing = () =>
    run("pair", async () => {
      const fresh = newPairingCode();
      await armPairing(fresh, 300);
      setCode(fresh);
      setNote("Type this code on the other device within 5 minutes.");
    });

  const join = (force = false) =>
    run("join", async () => {
      // Warn before the first byte goes out, not after — by the time a pairing
      // has happened over the open internet, the handshake has already crossed it.
      const warning = exposureNote(addressExposure(joinAddr));
      if (warning && !force) {
        setPending(warning);
        return;
      }
      setPending(null);
      const peer = await pairWith(joinAddr, joinCode);
      setJoinCode("");
      setNote(`Paired with ${peer.name}.`);
    });

  const updateShare = (patch: Partial<MeshShare>) => {
    const next = { ...share, ...patch };
    setShare(next);
    saveShare(next);
  };

  const probe = (peer: MeshPeer) =>
    run(`probe:${peer.id}`, async () => {
      const caps = await callPeer<{ models: string[]; tools: string[] }>(peer.id, "describe");
      setNote(
        `${peer.name}: ${caps.models.length} model(s), ${caps.tools.length} tool(s) shared with you.`,
      );
    });

  const paired = status?.peers.filter((p) => p.paired) ?? [];
  const nearby = status?.peers.filter((p) => !p.paired) ?? [];

  if (isWeb()) {
    return (
      <>
        <h2>Devices</h2>
        <GetDesktopApp feature="mesh" />
      </>
    );
  }

  return (
    <>
      <h2>This device</h2>
      <p className="hint">
        Connect the machines you own into one system: use the desktop's models from the laptop, or
        reach a knowledge base that only lives on one of them. Everything stays between your
        devices — nothing is routed through us.
      </p>

      <div className="provider-row">
        <input
          value={name}
          aria-label="Device name"
          placeholder="Desktop"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setDeviceName(name)}
        />
        <button className="btn" disabled={busy === "mesh"} onClick={toggleMesh}>
          {busy === "mesh" ? <Spinner size={13} /> : status?.running ? "Turn off" : "Turn on"}
        </button>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => {
            setAuto(e.target.checked);
            localStorage.setItem(AUTO_KEY, e.target.checked ? "1" : "0");
          }}
        />
        Start the mesh when HarnessStation starts
      </label>

      {status?.running && (
        <p className="hint">
          Reachable on port {status.port}, announcing on {status.discoveryPort}.{" "}
          {status.peers.length} device(s) known.
        </p>
      )}

      {status?.exposure && (
        <div className="warn-banner" role="alert">
          <div>
            <b>This device is reachable from the internet.</b>
            <p>
              {status.exposure.count === 1 ? "A connection" : `${status.exposure.count} connections`}{" "}
              reached the mesh port from {status.exposure.from}, which is a public address — so this
              port is open to the internet, not just your network.{" "}
              {status.exposure.authenticated
                ? "At least one of them was a paired device of yours. Traffic still isn't encrypted, so put the link inside a VPN or tunnel."
                : "None of them authenticated, so nothing was shared — but the port is being reached, and unpaired scanning is worth knowing about."}{" "}
              If you didn't mean to expose it, close the forwarded port on your router and connect
              through a VPN or tunnel (Tailscale, WireGuard, SSH) instead.
            </p>
          </div>
        </div>
      )}

      <h2>What this device shares</h2>
      <p className="hint">
        Pairing by itself grants nothing. Each switch below is separate, and off by default.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={share.models}
          onChange={(e) => updateShare({ models: e.target.checked })}
        />
        Models — let paired devices run inference here (your API keys, your GPU)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={share.tools}
          onChange={(e) => updateShare({ tools: e.target.checked })}
        />
        Tools — let them call tools on this machine
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={share.knowledge}
          onChange={(e) => updateShare({ knowledge: e.target.checked })}
        />
        Knowledge — let them search knowledge bases stored here
      </label>
      <p className="hint">
        Shell, Python and file-writing tools are never shared, whatever the switch above says —
        pairing is a code typed once, and it shouldn't amount to a remote shell.
      </p>

      <h2>Add a device</h2>
      <div className="provider-row">
        <button className="btn primary" disabled={!status?.running || busy === "pair"} onClick={startPairing}>
          {busy === "pair" ? <Spinner size={13} /> : "Show pairing code"}
        </button>
        {code && (
          <>
            <code className="pair-code">{code}</code>
            <button
              className="btn"
              onClick={() =>
                void disarmPairing().then(() => {
                  setCode(null);
                  setNote(null);
                })
              }
            >
              Cancel
            </button>
          </>
        )}
      </div>
      {!status?.running && <p className="hint">Turn the mesh on first.</p>}

      <p className="hint" style={{ marginTop: 14 }}>
        Or enter the code shown on the other device:
      </p>
      <div className="provider-row">
        <input
          value={joinAddr}
          placeholder="192.168.1.42  (or hostname)"
          aria-label="Other device address"
          onChange={(e) => {
            setJoinAddr(e.target.value);
            setPending(null);
          }}
        />
        <input
          value={joinCode}
          placeholder="XXXX-XXXX-XXXX"
          aria-label="Pairing code"
          onChange={(e) => setJoinCode(e.target.value)}
        />
        <button
          className="btn primary"
          disabled={!joinAddr.trim() || !looksLikeCode(joinCode) || busy === "join"}
          onClick={() => void join()}
        >
          {busy === "join" ? <Spinner size={13} /> : "Pair"}
        </button>
      </div>
      <p className="hint">
        Devices on the same network find each other on their own — the address is only needed the
        first time, or for a machine somewhere else.
      </p>

      {pending && (
        <div className="warn-banner" role="alert">
          <div>
            <b>This link isn't private.</b>
            <p>{pending}</p>
          </div>
          <div className="warn-actions">
            <button
              className="btn"
              onClick={() => {
                setPending(null);
                void join(true);
              }}
            >
              Pair anyway
            </button>
            <button className="btn" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button className="error-dismiss" aria-label="Dismiss" onClick={() => setError(null)}>
            <IconX size={12} />
          </button>
        </div>
      )}
      {note && !error && <p className="hint ok-note">{note}</p>}

      <h2>Paired devices</h2>
      {paired.length === 0 && <p className="hint">None yet.</p>}
      {paired.map((p) => (
        <div className="provider-row" key={p.id}>
          <span className={`conn-dot ${p.online ? "on" : ""}`} aria-hidden="true" />
          <b>{p.name}</b>
          <span className="hint">{p.addr || "address unknown"}</span>
          {needsWarning(p.exposure ?? addressExposure(p.addr)) && (
            <span
              className="exposure-badge"
              title={exposureNote(p.exposure ?? addressExposure(p.addr), "This device's address") ?? ""}
            >
              unencrypted link
            </span>
          )}
          <button className="btn" disabled={busy === `probe:${p.id}`} onClick={() => probe(p)}>
            {busy === `probe:${p.id}` ? <Spinner size={13} /> : "What can it do?"}
          </button>
          <button className="btn" onClick={() => void run("forget", () => forgetPeer(p.id))}>
            Forget
          </button>
        </div>
      ))}

      {nearby.length > 0 && (
        <>
          <h2>On this network</h2>
          <p className="hint">Seen announcing themselves, but not paired.</p>
          {nearby.map((p) => (
            <div className="provider-row" key={p.id}>
              <span className={`conn-dot ${p.online ? "on" : ""}`} aria-hidden="true" />
              <b>{p.name}</b>
              <span className="hint">{p.addr}</span>
              <button
                className="btn"
                onClick={() => {
                  setJoinAddr(p.addr);
                  setNote(`Show a pairing code on ${p.name}, then enter it above.`);
                }}
              >
                Pair…
              </button>
            </div>
          ))}
        </>
      )}

      <h2>Somewhere else</h2>
      <p className="hint">
        A machine off this network can be added by address. Do that over a VPN or tunnel
        (Tailscale, WireGuard, SSH) rather than forwarding a port: pairing proves who you are
        without sending the code, but the requests themselves aren't encrypted yet.
      </p>
      <div className="provider-row">
        <input
          value={joinAddr}
          placeholder="host:8793"
          aria-label="Remote address"
          onChange={(e) => setJoinAddr(e.target.value)}
        />
        <button
          className="btn"
          disabled={!joinAddr.trim()}
          onClick={() =>
            void run("add", async () => {
              await addPeerByAddress(joinAddr);
              setNote("Added. Now enter its pairing code above.");
            })
          }
        >
          Remember address
        </button>
      </div>

      <LocalApiCard />
    </>
  );
}

/**
 * Local API server — expose the configured models and agents on loopback as an
 * OpenAI-compatible endpoint, so any tool on this machine that speaks the OpenAI
 * API (an editor, a script, an SDK) can drive them. Loopback only: sharing
 * across devices is the mesh's job, with its own pairing.
 */
function LocalApiCard() {
  const { settings, saveSettings } = useStore();
  const cfg = settings.localApi;
  const [port, setPort] = useState(String(cfg?.port ?? DEFAULT_LOCAL_API_PORT));
  // Actual bound port from Rust, polled — the source of truth for "is it up?".
  const [running, setRunning] = useState<number | null>(null);

  // Poll the real server state while the panel is open. Start/stop itself is
  // driven by the App-level effect that watches settings.localApi.
  useEffect(() => {
    let live = true;
    const tick = () => void localApiStatus().then((p) => live && setRunning(p));
    tick();
    const t = window.setInterval(tick, 1500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const save = (patch: Partial<NonNullable<typeof cfg>>) =>
    saveSettings({ ...settings, localApi: { enabled: false, ...cfg, ...patch } });

  const clampPort = (v: string) => Math.min(65535, Math.max(1, Number(v) || DEFAULT_LOCAL_API_PORT));

  return (
    <>
      <h2 style={{ marginTop: 28 }}>Local API server</h2>
      <p className="hint">
        Serve the models and agents you've set up here as an OpenAI-compatible endpoint on this
        machine, so other apps — an editor, a script, anything that speaks the OpenAI API — can call
        them. Loopback only (<code>127.0.0.1</code>); nothing is exposed to the network.
      </p>

      <div className="provider-row">
        <label className="check" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={!!cfg?.enabled}
            onChange={(e) => save({ enabled: e.target.checked, port: clampPort(port) })}
          />
          {running ? "Running" : cfg?.enabled ? "Starting…" : "Off"}
        </label>
        <input
          value={port}
          aria-label="Local API port"
          placeholder={String(DEFAULT_LOCAL_API_PORT)}
          style={{ width: 96 }}
          onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
          onBlur={() => save({ port: clampPort(port) })}
        />
      </div>

      {running && (
        <p className="hint ok-note">
          Point a client's base URL at <code>http://127.0.0.1:{running}/v1</code> (any API key). Use
          a model id like <code>openai/gpt-5</code> or an agent as <code>agent/&lt;name&gt;</code>.
          <code> GET /v1/models</code> lists them.
        </p>
      )}
    </>
  );
}
