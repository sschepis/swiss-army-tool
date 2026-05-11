import { CLINode } from "./cli-node.js";
import { LeafNode } from "./leaf-node.js";
import type { CLINodeConfig } from "../types.js";
import { findClosestMatch } from "../utils/fuzzy.js";

export class BranchNode extends CLINode {
  readonly name: string;
  readonly description: string;
  readonly children: Map<string, CLINode> = new Map();

  constructor(config: CLINodeConfig) {
    super();
    this.name = config.name;
    this.description = config.description;
  }

  isBranch(): boolean {
    return true;
  }

  addChild(node: CLINode, options?: { overwrite?: boolean }): this {
    if (this.children.has(node.name) && !options?.overwrite) {
      throw new Error(
        `Namespace collision: '${node.name}' already exists under '${this.name}'. ` +
        `Pass { overwrite: true } to replace it.`,
      );
    }
    this.children.set(node.name, node);
    return this;
  }

  removeChild(name: string): boolean {
    return this.children.delete(name);
  }

  getHelp(contextPath: string): string {
    return this.generateMenu(contextPath);
  }

  async execute(
    pathTokens: string[],
    kwargs: Record<string, unknown>,
  ): Promise<string> {
    if (pathTokens.length === 0) {
      return this.generateMenu();
    }

    const next = pathTokens[0];
    const remaining = pathTokens.slice(1);

    if (next === "help") {
      if (remaining.length === 0) {
        return this.generateMenu();
      }
      const target = this.children.get(remaining[0]);
      if (!target) {
        const suggestion = findClosestMatch(remaining[0], [...this.children.keys()]);
        const available = [...this.children.keys()].join(", ");
        const hint = suggestion
          ? `\nDid you mean: ${suggestion}?\nAvailable under '${this.name}': ${available}`
          : `\nAvailable under '${this.name}': ${available}`;
        return this.formatError(
          "CommandNotFound",
          `'${remaining[0]}' is not recognized under '${this.name}'.${hint}`,
        );
      }
      return target.getHelp(`${this.name}/${remaining[0]}`);
    }

    const child = this.children.get(next);
    if (!child) {
      const suggestion = findClosestMatch(next, [...this.children.keys()]);
      let hint = "";
      if (suggestion) {
        const suggestedChild = this.children.get(suggestion)!;
        hint = `\nDid you mean: ${suggestion}?`;
        if (suggestedChild instanceof LeafNode) {
          hint += `\n\nCorrect invocation:\n  command="${this.name}/${suggestion}"`;
          if (suggestedChild.requiredArgs.length > 0) {
            const example = Object.fromEntries(
              suggestedChild.requiredArgs.map((a) => {
                const desc = suggestedChild.argDescriptors.get(a);
                return [a, desc?.description ? `<${desc.description}>` : `<${a}>`];
              }),
            );
            hint += `, kwargs=${JSON.stringify(example)}`;
          }
        } else {
          hint += `\n\nTry: command="${this.name}/${suggestion}" or command="help ${this.name}/${suggestion}"`;
        }
      } else {
        const available = [...this.children.keys()].join(", ");
        hint = `\nAvailable under '${this.name}': ${available}`;
      }
      return this.formatError(
        "CommandNotFound",
        `'${next}' is not recognized under '${this.name}'.${hint}`,
      );
    }

    return child.execute(remaining, kwargs);
  }

  protected generateMenu(contextPath?: string): string {
    const header = `=== ${this.name.toUpperCase()} MENU ===`;
    const lines: string[] = [header, this.description, "", "Available Options:"];

    const path = contextPath || this.name;

    for (const [, child] of this.children) {
      const icon = child.isBranch() ? "\u{1F4C1}" : "\u26A1";
      lines.push(`  ${icon} ${child.name.padEnd(15)} : ${child.description}`);
      if (child instanceof LeafNode && child.requiredArgs.length > 0) {
        const example = Object.fromEntries(
          child.requiredArgs.map((a) => {
            const desc = child.argDescriptors.get(a);
            return [a, desc?.description ? `<${desc.description}>` : `<${a}>`];
          }),
        );
        lines.push(`${"".padEnd(20)}   \u21B3 command="${path}/${child.name}", kwargs=${JSON.stringify(example)}`);
      }
    }

    lines.push("");
    lines.push(`Usage: command="${path}/<option>", kwargs={...}`);
    lines.push(`Help:  command="help ${path}/<option>"`);

    return lines.join("\n");
  }
}
