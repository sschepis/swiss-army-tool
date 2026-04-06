import { BranchNode } from "./nodes/branch-node.js";
import { CLINode } from "./nodes/cli-node.js";
import { SessionManager } from "./session.js";
import { formatError } from "./errors.js";
import { findClosestMatch } from "./utils/fuzzy.js";

export interface RouterOptions {
  /** Lines per page for pagination (default: 50) */
  pageSize?: number;
  /** Maximum command length (default: 1000) */
  maxCommandLength?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Custom logger function (defaults to console.debug) */
  logger?: (message: string) => void;
}

export type Middleware = (
  ctx: ExecutionContext,
  next: () => Promise<string>,
) => Promise<string>;

export interface ExecutionContext {
  command: string;
  kwargs: Record<string, unknown>;
  resolvedPath: string;
  session: SessionManager;
}

export class Router {
  private readonly middlewares: Middleware[] = [];
  private readonly aliases: Map<string, string> = new Map();
  private readonly pageSize: number;
  private readonly maxCommandLength: number;
  private readonly debugMode: boolean;
  private readonly logger: (message: string) => void;

  constructor(
    private readonly root: BranchNode,
    private readonly session: SessionManager,
    options?: RouterOptions,
  ) {
    this.pageSize = options?.pageSize ?? 50;
    this.maxCommandLength = options?.maxCommandLength ?? 1000;
    this.debugMode = options?.debug ?? false;
    this.logger = options?.logger ?? console.debug;
  }

  private debug(message: string): void {
    if (this.debugMode) {
      this.logger(`[swiss-army-tool] ${message}`);
    }
  }

  /** Register a middleware function. */
  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /** Register a command alias. */
  alias(shortcut: string, fullCommand: string): this {
    this.aliases.set(shortcut, fullCommand);
    return this;
  }

