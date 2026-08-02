/**
 * Updater/process, standing in for @tauri-apps/plugin-updater and plugin-process.
 *
 * The web app updates by reloading the page — there's no installer to replace
 * and no process to relaunch. `check` reports no update available so the UI's
 * "check for updates" simply finds none, which is the truth.
 */
export async function check(): Promise<null> {
  return null;
}
export async function relaunch(): Promise<void> {
  location.reload();
}
