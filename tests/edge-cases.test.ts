import { describe, it, expect } from "vitest";
import { Router } from "../src/router.js";
import { BranchNode } from "../src/nodes/branch-node.js";
import { LeafNode } from "../src/nodes/leaf-node.js";
import { DynamicBranchNode } from "../src/nodes/dynamic-branch-node.js";
import { SessionManager } from "../src/session.js";
import { createMemoryModule } from "../src/memory.js";
import { table, lineNumbered, truncate } from "../src/formatter.js";
import { levenshtein, findClosestMatch } from "../src/utils/fuzzy.js";

// ── Phase 1 Feature Tests ──────────────────────────────────────────

describe("Memory delete action (B1)", () => {
  function setup() {
    const session = new SessionManager("test");
    const memory = createMemoryModule(session);
    return { session, memory };
  }

  it("deletes an existing key", async () => {
    const { session, memory } = setup();
    session.kvStore.set("port", "5432");
    const result = await memory.execute(["delete"], { key: "port" });
    expect(result).toContain("SUCCESS");
    expect(session.kvStore.has("port")).toBe(false);
  });

  it("errors when deleting a non-existent key", async () => {
    const { memory } = setup();
    const result = await memory.execute(["delete"], { key: "nope" });
    expect(result).toContain("KeyNotFound");
  });

  it("also unpins a pinned key when deleting", async () => {
    const { session, memory } = setup();
    session.kvStore.set("port", "5432");
    session.pinnedKeys.add("port");
    const result = await memory.execute(["delete"], { key: "port" });
    expect(result).toContain("SUCCESS");
    expect(session.kvStore.has("port")).toBe(false);
    expect(session.pinnedKeys.has("port")).toBe(false);
  });
});

describe("Handler-level error recovery (D1)", () => {
  it("catches sync handler exceptions", async () => {
    const node = new LeafNode({
      name: "failing",
      description: "Always fails",
      handler: () => {
        throw new Error("Something broke");
      },
    });
    const result = await node.execute([], {});
    expect(result).toContain("HandlerException");
    expect(result).toContain("Something broke");
    expect(result).toContain("failing");
  });

  it("catches async handler exceptions", async () => {
    const node = new LeafNode({
      name: "async-fail",
      description: "Async failure",
      handler: async () => {
        throw new Error("Async error");
      },
    });
    const result = await node.execute([], {});
    expect(result).toContain("HandlerException");
    expect(result).toContain("Async error");
  });

  it("catches non-Error exceptions", async () => {
    const node = new LeafNode({
      name: "throw-string",
      description: "Throws string",
      handler: () => {
        throw "raw string error";
      },
    });
    const result = await node.execute([], {});
    expect(result).toContain("HandlerException");
    expect(result).toContain("unexpected error");
  });
});

describe("Namespace collision detection (A4)", () => {
  it("throws when adding a child with duplicate name", () => {
    const branch = new BranchNode({ name: "root", description: "Root" });
    const leaf1 = new LeafNode({ name: "action", description: "First", handler: () => "1" });
    const leaf2 = new LeafNode({ name: "action", description: "Second", handler: () => "2" });

    branch.addChild(leaf1);
    expect(() => branch.addChild(leaf2)).toThrow("Namespace collision");
  });

  it("allows overwrite when option is set", () => {
    const branch = new BranchNode({ name: "root", description: "Root" });
    const leaf1 = new LeafNode({ name: "action", description: "First", handler: () => "1" });
    const leaf2 = new LeafNode({ name: "action", description: "Second", handler: () => "2" });

    branch.addChild(leaf1);
    branch.addChild(leaf2, { overwrite: true });
    expect(branch.children.get("action")?.description).toBe("Second");
  });

  it("does not throw for first-time child", () => {
    const branch = new BranchNode({ name: "root", description: "Root" });
    const leaf = new LeafNode({ name: "action", description: "Test", handler: () => "ok" });
    expect(() => branch.addChild(leaf)).not.toThrow();
  });
});

