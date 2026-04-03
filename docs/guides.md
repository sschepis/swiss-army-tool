# Guides

Task-oriented how-to guides for common `swiss-army-tool` workflows.

---

## 1. Building a Command Tree

### Manual approach (BranchNode + LeafNode)

Build the tree bottom-up by creating nodes and adding them as children:

```ts
import { BranchNode, LeafNode, Router, SessionManager } from "swiss-army-tool";

const root = new BranchNode({ name: "root", description: "Main system" });

const db = new BranchNode({ name: "database", description: "Database operations" });
db.addChild(new LeafNode({
  name: "query",
  description: "Run a SQL query.",
  requiredArgs: ["sql"],
  handler: async (kwargs) => {
    const result = await myDb.query(String(kwargs.sql));
    return `[SUCCESS] ${JSON.stringify(result)}`;
  },
}));
db.addChild(new LeafNode({
  name: "tables",
  description: "List all tables.",
  handler: async () => {
    const tables = await myDb.listTables();
    return `[SUCCESS] ${tables.join(", ")}`;
  },
}));
root.addChild(db);

const session = new SessionManager();
const router = new Router(root, session);
```

### Fluent approach (TreeBuilder)

Use `TreeBuilder` for less boilerplate:

```ts
import { TreeBuilder, Router, SessionManager, createMemoryModule } from "swiss-army-tool";

const session = new SessionManager();

const root = TreeBuilder.create("root", "Main system")
  .branch("database", "Database operations", db => {
    db.leaf("query", {
      description: "Run a SQL query.",
      requiredArgs: ["sql"],
      handler: async (kwargs) => `[SUCCESS] ${await myDb.query(String(kwargs.sql))}`,
    });
    db.leaf("tables", {
      description: "List all tables.",
      handler: async () => `[SUCCESS] ${(await myDb.listTables()).join(", ")}`,
    });
  })
  .addBranch(createMemoryModule(session))  // Add pre-built modules
  .build();

const router = new Router(root, session);
```

**When to use which:** `TreeBuilder` is cleaner for static trees. Use the manual approach when you need dynamic construction or conditional child registration.

---

## 2. Typed Arguments

Arguments can be simple string arrays or rich descriptors with types, descriptions, defaults, and validators.

### Simple args (string array)

```ts
new LeafNode({
  name: "query",
  requiredArgs: ["sql"],
  optionalArgs: ["limit"],
  handler: (kwargs) => { /* kwargs.sql and kwargs.limit are unknown */ },
});
```

### Rich args (ArgDescriptor)

```ts
new LeafNode({
  name: "query",
  description: "Run a SQL query.",
  requiredArgs: {
    sql: { type: "string", description: "The SQL statement to execute" },
  },
  optionalArgs: {
    limit: { type: "number", description: "Max rows to return", default: 100 },
    verbose: { type: "boolean", description: "Show execution plan" },
    filter: { type: "json", description: "JSON filter object" },
  },
  handler: (kwargs) => {
    // kwargs.sql is coerced to string
    // kwargs.limit is coerced to number (default 100 if not provided)
    // kwargs.verbose is coerced to boolean
    // kwargs.filter is parsed from JSON string if needed
  },
});
```

### Supported types

| Type | Coercion | Accepts |
|------|----------|---------|
| `"string"` | `String(value)` | Anything |
| `"number"` | `Number(value)` | Numbers, numeric strings. Rejects `NaN`. |
| `"boolean"` | Direct or string | `true`/`false`, `"true"`/`"false"`, `"1"`/`"0"` |
| `"json"` | `JSON.parse` if string | Objects pass through; strings are parsed |

### Custom validators

```ts
requiredArgs: {
  port: {
    type: "number",
    validator: (v) => (v as number) >= 1 && (v as number) <= 65535,
  },
}
```

If the validator returns `false`: `[ERROR: InvalidArgument] Argument 'port' failed validation.`

### Auto-generated help

Typed args automatically produce richer help output:

