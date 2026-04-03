import { CLINode } from "./cli-node.js";
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
        const hint = suggestion ? `\nDid you mean: ${suggestion}?` : "";
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
      const hint = suggestion ? `\nDid you mean: ${suggestion}?` : "";
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

    for (const [, child] of this.children) {
      const icon = child.isBranch() ? "\u{1F4C1}" : "\u26A1";
      lines.push(`  ${icon} ${child.name.padEnd(15)} : ${child.description}`);
    }

    const path = contextPath || this.name;
    lines.push("");
    lines.push(`Usage: command="${path} <option>"`);
    lines.push(`Example: command="help ${path} <option>"`);

    return lines.join("\n");
  }
}
