/** Shows whether the background worker currently holds a socket to the app. */
chrome.runtime.sendMessage({ type: "status" }, (res) => {
  const on = !!res?.connected;
  document.getElementById("dot").classList.toggle("on", on);
  document.getElementById("state").textContent = on ? "Connected" : "Not connected";
  document.getElementById("hint").textContent = on
    ? "HarnessStation can drive this browser."
    : "Start HarnessStation, then reopen this popup.";
});