```
=== QUERY ===
Run a SQL query.

Required arguments:
  - sql (string) - The SQL statement to execute

Optional arguments:
  - limit (number) - Max rows to return [default: 100]
  - verbose (boolean) - Show execution plan

Usage: command="database/query", kwargs={...}
```

---

## 3. Middleware

Middleware wraps command execution with cross-cutting logic. It follows the onion model.

### Basic middleware

```ts
router.use(async (ctx, next) => {
  console.log(`→ ${ctx.command}`);
  const result = await next();
  console.log(`← ${ctx.command} (${result.length} chars)`);
  return result;
});
```

### Timing middleware

```ts
router.use(async (ctx, next) => {
  const start = Date.now();
  const result = await next();
  const ms = Date.now() - start;
  return `${result}\n[Executed in ${ms}ms]`;
});
```

### Auth middleware

```ts
router.use(async (ctx, next) => {
  if (!ctx.kwargs.auth_token) {
    return "[ERROR: Unauthorized] Provide auth_token in kwargs.";
  }
  return next();
});
```

### Middleware ordering

Middleware runs in registration order (first = outermost):

```ts
router.use(mw1);  // Runs first (before) and last (after)
router.use(mw2);  // Runs second (before) and second-to-last (after)
```

Execution: `mw1-before → mw2-before → handler → mw2-after → mw1-after`

### Important: Built-ins bypass middleware

`cd`, `pwd`, `help`, `ls`, `tree`, `find`, and `history` are handled before middleware runs. Only tree-routed commands pass through the middleware chain.

---

## 4. Memory & Tags

The memory module gives the LLM a persistent scratchpad.

### Store with tags

```ts
await router.execute("memory set", {
  key: "db_host",
  value: "prod-db.example.com",
  tags: "config,database",
});
```

### Retrieve

```ts
await router.execute("memory get", { key: "db_host" });
// [SUCCESS] db_host = prod-db.example.com [tags: config, database]
```

### List by tag

```ts
await router.execute("memory list", { tag: "database" });
// Only keys tagged with "database" are shown
```

### Search across keys and values

```ts
await router.execute("memory search", { query: "prod", limit: 5 });
// Matches keys or values containing "prod"
```

### Pin for context injection

```ts
await router.execute("memory pin", { key: "db_host" });
// Now every response includes:
// [PINNED MEMORY - db_host]: prod-db.example.com
```

### Manage tags separately

```ts
await router.execute("memory tag", { key: "db_host", tags: "config,production,critical" });
```

### Delete

```ts
await router.execute("memory delete", { key: "db_host" });
// Also unpins and removes tags
```

---

## 5. Dynamic Branches

Use `DynamicBranchNode` when children depend on external state.

### Basic implementation

```ts
import { DynamicBranchNode, LeafNode } from "swiss-army-tool";

class TablesModule extends DynamicBranchNode {
  constructor(private db: Database) {
    super({
      name: "tables",
      description: "Live database tables.",
      ttlMs: 30000,  // Refresh every 30s
    });
  }

  protected async refresh() {
    const tables = await this.db.listTables();
    for (const name of tables) {
      this.addChild(
        new LeafNode({
          name,
          description: `Query the '${name}' table.`,
          requiredArgs: { sql: { type: "string" } },
          handler: (kw) => this.db.query(String(kw.sql)),
        }),
        { overwrite: true },  // Required since refresh clears and re-adds
      );
    }
  }
}
```

Note: `addChild` is called with `{ overwrite: true }` because `refresh()` runs after `children.clear()`, but if your TTL overlaps you may hit collisions.

### Error handling

If `refresh()` throws, the error is caught:

```
[ERROR: RefreshFailed] Failed to refresh 'tables': Connection refused
Tip: Type 'help tables' for usage instructions.
```

### Force refresh

```ts
tablesModule.invalidate();
// Next execute() or getHelp() will re-run refresh()
```

---

## 6. Session Persistence

### Save

