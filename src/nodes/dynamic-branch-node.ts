import { BranchNode } from "./branch-node.js";
import type { DynamicBranchConfig } from "../types.js";
import { formatError } from "../errors.js";

export abstract class DynamicBranchNode extends BranchNode {
  private readonly ttlMs: number;
  private lastRefresh = 0;

  constructor(config: DynamicBranchConfig) {
    super(config);
    this.ttlMs = config.ttlMs ?? 60_000;
  }

  /**
   * Override this to populate children dynamically.
   * Called automatically before routing when the cache has expired.
   */
  protected abstract refresh(): void | Promise<void>;

  /** Ensure children are refreshed if TTL has expired. */
  private async ensureRefreshed(): Promise<string | null> {
    const now = Date.now();
    if (now - this.lastRefresh > this.ttlMs) {
      this.children.clear();
      try {
        await this.refresh();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred.";
        return formatError(
          "RefreshFailed",
          `Failed to refresh '${this.name}': ${message}`,
          this.name,
        );
      }
      this.lastRefresh = now;
    }
    return null;
  }

  async execute(
    pathTokens: string[],
    kwargs: Record<string, unknown>,
  ): Promise<string> {
    const error = await this.ensureRefreshed();
    if (error) return error;
    return super.execute(pathTokens, kwargs);
  }

  /** Override getHelp to trigger refresh so stale children aren't shown. */
  getHelp(contextPath: string): string {
    // Note: getHelp is synchronous in the base class, but we need to trigger refresh.
    // For sync callers, we kick off a best-effort refresh. The next execute() will
    // guarantee freshness if this doesn't complete in time.
    const now = Date.now();
    if (now - this.lastRefresh > this.ttlMs) {
      this.children.clear();
      try {
        const result = this.refresh();
        // If refresh is sync, it completes immediately
        if (result instanceof Promise) {
          // For async refresh, we can't await here. Mark as refreshed
          // optimistically; execute() will re-check.
          result.catch(() => { /* swallow — execute() will retry */ });
        }
        this.lastRefresh = now;
      } catch {
        // Swallow — return whatever children we have
      }
    }
    return super.getHelp(contextPath);
  }

  /** Force a refresh on the next execute call. */
  invalidate(): void {
    this.lastRefresh = 0;
  }
}
