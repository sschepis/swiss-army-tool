# Examples

Two complete, self-contained example applications with inline commentary.

---

## Example 1: DevOps Toolkit

A system administration tool with process management, file operations, simulated cloud resources, middleware, aliases, and a full LLM conversation loop.

```ts
import {
  TreeBuilder,
  DynamicBranchNode,
  LeafNode,
  Router,
  SessionManager,
  createMemoryModule,
  generateToolSchema,
  table,
  lineNumbered,
  csv,
} from "swiss-army-tool";

// ── Simulated backends ──────────────────────────────────────────────

const processes = [
  { pid: 1001, name: "nginx", cpu: "2.1%", mem: "128MB", status: "running" },
  { pid: 1002, name: "postgres", cpu: "5.4%", mem: "512MB", status: "running" },
  { pid: 1003, name: "redis", cpu: "0.3%", mem: "64MB", status: "running" },
  { pid: 1004, name: "node-app", cpu: "12.8%", mem: "256MB", status: "running" },
  { pid: 1005, name: "cron-job", cpu: "0.0%", mem: "8MB", status: "sleeping" },
];

const files: Record<string, string> = {
  "/etc/nginx/nginx.conf": [
    "worker_processes auto;",
    "events { worker_connections 1024; }",
    "http {",
    "  server {",
    "    listen 80;",
    "    server_name example.com;",
    "    location / { proxy_pass http://localhost:3000; }",
    "  }",
    "}",
  ].join("\n"),
  "/var/log/app.log": Array.from(
    { length: 120 },
    (_, i) => `[2024-01-${String(i % 30 + 1).padStart(2, "0")}] Request processed in ${Math.floor(Math.random() * 200)}ms`,
  ).join("\n"),
};

const s3Buckets = ["prod-assets", "staging-assets", "backups-2024", "logs-archive"];

// ── Dynamic branch: S3 buckets ─────────────────────────────────────

class S3Module extends DynamicBranchNode {
  constructor() {
    super({ name: "s3", description: "S3 bucket operations.", ttlMs: 60000 });
  }

  protected refresh(): void {
    // In a real app, this would call the AWS SDK
    for (const bucket of s3Buckets) {
      this.addChild(
        new LeafNode({
          name: bucket,
          description: `List objects in '${bucket}'.`,
          optionalArgs: {
            prefix: { type: "string", description: "Filter by prefix" },
            limit: { type: "number", description: "Max results", default: 20 },
          },
          handler: (kw) => {
            const prefix = kw.prefix ? String(kw.prefix) : "";
            return `[SUCCESS] Objects in ${bucket} (prefix="${prefix}"):\n  data/file1.json\n  data/file2.csv\n  images/logo.png`;
          },
        }),
        { overwrite: true },
      );
    }
  }
}

// ── Build the command tree ──────────────────────────────────────────

const session = new SessionManager("devops-session");

const root = TreeBuilder.create("root", "DevOps toolkit for server management")

  // ── system/process/* ──
  .branch("system", "System administration.", sys => {
    sys.branch("process", "Process management.", proc => {

      proc.leaf("list", {
        description: "List running processes.",
        optionalArgs: {
          status: { type: "string", description: "Filter by status (running, sleeping)" },
        },
        handler: (kw) => {
          let filtered = processes;
          if (kw.status) {
            filtered = processes.filter(p => p.status === String(kw.status));
          }
          // Use the table formatter for clean LLM output
          return "[SUCCESS] Processes:\n" + table(
            ["PID", "Name", "CPU", "Memory", "Status"],
            filtered.map(p => [String(p.pid), p.name, p.cpu, p.mem, p.status]),
          );
        },
      });

      proc.leaf("kill", {
        description: "Kill a process by PID.",
        requiredArgs: {
          pid: {
            type: "number",
            description: "Process ID to kill",
            // Custom validator: PID must be a known process
            validator: (v) => processes.some(p => p.pid === v),
          },
        },
        optionalArgs: {
          force: { type: "boolean", description: "Force kill (SIGKILL)", default: false },
        },
        handler: (kw) => {
          const signal = kw.force ? "SIGKILL" : "SIGTERM";
          return `[SUCCESS] Sent ${signal} to PID ${kw.pid}.`;
        },
      });
    });

    // ── system/file/* ──
    sys.branch("file", "File operations.", file => {

      file.leaf("read", {
        description: "Read a file's contents with line numbers.",
        requiredArgs: {
          path: { type: "string", description: "Absolute file path" },
        },
        optionalArgs: {
          start: { type: "number", description: "Start line", default: 1 },
          end: { type: "number", description: "End line" },
        },
        handler: (kw) => {
          const content = files[String(kw.path)];
          if (!content) return `[ERROR: FileNotFound] '${kw.path}' does not exist.`;
          // Use lineNumbered formatter
          const numbered = lineNumbered(content, Number(kw.start) || 1);
          return `[SUCCESS] File: ${kw.path}\n${numbered}`;
        },
      });

      file.leaf("search", {
        description: "Search for a pattern across files.",
        requiredArgs: {
          pattern: { type: "string", description: "Text pattern to search for" },
        },
        handler: (kw) => {
          const pattern = String(kw.pattern).toLowerCase();
          const matches: string[][] = [];
          for (const [path, content] of Object.entries(files)) {
            content.split("\n").forEach((line, i) => {
              if (line.toLowerCase().includes(pattern)) {
                matches.push([path, String(i + 1), line.trim()]);
              }
            });
          }
          if (matches.length === 0) return `[INFO] No matches for '${kw.pattern}'.`;
          // Use CSV formatter (fewer tokens than JSON)
          return `[SUCCESS] Found ${matches.length} matches:\n` + csv(
            ["File", "Line", "Content"],
            matches.slice(0, 20),
          );
        },
      });
    });
  })

  // ── cloud/aws/s3/* (dynamic branch) ──
  .branch("cloud", "Cloud provider integrations.", cloud => {
    cloud.branch("aws", "Amazon Web Services.", aws => {
      // addBranch is not available on TreeBuilder's inner callback,
      // so we build this part manually below
    });
  })

  // ── memory module ──
  .addBranch(createMemoryModule(session))
  .build();

// Manually add the dynamic S3 module to cloud/aws
const cloudNode = root.children.get("cloud")! as import("swiss-army-tool").BranchNode;
const awsNode = cloudNode.children.get("aws")! as import("swiss-army-tool").BranchNode;
awsNode.addChild(new S3Module());

// ── Create the router with middleware ───────────────────────────────

const router = new Router(root, session, {
  pageSize: 30,  // Paginate after 30 lines
  debug: false,
});

// Logging middleware: records execution times
router.use(async (ctx, next) => {
  const start = Date.now();
  const result = await next();
  const ms = Date.now() - start;
  // Append timing to every response
  return `${result}\n[Executed in ${ms}ms]`;
});

// Command aliases for frequent paths
router.alias("proc", "system process");
router.alias("s3", "cloud aws s3");

// ── Generate the LLM tool schema ────────────────────────────────────

const schema = generateToolSchema({ root });
// The description now includes all top-level modules

// ── Simulated LLM Conversation ──────────────────────────────────────

async function simulateConversation() {
  console.log("=== DevOps Toolkit — Simulated LLM Session ===\n");

  // Turn 1: Discovery
  console.log("Turn 1: help");
  console.log(await router.execute("help"));
  console.log();

  // Turn 2: Quick listing
  console.log("Turn 2: ls");
  console.log(await router.execute("ls"));
  console.log();

  // Turn 3: Navigate to system
  console.log("Turn 3: system");
  console.log(await router.execute("system"));
  console.log();

  // Turn 4: List processes
  console.log("Turn 4: proc list (using alias)");
  console.log(await router.execute("proc list"));
  console.log();

  // Turn 5: Search for proxy config
  console.log("Turn 5: system file search");
  console.log(await router.execute("system file search", { pattern: "proxy_pass" }));
  console.log();

  // Turn 6: Read the nginx config
  console.log("Turn 6: system file read");
  console.log(await router.execute("system file read", { path: "/etc/nginx/nginx.conf" }));
  console.log();

  // Turn 7: Read a large log file (triggers pagination)
  console.log("Turn 7: system file read (large file, page 1)");
  console.log(await router.execute("system file read", { path: "/var/log/app.log" }));
  console.log();

  // Turn 8: Save a note
  console.log("Turn 8: memory set");
  console.log(await router.execute("memory set", {
    key: "nginx_config_path",
    value: "/etc/nginx/nginx.conf",
    tags: "config,nginx",
  }));
  console.log();

  // Turn 9: Pin it
  console.log("Turn 9: memory pin");
  console.log(await router.execute("memory pin", { key: "nginx_config_path" }));
  console.log();

  // Turn 10: Now all responses include pinned context
  console.log("Turn 10: cloud aws s3 (pinned context visible)");
  console.log(await router.execute("cloud aws s3"));
  console.log();

  // Turn 11: Use find to search for 'kill'
  console.log("Turn 11: find kill");
  console.log(await router.execute("find kill"));
  console.log();

  // Turn 12: Check command history
  console.log("Turn 12: history");
  console.log(await router.execute("history"));
}

simulateConversation().catch(console.error);
```

