import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installErrorReporting } from "./lib/errorReporting";

// Before the first render, so an error thrown while the tree is mounting is
// still reported rather than going to a console nobody is reading.
installErrorReporting();

// The boundary sits outside StrictMode. Inside, it would be remounted by the
// double-invoked lifecycle in development and lose the error it had just
// caught — the crash screen would appear and vanish.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </ErrorBoundary>,
);
