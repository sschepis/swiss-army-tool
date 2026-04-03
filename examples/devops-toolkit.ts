/**
 * DevOps Toolkit — swiss-army-tool Example
 *
 * A server management multi-tool for an LLM DevOps assistant.
 *
 * Demonstrates:
 *   - Manual tree construction (BranchNode / LeafNode)
 *   - DynamicBranchNode with sync refresh (simulated S3 buckets)
 *   - Formatters: table(), lineNumbered(), csv()
 *   - Automatic pagination on large output
 *   - Logging middleware (appends execution time)
 *   - Command aliases
 *   - Memory module with tags and pinning
 *   - Built-in commands: help, ls, find, tree, cd, history
 *   - Fuzzy suggestion on typo
 *   - 15-turn simulated LLM conversation
 *
 * Run:
 *   npx tsx examples/devops-toolkit.ts
 */

import {
  BranchNode,
  LeafNode,
  DynamicBranchNode,
  Router,
  SessionManager,
  createMemoryModule,
  generateToolSchema,
  table,
  lineNumbered,
  csv,
} from "../src/index.js";

// ── Simulated Backends ──────────────────────────────────────────────

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
    { length: 80 },
    (_, i) =>
      `[2024-01-${String((i % 30) + 1).padStart(2, "0")} ${String(8 + (i % 14)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}] ` +
      `${["INFO", "WARN", "ERROR", "DEBUG"][i % 4]} ` +
      `Request ${i + 1} processed in ${Math.floor(Math.random() * 200 + 10)}ms`,
  ).join("\n"),
};

const s3Buckets = ["prod-assets", "staging-assets", "backups-2024", "logs-archive"];

// ── Dynamic Branch: S3 Buckets ──────────────────────────────────────

class S3Module extends DynamicBranchNode {
  constructor() {
    super({ name: "s3", description: "S3 bucket operations.", ttlMs: 60_000 });
  }

  protected refresh(): void {
    for (const bucket of s3Buckets) {
      this.addChild(
        new LeafNode({
          name: bucket,
          description: `List objects in '${bucket}'.`,
          optionalArgs: {
            prefix: { type: "string", description: "Filter by key prefix" },
          },
          handler: (kw) => {
            const prefix = kw.prefix ? String(kw.prefix) : "";
            const objects = [
              `${prefix || "data/"}report-2024-q1.csv`,
              `${prefix || "data/"}report-2024-q2.csv`,
              `${prefix || "images/"}banner.png`,
              `${prefix || "config/"}settings.json`,
            ];
            return `[SUCCESS] Objects in s3://${bucket}/ (prefix="${prefix}"):\n${objects.map((o) => `  ${o}`).join("\n")}`;
          },
        }),
        { overwrite: true },
      );
    }
  }
}

// ── Build the Command Tree ──────────────────────────────────────────

const session = new SessionManager("devops-session-001");
const root = new BranchNode({ name: "root", description: "DevOps toolkit for server management." });

// system/process/*
const system = new BranchNode({ name: "system", description: "System administration." });
const process_ = new BranchNode({ name: "process", description: "Process management." });

process_.addChild(
  new LeafNode({
    name: "list",
    description: "List running processes.",
    optionalArgs: {
      status: { type: "string", description: "Filter by status (running, sleeping)" },
    },
    handler: (kw) => {
      let filtered = processes;
      if (kw.status) {
        filtered = processes.filter((p) => p.status === String(kw.status));
      }
      return (
        `[SUCCESS] Processes (${filtered.length}):\n` +
        table(
          ["PID", "Name", "CPU", "Memory", "Status"],
          filtered.map((p) => [String(p.pid), p.name, p.cpu, p.mem, p.status]),
        )
      );
    },
  }),
);

process_.addChild(
  new LeafNode({
    name: "kill",
    description: "Kill a process by PID.",
    requiredArgs: {
      pid: {
        type: "number",
        description: "Process ID to terminate",
        validator: (v) => processes.some((p) => p.pid === v),
      },
    },
    optionalArgs: {
      force: { type: "boolean", description: "Force kill (SIGKILL)", default: false },
    },
    handler: (kw) => {
      const signal = kw.force ? "SIGKILL" : "SIGTERM";
      const proc = processes.find((p) => p.pid === kw.pid);
      return `[SUCCESS] Sent ${signal} to PID ${kw.pid} (${proc?.name}).`;
    },
  }),
);

system.addChild(process_);

// system/file/*
const file = new BranchNode({ name: "file", description: "File operations." });

file.addChild(
  new LeafNode({
    name: "read",
    description: "Read a file with line numbers.",
    requiredArgs: {
      path: { type: "string", description: "Absolute file path" },
    },
    handler: (kw) => {
      const content = files[String(kw.path)];
      if (!content) return `[ERROR: FileNotFound] '${kw.path}' does not exist.`;
      return `[SUCCESS] File: ${kw.path}\n${lineNumbered(content)}`;
    },
  }),
);

