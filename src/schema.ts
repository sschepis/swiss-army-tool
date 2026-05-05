import type { ToolSchema, SchemaOptions } from "./types.js";
import type { BranchNode } from "./nodes/branch-node.js";
import type { CLINode } from "./nodes/cli-node.js";
import { LeafNode } from "./nodes/leaf-node.js";

const DEFAULT_NAME = "terminal_interface";
const DEFAULT_DESCRIPTION =
  "Your central interface to interact with the system. Use commands to navigate menus and execute actions. If you are unsure what to do, use the 'help' command.";

function collectLeafSignatures(node: CLINode, prefix: string): string[] {
  if (node instanceof LeafNode) {
    const args = node.requiredArgs;
    const sig = args.length > 0 ? ` (kwargs: {${args.join(", ")}})` : "";
    return [`  ${prefix}${sig} — ${node.description}`];
  }
  if (node.isBranch()) {
    const branch = node as BranchNode;
    const lines: string[] = [];
    for (const [, child] of branch.children) {
      lines.push(...collectLeafSignatures(child, `${prefix}/${child.name}`));
    }
    return lines;
  }
  return [];
}

/**
 * Generate the Omni-Tool JSON schema to pass to any LLM API.
 * Optionally introspects a command tree to enrich the description with
 * available top-level modules.
 */
export function generateToolSchema(options?: SchemaOptions & { root?: BranchNode }): ToolSchema {
  let description = options?.description ?? DEFAULT_DESCRIPTION;

  // Auto-generate command reference from tree if provided
  if (options?.root) {
    const signatures: string[] = [];
    for (const [, child] of options.root.children) {
      signatures.push(...collectLeafSignatures(child, child.name));
    }
    if (signatures.length > 0) {
      description += "\n\nCommands:\n" + signatures.join("\n");
    }
    description += "\n\nBuilt-in commands: help, cd, pwd, ls, tree, find, history.";
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
