import { describe, it, expect, vi } from "vitest";
import { Router } from "../src/router.js";
import { BranchNode } from "../src/nodes/branch-node.js";
import { LeafNode } from "../src/nodes/leaf-node.js";
import { SessionManager } from "../src/session.js";
import { TreeBuilder } from "../src/builder.js";
import { generateToolSchema } from "../src/schema.js";
import { csv, prettyJson, digest } from "../src/formatter.js";
import {
  createTestRouter,
  mockLeafNode,
  assertSuccess,
  assertError,
  executeSequence,
} from "../src/testing.js";
import { createMemoryModule } from "../src/memory.js";

// ── E1: TreeBuilder ─────────────────────────────────────────────────

describe("TreeBuilder (E1)", () => {
  it("builds a simple tree", () => {
    const root = TreeBuilder.create("root", "Main system")
      .leaf("status", {
        description: "System status",
        handler: () => "[SUCCESS] OK",
      })
      .build();

    expect(root.name).toBe("root");
    expect(root.children.has("status")).toBe(true);
  });

  it("builds nested branches", () => {
    const root = TreeBuilder.create("root", "Main")
      .branch("database", "DB", (db) => {
        db.leaf("query", {
          description: "Run SQL",
          requiredArgs: ["sql"],
          handler: (kw) => `[SUCCESS] ${kw.sql}`,
        });
        db.leaf("tables", {
          description: "List tables",
          handler: () => "[SUCCESS] users, orders",
        });
      })
      .build();

    expect(root.children.has("database")).toBe(true);
    const db = root.children.get("database") as BranchNode;
    expect(db.children.has("query")).toBe(true);
    expect(db.children.has("tables")).toBe(true);
  });

  it("supports addBranch for pre-built modules", () => {
    const session = new SessionManager("test");
    const root = TreeBuilder.create("root", "Main")
      .addBranch(createMemoryModule(session))
      .build();

    expect(root.children.has("memory")).toBe(true);
  });

  it("works with Router", async () => {
    const root = TreeBuilder.create("root", "Main")
      .branch("db", "Database", (db) => {
        db.leaf("query", {
          description: "Run SQL",
          requiredArgs: ["sql"],
          handler: (kw) => `[SUCCESS] ${kw.sql}`,
        });
      })
      .build();

    const { router } = createTestRouter(root);
    const result = await router.execute("db query", { sql: "SELECT 1" });
    expect(result).toContain("SUCCESS");
    expect(result).toContain("SELECT 1");
  });
});

// ── E2: Schema Auto-Generation ──────────────────────────────────────

describe("Schema auto-generation (E2)", () => {
  it("default schema still works", () => {
    const schema = generateToolSchema();
    expect(schema.name).toBe("terminal_interface");
    expect(schema.parameters.required).toContain("command");
  });

  it("includes module listing when root is provided", () => {
    const root = TreeBuilder.create("root", "Main")
      .branch("database", "Query the database", () => {})
      .branch("files", "File operations", () => {})
      .build();

    const schema = generateToolSchema({ root });
    expect(schema.description).toContain("database");
    expect(schema.description).toContain("files");
    expect(schema.description).toContain("Built-in commands");
  });
});

// ── E4: Testing Utilities ───────────────────────────────────────────

describe("Testing utilities (E4)", () => {
  it("createTestRouter creates a working router", async () => {
    const root = new BranchNode({ name: "root", description: "Root" });
    root.addChild(mockLeafNode("ping", "[SUCCESS] pong"));
    const { router, session } = createTestRouter(root);

    expect(session.sessionId).toBe("test");
    const result = await router.execute("ping");
    expect(result).toContain("pong");
  });

  it("assertSuccess passes for success", () => {
    expect(() => assertSuccess("[SUCCESS] OK")).not.toThrow();
  });

  it("assertSuccess throws for errors", () => {
    expect(() => assertSuccess("[ERROR] Not good")).toThrow("Expected SUCCESS");
  });

  it("assertError passes for errors", () => {
    expect(() => assertError("[ERROR: NotFound] Missing")).not.toThrow();
  });

  it("assertError checks error type", () => {
    expect(() => assertError("[ERROR: NotFound] Missing", "NotFound")).not.toThrow();
    expect(() => assertError("[ERROR: NotFound] Missing", "Timeout")).toThrow("Expected error type");
  });

  it("executeSequence runs commands in order", async () => {
    const root = new BranchNode({ name: "root", description: "Root" });
    root.addChild(mockLeafNode("a", "[SUCCESS] A"));
    root.addChild(mockLeafNode("b", "[SUCCESS] B"));
    const { router } = createTestRouter(root);

    const results = await executeSequence(router, [
      { command: "a" },
      { command: "b" },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]).toContain("A");
    expect(results[1]).toContain("B");
  });
});

