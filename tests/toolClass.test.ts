import { describe, expect, it } from "vitest";
import { toolClass } from "../src/lib/hooks";

describe("toolClass — sandbox/approval categorisation", () => {
  it("treats terminal-style tools as exec", () => {
    expect(toolClass("run_terminal")).toBe("exec");
    expect(toolClass("shell_exec")).toBe("exec");
    expect(toolClass("some_mcp_bash")).toBe("exec");
  });
  it("treats mutating file tools as write", () => {
    for (const id of ["write_file", "edit_file", "delete_path", "make_dir", "github_create_issue", "notion_update_page"]) {
      expect(toolClass(id)).toBe("write");
    }
  });
  it("treats reads, search and fetches as read", () => {
    for (const id of ["read_file", "list_folder", "find_files", "grep_files", "web_search", "fetch_page"]) {
      expect(toolClass(id)).toBe("read");
    }
  });
});
