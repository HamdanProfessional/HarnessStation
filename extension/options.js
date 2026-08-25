// Stores the bridge token the desktop app expects on every WebSocket hello.
// The service worker reads it from chrome.storage.local at connect time.
const input = document.getElementById("token");
const status = document.getElementById("status");

chrome.storage.local.get("bridgeToken", ({ bridgeToken }) => {
  input.value = bridgeToken || "";
});

document.getElementById("save").addEventListener("click", () => {
  const token = input.value.trim();
  chrome.storage.local.set({ bridgeToken: token }, () => {
    status.textContent = token ? "Saved — reconnecting…" : "Cleared.";
    // The service worker polls its own reconnect loop; a fresh token takes
    // effect on the next attempt (3s), so nothing further to poke here.
    setTimeout(() => (status.textContent = ""), 2500);
  });
});
