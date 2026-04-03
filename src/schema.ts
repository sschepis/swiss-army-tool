import type { ToolSchema, SchemaOptions } from "./types.js";
import type { BranchNode } from "./nodes/branch-node.js";

const DEFAULT_NAME = "terminal_interface";
const DEFAULT_DESCRIPTION =
  "Your central interface to interact with the system. Use commands to navigate menus and execute actions. If you are unsure what to do, use the 'help' command.";

/**
 * Generate the Omni-Tool JSON schema to pass to any LLM API.
 * Optionally introspects a command tree to enrich the description with
 * available top-level modules.
 */
export function generateToolSchema(options?: SchemaOptions & { root?: BranchNode }): ToolSchema {
  let description = options?.description ?? DEFAULT_DESCRIPTION;

  // Auto-generate module list from tree if provided
  if (options?.root) {
    const modules: string[] = [];
    for (const [, child] of options.root.children) {
      modules.push(`${child.name} (${child.description})`);
    }
    if (modules.length > 0) {
      description += `\n\nAvailable top-level modules: ${modules.join(", ")}.`;
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
