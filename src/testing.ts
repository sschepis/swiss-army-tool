import { BranchNode } from "./nodes/branch-node.js";
import { LeafNode } from "./nodes/leaf-node.js";
import { Router } from "./router.js";
import { SessionManager } from "./session.js";
import type { RouterOptions } from "./router.js";

/**
 * Create a Router with an in-memory session for testing.
 */
export function createTestRouter(
  root: BranchNode,
  options?: RouterOptions & { sessionId?: string },
): { router: Router; session: SessionManager } {
  const session = new SessionManager(options?.sessionId ?? "test");
  const router = new Router(root, session, options);
  return { router, session };
}

/**
 * Create a mock LeafNode that returns a fixed response.
 */
export function mockLeafNode(
  name: string,
  response: string,
  description = `Mock: ${name}`,
): LeafNode {
  return new LeafNode({
    name,
    description,
    handler: () => response,
  });
}

/**
 * Assert a router result contains a success indicator.
 */
export function assertSuccess(result: string): void {
  if (!result.includes("SUCCESS")) {
    throw new Error(`Expected SUCCESS in result but got:\n${result}`);
  }
}

/**
 * Assert a router result contains an error of the specified type.
 */
export function assertError(result: string, errorType?: string): void {
  if (!result.includes("ERROR")) {
    throw new Error(`Expected ERROR in result but got:\n${result}`);
  }
  if (errorType && !result.includes(errorType)) {
    throw new Error(`Expected error type '${errorType}' in result but got:\n${result}`);
  }
}

/**
 * Execute a sequence of commands and return all results.
 */
export async function executeSequence(
  router: Router,
  commands: Array<{ command: string; kwargs?: Record<string, unknown> }>,
): Promise<string[]> {
  const results: string[] = [];
  for (const { command, kwargs } of commands) {
    results.push(await router.execute(command, kwargs));
  }
  return results;
}
