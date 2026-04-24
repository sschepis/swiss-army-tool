import { BranchNode } from "./nodes/branch-node.js";
import { LeafNode } from "./nodes/leaf-node.js";
import type { Middleware } from "./router.js";

// ── Types ────────────────────────────────────────────────────────────

export interface NoteEntry {
  command: string;
  keyArg: string;
  resultSummary: string;
  success: boolean;
  timestamp: number;
  durationMs: number;
  kind: "tool" | "observation";
}

export interface SessionNotesOptions {
  /** Max entries before oldest are evicted (default: 200). */
  maxEntries?: number;
  /** Number of recent entries to show in the footer (default: 8). */
  footerRecent?: number;
  /** Commands to skip for capture and footer (e.g. nav commands). */
  skipCommands?: Set<string>;
}

// ── Default skip list ────────────────────────────────────────────────

const DEFAULT_SKIP = new Set([
  "help", "ls", "tree", "cd", "pwd", "history", "find",
  "notes", "notes/list", "notes/add",
]);

// ── Key-arg extraction ───────────────────────────────────────────────

function extractKeyArg(command: string, kwargs: Record<string, unknown>): string {
  const path = kwargs.path ?? kwargs.target_file ?? kwargs.file;
  if (typeof path === "string") {
    const segments = path.split("/");
    return segments[segments.length - 1];
  }
  if (typeof kwargs.pattern === "string")
    return kwargs.pattern.length > 25 ? kwargs.pattern.slice(0, 25) + "…" : kwargs.pattern;
  if (typeof kwargs.query === "string")
    return kwargs.query.length > 25 ? kwargs.query.slice(0, 25) + "…" : kwargs.query;
  if (typeof kwargs.cmd === "string")
    return kwargs.cmd.length > 30 ? kwargs.cmd.slice(0, 30) + "…" : kwargs.cmd;
  if (typeof kwargs.symbol === "string") return kwargs.symbol;
  if (typeof kwargs.task === "string")
    return kwargs.task.length > 30 ? kwargs.task.slice(0, 30) + "…" : kwargs.task;
  if (typeof kwargs.name === "string") return kwargs.name;
  if (typeof kwargs.key === "string") return kwargs.key;
  return "";
}

function summarizeResponse(response: string): string {
  const first = response.split("\n")[0];
  if (first.length <= 100) return first;
  return first.slice(0, 100) + "…";
}

// ── SessionNotes class ───────────────────────────────────────────────

export class SessionNotes {
  private entries: NoteEntry[] = [];
  private readonly maxEntries: number;
  private readonly footerRecent: number;
  private readonly skipCommands: Set<string>;

  constructor(options?: SessionNotesOptions) {
    this.maxEntries = options?.maxEntries ?? 200;
    this.footerRecent = options?.footerRecent ?? 8;
    this.skipCommands = options?.skipCommands ?? DEFAULT_SKIP;
  }

