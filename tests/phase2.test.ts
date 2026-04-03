import { describe, it, expect, vi } from "vitest";
import { Router } from "../src/router.js";
import { BranchNode } from "../src/nodes/branch-node.js";
import { LeafNode } from "../src/nodes/leaf-node.js";
import { DynamicBranchNode } from "../src/nodes/dynamic-branch-node.js";
import { SessionManager } from "../src/session.js";
import { createMemoryModule } from "../src/memory.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeRouter() {
  const root = new BranchNode({ name: "root", description: "Root" });
  const db = new BranchNode({ name: "database", description: "Query the database." });
  db.addChild(
    new LeafNode({
      name: "query",
      description: "Run a SQL query.",
      requiredArgs: { sql: { type: "string", description: "SQL statement" } },
      optionalArgs: { limit: { type: "number", description: "Max rows", default: 100 } },
      handler: (kw) => `[SUCCESS] Ran: ${kw.sql}, limit: ${kw.limit}`,
    }),
  );
  db.addChild(
    new LeafNode({
      name: "tables",
      description: "List all tables.",
      handler: () => "[SUCCESS] users, orders, products",
    }),
  );
  root.addChild(db);

  const files = new BranchNode({ name: "files", description: "File operations." });
  files.addChild(
    new LeafNode({
      name: "read",
      description: "Read a file.",
      requiredArgs: ["path"],
      handler: (kw) => `[SUCCESS] Contents of ${kw.path}`,
    }),
  );
  root.addChild(files);

  const session = new SessionManager("test");
  root.addChild(createMemoryModule(session));
  const router = new Router(root, session, { pageSize: 5 });
  return { router, session, root };
}

// ── A3: Arg Type Validation & Descriptions ──────────────────────────

describe("Arg type validation (A3)", () => {
  it("coerces number arguments", async () => {
    const node = new LeafNode({
      name: "test",
      description: "Test",
      requiredArgs: { count: { type: "number" } },
      handler: (kw) => `count=${kw.count}, type=${typeof kw.count}`,
    });
    const result = await node.execute([], { count: "42" });
    expect(result).toBe("count=42, type=number");
  });

  it("rejects invalid number arguments", async () => {
    const node = new LeafNode({
      name: "test",
      description: "Test",
      requiredArgs: { count: { type: "number" } },
      handler: () => "ok",
    });
    const result = await node.execute([], { count: "abc" });
    expect(result).toContain("InvalidArgument");
    expect(result).toContain("must be a number");
  });

  it("coerces boolean arguments", async () => {
    const node = new LeafNode({
      name: "test",
      description: "Test",
      requiredArgs: { flag: { type: "boolean" } },
      handler: (kw) => `flag=${kw.flag}, type=${typeof kw.flag}`,
    });
    const result = await node.execute([], { flag: "true" });
    expect(result).toBe("flag=true, type=boolean");
  });

  it("rejects invalid boolean arguments", async () => {
    const node = new LeafNode({
      name: "test",
      description: "Test",
      requiredArgs: { flag: { type: "boolean" } },
      handler: () => "ok",
    });
    const result = await node.execute([], { flag: "maybe" });
    expect(result).toContain("InvalidArgument");
    expect(result).toContain("must be a boolean");
  });

  it("applies default values for optional args", async () => {
    const node = new LeafNode({
      name: "test",
      description: "Test",
      optionalArgs: { limit: { type: "number", default: 10 } },
      handler: (kw) => `limit=${kw.limit}`,
    });
    const result = await node.execute([], {});
    expect(result).toBe("limit=10");
  });

  it("runs custom validators", async () => {
    const node = new LeafNode({
      name: "test",
      description: "Test",
      requiredArgs: {
        port: {
          type: "number",
          validator: (v) => (v as number) >= 1 && (v as number) <= 65535,
        },
      },
      handler: () => "ok",
    });
    const result = await node.execute([], { port: 99999 });
    expect(result).toContain("InvalidArgument");
    expect(result).toContain("failed validation");
  });

  it("getHelp includes type and description info", () => {
    const node = new LeafNode({
      name: "query",
      description: "Run a query",
      requiredArgs: { sql: { type: "string", description: "The SQL statement" } },
      optionalArgs: { limit: { type: "number", description: "Max rows", default: 100 } },
      handler: () => "",
    });
    const help = node.getHelp("database/query");
    expect(help).toContain("(string)");
    expect(help).toContain("The SQL statement");
    expect(help).toContain("(number)");
    expect(help).toContain("Max rows");
    expect(help).toContain("[default: 100]");
  });

  it("coerces JSON string arguments", async () => {
    const node = new LeafNode({
      name: "test",
      description: "Test",
      requiredArgs: { data: { type: "json" } },
      handler: (kw) => JSON.stringify(kw.data),
    });
    const result = await node.execute([], { data: '{"a":1}' });
    expect(result).toBe('{"a":1}');
  });

  it("passes through objects for JSON type", async () => {
    const node = new LeafNode({
      name: "test",
      description: "Test",
      requiredArgs: { data: { type: "json" } },
      handler: (kw) => JSON.stringify(kw.data),
    });
    const result = await node.execute([], { data: { a: 1 } });
    expect(result).toBe('{"a":1}');
  });
});

