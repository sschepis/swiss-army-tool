import type { ToolSchema, SchemaOptions } from "./types.js";
import type { BranchNode } from "./nodes/branch-node.js";
import type { CLINode } from "./nodes/cli-node.js";
import { LeafNode } from "./nodes/leaf-node.js";

const DEFAULT_NAME = "terminal_interface";
const DEFAULT_DESCRIPTION =
  "Your central interface to interact with the system. Use commands to navigate menus and execute actions. If you are unsure what to do, use the 'help' command.";

function collectBranchSummaries(root: BranchNode): string[] {
  const lines: string[] = [];
  for (const [, child] of root.children) {
    if (child.isBranch()) {
      const branch = child as BranchNode;
      const leafCount = countLeaves(branch);
      const desc = branch.description.split(/[.\n]/)[0];
      lines.push(`  ${child.name}/ (${leafCount} commands) — ${desc}`);
    } else {
      lines.push(`  ${child.name} — ${child.description.split(/[.\n]/)[0]}`);
    }
  }
  return lines;
}

function countLeaves(node: CLINode): number {
  if (node instanceof LeafNode) return 1;
  if (node.isBranch()) {
    let count = 0;
    for (const [, child] of (node as BranchNode).children) {
      count += countLeaves(child);
    }
    return count;
  }
  return 0;
}

/**
 * Generate the Omni-Tool JSON schema to pass to any LLM API.
 * Optionally introspects a command tree to enrich the description with
 * available top-level modules (branch names only — use `help` for details).
 */
export function generateToolSchema(options?: SchemaOptions & { root?: BranchNode }): ToolSchema {
  let description = options?.description ?? DEFAULT_DESCRIPTION;

  if (options?.root) {
    const summaries = collectBranchSummaries(options.root);
    if (summaries.length > 0) {
      description += "\n\nModules:\n" + summaries.join("\n");
    }
    description += "\n\nUse `help <module>` to see available commands. Built-in: help, cd, pwd, ls, tree, find, history.";
  }

  return {
    name: options?.name ?? DEFAULT_NAME,
    description,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "The command or menu path (e.g., 'help', 'filesystem read', 'db query')",
        },
        kwargs: {
          type: "object",
          description: "Key-value arguments for the command.",
          additionalProperties: true,
        },
      },
      required: ["command"],
    },
  };
}