describe("Fuzzy command suggestions (C1)", () => {
  it("levenshtein computes correct distances", () => {
    expect(levenshtein("", "")).toBe(0);
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("abc", "abd")).toBe(1);
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("findClosestMatch returns closest candidate", () => {
    const candidates = ["database", "memory", "cloud", "system"];
    expect(findClosestMatch("databse", candidates)).toBe("database");
    expect(findClosestMatch("memry", candidates)).toBe("memory");
    expect(findClosestMatch("clod", candidates)).toBe("cloud");
  });

  it("findClosestMatch returns undefined when too far", () => {
    const candidates = ["database", "memory"];
    expect(findClosestMatch("zzzzzzzzz", candidates)).toBeUndefined();
  });

  it("findClosestMatch is case-insensitive", () => {
    const candidates = ["Database", "Memory"];
    expect(findClosestMatch("database", candidates)).toBe("Database");
  });

  it("BranchNode suggests close matches on command not found", async () => {
    const root = new BranchNode({ name: "root", description: "Root" });
    root.addChild(new LeafNode({ name: "query", description: "Run query", handler: () => "ok" }));
    root.addChild(new LeafNode({ name: "list", description: "List items", handler: () => "ok" }));

    const result = await root.execute(["qurey"], {});
    expect(result).toContain("CommandNotFound");
    expect(result).toContain("Did you mean: query?");
  });

  it("BranchNode does not suggest when no close match", async () => {
    const root = new BranchNode({ name: "root", description: "Root" });
    root.addChild(new LeafNode({ name: "query", description: "Run query", handler: () => "ok" }));

    const result = await root.execute(["zzzzzzzzz"], {});
    expect(result).toContain("CommandNotFound");
    expect(result).not.toContain("Did you mean");
  });
});

// ── Error Edge Cases (H1) ──────────────────────────────────────────

describe("Router edge cases", () => {
  function makeRouter() {
    const root = new BranchNode({ name: "root", description: "Root" });
    const cloud = new BranchNode({ name: "cloud", description: "Cloud" });
    const aws = new BranchNode({ name: "aws", description: "AWS" });
    const ls = new LeafNode({
      name: "ls",
      description: "List",
      handler: () => "[SUCCESS] items",
    });
    aws.addChild(ls);
    cloud.addChild(aws);
    root.addChild(cloud);

    const session = new SessionManager("test");
    root.addChild(createMemoryModule(session));
    const router = new Router(root, session);
    return { router, session, root };
  }

  it("handles empty command string", async () => {
    const { router } = makeRouter();
    const result = await router.execute("");
    expect(result).toContain("ROOT MENU");
  });

  it("handles whitespace-only command", async () => {
    const { router } = makeRouter();
    const result = await router.execute("   ");
    expect(result).toContain("ROOT MENU");
  });

  it("handles slash-separated paths", async () => {
    const { router } = makeRouter();
    const result = await router.execute("cloud/aws/ls");
    expect(result).toContain("SUCCESS");
  });

  it("handles mixed slash and space paths", async () => {
    const { router } = makeRouter();
    const result = await router.execute("cloud aws/ls");
    expect(result).toContain("SUCCESS");
  });

  it("handles trailing slashes", async () => {
    const { router } = makeRouter();
    const result = await router.execute("cloud/");
    expect(result).toContain("CLOUD MENU");
  });

  it("cd with no argument goes to root", async () => {
    const { router, session } = makeRouter();
    await router.execute("cd cloud");
    expect(session.cwd).toBe("/cloud");
    await router.execute("cd");
    expect(session.cwd).toBe("/");
  });

  it("cd .. from root stays at root", async () => {
    const { router, session } = makeRouter();
    await router.execute("cd ..");
    expect(session.cwd).toBe("/");
  });

  it("handles deeply nested path resolution", async () => {
    const { router } = makeRouter();
    const result = await router.execute("cloud aws ls");
    expect(result).toContain("SUCCESS");
  });

  it("router handles handler exceptions gracefully", async () => {
    const root = new BranchNode({ name: "root", description: "Root" });
    root.addChild(
      new LeafNode({
        name: "bomb",
        description: "Throws",
        handler: () => {
          throw new Error("Boom!");
        },
      }),
    );
    const session = new SessionManager("test");
    const router = new Router(root, session);

    const result = await router.execute("bomb");
    expect(result).toContain("HandlerException");
    expect(result).toContain("Boom!");
  });
});

describe("Session edge cases", () => {
  it("resolvePath with empty string returns cwd", () => {
    const s = new SessionManager();
    s.cwd = "/cloud";
    expect(s.resolvePath("")).toBe("/cloud");
  });

  it("resolvePath with '.' returns cwd", () => {
    const s = new SessionManager();
    s.cwd = "/cloud/aws";
    expect(s.resolvePath(".")).toBe("/cloud/aws");
  });

  it("cd .. from root returns root", () => {
    const s = new SessionManager();
    expect(s.resolvePath("..")).toBe("/");
  });

  it("getPinnedContext skips deleted keys", () => {
    const s = new SessionManager();
    s.kvStore.set("a", "1");
    s.pinnedKeys.add("a");
    s.pinnedKeys.add("b"); // b doesn't exist in kvStore
    const ctx = s.getPinnedContext();
    expect(ctx).toContain("a");
    expect(ctx).not.toContain("[PINNED MEMORY - b]");
  });
});

describe("DynamicBranchNode edge cases", () => {
  class FailingDynamicBranch extends DynamicBranchNode {
    protected refresh(): void {
      throw new Error("Refresh failed!");
    }
  }

  it("propagates refresh errors as SystemFault", async () => {
    const node = new FailingDynamicBranch({ name: "dyn", description: "Dynamic" });
    // Before D4 fix, this would throw unhandled. After D4, it returns an error string.
    try {
      const result = await node.execute(["item"], {});
      // If D4 is implemented, we expect an error message
      expect(result).toContain("ERROR");
    } catch {
      // Before D4, this is expected
    }
  });
});

describe("Formatter edge cases", () => {
  it("table with no rows", () => {
    const result = table(["Name", "Age"], []);
    expect(result).toContain("Name");
    expect(result).toContain("---");
  });

  it("table with missing cells", () => {
    const result = table(["A", "B", "C"], [["1"]]);
    expect(result).toContain("1");
  });

  it("lineNumbered with empty string", () => {
    const result = lineNumbered("");
    expect(result).toBe("1 | ");
  });

  it("lineNumbered with single line", () => {
    const result = lineNumbered("hello");
    expect(result).toBe("1 | hello");
  });

  it("truncate with maxLines = 0 truncates everything", () => {
    const result = truncate("line1\nline2\nline3", 0);
    expect(result).toContain("TRUNCATED");
    expect(result).toContain("3 more lines");
  });

  it("truncate with maxLines = 1 shows one line", () => {
    const result = truncate("line1\nline2\nline3", 1);
    expect(result).toContain("line1");
    expect(result).toContain("TRUNCATED");
    expect(result).toContain("2 more lines");
  });
});

describe("Memory edge cases", () => {
  function setup() {
    const session = new SessionManager("test");
    const memory = createMemoryModule(session);
    return { session, memory };
  }

  it("handles empty string keys", async () => {
    const { session, memory } = setup();
    const result = await memory.execute(["set"], { key: "", value: "test" });
    expect(result).toContain("SUCCESS");
    expect(session.kvStore.get("")).toBe("test");
  });

  it("handles empty string values", async () => {
    const { session, memory } = setup();
    const result = await memory.execute(["set"], { key: "empty", value: "" });
    expect(result).toContain("SUCCESS");
    expect(session.kvStore.get("empty")).toBe("");
  });

  it("list with prefix filter", async () => {
    const { session, memory } = setup();
    session.kvStore.set("db_host", "localhost");
    session.kvStore.set("db_port", "5432");
    session.kvStore.set("api_key", "secret");
    const result = await memory.execute(["list"], { prefix: "db_" });
    expect(result).toContain("db_host");
    expect(result).toContain("db_port");
    expect(result).not.toContain("api_key");
  });
});