```ts
const json = session.toJSON();
// Store `json` in your database, file, or cache
await redis.set(`session:${session.sessionId}`, JSON.stringify(json));
```

### Restore

```ts
const data = JSON.parse(await redis.get(`session:${sessionId}`));
const session = SessionManager.fromJSON(data);
const router = new Router(root, session);
```

### What gets serialized

- `sessionId`, `cwd`
- `kvStore` (all key-value pairs)
- `pinnedKeys`
- `kvTags` (all tag sets)
- `history` (all entries with timestamps)

The pagination cache is **not** serialized (it's transient).

---

## 7. Command Aliases

Aliases map a shortcut to a full command path:

```ts
router.alias("q", "database query");
router.alias("mem", "memory");
router.alias("proc", "system process");
```

Usage:

```ts
await router.execute("q", { sql: "SELECT 1" });
// Equivalent to: router.execute("database query", { sql: "SELECT 1" })

await router.execute("mem set", { key: "x", value: "y" });
// Equivalent to: router.execute("memory set", { key: "x", value: "y" })
```

Aliases are resolved before built-in dispatch, so you can alias built-in names (though this is not recommended).

---

## 8. Pagination

### How it works

When a command returns more than `pageSize` lines (default 50), the router:

1. Caches the full output in the session
2. Returns the first page with a hint:
   ```
   [OUTPUT TRUNCATED] 450 more lines (page 1/10). Pass kwargs={page: 2} to view more.
   ```

### Retrieving pages

The LLM re-executes the same command with `page`:

```ts
await router.execute("database query", { sql: "SELECT * FROM users", page: 2 });
// Returns lines 51-100
```

### Custom page size

```ts
const router = new Router(root, session, { pageSize: 25 });
```

---

## 9. Testing Your Commands

### Quick setup

```ts
import { createTestRouter, mockLeafNode, assertSuccess, assertError } from "swiss-army-tool";
import { BranchNode } from "swiss-army-tool";

const root = new BranchNode({ name: "root", description: "Root" });
root.addChild(mockLeafNode("ping", "[SUCCESS] pong"));

const { router, session } = createTestRouter(root);
```

### Assertions

```ts
const result = await router.execute("ping");
assertSuccess(result);  // Passes

const bad = await router.execute("nonexistent");
assertError(bad, "CommandNotFound");  // Passes
```

### Batch execution

```ts
import { executeSequence } from "swiss-army-tool";

const results = await executeSequence(router, [
  { command: "memory set", kwargs: { key: "x", value: "1" } },
  { command: "memory get", kwargs: { key: "x" } },
  { command: "memory delete", kwargs: { key: "x" } },
]);
assertSuccess(results[0]);
assertSuccess(results[1]);
assertSuccess(results[2]);
```

---

## 10. Debug Mode

Enable debug logging to trace command resolution:

```ts
const router = new Router(root, session, {
  debug: true,
  logger: (msg) => console.log(msg),  // Or your logging framework
});
```

Debug output includes:
- Command received and kwargs
- Resolved path and tokens
- Execution time

```
[swiss-army-tool] execute: command="database query", kwargs={"sql":"SELECT 1"}
[swiss-army-tool] resolved: "database query" -> "/database/query" (tokens: [database, query])
[swiss-army-tool] completed in 12ms
```

---

## 11. Schema Generation

### Default

```ts
import { generateToolSchema } from "swiss-army-tool";

const schema = generateToolSchema();
// { name: "terminal_interface", description: "Your central interface...", parameters: { ... } }
```

### Tree-introspected

Pass your root node to auto-include module names in the description:

```ts
const schema = generateToolSchema({ root });
// description includes:
// "Available top-level modules: database (Database operations), memory (Persistent scratchpad)."
// "Built-in commands: help, cd, pwd, ls, tree, find, history."
```

### Custom name and description

```ts
const schema = generateToolSchema({
  name: "my_assistant_tool",
  description: "Use this tool to interact with the deployment system.",
});
```