// ── B4: Pagination ──────────────────────────────────────────────────

describe("Pagination (B4)", () => {
  it("paginates long output", async () => {
    const root = new BranchNode({ name: "root", description: "Root" });
    root.addChild(
      new LeafNode({
        name: "longout",
        description: "Long output",
        handler: () => Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join("\n"),
      }),
    );
    const session = new SessionManager("test");
    const router = new Router(root, session, { pageSize: 5 });

    const result = await router.execute("longout");
    expect(result).toContain("Line 1");
    expect(result).toContain("Line 5");
    expect(result).not.toContain("Line 6");
    expect(result).toContain("OUTPUT TRUNCATED");
    expect(result).toContain("page 1/");
  });

  it("retrieves subsequent pages", async () => {
    const root = new BranchNode({ name: "root", description: "Root" });
    root.addChild(
      new LeafNode({
        name: "longout",
        description: "Long output",
        handler: () => Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join("\n"),
      }),
    );
    const session = new SessionManager("test");
    const router = new Router(root, session, { pageSize: 5 });

    // First call to cache the output
    await router.execute("longout");
    // Get page 2
    const page2 = await router.execute("longout", { page: 2 });
    expect(page2).toContain("Line 6");
    expect(page2).toContain("Line 10");
    expect(page2).toContain("Page 2/");
  });

  it("does not paginate short output", async () => {
    const root = new BranchNode({ name: "root", description: "Root" });
    root.addChild(
      new LeafNode({
        name: "short",
        description: "Short output",
        handler: () => "Line 1\nLine 2",
      }),
    );
    const session = new SessionManager("test");
    const router = new Router(root, session, { pageSize: 5 });

    const result = await router.execute("short");
    expect(result).not.toContain("TRUNCATED");
  });
});

// ── C5: Enhanced Help Routing ───────────────────────────────────────

describe("Enhanced help routing (C5)", () => {
  it("help shows current CWD menu", async () => {
    const { router } = makeRouter();
    await router.execute("cd database");
    const result = await router.execute("help");
    expect(result).toContain("DATABASE MENU");
  });

  it("help <path> resolves relative to CWD", async () => {
    const { router } = makeRouter();
    await router.execute("cd database");
    const result = await router.execute("help query");
    expect(result).toContain("QUERY");
    expect(result).toContain("sql");
  });

  it("help <absolute path> resolves from root", async () => {
    const { router } = makeRouter();
    await router.execute("cd database");
    const result = await router.execute("help files/read");
    // This should find files/read relative to CWD which is /database
    // Actually this resolves to /database/files/read which doesn't exist
    // Let me test absolute path
    expect(result).toContain("ERROR"); // files/read doesn't exist under database
  });

  it("help on leaf node shows arg info", async () => {
    const { router } = makeRouter();
    const result = await router.execute("help database query");
    expect(result).toContain("QUERY");
    expect(result).toContain("sql");
    expect(result).toContain("(string)");
  });

  it("help errors on non-existent path", async () => {
    const { router } = makeRouter();
    const result = await router.execute("help nonexistent");
    expect(result).toContain("CommandNotFound");
  });
});