---

## Example 2: Database Explorer

A database exploration tool built with `TreeBuilder`, featuring dynamic table discovery, typed arguments, auth middleware, session persistence, and an enriched schema.

```ts
import {
  TreeBuilder,
  DynamicBranchNode,
  LeafNode,
  BranchNode,
  Router,
  SessionManager,
  createMemoryModule,
  generateToolSchema,
  table,
  csv,
  prettyJson,
} from "swiss-army-tool";

// ── Simulated database ──────────────────────────────────────────────

const DB_TABLES: Record<string, { columns: string[]; rows: string[][] }> = {
  users: {
    columns: ["id", "name", "email", "role", "created_at"],
    rows: [
      ["1", "Alice", "alice@example.com", "admin", "2024-01-15"],
      ["2", "Bob", "bob@example.com", "user", "2024-02-20"],
      ["3", "Carol", "carol@example.com", "user", "2024-03-10"],
      ["4", "Dave", "dave@example.com", "moderator", "2024-04-05"],
    ],
  },
  orders: {
    columns: ["id", "user_id", "product", "amount", "status"],
    rows: [
      ["101", "1", "Widget Pro", "$49.99", "shipped"],
      ["102", "2", "Gadget X", "$29.99", "processing"],
      ["103", "1", "Widget Pro", "$49.99", "delivered"],
      ["104", "3", "Thingamajig", "$19.99", "cancelled"],
      ["105", "4", "Widget Lite", "$9.99", "shipped"],
    ],
  },
  products: {
    columns: ["id", "name", "price", "category", "stock"],
    rows: [
      ["1", "Widget Pro", "$49.99", "widgets", "142"],
      ["2", "Widget Lite", "$9.99", "widgets", "580"],
      ["3", "Gadget X", "$29.99", "gadgets", "73"],
      ["4", "Thingamajig", "$19.99", "misc", "12"],
    ],
  },
};

// ── Dynamic branch: auto-discovers tables ───────────────────────────

class TableDiscoveryModule extends DynamicBranchNode {
  constructor() {
    super({
      name: "tables",
      description: "Browse live database tables. Auto-discovered from the schema.",
      ttlMs: 30000,
    });
  }

  protected refresh(): void {
    for (const tableName of Object.keys(DB_TABLES)) {
      const tbl = DB_TABLES[tableName];

      // Each table gets its own sub-menu with schema/query/insert actions
      const tableBranch = new BranchNode({
        name: tableName,
        description: `Actions for the '${tableName}' table (${tbl.rows.length} rows).`,
      });

      // schema action
      tableBranch.addChild(
        new LeafNode({
          name: "schema",
          description: `View columns and types for '${tableName}'.`,
          handler: () => {
            const cols = tbl.columns.map(c => `  - ${c}`).join("\n");
            return `[SUCCESS] Schema for '${tableName}':\n${cols}`;
          },
        }),
      );

      // query action
      tableBranch.addChild(
        new LeafNode({
          name: "query",
          description: `Run a SELECT on '${tableName}'.`,
          requiredArgs: {
            sql: { type: "string", description: "SQL SELECT statement" },
          },
          optionalArgs: {
            limit: { type: "number", description: "Max rows to return", default: 100 },
            format: {
              type: "string",
              description: "Output format: table, csv, or json",
              default: "table",
              validator: (v) => ["table", "csv", "json"].includes(v as string),
            },
          },
          timeoutMs: 10000,
          handler: (kw) => {
            const limit = Number(kw.limit);
            const rows = tbl.rows.slice(0, limit);
            const fmt = String(kw.format);

            let output: string;
            if (fmt === "csv") {
              output = csv(tbl.columns, rows);
            } else if (fmt === "json") {
              const objs = rows.map(row =>
                Object.fromEntries(tbl.columns.map((c, i) => [c, row[i]])),
              );
              output = prettyJson(objs);
            } else {
              output = table(tbl.columns, rows);
            }

            return `[SUCCESS] Query on '${tableName}' (${rows.length} rows):\n${output}`;
          },
        }),
      );

      // insert action
      tableBranch.addChild(
        new LeafNode({
          name: "insert",
          description: `Insert a row into '${tableName}'.`,
          requiredArgs: {
            data: { type: "json", description: "Row data as JSON object" },
          },
          handler: (kw) => {
            const data = kw.data as Record<string, unknown>;
            const row = tbl.columns.map(c => String(data[c] ?? ""));
            tbl.rows.push(row);
            return `[SUCCESS] Inserted row into '${tableName}'. New row count: ${tbl.rows.length}.`;
          },
        }),
      );

      this.addChild(tableBranch, { overwrite: true });
    }
  }
}

// ── Build the command tree ──────────────────────────────────────────

const session = new SessionManager("db-explorer");

const root = TreeBuilder.create("root", "Database explorer — browse and query your database")

  .branch("database", "Database operations.", db => {
    db.leaf("stats", {
      description: "Show database statistics.",
      handler: () => {
        const tableCount = Object.keys(DB_TABLES).length;
        const totalRows = Object.values(DB_TABLES).reduce((sum, t) => sum + t.rows.length, 0);
        return `[SUCCESS] Database stats:\n  Tables: ${tableCount}\n  Total rows: ${totalRows}`;
      },
    });
    // The dynamic tables module will be added below
  })

  .addBranch(createMemoryModule(session))
  .build();

// Add the dynamic tables module
const dbNode = root.children.get("database")! as BranchNode;
dbNode.addChild(new TableDiscoveryModule());

// ── Router with auth middleware ──────────────────────────────────────

const router = new Router(root, session, { pageSize: 40 });

// Auth middleware: requires auth_token for write operations
router.use(async (ctx, next) => {
  const writeCommands = ["insert", "delete"];
  const lastToken = ctx.resolvedPath.split("/").pop();

  if (writeCommands.includes(lastToken ?? "") && ctx.kwargs.auth_token !== "secret123") {
    return "[ERROR: Unauthorized] Write operations require kwargs={auth_token: \"...\"}";
  }
  return next();
});

// ── Generate enriched schema ────────────────────────────────────────

const toolSchema = generateToolSchema({
  root,
  name: "db_explorer",
  description: "Explore and query the application database. Start with 'help'.",
});

console.log("Tool schema for LLM:", JSON.stringify(toolSchema, null, 2));

// ── Simulated LLM Conversation ──────────────────────────────────────

async function simulateConversation() {
  console.log("\n=== Database Explorer — Simulated LLM Session ===\n");

  // Turn 1: Discovery
  console.log("Turn 1: help");
  console.log(await router.execute("help"));
  console.log();

  // Turn 2: Check database stats
  console.log("Turn 2: database stats");
  console.log(await router.execute("database stats"));
  console.log();

  // Turn 3: Explore tables (triggers dynamic refresh)
  console.log("Turn 3: database tables");
  console.log(await router.execute("database tables"));
  console.log();

  // Turn 4: Inspect the users table schema
  console.log("Turn 4: database tables users schema");
  console.log(await router.execute("database tables users schema"));
  console.log();

  // Turn 5: Query users as a formatted table
  console.log("Turn 5: database tables users query (table format)");
  console.log(await router.execute("database tables users query", {
    sql: "SELECT * FROM users",
  }));
  console.log();

  // Turn 6: Query orders as CSV (fewer tokens)
  console.log("Turn 6: database tables orders query (csv format)");
  console.log(await router.execute("database tables orders query", {
    sql: "SELECT * FROM orders",
    format: "csv",
  }));
  console.log();

  // Turn 7: Query products as JSON
  console.log("Turn 7: database tables products query (json format)");
  console.log(await router.execute("database tables products query", {
    sql: "SELECT * FROM products",
    format: "json",
    limit: 2,
  }));
  console.log();

  // Turn 8: Try insert without auth (rejected by middleware)
  console.log("Turn 8: insert without auth (rejected)");
  console.log(await router.execute("database tables users insert", {
    data: { id: "5", name: "Eve", email: "eve@example.com", role: "user", created_at: "2024-05-01" },
  }));
  console.log();

  // Turn 9: Insert with auth
  console.log("Turn 9: insert with auth (success)");
  console.log(await router.execute("database tables users insert", {
    data: { id: "5", name: "Eve", email: "eve@example.com", role: "user", created_at: "2024-05-01" },
    auth_token: "secret123",
  }));
  console.log();

  // Turn 10: Save discovery to memory
  console.log("Turn 10: memory set");
  console.log(await router.execute("memory set", {
    key: "user_count",
    value: "5 users in the database",
    tags: "stats,users",
  }));
  console.log();

  // Turn 11: Pin it
  console.log("Turn 11: memory pin");
  console.log(await router.execute("memory pin", { key: "user_count" }));
  console.log();

  // Turn 12: Verify pinned context appears in subsequent calls
  console.log("Turn 12: database stats (pinned context visible)");
  console.log(await router.execute("database stats"));
  console.log();

  // Turn 13: Use find to search for 'schema'
  console.log("Turn 13: find schema");
  console.log(await router.execute("find schema"));
  console.log();

  // Turn 14: Use cd + relative paths
  console.log("Turn 14: cd database/tables/users");
  console.log(await router.execute("cd database/tables/users"));
  console.log();

  console.log("Turn 15: query (relative, from /database/tables/users)");
  console.log(await router.execute("query", { sql: "SELECT * FROM users WHERE role='admin'" }));
  console.log();

  // Turn 16: Serialize the session for persistence
  const serialized = session.toJSON();
  console.log("Turn 16: Session serialized");
  console.log(`  Keys stored: ${Object.keys(serialized.kvStore as object).length}`);
  console.log(`  History entries: ${(serialized.history as unknown[]).length}`);
  console.log(`  CWD: ${serialized.cwd}`);
  console.log();

  // Restore and verify
  const restored = SessionManager.fromJSON(serialized);
  console.log(`  Restored session ID: ${restored.sessionId}`);
  console.log(`  Restored CWD: ${restored.cwd}`);
  console.log(`  Restored pinned keys: ${[...restored.pinnedKeys].join(", ")}`);
}

simulateConversation().catch(console.error);
```

---

## Running the Examples

These examples import from `"swiss-army-tool"`. To run them locally against the source:

1. Build the project: `npm run build`
2. Save the example to a file (e.g., `examples/devops.ts`)
3. Run with a TypeScript runner:
   ```bash
   npx tsx examples/devops.ts
   ```

Or change the imports to relative paths:

```ts
import { TreeBuilder, Router, ... } from "../src/index.js";
```
