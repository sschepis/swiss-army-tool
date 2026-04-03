# Error Handling

Complete error taxonomy, recovery patterns, and how the LLM experiences errors.

---

## Error Format

All errors follow a consistent format:

```
[ERROR: ErrorType] Human-readable message describing what went wrong.
Tip: Actionable suggestion for how to fix it.
```

The `Tip` line guides the LLM toward self-correction. This structure is critical — LLMs recover reliably from errors when the error message tells them *exactly* what went wrong and *exactly* how to fix it.

---

## Error Taxonomy

### `CommandNotFound`

**Trigger:** A command path token doesn't match any child in the current branch.

**Message:**
```
[ERROR: CommandNotFound] 'databse' is not recognized under 'root'.
Did you mean: database?
Tip: Type 'help root' for usage instructions.
```

**Fuzzy suggestion:** If the input is within 3 Levenshtein edits of an existing child name, the suggestion is included. Otherwise the "Did you mean" line is omitted.

**LLM recovery:** The LLM re-reads the suggestion and retries with the correct name.

---

### `MissingArguments`

**Trigger:** A `LeafNode` is executed without one or more required arguments.

**Message:**
```
[ERROR: MissingArguments] You are missing required arguments: sql, limit.
Tip: Type 'help database/query' for usage instructions.
```

**LLM recovery:** The LLM runs `help` on the command to see the argument spec, then retries with the correct kwargs.

---

### `InvalidArgument`

**Trigger:** Type coercion fails or a custom validator returns `false`.

**Type coercion failure:**
```
[ERROR: InvalidArgument] Argument 'limit' must be a number, got 'abc'.
Tip: Type 'help database/query' for usage instructions.
```

**Validator failure:**
```
[ERROR: InvalidArgument] Argument 'port' failed validation.
Tip: Type 'help connect' for usage instructions.
```

**LLM recovery:** The LLM adjusts the argument value and retries.

---

### `TooDeep`

**Trigger:** Trying to route further into a `LeafNode` (which has no children).

**Message:**
```
[ERROR: TooDeep] 'query' is an action, it has no sub-menus.
Tip: Type 'help query' for usage instructions.
```

**LLM recovery:** The LLM realizes it passed too many path segments and removes the extra tokens.

---

### `InvalidPath`

**Trigger:** `cd` targets a non-existent path or a leaf node.

**Non-existent:**
```
[ERROR: InvalidPath] Directory '/database/nope' does not exist.
Did you mean: tables?
Tip: Run 'help' to see the main menu.
```

**Leaf node:**
```
[ERROR: InvalidPath] '/database/query' is an executable action, not a directory. You cannot 'cd' into it.
Tip: Run 'help' to see the main menu.
```

**LLM recovery:** The LLM uses `help` or `ls` to see what exists at that path.

---

### `InvalidInput`

**Trigger:** The command string exceeds `maxCommandLength` (default 1000 characters).

**Message:**
```
[ERROR: InvalidInput] Command exceeds maximum length of 1000 characters.
Tip: Run 'help' to see the main menu.
```

**LLM recovery:** The LLM shortens the command, possibly using `cd` to set a working directory and then using relative paths.

---

### `HandlerException`

**Trigger:** A `LeafNode`'s handler function throws an exception (sync or async).

**Message:**
```
[ERROR: HandlerException] Command 'query' failed: Connection refused.
Tip: Type 'help query' for usage instructions.
```

This catches:
- Thrown `Error` objects (message is used)
- Thrown strings or other values ("An unexpected error occurred.")
- Timeout expiry: `"Command 'query' failed: Timed out after 30000ms"`

**LLM recovery:** The LLM reads the error, adjusts its approach (different args, retry, or use a different command).

---

### `RefreshFailed`

**Trigger:** A `DynamicBranchNode`'s `refresh()` method throws.

**Message:**
```
[ERROR: RefreshFailed] Failed to refresh 'tables': Connection timeout.
Tip: Type 'help tables' for usage instructions.
```