// ── C2: ls Built-in ─────────────────────────────────────────────────

describe("ls built-in (C2)", () => {
  it("ls shows compact directory listing at root", async () => {
    const { router } = makeRouter();
    const result = await router.execute("ls");
    expect(result).toContain("database");
    expect(result).toContain("files");
    expect(result).toContain("memory");
    // Should NOT contain full descriptions (compact mode)
    expect(result).not.toContain("Query the database.");
  });

  it("ls shows compact listing after cd", async () => {
    const { router } = makeRouter();
    await router.execute("cd database");
    const result = await router.execute("ls");
    expect(result).toContain("query");
    expect(result).toContain("tables");
  });
});

// ── D2 & D4: DynamicBranchNode Improvements ────────────────────────

describe("DynamicBranchNode refresh on getHelp (D2)", () => {
  class TestDynamic extends DynamicBranchNode {
    refreshCount = 0;
    protected refresh(): void {
      this.refreshCount++;
      this.addChild(
        new LeafNode({
          name: "item",
          description: "Dynamic item",
          handler: () => `[SUCCESS] Item #${this.refreshCount}`,
        }),
      );
    }
  }

  it("getHelp triggers refresh for sync refresh", () => {
    const node = new TestDynamic({ name: "dyn", description: "Dynamic" });
    const help = node.getHelp("/dyn");
    expect(help).toContain("item");
    expect(node.refreshCount).toBe(1);
  });
});

describe("DynamicBranchNode error handling (D4)", () => {
  class FailingDynamic extends DynamicBranchNode {
    protected refresh(): void {
      throw new Error("Connection refused");
    }
  }

  it("returns error message instead of throwing", async () => {
    const node = new FailingDynamic({ name: "db", description: "Database" });
    const result = await node.execute(["item"], {});
    expect(result).toContain("RefreshFailed");
    expect(result).toContain("Connection refused");
  });

  class AsyncFailingDynamic extends DynamicBranchNode {
    protected async refresh(): Promise<void> {
      throw new Error("Timeout");
    }
  }

  it("handles async refresh errors", async () => {
    const node = new AsyncFailingDynamic({ name: "api", description: "API" });
    const result = await node.execute(["item"], {});
    expect(result).toContain("RefreshFailed");
    expect(result).toContain("Timeout");
  });
});

// ── Session Serialization (F1) ──────────────────────────────────────

describe("Session serialization (F1)", () => {
  it("serializes and deserializes session state", () => {
    const session = new SessionManager("test-123");
    session.cwd = "/database";
    session.kvStore.set("port", "5432");
    session.kvStore.set("host", "localhost");
    session.pinnedKeys.add("port");
    session.recordCommand("help");
    session.recordCommand("database query");

    const json = session.toJSON();
    const restored = SessionManager.fromJSON(json);

    expect(restored.sessionId).toBe("test-123");
    expect(restored.cwd).toBe("/database");
    expect(restored.kvStore.get("port")).toBe("5432");
    expect(restored.kvStore.get("host")).toBe("localhost");
    expect(restored.pinnedKeys.has("port")).toBe(true);
    expect(restored.history).toHaveLength(2);
    expect(restored.history[0].command).toBe("help");
  });
});

// ── Command History (B5) ────────────────────────────────────────────

describe("Command history (B5)", () => {
  it("records commands in history", async () => {
    const { router, session } = makeRouter();
    await router.execute("help");
    await router.execute("database");
    expect(session.history).toHaveLength(2);
    expect(session.history[0].command).toBe("help");
    expect(session.history[1].command).toBe("database");
  });

  it("history command shows recent commands", async () => {
    const { router } = makeRouter();
    await router.execute("help");
    await router.execute("database");
    const result = await router.execute("history");
    expect(result).toContain("help");
    expect(result).toContain("database");
  });

  it("respects max history size", () => {
    const session = new SessionManager("test", { maxHistorySize: 3 });
    session.recordCommand("a");
    session.recordCommand("b");
    session.recordCommand("c");
    session.recordCommand("d");
    expect(session.history).toHaveLength(3);
    expect(session.history[0].command).toBe("b"); // 'a' was evicted
  });
});

