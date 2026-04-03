# swiss-army-tool

A TypeScript framework that exposes a single "Omni-Tool" interface to LLMs, replacing dozens of individual tool definitions with one hierarchical, CLI-like command tree. The LLM navigates menus, discovers capabilities, and executes actions — all through a single JSON function call.

## Why?

Giving an LLM 20+ tools upfront creates schema bloat and decision paralysis. This framework reduces the surface area to **one tool**, forcing the LLM into a chain-of-thought exploration loop that yields more stable reasoning. The LLM discovers what it can do by navigating a filesystem-like hierarchy — just like a developer using a CLI.

## Install

```bash
npm install @sschepis/swiss-army-tool
```

## Quick Start

```ts
import {
  BranchNode,
  LeafNode,
  Router,
  SessionManager,
  createMemoryModule,
  generateToolSchema,
} from "@sschepis/swiss-army-tool";

// 1. Build your command tree
const root = new BranchNode({ name: "root", description: "Main system" });

const db = new BranchNode({ name: "database", description: "Query the database." });
db.addChild(
  new LeafNode({
    name: "query",
    description: "Run a SQL query.",
    requiredArgs: ["sql"],
    handler: async (kwargs) => {
      const results = await runQuery(String(kwargs.sql));
      return `[SUCCESS] ${JSON.stringify(results)}`;
    },
  })
);
root.addChild(db);

// 2. Add the built-in memory module
const session = new SessionManager();
root.addChild(createMemoryModule(session));

// 3. Create the router
const router = new Router(root, session);

// 4. Generate the tool schema for your LLM
const schema = generateToolSchema();
// Pass `schema` as the single tool definition to your LLM API

// 5. In your LLM loop, route tool calls through the router
const result = await router.execute("database query", { sql: "SELECT * FROM users" });
```

## How the LLM Experiences It

**Turn 1 — Discovery:**
```
LLM calls: terminal_interface(command="help")
→ === ROOT MENU ===
  Available Options:
    📁 database        : Query the database.
    📁 memory          : Persistent scratchpad.
```

**Turn 2 — Exploration:**
```
LLM calls: terminal_interface(command="database")
→ === DATABASE MENU ===
  Available Options:
    ⚡ query           : Run a SQL query.
```

**Turn 3 — Error recovery:**
```
LLM calls: terminal_interface(command="database query")
→ [ERROR: MissingArguments] You are missing required arguments: sql.
  Tip: Type 'help database query' for usage instructions.
```

**Turn 4 — Success:**
```
LLM calls: terminal_interface(command="database query", kwargs={sql: "SELECT * FROM users"})
→ [SUCCESS] [{"id": 1, "name": "Alice"}]
```

## Core Concepts

### Node Types

| Type | Purpose |
|------|---------|
| `BranchNode` | Menu/directory — routes to children, generates formatted menus |
| `LeafNode` | Executable action — validates args, runs your handler |
| `DynamicBranchNode` | Lazy-loading branch — auto-refreshes children from live data sources (databases, APIs, etc.) with TTL caching |

### Router

The `Router` is the main entry point. It resolves commands against the current working directory, handles built-in commands, and wraps all output with contextual breadcrumbs.

**Built-in commands:**
- `help` — show the root menu
- `cd <path>` — change working directory (saves tokens on repeated commands)
- `pwd` — print current directory
- `tree` — show the full command hierarchy

**Path resolution** works like a POSIX filesystem:
- Absolute: `command="database query"`
- Relative (after `cd database`): `command="query"`
- Parent: `command="../memory set"`
- Slash-separated: `command="database/query"`

### Session Manager

Tracks per-session state:
- **CWD** — current working directory for relative path resolution
- **KV Store** — key-value scratchpad the LLM can read/write via the memory module
- **Pinned Keys** — values automatically injected into every response

### Memory Module

A pre-built `BranchNode` with five actions:

| Action | Description |
|--------|-------------|
| `memory set` | Store a key-value pair (`kwargs: {key, value}`) |
| `memory get` | Retrieve a value (`kwargs: {key}`) |
| `memory list` | List all stored keys |
| `memory pin` | Pin a key so its value appears in every response |
| `memory unpin` | Remove a pin |

Pinned memories are automatically prepended to all router output, keeping critical context visible even as the conversation grows.

### Dynamic Branches

For modules that reflect live external state (databases, cloud resources, APIs), extend `DynamicBranchNode`:

```ts
class TablesModule extends DynamicBranchNode {
  constructor(private db: Database) {
    super({ name: "tables", description: "Live database tables.", ttlMs: 30000 });
  }

  protected async refresh() {
    const tables = await this.db.listTables();
    for (const t of tables) {
      this.addChild(new LeafNode({
        name: t,
        description: `Query the '${t}' table.`,
        requiredArgs: ["sql"],
        handler: (kw) => this.db.query(String(kw.sql)),
      }));
    }
  }
}
```

Children are populated lazily on first access and cached for the configured TTL. Call `invalidate()` to force a refresh.

### Formatting Helpers

```ts
import { table, lineNumbered, truncate } from "@sschepis/swiss-army-tool";

// Markdown table
table(["Name", "Role"], [["Alice", "admin"], ["Bob", "user"]]);

// Line-numbered text (for file contents)
lineNumbered("function hello() {\n  return 'world';\n}", 41);
// 41 | function hello() {
// 42 |   return 'world';
// 43 | }

// Truncate long output with pagination hint
truncate(longText, 50);
// ... first 50 lines ...
// [OUTPUT TRUNCATED] 450 more lines. Pass kwargs={page: 2} to view more.
```

### Schema Generator

```ts
import { generateToolSchema } from "@sschepis/swiss-army-tool";

// Default schema
const schema = generateToolSchema();
// { name: "terminal_interface", description: "...", parameters: { ... } }

// Custom name/description
const custom = generateToolSchema({
  name: "my_tool",
  description: "Custom description for the LLM.",
});
```

## API Reference

### Classes

- **`BranchNode(config: { name, description })`** — Menu node. Use `.addChild(node)` and `.removeChild(name)`.
- **`LeafNode(config: { name, description, requiredArgs?, optionalArgs?, handler })`** — Action node. Handler receives `kwargs` and returns a string (sync or async).
- **`DynamicBranchNode(config: { name, description, ttlMs? })`** — Abstract. Override `protected refresh()` to populate children. Call `.invalidate()` to bust the cache.
- **`Router(root, session)`** — Call `.execute(command, kwargs?)` to dispatch.
- **`SessionManager(sessionId?)`** — Tracks CWD, KV store, pinned keys.

### Functions

- **`createMemoryModule(session)`** — Returns a `BranchNode` wired to the session's KV store.
- **`generateToolSchema(options?)`** — Returns the Omni-Tool JSON schema object.
- **`table(headers, rows)`** — Format as Markdown table.
- **`lineNumbered(text, startLine?)`** — Add line numbers.
- **`truncate(text, maxLines, hint?)`** — Truncate with pagination hint.

## License

MIT