file.addChild(
  new LeafNode({
    name: "search",
    description: "Search for a text pattern across all files.",
    requiredArgs: {
      pattern: { type: "string", description: "Text pattern to search for" },
    },
    handler: (kw) => {
      const pattern = String(kw.pattern).toLowerCase();
      const matches: string[][] = [];
      for (const [path, content] of Object.entries(files)) {
        content.split("\n").forEach((line, i) => {
          if (line.toLowerCase().includes(pattern)) {
            matches.push([path, String(i + 1), line.trim().slice(0, 80)]);
          }
        });
      }
      if (matches.length === 0) return `[INFO] No matches for '${kw.pattern}'.`;
      return (
        `[SUCCESS] Found ${matches.length} match(es):\n` +
        csv(["File", "Line", "Content"], matches.slice(0, 15))
      );
    },
  }),
);

system.addChild(file);
root.addChild(system);

// cloud/aws/s3/* (dynamic branch)
const cloud = new BranchNode({ name: "cloud", description: "Cloud provider integrations." });
const aws = new BranchNode({ name: "aws", description: "Amazon Web Services." });
aws.addChild(new S3Module());
cloud.addChild(aws);
root.addChild(cloud);

// Memory module
root.addChild(createMemoryModule(session));

// ── Router with Middleware and Aliases ───────────────────────────────

const router = new Router(root, session, { pageSize: 20 });

// Logging middleware: appends execution time
router.use(async (ctx, next) => {
  const start = Date.now();
  const result = await next();
  return `${result}\n[Executed in ${Date.now() - start}ms]`;
});

// Aliases
router.alias("proc", "system process");
router.alias("s3", "cloud aws s3");

// ── Simulated LLM Conversation ──────────────────────────────────────

const SEPARATOR = "\u2501".repeat(60);

function turn(n: number, label: string) {
  console.log(`\n${SEPARATOR}`);
  console.log(`  Turn ${n}: ${label}`);
  console.log(SEPARATOR);
}

async function main() {
  console.log("=== DevOps Toolkit - swiss-army-tool Example ===");
  console.log(`Session: ${session.sessionId}\n`);

  // Show the tool schema the LLM would receive
  const schema = generateToolSchema({ root });
  console.log("Tool schema name:", schema.name);
  console.log("Tool schema description (first 120 chars):", schema.description.slice(0, 120) + "...\n");

  // ── Turn 1: help ──
  turn(1, 'help');
  console.log(await router.execute("help"));

  // ── Turn 2: ls ──
  turn(2, 'ls (compact listing)');
  console.log(await router.execute("ls"));

  // ── Turn 3: tree ──
  turn(3, 'tree (full hierarchy)');
  console.log(await router.execute("tree"));

  // ── Turn 4: system process list ──
  turn(4, 'system process list');
  console.log(await router.execute("system process list"));

  // ── Turn 5: system process kill (typed number + validator) ──
  turn(5, 'proc kill pid=1004 (alias + typed arg)');
  console.log(await router.execute("proc kill", { pid: 1004 }));

  // ── Turn 6: typo → fuzzy suggestion ──
  turn(6, 'system file raed (TYPO - fuzzy suggestion)');
  console.log(await router.execute("system file raed"));

  // ── Turn 7: system file read (small file) ──
  turn(7, 'system file read /etc/nginx/nginx.conf');
  console.log(await router.execute("system file read", { path: "/etc/nginx/nginx.conf" }));

  // ── Turn 8: system file read (large file → pagination) ──
  turn(8, 'system file read /var/log/app.log (paginated)');
  console.log(await router.execute("system file read", { path: "/var/log/app.log" }));

  // ── Turn 9: retrieve page 2 ──
  turn(9, 'system file read page=2');
  console.log(await router.execute("system file read", { path: "/var/log/app.log", page: 2 }));

  // ── Turn 10: system file search (CSV output) ──
  turn(10, 'system file search pattern="ERROR"');
  console.log(await router.execute("system file search", { pattern: "ERROR" }));

  // ── Turn 11: memory set with tags ──
  turn(11, 'memory set (with tags)');
  console.log(await router.execute("memory set", {
    key: "nginx_config",
    value: "/etc/nginx/nginx.conf",
    tags: "config,nginx,important",
  }));

  // ── Turn 12: memory pin → pinned context in subsequent responses ──
  turn(12, 'memory pin');
  console.log(await router.execute("memory pin", { key: "nginx_config" }));

  // ── Turn 13: cd + relative command on dynamic branch ──
  turn(13, 'cd cloud/aws/s3 → prod-assets (dynamic branch)');
  console.log(await router.execute("cd cloud/aws/s3"));
  console.log();
  // Now use relative path
  console.log(await router.execute("prod-assets"));

  // ── Turn 14: find ──
  turn(14, 'find kill (search command tree)');
  console.log(await router.execute("find kill"));

  // ── Turn 15: history ──
  turn(15, 'history (audit trail)');
  console.log(await router.execute("history"));

  console.log(`\n${SEPARATOR}`);
  console.log("  Example complete.");
  console.log(SEPARATOR);
}

main().catch(console.error);