  /**
   * Main entry point — the function wired to the LLM's single tool call.
   * Resolves the command against the CWD, routes it through the tree,
   * and returns a breadcrumbed response.
   */
  async execute(
    command: string,
    kwargs: Record<string, unknown> = {},
  ): Promise<string> {
    // Guard against undefined/null command (e.g. malformed LLM tool arguments)
    if (command == null || typeof command !== "string") {
      return this.wrap(
        formatError("InvalidInput", "No command provided. Use 'help' to see available commands."),
      );
    }

    this.debug(`execute: command="${command}", kwargs=${JSON.stringify(kwargs)}`);
    const startTime = Date.now();

    // Input sanitization
    if (command.length > this.maxCommandLength) {
      return this.wrap(
        formatError("InvalidInput", `Command exceeds maximum length of ${this.maxCommandLength} characters.`),
      );
    }

    let cmd = command.trim();

    // Record command in history
    if (cmd) {
      this.session.recordCommand(cmd);
    }

    // Resolve aliases
    for (const [shortcut, full] of this.aliases) {
      if (cmd === shortcut || cmd.startsWith(shortcut + " ")) {
        cmd = cmd.replace(shortcut, full);
        break;
      }
    }

    // Built-in: pwd
    if (cmd === "pwd") {
      return this.wrap(`[CWD] ${this.session.cwd}`);
    }

    // Built-in: cd
    if (cmd === "cd" || cmd.startsWith("cd ")) {
      return this.wrap(this.handleCd(cmd));
    }

    // Built-in: tree
    if (cmd === "tree") {
      return this.wrap(this.buildTree(this.root, "", true));
    }

    // Built-in: ls (compact directory listing)
    // Only use built-in ls if no child named 'ls' exists in the current directory
    if (cmd === "ls") {
      const cwdNode = this.resolveNode(this.session.cwd.split("/").filter(Boolean));
      const hasLsChild = cwdNode?.isBranch() && (cwdNode as BranchNode).children.has("ls");
      if (!hasLsChild) {
        return this.wrap(this.handleLs());
      }
      // Fall through to normal command routing
    }

    // Built-in: history
    if (cmd === "history") {
      return this.wrap(this.handleHistory(kwargs));
    }

    // Built-in: find (search command tree)
    if (cmd === "find" || cmd.startsWith("find ")) {
      const query = cmd === "find"
        ? (kwargs.query as string | undefined)
        : cmd.slice(5).trim() || (kwargs.query as string | undefined);
      return this.wrap(this.handleFind(query));
    }

    // Built-in: help (with enhanced path routing)
    if (cmd === "help" || cmd.startsWith("help ")) {
      return this.wrap(this.handleHelp(cmd));
    }

    // Handle empty command (show current directory menu)
    if (!cmd) {
      const cwdTokens = this.session.cwd.split("/").filter(Boolean);
      if (cwdTokens.length === 0) {
        return this.wrap(this.root.getHelp("/"));
      }
      try {
        const result = await this.root.execute(cwdTokens, {});
        return this.wrap(result);
      } catch {
        return this.wrap(this.root.getHelp("/"));
      }
    }

    // The command can be space-separated ("cloud aws ls") or slash-separated ("cloud/aws/ls").
    // Normalize spaces to slashes, then resolve against the CWD.
    const normalized = cmd.replace(/\s+/g, "/");
    const fullPath = this.session.resolvePath(normalized);
    const tokens = fullPath.split("/").filter(Boolean);

    this.debug(`resolved: "${cmd}" -> "${fullPath}" (tokens: [${tokens.join(", ")}])`);

    // Build execution context for middleware
    const ctx: ExecutionContext = {
      command: cmd,
      kwargs,
      resolvedPath: fullPath,
      session: this.session,
    };

    // Build middleware chain
    const coreExecute = async (): Promise<string> => {
      const result = await this.root.execute(tokens, kwargs);
      return this.paginate(fullPath, result, kwargs);
    };

    try {
      let chain = coreExecute;
      for (let i = this.middlewares.length - 1; i >= 0; i--) {
        const mw = this.middlewares[i];
        const next = chain;
        chain = () => mw(ctx, next);
      }
      const result = await chain();
      this.debug(`completed in ${Date.now() - startTime}ms`);
      return this.wrap(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      return this.wrap(
        formatError("SystemFault", message),
      );
    }
  }

  /** Apply pagination if output exceeds page size. */
  private paginate(
    key: string,
    output: string,
    kwargs: Record<string, unknown>,
  ): string {
    const lines = output.split("\n");
    const page = typeof kwargs.page === "number" ? kwargs.page : undefined;

    // If explicitly requesting a page, check cache
    if (page !== undefined) {
      const cached = this.session.getPage(key, page, this.pageSize);
      if (cached) {
        const nav = cached.currentPage < cached.totalPages
          ? `\n[Page ${cached.currentPage}/${cached.totalPages}] Pass kwargs={page: ${cached.currentPage + 1}} for next page.`
          : `\n[Page ${cached.currentPage}/${cached.totalPages}] End of output.`;
        return cached.content + nav;
      }
    }

    // If output fits in one page, return as-is
    if (lines.length <= this.pageSize) {
      return output;
    }

    // Cache full output and return first page
    this.session.setPaginationCache(key, output);
    const firstPage = lines.slice(0, this.pageSize).join("\n");
    const totalPages = Math.ceil(lines.length / this.pageSize);
    return `${firstPage}\n[OUTPUT TRUNCATED] ${lines.length - this.pageSize} more lines (page 1/${totalPages}). Pass kwargs={page: 2} to view more.`;
  }

  /** Wrap output with breadcrumb and pinned context. */
  private wrap(output: string): string {
    const parts: string[] = [];

    const pinned = this.session.getPinnedContext();
    if (pinned) parts.push(pinned);

    parts.push(`[Context: ${this.session.cwd}]`);
    parts.push(output);

    return parts.join("\n");
  }

  /** Handle `help` and `help <path>` with CWD-relative resolution. */
  private handleHelp(cmd: string): string {
    if (cmd === "help") {
      // Show help for current directory
      const cwdTokens = this.session.cwd.split("/").filter(Boolean);
      const node = this.resolveNode(cwdTokens);
      return node ? node.getHelp(this.session.cwd) : this.root.getHelp("/");
    }

    // help <path> — resolve relative to CWD
    const target = cmd.slice(5).trim().replace(/\s+/g, "/");
    const fullPath = this.session.resolvePath(target);
    const tokens = fullPath.split("/").filter(Boolean);
    const node = this.resolveNode(tokens);
    if (!node) {
      return formatError(
        "CommandNotFound",
        `'${target}' does not exist.`,
      );
    }
    return node.getHelp(fullPath);
  }

  /** Handle compact `ls` for current directory. */
  private handleLs(): string {
    const cwdTokens = this.session.cwd.split("/").filter(Boolean);
    const node = this.resolveNode(cwdTokens);
    if (!node || !node.isBranch()) {
      return formatError("InvalidPath", "Current directory is not a branch node.");
    }
    const branch = node as BranchNode;
    if (branch.children.size === 0) {
      return "[INFO] Empty directory.";
    }
    const lines: string[] = [];
    for (const [, child] of branch.children) {
      const icon = child.isBranch() ? "\u{1F4C1}" : "\u26A1";
      lines.push(`${icon} ${child.name}`);
    }
    return lines.join("\n");
  }

  /** Handle `find` command — search the tree by name or description. */
  private handleFind(query?: string): string {
    if (!query) {
      return formatError("MissingArguments", "Provide a search query. Usage: find <query> or find kwargs={query: \"...\"}");
    }
    const results: string[] = [];
    const lowerQuery = query.toLowerCase();

    const walk = (node: CLINode, path: string) => {
      const matches =
        node.name.toLowerCase().includes(lowerQuery) ||
        node.description.toLowerCase().includes(lowerQuery);
      if (matches) {
        const icon = node.isBranch() ? "\u{1F4C1}" : "\u26A1";
        results.push(`${icon} ${path} - ${node.description}`);
      }
      if (node.isBranch()) {
        const branch = node as BranchNode;
        for (const [, child] of branch.children) {
          walk(child, `${path}/${child.name}`);
        }
      }
    };

    for (const [, child] of this.root.children) {
      walk(child, child.name);
    }

    if (results.length === 0) {
      return `[INFO] No commands matching '${query}'.`;
    }
    return `[SUCCESS] Found ${results.length} match(es):\n${results.join("\n")}`;
  }

  /** Handle `history` command. */
  private handleHistory(kwargs: Record<string, unknown>): string {
    const limit = typeof kwargs.limit === "number" ? kwargs.limit : 20;
    const entries = this.session.history.slice(-limit);
    if (entries.length === 0) {
      return "[INFO] No command history.";
    }
    const lines = entries.map((e, i) => `  ${i + 1}. ${e.command}`);
    return `[SUCCESS] Recent commands (${entries.length}):\n${lines.join("\n")}`;
  }

  /** Resolve a path to a CLINode, or null if not found. */
  private resolveNode(tokens: string[]): CLINode | null {
    let current: CLINode = this.root;
    for (const token of tokens) {
      if (!current.isBranch()) return null;
      const branch = current as BranchNode;
      const child = branch.children.get(token);
      if (!child) return null;
      current = child;
    }
    return current;
  }

  private handleCd(cmd: string): string {
    const target = cmd.slice(2).trim().replace(/\s+/g, "/") || "/";

    // Preview the new path
    const proposed = this.session.resolvePath(target);
    const tokens = proposed.split("/").filter(Boolean);

    // Walk the tree to verify the path exists and is a branch
    let current: BranchNode | null = this.root;
    for (const token of tokens) {
      const child = current.children.get(token);
      if (!child) {
        const suggestion = findClosestMatch(token, [...current.children.keys()]);
        const hint = suggestion ? `\nDid you mean: ${suggestion}?` : "";
        return formatError(
          "InvalidPath",
          `Directory '${proposed}' does not exist.${hint}`,
        );
      }
      if (!child.isBranch()) {
        return formatError(
          "InvalidPath",
          `'${proposed}' is an executable action, not a directory. You cannot 'cd' into it.`,
        );
      }
      current = child as BranchNode;
    }

    this.session.updateCwd(target);
    return `[SUCCESS] Directory changed to ${this.session.cwd}\nTip: Run 'help' or use an empty command to see available options here.`;
  }

  private buildTree(
    node: BranchNode,
    prefix: string,
    isRoot: boolean,
  ): string {
    const lines: string[] = [];

    if (isRoot) {
      lines.push(`/ (${node.name})`);
    }

    const entries = [...node.children.entries()];
    entries.forEach(([, child], idx) => {
      const isLast = idx === entries.length - 1;
      const connector = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
      const icon = child.isBranch() ? "\u{1F4C1}" : "\u26A1";
      lines.push(`${prefix}${connector}${icon} ${child.name}`);

      if (child.isBranch()) {
        const childPrefix = prefix + (isLast ? "    " : "\u2502   ");
        const sub = this.buildTree(child as BranchNode, childPrefix, false);
        lines.push(sub);
      }
    });

    return lines.join("\n");
  }
}
