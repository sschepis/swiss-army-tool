# API Reference

Complete reference for every public symbol exported by `swiss-army-tool`.

---

## Classes

### `CLINode` (abstract)

Base class for all nodes in the command tree.

```ts
import { CLINode } from "swiss-army-tool";
```

| Member | Signature | Description |
|--------|-----------|-------------|
| `name` | `abstract readonly name: string` | The command name |
| `description` | `abstract readonly description: string` | Short description for menus |
| `isBranch()` | `abstract isBranch(): boolean` | Whether this node has children |
| `getHelp(contextPath)` | `abstract getHelp(contextPath: string): string` | Render context-sensitive help |
| `execute(pathTokens, kwargs)` | `abstract execute(pathTokens: string[], kwargs: Record<string, unknown>): string \| Promise<string>` | Execute or route the command |
| `formatError(errorType, hint)` | `formatError(errorType: string, hint: string): string` | Format a standardized error string |

---

### `BranchNode`

Menu / directory node. Routes commands to children and generates formatted menus.

```ts
import { BranchNode } from "swiss-army-tool";

const root = new BranchNode({ name: "root", description: "Main system" });
```

**Constructor:** `new BranchNode(config: CLINodeConfig)`

| Member | Signature | Description |
|--------|-----------|-------------|
| `name` | `readonly name: string` | Node name |
| `description` | `readonly description: string` | Node description |
| `children` | `readonly children: Map<string, CLINode>` | Child nodes |
| `isBranch()` | `isBranch(): boolean` | Always returns `true` |
| `addChild(node, options?)` | `addChild(node: CLINode, options?: { overwrite?: boolean }): this` | Add a child. Throws on collision unless `overwrite: true`. |
| `removeChild(name)` | `removeChild(name: string): boolean` | Remove a child by name |
| `getHelp(contextPath)` | `getHelp(contextPath: string): string` | Generate the formatted menu |
| `execute(pathTokens, kwargs)` | `async execute(pathTokens: string[], kwargs: Record<string, unknown>): Promise<string>` | Route to child or show menu |

When `execute` is called with no path tokens, the menu is displayed. With tokens, the first token is consumed and the command is delegated to the matching child. Unknown children produce a `CommandNotFound` error with fuzzy suggestion.

---

### `LeafNode`

Executable action node. Validates arguments, coerces types, runs the handler.

```ts
import { LeafNode } from "swiss-army-tool";

const action = new LeafNode({
  name: "query",
  description: "Run a SQL query.",
  requiredArgs: { sql: { type: "string", description: "SQL statement" } },
  optionalArgs: { limit: { type: "number", default: 100 } },
  timeoutMs: 30000,
  handler: async (kwargs) => `[SUCCESS] ${kwargs.sql}`,
});
```

**Constructor:** `new LeafNode(config: LeafNodeConfig)`

| Member | Signature | Description |
|--------|-----------|-------------|
| `name` | `readonly name: string` | Node name |
| `description` | `readonly description: string` | Node description |
| `requiredArgs` | `readonly requiredArgs: string[]` | Required argument names |
| `optionalArgs` | `readonly optionalArgs: string[]` | Optional argument names |
| `argDescriptors` | `readonly argDescriptors: Map<string, ArgDescriptor>` | Type/description/default/validator per arg |
| `timeoutMs` | `readonly timeoutMs?: number` | Handler timeout in ms |
| `isBranch()` | `isBranch(): boolean` | Always returns `false` |
| `getHelp(contextPath)` | `getHelp(contextPath: string): string` | Show name, description, args with types/defaults |
| `execute(pathTokens, kwargs)` | `async execute(pathTokens: string[], kwargs: Record<string, unknown>): Promise<string>` | Validate args, coerce types, run handler |

**Execution flow:**
1. Reject if path tokens remain (`TooDeep` error)
2. Apply defaults for optional args
3. Check required args are present (`MissingArguments` error)
4. Coerce types and run validators (`InvalidArgument` error)
5. Run handler (with timeout if configured)
6. Catch handler exceptions (`HandlerException` error)

---

### `DynamicBranchNode` (abstract)

Branch whose children are populated lazily from external data with TTL caching.

```ts
import { DynamicBranchNode } from "swiss-army-tool";

class TablesModule extends DynamicBranchNode {
  constructor() {
    super({ name: "tables", description: "Live tables", ttlMs: 30000 });
  }
  protected async refresh() {
    // Query database, add children
  }
}
```

**Constructor:** `new DynamicBranchNode(config: DynamicBranchConfig)`

| Member | Signature | Description |
|--------|-----------|-------------|
| `refresh()` | `protected abstract refresh(): void \| Promise<void>` | Override to populate children |
| `execute(pathTokens, kwargs)` | `async execute(...): Promise<string>` | Refreshes if TTL expired, then routes |
| `getHelp(contextPath)` | `getHelp(contextPath: string): string` | Triggers best-effort refresh, then shows menu |
| `invalidate()` | `invalidate(): void` | Force refresh on next access |

If `refresh()` throws, the error is caught and returned as `[ERROR: RefreshFailed]`.

---

