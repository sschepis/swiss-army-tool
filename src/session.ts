import { posix } from "node:path";

export interface HistoryEntry {
  command: string;
  timestamp: number;
}

export class SessionManager {
  readonly sessionId: string;
  cwd = "/";
  readonly kvStore: Map<string, string> = new Map();
  readonly pinnedKeys: Set<string> = new Set();
  /** Tags associated with memory keys */
  readonly kvTags: Map<string, Set<string>> = new Map();
  /** Pagination cache: stores full output keyed by command path */
  private paginationCache: { key: string; lines: string[] } | null = null;
  /** Command history ring buffer */
  readonly history: HistoryEntry[] = [];
  readonly maxHistorySize: number;

  constructor(sessionId?: string, options?: { maxHistorySize?: number }) {
    this.sessionId = sessionId ?? crypto.randomUUID();
    this.maxHistorySize = options?.maxHistorySize ?? 100;
  }

  /** Resolve a path relative to the CWD using POSIX rules. */
  resolvePath(input: string): string {
    if (!input || input === ".") return this.cwd;
    // Treat paths starting with "/" as absolute (not relative to cwd)
    const base = input.startsWith("/") ? "/" : this.cwd;
    const resolved = posix.normalize(posix.join(base, input));
    return resolved === "." ? "/" : resolved;
  }

  /** Update the CWD. Returns the new CWD. */
  updateCwd(newPath: string): string {
    this.cwd = this.resolvePath(newPath);
    return this.cwd;
  }

  /** Get all pinned memory values formatted for prompt injection. */
  getPinnedContext(): string {
    if (this.pinnedKeys.size === 0) return "";
    const lines: string[] = [];
    for (const key of this.pinnedKeys) {
      const value = this.kvStore.get(key);
      if (value !== undefined) {
        lines.push(`[PINNED MEMORY - ${key}]: ${value}`);
      }
    }
    return lines.join("\n");
  }

  /** Store paginated output. */
  setPaginationCache(key: string, fullOutput: string): void {
    this.paginationCache = { key, lines: fullOutput.split("\n") };
  }

  /** Retrieve a page from the pagination cache. Returns null if no cache or wrong key. */
  getPage(key: string, page: number, pageSize: number): { content: string; totalPages: number; currentPage: number } | null {
    if (!this.paginationCache || this.paginationCache.key !== key) return null;
    const lines = this.paginationCache.lines;
    const totalPages = Math.ceil(lines.length / pageSize);
    const clampedPage = Math.max(1, Math.min(page, totalPages));
    const start = (clampedPage - 1) * pageSize;
    const end = start + pageSize;
    const content = lines.slice(start, end).join("\n");
    return { content, totalPages, currentPage: clampedPage };
  }

  /** Record a command in the history. */
  recordCommand(command: string): void {
    this.history.push({ command, timestamp: Date.now() });
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  /** Serialize session state to a plain object. */
  toJSON(): Record<string, unknown> {
    return {
      sessionId: this.sessionId,
      cwd: this.cwd,
      kvStore: Object.fromEntries(this.kvStore),
      pinnedKeys: [...this.pinnedKeys],
      kvTags: Object.fromEntries(
        [...this.kvTags.entries()].map(([k, v]) => [k, [...v]]),
      ),
      history: this.history,
    };
  }

  /** Restore session state from a plain object. */
  static fromJSON(data: Record<string, unknown>): SessionManager {
    const session = new SessionManager(data.sessionId as string);
    session.cwd = (data.cwd as string) ?? "/";

    if (data.kvStore && typeof data.kvStore === "object") {
      for (const [k, v] of Object.entries(data.kvStore as Record<string, string>)) {
        session.kvStore.set(k, v);
      }
    }

    if (Array.isArray(data.pinnedKeys)) {
      for (const key of data.pinnedKeys) {
        session.pinnedKeys.add(key as string);
      }
    }

    if (data.kvTags && typeof data.kvTags === "object") {
      for (const [k, v] of Object.entries(data.kvTags as Record<string, string[]>)) {
        session.kvTags.set(k, new Set(v));
      }
    }

    if (Array.isArray(data.history)) {
      for (const entry of data.history) {
        session.history.push(entry as HistoryEntry);
      }
    }

    return session;
  }
}
