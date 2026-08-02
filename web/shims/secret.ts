/**
 * Secret storage for the web build.
 *
 * The desktop app keeps API keys in the OS keychain (Credential Manager / Secret
 * Service). A browser tab has no equivalent, so keys live in localStorage under
 * a namespace instead. This is a real reduction in protection and the app says
 * so in the UI: anything with access to the origin's storage can read them.
 *
 * The alternative — routing keys through a server — is exactly what this app
 * refuses to do, so the honest trade for a serverless web build is browser
 * storage with the caveat stated plainly.
 */

import { registerCommand } from "./core";

const PREFIX = "hs-secret:";

registerCommand("secret_set", (args) => {
  const { id, value } = (args ?? {}) as { id: string; value: string };
  if (value) localStorage.setItem(PREFIX + id, value);
  else localStorage.removeItem(PREFIX + id);
  return null;
});

registerCommand("secret_get", (args) => {
  const { id } = (args ?? {}) as { id: string };
  return localStorage.getItem(PREFIX + id);
});

registerCommand("secret_delete", (args) => {
  const { id } = (args ?? {}) as { id: string };
  localStorage.removeItem(PREFIX + id);
  return null;
});