### `Router`

Main entry point. Resolves commands, runs middleware, handles built-ins, paginates output.

```ts
import { Router } from "swiss-army-tool";

const router = new Router(root, session, {
  pageSize: 50,
  maxCommandLength: 1000,
  debug: false,
  logger: console.debug,
});
```

**Constructor:** `new Router(root: BranchNode, session: SessionManager, options?: RouterOptions)`

| Member | Signature | Description |
|--------|-----------|-------------|
| `use(middleware)` | `use(middleware: Middleware): this` | Register middleware |
| `alias(shortcut, full)` | `alias(shortcut: string, fullCommand: string): this` | Register a command alias |
| `execute(command, kwargs?)` | `async execute(command: string, kwargs?: Record<string, unknown>): Promise<string>` | Execute a command and return the response |

**Built-in commands** handled before tree routing:
`help`, `cd`, `pwd`, `ls`, `tree`, `find`, `history`

---

### `SessionManager`

Per-conversation state: CWD, KV store, pins, tags, history.

```ts
import { SessionManager } from "swiss-army-tool";

const session = new SessionManager("session-id", { maxHistorySize: 200 });
```

**Constructor:** `new SessionManager(sessionId?: string, options?: { maxHistorySize?: number })`

| Member | Signature | Description |
|--------|-----------|-------------|
| `sessionId` | `readonly sessionId: string` | Unique ID (auto-UUID if not provided) |
| `cwd` | `cwd: string` | Current working directory (default `"/"`) |
| `kvStore` | `readonly kvStore: Map<string, string>` | Key-value scratchpad |
| `pinnedKeys` | `readonly pinnedKeys: Set<string>` | Pinned key names |
| `kvTags` | `readonly kvTags: Map<string, Set<string>>` | Tags per key |
| `history` | `readonly history: HistoryEntry[]` | Command history |
| `maxHistorySize` | `readonly maxHistorySize: number` | History buffer size (default 100) |
| `resolvePath(input)` | `resolvePath(input: string): string` | Resolve path against CWD |
| `updateCwd(newPath)` | `updateCwd(newPath: string): string` | Change CWD, return new value |
| `getPinnedContext()` | `getPinnedContext(): string` | Format pinned values for injection |
| `setPaginationCache(key, output)` | `setPaginationCache(key: string, fullOutput: string): void` | Cache output for pagination |
| `getPage(key, page, pageSize)` | `getPage(key: string, page: number, pageSize: number): {...} \| null` | Retrieve a page from cache |
| `recordCommand(command)` | `recordCommand(command: string): void` | Append to history |
| `toJSON()` | `toJSON(): Record<string, unknown>` | Serialize session state |
| `fromJSON(data)` | `static fromJSON(data: Record<string, unknown>): SessionManager` | Restore from serialized data |

---

### `TreeBuilder`

Fluent builder for constructing command trees.

```ts
import { TreeBuilder } from "swiss-army-tool";

const root = TreeBuilder.create("root", "Main")
  .branch("db", "Database", db => {
    db.leaf("query", { description: "Run SQL", requiredArgs: ["sql"], handler: ... });
  })
  .build();
```

| Member | Signature | Description |
|--------|-----------|-------------|
| `create(name, desc)` | `static create(name: string, description: string): TreeBuilder` | Create a new builder |
| `branch(name, desc, configure?)` | `branch(name: string, description: string, configure?: (b: TreeBuilder) => void): this` | Add a sub-menu |
| `addBranch(node)` | `addBranch(branchNode: BranchNode): this` | Add a pre-built BranchNode |
| `leaf(name, options)` | `leaf(name: string, options: LeafOptions): this` | Add an action |
| `build()` | `build(): BranchNode` | Return the built BranchNode |

---

### Error Classes

All extend `CLIError`, which extends `Error`.

| Class | Constructor | Produces |
|-------|-------------|----------|
| `CLIError` | `(errorType: string, hint: string, nodeName?: string)` | `[ERROR: {type}] {hint}` |
| `CommandNotFoundError` | `(command: string, parentName?: string)` | `[ERROR: CommandNotFound] ...` |
| `MissingArgsError` | `(missing: string[], nodeName?: string)` | `[ERROR: MissingArguments] ...` |
| `InvalidPathError` | `(path: string, reason?: string)` | `[ERROR: InvalidPath] ...` |
| `TooDeepError` | `(nodeName: string)` | `[ERROR: TooDeep] ...` |

---

## Functions

### `createMemoryModule(session)`

```ts
function createMemoryModule(session: SessionManager): BranchNode
```

Returns a `BranchNode` named `"memory"` with 8 child actions: `set`, `get`, `list`, `search`, `tag`, `pin`, `unpin`, `delete`. All operate on the session's KV store, pinned keys, and tags.

---

### `generateToolSchema(options?)`

```ts
function generateToolSchema(options?: SchemaOptions & { root?: BranchNode }): ToolSchema
```

Generate the single-tool JSON schema for an LLM API. If `root` is provided, the description is enriched with a list of top-level modules and built-in commands.

```ts
const schema = generateToolSchema({ root });
// description includes: "Available top-level modules: database (...), memory (...)."
```