// ── B2: Memory Tags ────────────────────────────────────────────────

describe("Memory tags (B2)", () => {
  function setup() {
    const session = new SessionManager("test");
    const memory = createMemoryModule(session);
    return { session, memory };
  }

  it("set stores tags with comma-separated string", async () => {
    const { session, memory } = setup();
    await memory.execute(["set"], {
      key: "db_host",
      value: "localhost",
      tags: "database,config",
    });
    expect(session.kvTags.get("db_host")).toEqual(new Set(["database", "config"]));
  });

  it("get shows tags", async () => {
    const { session, memory } = setup();
    session.kvStore.set("db_host", "localhost");
    session.kvTags.set("db_host", new Set(["database"]));
    const result = await memory.execute(["get"], { key: "db_host" });
    expect(result).toContain("database");
  });

  it("list filters by tag", async () => {
    const { session, memory } = setup();
    session.kvStore.set("db_host", "localhost");
    session.kvStore.set("db_port", "5432");
    session.kvStore.set("api_key", "secret");
    session.kvTags.set("db_host", new Set(["database"]));
    session.kvTags.set("db_port", new Set(["database"]));
    session.kvTags.set("api_key", new Set(["api"]));

    const result = await memory.execute(["list"], { tag: "database" });
    expect(result).toContain("db_host");
    expect(result).toContain("db_port");
    expect(result).not.toContain("api_key");
  });

  it("tag action adds tags to existing key", async () => {
    const { session, memory } = setup();
    session.kvStore.set("note", "important");
    const result = await memory.execute(["tag"], { key: "note", tags: "todo,critical" });
    expect(result).toContain("SUCCESS");
    expect(session.kvTags.get("note")).toEqual(new Set(["todo", "critical"]));
  });

  it("tag errors on missing key", async () => {
    const { memory } = setup();
    const result = await memory.execute(["tag"], { key: "nope", tags: "x" });
    expect(result).toContain("KeyNotFound");
  });

  it("delete also removes tags", async () => {
    const { session, memory } = setup();
    session.kvStore.set("note", "value");
    session.kvTags.set("note", new Set(["tag1"]));
    await memory.execute(["delete"], { key: "note" });
    expect(session.kvTags.has("note")).toBe(false);
  });
});

// ── B3: Memory Search ───────────────────────────────────────────────

describe("Memory search (B3)", () => {
  function setup() {
    const session = new SessionManager("test");
    const memory = createMemoryModule(session);
    return { session, memory };
  }

  it("searches by key name", async () => {
    const { session, memory } = setup();
    session.kvStore.set("db_host", "localhost");
    session.kvStore.set("api_key", "secret");
    const result = await memory.execute(["search"], { query: "db" });
    expect(result).toContain("db_host");
    expect(result).not.toContain("api_key");
  });

  it("searches by value content", async () => {
    const { session, memory } = setup();
    session.kvStore.set("host", "localhost");
    session.kvStore.set("port", "5432");
    const result = await memory.execute(["search"], { query: "local" });
    expect(result).toContain("host");
    expect(result).not.toContain("port");
  });

  it("case-insensitive search", async () => {
    const { session, memory } = setup();
    session.kvStore.set("Config", "Value");
    const result = await memory.execute(["search"], { query: "config" });
    expect(result).toContain("Config");
  });

  it("returns info when no matches", async () => {
    const { memory } = setup();
    const result = await memory.execute(["search"], { query: "nothing" });
    expect(result).toContain("No memories matching");
  });

  it("respects limit", async () => {
    const { session, memory } = setup();
    for (let i = 0; i < 20; i++) {
      session.kvStore.set(`item_${i}`, `value_${i}`);
    }
    const result = await memory.execute(["search"], { query: "item", limit: 3 });
    expect(result).toContain("3 match");
  });
});