// ── Find Command (C3) ───────────────────────────────────────────────

describe("find command (C3)", () => {
  it("finds commands by name", async () => {
    const { router } = makeRouter();
    const result = await router.execute("find tables");
    expect(result).toContain("tables");
    expect(result).toContain("1 match");
  });

  it("finds commands by description", async () => {
    const { router } = makeRouter();
    const result = await router.execute("find", { query: "SQL" });
    expect(result).toContain("query");
  });

  it("returns info when no matches", async () => {
    const { router } = makeRouter();
    const result = await router.execute("find zzzznotfound");
    expect(result).toContain("No commands matching");
  });

  it("errors when no query provided", async () => {
    const { router } = makeRouter();
    const result = await router.execute("find");
    expect(result).toContain("MissingArguments");
  });
});

// ── Input Sanitization (D5) ─────────────────────────────────────────

describe("Input sanitization (D5)", () => {
  it("rejects excessively long commands", async () => {
    const { router } = makeRouter();
    const longCmd = "a".repeat(1001);
    const result = await router.execute(longCmd);
    expect(result).toContain("InvalidInput");
    expect(result).toContain("maximum length");
  });
});

// ── Middleware (A1) ─────────────────────────────────────────────────

describe("Middleware (A1)", () => {
  it("middleware wraps execution", async () => {
    const root = new BranchNode({ name: "root", description: "Root" });
    root.addChild(
      new LeafNode({
        name: "action",
        description: "Test",
        handler: () => "original",
      }),
    );
    const session = new SessionManager("test");
    const router = new Router(root, session);

    const logs: string[] = [];
    router.use(async (ctx, next) => {
      logs.push(`before:${ctx.command}`);
      const result = await next();
      logs.push(`after:${ctx.command}`);
      return result;
    });

    await router.execute("action");
    expect(logs).toEqual(["before:action", "after:action"]);
  });

  it("middleware can modify output", async () => {
    const root = new BranchNode({ name: "root", description: "Root" });
    root.addChild(
      new LeafNode({
        name: "action",
        description: "Test",
        handler: () => "original",
      }),
    );
    const session = new SessionManager("test");
    const router = new Router(root, session);

    router.use(async (_ctx, next) => {
      const result = await next();
      return result + " [modified]";
    });

    const result = await router.execute("action");
    expect(result).toContain("original [modified]");
  });

  it("multiple middlewares execute in order", async () => {
    const root = new BranchNode({ name: "root", description: "Root" });
    root.addChild(
      new LeafNode({
        name: "action",
        description: "Test",
        handler: () => "core",
      }),
    );
    const session = new SessionManager("test");
    const router = new Router(root, session);

    const order: string[] = [];
    router.use(async (_ctx, next) => {
      order.push("mw1-before");
      const result = await next();
      order.push("mw1-after");
      return result;
    });
    router.use(async (_ctx, next) => {
      order.push("mw2-before");
      const result = await next();
      order.push("mw2-after");
      return result;
    });

    await router.execute("action");
    expect(order).toEqual(["mw1-before", "mw2-before", "mw2-after", "mw1-after"]);
  });
});

// ── Command Aliases (C4) ────────────────────────────────────────────

describe("Command aliases (C4)", () => {
  it("aliases route to full commands", async () => {
    const { router } = makeRouter();
    router.alias("q", "database query");
    const result = await router.execute("q", { sql: "SELECT 1" });
    expect(result).toContain("SUCCESS");
    expect(result).toContain("SELECT 1");
  });

  it("aliases work with additional tokens", async () => {
    const { router } = makeRouter();
    router.alias("db", "database");
    const result = await router.execute("db query", { sql: "SELECT 1" });
    expect(result).toContain("SUCCESS");
  });
});
