import { describe, expect, it } from "vitest";
import { resolve, WORKSPACE } from "../web/shims/vfs";

/**
 * The web file tools run against an OPFS workspace shared with the terminal and
 * Python. The one property that must hold is the sandbox: no path a model can
 * construct may resolve outside the workspace, or it could read or clobber the
 * app's own settings, conversations and stored keys elsewhere in OPFS.
 */
describe("virtual filesystem path resolution", () => {
  it("keeps ordinary paths inside the workspace", () => {
    expect(resolve("", "notes.txt")).toBe(`${WORKSPACE}/notes.txt`);
    expect(resolve("proj", "src/main.ts")).toBe(`${WORKSPACE}/proj/src/main.ts`);
    expect(resolve("", "./a/./b")).toBe(`${WORKSPACE}/a/b`);
  });

  it("clamps ..  — never climbs out of the workspace", () => {
    const escapes = [
      "../settings.json",
      "../../.harnessx/settings.json",
      "../../../etc/passwd",
      "a/../../../../secret",
      "..\\..\\windows", // backslash traversal
    ];
    for (const evil of escapes) {
      expect(resolve("", evil).startsWith(WORKSPACE), evil).toBe(true);
      expect(resolve("", evil).includes("/../"), evil).toBe(false);
    }
  });

  it("treats absolute paths as workspace-relative, not filesystem-absolute", () => {
    expect(resolve("", "/etc/passwd")).toBe(`${WORKSPACE}/etc/passwd`);
    expect(resolve("", "C:\\Windows\\System32")).toBe(`${WORKSPACE}/Windows/System32`);
    expect(resolve("", "~/.ssh/id_rsa")).toBe(`${WORKSPACE}/.ssh/id_rsa`);
  });

  it("an empty path is the workspace root itself", () => {
    expect(resolve("", "")).toBe(WORKSPACE);
    expect(resolve("", "..")).toBe(WORKSPACE);
  });
});