// ── G1-G3: Additional Formatters ────────────────────────────────────

describe("CSV formatter (G1)", () => {
  it("formats basic CSV", () => {
    const result = csv(["Name", "Age"], [["Alice", "30"], ["Bob", "25"]]);
    expect(result).toBe("Name,Age\nAlice,30\nBob,25");
  });

  it("escapes commas in cells", () => {
    const result = csv(["Name", "Address"], [["Alice", "123 Main St, Apt 4"]]);
    expect(result).toContain('"123 Main St, Apt 4"');
  });

  it("escapes quotes in cells", () => {
    const result = csv(["Name", "Quote"], [["Alice", 'Said "hello"']]);
    expect(result).toContain('"Said ""hello"""');
  });
});

describe("prettyJson formatter (G2)", () => {
  it("formats simple objects", () => {
    const result = prettyJson({ a: 1, b: "hello" });
    expect(result).toContain('"a": 1');
    expect(result).toContain('"b": "hello"');
  });

  it("respects max depth", () => {
    const deep = { a: { b: { c: { d: { e: "deep" } } } } };
    const result = prettyJson(deep, 2);
    expect(result).toContain("...");
  });

  it("handles arrays", () => {
    const result = prettyJson([1, 2, 3]);
    expect(result).toBe("[1, 2, 3]");
  });

  it("handles null/undefined", () => {
    expect(prettyJson(null)).toBe("null");
    expect(prettyJson(undefined)).toBe("undefined");
  });
});

describe("digest formatter (G3)", () => {
  it("returns full text when under limit", () => {
    expect(digest("hello", 100)).toBe("hello");
  });

  it("truncates text with char count", () => {
    const result = digest("hello world this is a long text", 10);
    expect(result).toBe("hello worl... [21 more chars]");
  });
});

// ── D3: Handler Timeout ─────────────────────────────────────────────

describe("Handler timeout (D3)", () => {
  it("times out slow handlers", async () => {
    const node = new LeafNode({
      name: "slow",
      description: "Slow handler",
      timeoutMs: 50,
      handler: () =>
        new Promise((resolve) => setTimeout(() => resolve("done"), 500)),
    });
    const result = await node.execute([], {});
    expect(result).toContain("HandlerException");
    expect(result).toContain("Timed out");
  }, 2000);

  it("succeeds for fast handlers with timeout", async () => {
    const node = new LeafNode({
      name: "fast",
      description: "Fast handler",
      timeoutMs: 1000,
      handler: () => "[SUCCESS] Fast",
    });
    const result = await node.execute([], {});
    expect(result).toBe("[SUCCESS] Fast");
  });
});

// ── E5: Debug Mode ──────────────────────────────────────────────────

describe("Debug mode (E5)", () => {
  it("logs when debug is enabled", async () => {
    const logs: string[] = [];
    const root = new BranchNode({ name: "root", description: "Root" });
    root.addChild(mockLeafNode("ping", "[SUCCESS] pong"));

    const session = new SessionManager("test");
    const router = new Router(root, session, {
      debug: true,
      logger: (msg) => logs.push(msg),
    });

    await router.execute("ping");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.includes("execute"))).toBe(true);
    expect(logs.some((l) => l.includes("completed"))).toBe(true);
  });

  it("does not log when debug is disabled", async () => {
    const logs: string[] = [];
    const root = new BranchNode({ name: "root", description: "Root" });
    root.addChild(mockLeafNode("ping", "[SUCCESS] pong"));

    const session = new SessionManager("test");
    const router = new Router(root, session, {
      debug: false,
      logger: (msg) => logs.push(msg),
    });

    await router.execute("ping");
    expect(logs).toHaveLength(0);
  });
});

// ── Session Tags Serialization ──────────────────────────────────────

describe("Session tags serialization", () => {
  it("serializes and deserializes tags", () => {
    const session = new SessionManager("test");
    session.kvStore.set("a", "1");
    session.kvTags.set("a", new Set(["tag1", "tag2"]));

    const json = session.toJSON();
    const restored = SessionManager.fromJSON(json);

    expect(restored.kvTags.get("a")).toEqual(new Set(["tag1", "tag2"]));
  });
});
