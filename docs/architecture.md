# Architecture

This document explains the internal design of `swiss-army-tool` for contributors and advanced consumers.

## Overview

Most LLM integrations expose 10-30 individual tool definitions. Each tool requires its own JSON schema, and the LLM must reason over all of them simultaneously. This creates schema bloat, decision paralysis, and fragile tool selection.

`swiss-army-tool` takes a different approach: **one tool, one schema, infinite capabilities.** The LLM is given a single function (`terminal_interface`) and discovers what it can do by navigating a hierarchical command tree — the same way a developer navigates a CLI.

This forces the LLM into a chain-of-thought exploration loop:

```
help → explore menu → read help for command → provide args → execute
```

The result is more stable reasoning and fewer hallucinated tool calls.

## Node Hierarchy

The command tree is built from three node types, all inheriting from `CLINode`:

```
                    CLINode (abstract)
                   /        \
            BranchNode      LeafNode
               |
       DynamicBranchNode
```

| Class | Role | `isBranch()` |
|-------|------|:------------:|
| `BranchNode` | Directory / menu. Contains children. Routes commands downward. | `true` |
| `LeafNode` | Executable action. Validates args, runs handler, returns result. | `false` |
| `DynamicBranchNode` | Branch whose children are populated lazily from external data. | `true` |

Every node has a `name`, `description`, `getHelp()`, and `execute()`. The tree is walked top-down: the root `BranchNode` receives tokenized path segments and recursively delegates to children until it reaches a `LeafNode` or runs out of tokens.

### Namespace Collision Detection

`BranchNode.addChild()` throws if a child with the same name already exists:

```
Namespace collision: 'query' already exists under 'database'.
Pass { overwrite: true } to replace it.
```

This prevents accidental overwrites. Pass `{ overwrite: true }` to intentionally replace a child (useful in `DynamicBranchNode.refresh()`).

## Command Resolution Pipeline

When the LLM calls `router.execute(command, kwargs)`, the following pipeline runs:

```
                         ┌─────────────────────────┐
                         │   router.execute(cmd)    │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │   Input Sanitization     │
                         │  (length check)          │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │   Record in History      │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │   Alias Resolution       │
                         │  "q" → "database query"  │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │   Built-in Dispatch      │
                         │  pwd, cd, tree, ls,      │
                         │  history, find, help     │
                         └────────────┬────────────┘
                                      │ (not a built-in)
                         ┌────────────▼────────────┐
                         │   Path Normalization     │
                         │  spaces → slashes        │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │   CWD Resolution         │
                         │  resolve against cwd     │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │   Token Splitting        │
                         │  "/db/query" → ["db",    │
                         │                "query"]  │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │   Middleware Chain        │
                         │  (onion model)           │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │   Tree Traversal         │
                         │  root.execute(tokens,    │
                         │               kwargs)    │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │   Pagination             │
                         │  (if output > pageSize)  │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │   Wrapping               │
                         │  pinned context +        │
                         │  breadcrumb + output     │
                         └────────────┘
```

### Step-by-step:

1. **Input Sanitization** — Reject commands exceeding `maxCommandLength` (default 1000).
2. **History Recording** — Append to the session's bounded history ring buffer.
3. **Alias Resolution** — Check if the command starts with a registered alias and expand it.
4. **Built-in Dispatch** — Intercept `pwd`, `cd`, `tree`, `ls`, `history`, `find`, `help`. These bypass middleware and tree traversal.
5. **Path Normalization** — Convert spaces to slashes: `"cloud aws ls"` → `"cloud/aws/ls"`.
6. **CWD Resolution** — Resolve relative to the session's current working directory using POSIX path rules. Paths starting with `/` are treated as absolute.
7. **Token Splitting** — Split the resolved path into tokens: `"/cloud/aws/ls"` → `["cloud", "aws", "ls"]`.
8. **Middleware Chain** — Execute middleware in onion order (first registered = outermost).
9. **Tree Traversal** — Walk the root `BranchNode` with the tokens. Each `BranchNode` pops one token and delegates to the matching child. When tokens are exhausted at a `BranchNode`, the menu is returned. When a `LeafNode` is reached with no remaining tokens, args are validated and the handler runs.
10. **Pagination** — If the output exceeds `pageSize` lines, cache the full output and return just the first page with a navigation hint.
11. **Wrapping** — Prepend pinned memory context and a `[Context: /path]` breadcrumb.

## Session Lifecycle

`SessionManager` holds all per-conversation state:

| Field | Type | Purpose |
|-------|------|---------|
| `sessionId` | `string` | Unique identifier (auto-generated UUID if not provided) |
| `cwd` | `string` | Current working directory (default `"/"`) |
| `kvStore` | `Map<string, string>` | Key-value scratchpad |
| `pinnedKeys` | `Set<string>` | Keys whose values are injected into every response |
| `kvTags` | `Map<string, Set<string>>` | Tags associated with memory keys |
| `history` | `HistoryEntry[]` | Bounded ring buffer of commands (default max 100) |
| `paginationCache` | internal | Cached output for page retrieval |

### Path Resolution

`resolvePath()` uses POSIX rules:
- Empty / `"."` → returns CWD
- Starts with `"/"` → absolute (resolved from root)
- Otherwise → relative (resolved from CWD)
- `".."` → parent directory

### Serialization

`toJSON()` serializes the full session state (KV store, pins, tags, history, CWD) to a plain object. `SessionManager.fromJSON()` restores it. This enables persistence across server restarts.

## Memory Module

`createMemoryModule(session)` returns a `BranchNode` with 8 leaf actions wired to the session's KV store:

```
/memory
├── ⚡ set       — Write key/value with optional tags
├── ⚡ get       — Retrieve value (shows tags)
├── ⚡ list      — List keys, filter by prefix or tag
├── ⚡ search    — Substring search across keys and values
├── ⚡ tag       — Add/replace tags on a key
├── ⚡ pin       — Pin key for automatic context injection
├── ⚡ unpin     — Remove a pin
└── ⚡ delete    — Delete key (also unpins and removes tags)
```

**Pinned context injection:** On every `Router.execute()` call, the router calls `session.getPinnedContext()` and prepends it to the output. This makes pinned values visible to the LLM on every turn without the LLM needing to explicitly retrieve them.

## Middleware Pipeline

Middleware follows the onion model (like Koa or Express):

```ts
router.use(async (ctx, next) => {
  // Before execution
  const result = await next();
  // After execution
  return result;
});
```

Key details:
- First registered middleware = outermost layer
- `ctx` contains `{ command, kwargs, resolvedPath, session }`
- Middleware can modify the return value, short-circuit execution, add timing, etc.
- **Only tree-routed commands** pass through middleware. Built-ins (`cd`, `pwd`, `help`, `ls`, `tree`, `find`, `history`) bypass the middleware chain.

## Pagination

When a command produces output exceeding `pageSize` lines (default 50):

1. The full output is cached in `session.paginationCache`
2. Only the first `pageSize` lines are returned
3. A hint is appended: `[OUTPUT TRUNCATED] 450 more lines (page 1/10). Pass kwargs={page: 2} to view more.`
4. On subsequent calls with `kwargs.page`, the cached output is retrieved and the requested page is returned

The cache stores only one output at a time (keyed by command path). A new command overwrites the previous cache.

## Dynamic Branches

`DynamicBranchNode` extends `BranchNode` with lazy loading:

1. On first `execute()` or `getHelp()`, if the TTL has expired, `children.clear()` is called and `refresh()` runs
2. `refresh()` is implemented by subclasses to populate children (e.g., by querying a database for table names)
3. Results are cached for `ttlMs` milliseconds (default 60s)
4. `invalidate()` forces a refresh on the next access
5. If `refresh()` throws, the error is caught and returned as `[ERROR: RefreshFailed]` instead of crashing

Since `getHelp()` is synchronous in the base class, `DynamicBranchNode` overrides it to trigger a best-effort synchronous refresh. If `refresh()` is async, it fires and forgets — the next `execute()` call will guarantee freshness.

## Fuzzy Matching

When a command is not found, `BranchNode` computes the Levenshtein distance between the input and all child names. If the closest match is within 3 edits, it's suggested:

```
[ERROR: CommandNotFound] 'databse' is not recognized under 'root'.
Did you mean: database?
Tip: Type 'help root' for usage instructions.
```

The `levenshtein()` and `findClosestMatch()` functions are exported for consumer use.

## Argument Validation

`LeafNode` supports rich argument descriptors:

```ts
requiredArgs: {
  sql: { type: "string", description: "SQL query" },
  limit: { type: "number", description: "Max rows", default: 100 }
}
```

On execution:
1. Defaults are applied for missing optional args
2. Required args are checked for presence
3. Type coercion runs: `"42"` → `42` for number type
4. Custom validators run if provided
5. Errors are returned as actionable messages: `"Argument 'limit' must be a number, got 'abc'."`

Handler exceptions are caught and returned as `[ERROR: HandlerException]` with the command name for context.

If `timeoutMs` is set, the handler is raced against a timer. Timeout produces: `"Command 'query' failed: Timed out after 30000ms"`.
