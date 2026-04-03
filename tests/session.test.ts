import { describe, it, expect } from "vitest";
import { SessionManager } from "../src/session.js";

describe("SessionManager", () => {
  it("starts at root", () => {
    const s = new SessionManager();
    expect(s.cwd).toBe("/");
  });

  it("resolves absolute paths", () => {
    const s = new SessionManager();
    expect(s.resolvePath("/cloud/aws")).toBe("/cloud/aws");
  });

  it("resolves relative paths from cwd", () => {
    const s = new SessionManager();
    s.cwd = "/cloud";
    expect(s.resolvePath("aws")).toBe("/cloud/aws");
  });

  it("resolves parent paths", () => {
    const s = new SessionManager();
    s.cwd = "/cloud/aws/s3";
    expect(s.resolvePath("..")).toBe("/cloud/aws");
    expect(s.resolvePath("../..")).toBe("/cloud");
  });

  it("updateCwd changes cwd", () => {
    const s = new SessionManager();
    s.updateCwd("/cloud/aws");
    expect(s.cwd).toBe("/cloud/aws");
    s.updateCwd("..");
    expect(s.cwd).toBe("/cloud");
  });

  it("getPinnedContext returns empty string when no pins", () => {
    const s = new SessionManager();
    expect(s.getPinnedContext()).toBe("");
  });

  it("getPinnedContext returns pinned values", () => {
    const s = new SessionManager();
    s.kvStore.set("port", "5432");
    s.pinnedKeys.add("port");
    const ctx = s.getPinnedContext();
    expect(ctx).toContain("PINNED MEMORY");
    expect(ctx).toContain("port");
    expect(ctx).toContain("5432");
  });
});