  /** Record an auto-captured tool command. */
  record(
    command: string,
    kwargs: Record<string, unknown>,
    response: string,
    durationMs: number,
  ): void {
    if (this.skipCommands.has(command)) return;

    this.entries.push({
      command,
      keyArg: extractKeyArg(command, kwargs),
      resultSummary: summarizeResponse(response),
      success: !response.startsWith("[ERROR"),
      timestamp: Date.now(),
      durationMs,
      kind: "tool",
    });

    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  /** Add a manual AI observation to the session log. */
  addObservation(text: string): void {
    this.entries.push({
      command: "(note)",
      keyArg: "",
      resultSummary: text.length > 200 ? text.slice(0, 200) + "…" : text,
      success: true,
      timestamp: Date.now(),
      durationMs: 0,
      kind: "observation",
    });
  }

  /** Brief 1-line footer appended to each tool response. */
  footer(): string {
    if (this.entries.length === 0) return "";

    const recent = this.entries.slice(-this.footerRecent);
    const parts = recent.map((e) => {
      if (e.kind === "observation") return `📝${e.resultSummary.slice(0, 30)}`;
      const mark = e.success ? "✓" : "✗";
      const arg = e.keyArg ? `(${e.keyArg})` : "";
      return `${e.command}${arg}${mark}`;
    });

    return `\n\n[Session: ${this.entries.length} commands | ${parts.join(" → ")}]`;
  }

  /** Full detailed log for the `notes/list` command. */
  detail(count?: number): string {
    const n = count ?? 30;
    const slice = this.entries.slice(-n);
    if (slice.length === 0) return "[INFO] No commands executed yet this session.";

    const lines = slice.map((e, i) => {
      const time = new Date(e.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      if (e.kind === "observation") {
        return `  ${String(i + 1).padStart(3)}. [${time}] 📝 ${e.resultSummary}`;
      }
      const mark = e.success ? "OK" : "ERR";
      const arg = e.keyArg ? ` ${e.keyArg}` : "";
      const dur = e.durationMs > 0 ? ` (${e.durationMs}ms)` : "";
      return `  ${String(i + 1).padStart(3)}. [${time}] ${e.command}${arg} → [${mark}] ${e.resultSummary}${dur}`;
    });

    const errCount = this.entries.filter((e) => !e.success).length;
    const header = `[SESSION NOTES] ${this.entries.length} total commands, ${errCount} error(s). Showing last ${slice.length}:`;
    return `${header}\n${lines.join("\n")}`;
  }

  /** Total number of entries in the log. */
  size(): number {
    return this.entries.length;
  }

  /** Whether a command should be skipped for capture. */
  shouldSkip(command: string): boolean {
    return this.skipCommands.has(command);
  }
}

// ── Middleware factory ────────────────────────────────────────────────

/**
 * Creates a middleware that auto-captures every non-nav command into
 * the SessionNotes and appends a brief session context footer to
 * each tool response.
 */
export function createNotesMiddleware(notes: SessionNotes): Middleware {
  return async (ctx, next) => {
    const isSkip = notes.shouldSkip(ctx.command);

    const start = Date.now();
    const response = await next();
    const durationMs = Date.now() - start;

    if (!isSkip) {
      notes.record(ctx.command, ctx.kwargs, response, durationMs);
      return response + notes.footer();
    }

    return response;
  };
}

// ── Tree module factory ──────────────────────────────────────────────

/**
 * Creates a `notes` branch with `list` and `add` leaf commands.
 * Wire into the root after building the tree:
 *   root.addChild(createNotesModule(sessionNotes));
 */
export function createNotesModule(notes: SessionNotes): BranchNode {
  const branch = new BranchNode({
    name: "notes",
    description:
      "Session command log — auto-captured. Every tool command is recorded with timing, result, and success/failure. " +
      "A summary footer is appended to every response automatically. " +
      "Use notes/list for the full log. Use notes/add to record your own observations.",
  });

  branch.addChild(
    new LeafNode({
      name: "list",
      description:
        "View the full session log — every command run this session with timing, success/failure, and result summaries. " +
        "Use this to review what you have done, what succeeded, and what failed.",
      optionalArgs: {
        count: {
          type: "number",
          description: "Number of recent entries to show (default 30)",
          default: 30,
        },
      },
      handler: (kwargs) => {
        const count =
          typeof kwargs.count === "number" ? kwargs.count : undefined;
        return notes.detail(count);
      },
    }),
  );

  branch.addChild(
    new LeafNode({
      name: "add",
      description:
        "Record your own observation in the session log. Use this for decisions, hypotheses, or findings " +
        "that help you stay oriented. These appear alongside auto-captured tool results.",
      requiredArgs: {
        text: {
          type: "string",
          description:
            'Your observation (e.g. "Auth module uses JWT, stored in Redis")',
        },
      },
      handler: (kwargs) => {
        const text =
          typeof kwargs.text === "string" ? kwargs.text.trim() : "";
        if (!text)
          return "[ERROR] Missing required argument: text. Write your observation as a string.";
        notes.addObservation(text);
        return `[OK] Note recorded. Session log now has ${notes.size()} entries.`;
      },
    }),
  );

  return branch;
}
