import type { Middleware } from "./router.js";

// ── Types ────────────────────────────────────────────────────────────

export interface RedirectRule {
  /** Regex tested against the raw command string (typically the `cmd` kwarg of a shell command). */
  pattern: RegExp;
  /** Message returned instead of executing the command. Should explain WHY and WHAT to use instead. */
  message: string;
}

export interface RedirectMiddlewareOptions {
  /**
   * The command path(s) to intercept (e.g. "shell/run", "shell/background").
   * The middleware only inspects kwargs when the command matches one of these.
   * Default: ["shell/run"]
   */
  commands?: string[];
  /**
   * The kwarg key that contains the shell command string.
   * Default: "cmd"
   */
  kwargKey?: string;
}

// ── Built-in redirect rules ──────────────────────────────────────────

/**
 * Standard redirects for common shell commands that have dedicated tool
 * equivalents. These block `cat`, `grep`, `head`/`tail`/`sed`/`awk`,
 * `find`, and `ls` on source directories, directing the AI to the
 * proper tool tree commands instead.
 *
 * Consumers can use these as-is or extend with their own rules.
 */
export const STANDARD_REDIRECTS: RedirectRule[] = [
  {
    pattern:
      /\bcat\s+.*\.(?:ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|hpp|css|html|json|yaml|yml|toml|md|txt|sh|rb|swift|kt)\b/,
    message:
      "[BLOCKED] Do not use `cat` to read source files. Use the dedicated tools instead:\n" +
      "  • file/read — read a file with line numbers, offset, and limit\n" +
      "  • code/explore — deep-explore a file (symbols, types, call hierarchy) in ONE call\n" +
      "  • code/symbols — get the symbol outline of a file\n" +
      "These tools are faster, support pagination, and feed the session notes system.\n" +
      "shell/run is for builds, tests, installs, and CLI tasks that have no dedicated tool.",
  },
  {
    pattern: /\b(?:grep|rg|ripgrep)\s+(?:-[A-Za-z]*\s+)*(?:"|')?\w/,
    message:
      "[BLOCKED] Do not use `grep`/`rg` via shell. Use the dedicated tools instead:\n" +
      "  • search/grep — ripgrep-powered search with type and glob filters\n" +
      "  • code/references — find all references to a symbol (language-aware)\n" +
      "  • code/workspace-symbols — search symbols by name across the workspace\n" +
      "These tools integrate with session notes and the code map.\n" +
      "shell/run is for builds, tests, installs, and CLI tasks that have no dedicated tool.",
  },
  {
    pattern:
      /\b(?:head|tail|sed|awk)\s+.*\.(?:ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|hpp|css|html|json|yaml|yml|toml|md)\b/,
    message:
      "[BLOCKED] Do not use `head`/`tail`/`sed`/`awk` on source files. Use the dedicated tools instead:\n" +
      "  • file/read — supports offset and limit for reading specific sections\n" +
      "  • file/edit — surgical edits with exact-match replacement or line-anchored inserts\n" +
      "  • search/grep — search file contents by pattern\n" +
      "shell/run is for builds, tests, installs, and CLI tasks that have no dedicated tool.",
  },
  {
    pattern: /\bfind\s+.*-(?:name|iname|type)\b/,
    message:
      "[BLOCKED] Do not use `find` to locate files. Use search/glob instead:\n" +
      "  • search/glob pattern=\"**/*.ts\" — find files by glob pattern\n" +
      "  • search/grep — search file contents by pattern\n" +
      "shell/run is for builds, tests, installs, and CLI tasks that have no dedicated tool.",
  },
  {
    pattern:
      /\bls\s+(?:-[A-Za-z]*\s+)*(?:src|lib|app|packages|components|pages|test|spec)\b/,
    message:
      "[BLOCKED] Do not use `ls` to list source directories. Use the dedicated tools instead:\n" +
      "  • search/glob pattern=\"src/**/*\" — list files by glob pattern\n" +
      "  • code/symbols — get the symbol structure of a specific file\n" +
      "shell/run is for builds, tests, installs, and CLI tasks that have no dedicated tool.",
  },
];

// ── Middleware factory ────────────────────────────────────────────────

/**
 * Creates a middleware that intercepts shell commands and blocks those
 * that should use a dedicated tool tree command instead.
 *
 * Usage:
 *   router.use(createRedirectMiddleware(STANDARD_REDIRECTS));
 *   router.use(createRedirectMiddleware(myCustomRules, { commands: ["shell/run", "shell/background"] }));
 */
export function createRedirectMiddleware(
  rules: RedirectRule[],
  options?: RedirectMiddlewareOptions,
): Middleware {
  const commands = new Set(options?.commands ?? ["shell/run"]);
  const kwargKey = options?.kwargKey ?? "cmd";

  return async (ctx, next) => {
    if (commands.has(ctx.resolvedPath) || commands.has(ctx.command)) {
      const shellCmd = ctx.kwargs[kwargKey];
      if (typeof shellCmd === "string") {
        for (const rule of rules) {
          if (rule.pattern.test(shellCmd)) {
            return rule.message;
          }
        }
      }
    }
    return next();
  };
}
