import { describe, it, expect } from "vitest";
import { Router } from "../src/router.js";
import { BranchNode } from "../src/nodes/branch-node.js";
import { LeafNode } from "../src/nodes/leaf-node.js";
import { SessionManager } from "../src/session.js";
import { createMemoryModule } from "../src/memory.js";
import { generateToolSchema } from "../src/schema.js";
import { table, lineNumbered, truncate } from "../src/formatter.js";

describe("Integration: LLM interaction loop", () => {
  function buildSystem() {
    const session = new SessionManager("integration-test");
    const root = new BranchNode({ name: "root", description: "Main system" });

    // Database module
    const db = new BranchNode({ name: "database", description: "Query the user database." });
    db.addChild(
      new LeafNode({
        name: "query",
        description: "Run a SQL query.",
        requiredArgs: ["sql"],
        handler: (kw) => {
          const sql = String(kw.sql);
          if (sql.includes("users")) {
            return '[SUCCESS] Query executed.\nResults:\n[{"id": 1, "name": "Alice", "role": "admin"}]';
          }
          return "[SUCCESS] No results.";
        },
      }),
    );
    db.addChild(
      new LeafNode({
        name: "list_tables",
        description: "View available tables.",
        handler: () => "[SUCCESS] Tables: users, orders, products",
      }),
    );
    root.addChild(db);

    // Memory module
    root.addChild(createMemoryModule(session));

    const router = new Router(root, session);
    return { router, session };
  }

  it("Turn 1: Discovery — help shows main menu", async () => {
    const { router } = buildSystem();
    const result = await router.execute("help");
    expect(result).toContain("database");
    expect(result).toContain("memory");
  });

  it("Turn 2: Exploration — navigating to database shows sub-menu", async () => {
    const { router } = buildSystem();
    const result = await router.execute("database");
    expect(result).toContain("DATABASE MENU");
    expect(result).toContain("query");
    expect(result).toContain("list_tables");
  });

  it("Turn 3: Missing args — proper error and hint", async () => {
    const { router } = buildSystem();
    const result = await router.execute("database query");
    expect(result).toContain("MissingArguments");
    expect(result).toContain("sql");
  });

  it("Turn 4: Successful execution", async () => {
    const { router } = buildSystem();
    const result = await router.execute("database query", {
      sql: "SELECT * FROM users LIMIT 1",
    });
    expect(result).toContain("SUCCESS");
    expect(result).toContain("Alice");
  });

  it("Memory workflow: set, pin, verify pinned context", async () => {
    const { router, session } = buildSystem();

    // Set a memory
    const setResult = await router.execute("memory set", {
      key: "db_port",
      value: "5432",
    });
    expect(setResult).toContain("SUCCESS");

    // Pin it
    const pinResult = await router.execute("memory pin", { key: "db_port" });
    expect(pinResult).toContain("SUCCESS");

    // Verify pinned context appears in subsequent responses
    const helpResult = await router.execute("help");
    expect(helpResult).toContain("PINNED MEMORY");
    expect(helpResult).toContain("5432");
  });

  it("CWD workflow: cd + relative commands", async () => {
    const { router } = buildSystem();

    await router.execute("cd database");
    const result = await router.execute("list_tables");
    expect(result).toContain("Tables");
  });
});

describe("Schema generator", () => {
  it("generates default schema", () => {
    const schema = generateToolSchema();
    expect(schema.name).toBe("terminal_interface");
    expect(schema.parameters.required).toContain("command");
  });

  it("accepts custom name and description", () => {
    const schema = generateToolSchema({
      name: "my_tool",
      description: "Custom tool",
    });
    expect(schema.name).toBe("my_tool");
    expect(schema.description).toBe("Custom tool");
  });
});

describe("Formatter", () => {
  it("table formats correctly", () => {
    const result = table(["Name", "Age"], [["Alice", "30"], ["Bob", "25"]]);
    expect(result).toContain("Name");
    expect(result).toContain("Alice");
    expect(result).toContain("---");
  });

  it("lineNumbered adds line numbers", () => {
    const result = lineNumbered("hello\nworld", 41);
    expect(result).toContain("41 | hello");
    expect(result).toContain("42 | world");
  });

  it("truncate limits output", () => {
    const text = Array.from({ length: 100 }, (_, i) => `Line ${i}`).join("\n");
    const result = truncate(text, 5);
    expect(result.split("\n").length).toBe(6); // 5 lines + truncation message
    expect(result).toContain("TRUNCATED");
  });

  it("truncate returns full text when under limit", () => {
    const result = truncate("short text", 100);
    expect(result).toBe("short text");
  });
});