---

### `formatError(errorType, hint, nodeName?)`

```ts
function formatError(errorType: string, hint: string, nodeName?: string): string
```

Format a standardized error string with a contextual tip:
```
[ERROR: CommandNotFound] 'xyz' is not recognized.
Tip: Type 'help root' for usage instructions.
```

---

### Formatters

#### `table(headers, rows)`
```ts
function table(headers: string[], rows: string[][]): string
```
Markdown table with auto-padded columns.

#### `csv(headers, rows)`
```ts
function csv(headers: string[], rows: string[][]): string
```
CSV format. Handles escaping of commas, quotes, and newlines. Fewer tokens than JSON for tabular data.

#### `lineNumbered(text, startLine?)`
```ts
function lineNumbered(text: string, startLine?: number): string
```
Prepend line numbers (1-indexed by default). Useful for file contents.

#### `truncate(text, maxLines, hint?)`
```ts
function truncate(text: string, maxLines: number, hint?: string): string
```
Line-based truncation with a pagination hint appended.

#### `prettyJson(data, maxDepth?)`
```ts
function prettyJson(data: unknown, maxDepth?: number): string
```
Depth-limited JSON pretty-printing. Deep objects are replaced with `{...N keys}`.

#### `digest(text, maxChars)`
```ts
function digest(text: string, maxChars: number): string
```
Character-based truncation: `"text... [N more chars]"`.

---

### Testing Utilities

#### `createTestRouter(root, options?)`
```ts
function createTestRouter(
  root: BranchNode,
  options?: RouterOptions & { sessionId?: string },
): { router: Router; session: SessionManager }
```
Create a Router with an in-memory session. Defaults to `sessionId: "test"`.

#### `mockLeafNode(name, response, description?)`
```ts
function mockLeafNode(name: string, response: string, description?: string): LeafNode
```
Create a LeafNode that always returns the given string.

#### `assertSuccess(result)`
```ts
function assertSuccess(result: string): void
```
Throws if the result does not contain `"SUCCESS"`.

#### `assertError(result, errorType?)`
```ts
function assertError(result: string, errorType?: string): void
```
Throws if the result does not contain `"ERROR"`. If `errorType` is given, also checks for that string.

#### `executeSequence(router, commands)`
```ts
async function executeSequence(
  router: Router,
  commands: Array<{ command: string; kwargs?: Record<string, unknown> }>,
): Promise<string[]>
```
Execute commands sequentially and return all results.

---

### Fuzzy Matching

#### `levenshtein(a, b)`
```ts
function levenshtein(a: string, b: string): number
```
Compute Levenshtein edit distance between two strings.

#### `findClosestMatch(input, candidates, maxDistance?)`
```ts
function findClosestMatch(input: string, candidates: string[], maxDistance?: number): string | undefined
```
Find the closest candidate within `maxDistance` edits (default 3). Case-insensitive. Returns `undefined` if no match is close enough.

---

## Types & Interfaces

### `CLINodeConfig`
```ts
interface CLINodeConfig {
  name: string;
  description: string;
}
```

### `LeafNodeConfig`
```ts
interface LeafNodeConfig extends CLINodeConfig {
  requiredArgs?: string[] | Record<string, ArgDescriptor>;
  optionalArgs?: string[] | Record<string, ArgDescriptor>;
  handler: (kwargs: Record<string, unknown>) => string | Promise<string>;
  timeoutMs?: number;
}
```

### `DynamicBranchConfig`
```ts
interface DynamicBranchConfig extends CLINodeConfig {
  ttlMs?: number;
}
```

### `ArgType`
```ts
type ArgType = "string" | "number" | "boolean" | "json";
```

### `ArgDescriptor`
```ts
interface ArgDescriptor {
  type?: ArgType;
  description?: string;
  default?: unknown;
  validator?: (value: unknown) => boolean;
}
```

### `ToolSchema`
```ts
interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}
```

### `SchemaOptions`
```ts
interface SchemaOptions {
  name?: string;
  description?: string;
}
```

### `RouterOptions`
```ts
interface RouterOptions {
  pageSize?: number;           // Lines per page (default 50)
  maxCommandLength?: number;   // Input length limit (default 1000)
  debug?: boolean;             // Enable debug logging
  logger?: (message: string) => void;  // Custom logger
}
```

### `Middleware`
```ts
type Middleware = (
  ctx: ExecutionContext,
  next: () => Promise<string>,
) => Promise<string>;
```

### `ExecutionContext`
```ts
interface ExecutionContext {
  command: string;
  kwargs: Record<string, unknown>;
  resolvedPath: string;
  session: SessionManager;
}
```

### `HistoryEntry`
```ts
interface HistoryEntry {
  command: string;
  timestamp: number;
}
```

### `LeafOptions`
```ts
interface LeafOptions {
  description: string;
  requiredArgs?: string[] | Record<string, ArgDescriptor>;
  optionalArgs?: string[] | Record<string, ArgDescriptor>;
  handler: (kwargs: Record<string, unknown>) => string | Promise<string>;
}
```