This error is caught inside `DynamicBranchNode.execute()`. The error is returned as a string, not thrown. The node's children remain empty until the next successful refresh.

**LLM recovery:** The LLM may retry after a pause, or try a different approach.

---

### `SystemFault`

**Trigger:** An uncaught exception in the router's execution pipeline (after middleware and tree traversal).

**Message:**
```
[ERROR: SystemFault] An unexpected error occurred.
Tip: Run 'help' to see the main menu.
```

This is the catch-all. If you see this in production, it indicates a bug in either your handler code or the framework.

---

### `KeyNotFound` (Memory module)

**Trigger:** `memory get`, `memory pin`, or `memory tag` is called with a key that doesn't exist.

**Message:**
```
[ERROR: KeyNotFound] 'my_key' does not exist in the scratchpad.
Tip: Use command='memory list' to see all stored keys.
```

**LLM recovery:** The LLM runs `memory list` to see available keys.

---

## The Self-Correcting Loop

The error format is designed to keep the LLM in a productive loop:

```
LLM → wrong command → framework returns error with hint
LLM → reads hint → runs help or corrects args
LLM → retries with correct input → success
```

Example interaction:

```
Turn 1: terminal_interface(command="databse query")
→ [ERROR: CommandNotFound] 'databse' is not recognized under 'root'.
  Did you mean: database?

Turn 2: terminal_interface(command="database query")
→ [ERROR: MissingArguments] You are missing required arguments: sql.
  Tip: Type 'help database/query' for usage instructions.

Turn 3: terminal_interface(command="help database query")
→ === QUERY ===
  Run a SQL query.

  Required arguments:
    - sql (string) - The SQL statement to execute

  Optional arguments:
    - limit (number) - Max rows [default: 100]

Turn 4: terminal_interface(command="database query", kwargs={sql: "SELECT * FROM users"})
→ [SUCCESS] Query executed. [{"id": 1, "name": "Alice"}]
```

Each error narrows the solution space. By Turn 4, the LLM has everything it needs.

---

## Custom Error Handling in Handlers

### Returning errors directly

Handlers can return error strings without throwing:

```ts
handler: (kw) => {
  const user = db.findUser(String(kw.id));
  if (!user) {
    return `[ERROR: NotFound] User '${kw.id}' does not exist.\nTip: Use command='users list' to see all users.`;
  }
  return `[SUCCESS] ${JSON.stringify(user)}`;
}
```

### Using CLIError subclasses

You can throw framework error classes for consistency:

```ts
import { CommandNotFoundError } from "swiss-army-tool";

handler: (kw) => {
  if (!isValid(kw.input)) {
    throw new Error("Invalid input format");
    // Caught by LeafNode → [ERROR: HandlerException] Command 'x' failed: Invalid input format
  }
  return "[SUCCESS] Done";
}
```

### Timeout errors

Set `timeoutMs` on a LeafNode to prevent hung handlers:

```ts
new LeafNode({
  name: "slow_query",
  timeoutMs: 5000,
  handler: async () => {
    // If this takes > 5s:
    // [ERROR: HandlerException] Command 'slow_query' failed: Timed out after 5000ms
  },
});
```

---

## Error Class Hierarchy

```
Error
└── CLIError
    ├── CommandNotFoundError
    ├── MissingArgsError
    ├── InvalidPathError
    └── TooDeepError
```

All `CLIError` subclasses have:
- `errorType: string` — Machine-readable type (e.g., `"CommandNotFound"`)
- `hint: string` — Human-readable message
- `nodeName?: string` — The node that generated the error (used in the tip)

The `formatError()` function produces the standardized string format without requiring class instantiation:

```ts
import { formatError } from "swiss-army-tool";

const msg = formatError("CustomError", "Something went wrong.", "my_command");
// [ERROR: CustomError] Something went wrong.
// Tip: Type 'help my_command' for usage instructions.
```
