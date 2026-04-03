/**
 * Format data as a Markdown table for LLM consumption.
 */
export function table(
  headers: string[],
  rows: string[][],
): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const headerLine = headers
    .map((h, i) => h.padEnd(widths[i]))
    .join(" | ");
  const separator = widths.map((w) => "-".repeat(w)).join(" | ");
  const bodyLines = rows.map((row) =>
    row.map((cell, i) => (cell ?? "").padEnd(widths[i])).join(" | "),
  );

  return [headerLine, separator, ...bodyLines].join("\n");
}

/**
 * Format text with prepended line numbers (1-indexed).
 */
export function lineNumbered(
  text: string,
  startLine = 1,
): string {
  const lines = text.split("\n");
  const maxNum = startLine + lines.length - 1;
  const pad = String(maxNum).length;
  return lines
    .map((line, i) => `${String(startLine + i).padStart(pad)} | ${line}`)
    .join("\n");
}

/**
 * Truncate output to a maximum number of lines, appending a hint.
 */
export function truncate(
  text: string,
  maxLines: number,
  hint?: string,
): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;

  const truncated = lines.slice(0, maxLines).join("\n");
  const remaining = lines.length - maxLines;
  const defaultHint = `[OUTPUT TRUNCATED] ${remaining} more lines. Pass kwargs={page: 2} to view more.`;
  return `${truncated}\n${hint ?? defaultHint}`;
}

/**
 * Format data as CSV text (fewer tokens than JSON for tabular data).
 */
export function csv(
  headers: string[],
  rows: string[][],
): string {
  const escape = (cell: string) =>
    cell.includes(",") || cell.includes('"') || cell.includes("\n")
      ? `"${cell.replace(/"/g, '""')}"`
      : cell;

  const headerLine = headers.map(escape).join(",");
  const bodyLines = rows.map((row) => row.map(escape).join(","));
  return [headerLine, ...bodyLines].join("\n");
}

/**
 * Pretty-print JSON with optional depth limit for LLM readability.
 */
export function prettyJson(
  data: unknown,
  maxDepth = 4,
): string {
  function stringify(value: unknown, depth: number): string {
    if (depth > maxDepth) return '"[...]"';
    if (value === null || value === undefined) return String(value);
    if (typeof value !== "object") return JSON.stringify(value);

    if (Array.isArray(value)) {
      if (value.length === 0) return "[]";
      if (depth === maxDepth) return `[...${value.length} items]`;
      const items = value.map((v) => stringify(v, depth + 1));
      return `[${items.join(", ")}]`;
    }

    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    if (depth === maxDepth) return `{...${entries.length} keys}`;
    const pad = "  ".repeat(depth + 1);
    const closePad = "  ".repeat(depth);
    const lines = entries.map(
      ([k, v]) => `${pad}${JSON.stringify(k)}: ${stringify(v, depth + 1)}`,
    );
    return `{\n${lines.join(",\n")}\n${closePad}}`;
  }

  return stringify(data, 0);
}

/**
 * Character-based truncation (vs. line-based in `truncate`).
 * Returns the first `maxChars` characters with a trailing hint.
 */
export function digest(
  text: string,
  maxChars: number,
): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}... [${text.length - maxChars} more chars]`;
}
