// Core node types
export { CLINode } from "./nodes/cli-node.js";
export { BranchNode } from "./nodes/branch-node.js";
export { LeafNode } from "./nodes/leaf-node.js";
export { DynamicBranchNode } from "./nodes/dynamic-branch-node.js";

// Infrastructure
export { Router } from "./router.js";
export type { RouterOptions, Middleware, ExecutionContext } from "./router.js";
export { SessionManager } from "./session.js";
export type { HistoryEntry } from "./session.js";

// Builder
export { TreeBuilder } from "./builder.js";
export type { LeafOptions } from "./builder.js";

// Utilities
export { createMemoryModule } from "./memory.js";
export { generateToolSchema } from "./schema.js";
export { table, lineNumbered, truncate, csv, prettyJson, digest } from "./formatter.js";

// Testing utilities
export {
  createTestRouter,
  mockLeafNode,
  assertSuccess,
  assertError,
  executeSequence,
} from "./testing.js";

// Errors
export {
  CLIError,
  CommandNotFoundError,
  MissingArgsError,
  InvalidPathError,
  TooDeepError,
  formatError,
} from "./errors.js";

// Utilities - Fuzzy matching
export { levenshtein, findClosestMatch } from "./utils/fuzzy.js";

// Types
export type {
  CLINodeConfig,
  LeafNodeConfig,
  DynamicBranchConfig,
  ToolSchema,
  SchemaOptions,
  ArgType,
  ArgDescriptor,
} from "./types.js";
