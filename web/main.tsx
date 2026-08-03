import React from "react";
import ReactDOM from "react-dom/client";
import App from "../src/App";
import "../src/App.css";
// Registers the browser backends (mic capture, …) into the invoke() dispatcher.
import "./shims/mic";
import "./shims/secret";
import "./shims/speak";
import "./shims/vfs";
import "./shims/pyodide";
import "./shims/shell";
// Real Linux VM (v86) — booted on demand; see web/shims/vm.ts.
import "./shims/vm";

/**
 * Web entry point.
 *
 * Mounts the exact same <App/> the desktop build uses. The difference is entirely
 * in the Vite config, which points the @tauri-apps/* imports at the browser shims
 * — so there is one app, not two, and a feature added to the desktop UI appears
 * here for free.
 */
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
