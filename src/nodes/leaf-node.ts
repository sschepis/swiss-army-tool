import { CLINode } from "./cli-node.js";
import type { LeafNodeConfig, ArgDescriptor, ArgType } from "../types.js";

/** Normalize args config to a consistent format. */
function normalizeArgs(
  args?: string[] | Record<string, ArgDescriptor>,
): { names: string[]; descriptors: Map<string, ArgDescriptor> } {
  if (!args) return { names: [], descriptors: new Map() };

  if (Array.isArray(args)) {
    return {
      names: args,
      descriptors: new Map(args.map((name) => [name, {}])),
    };
  }

  return {
    names: Object.keys(args),
    descriptors: new Map(Object.entries(args)),
  };
}

/** Coerce a value to the specified type. Returns [coerced, error]. */
function coerceValue(
  value: unknown,
  type: ArgType,
  argName: string,
): [unknown, string | null] {
  switch (type) {
    case "string":
      return [String(value), null];
    case "number": {
      const num = Number(value);
      if (isNaN(num)) {
        return [value, `Argument '${argName}' must be a number, got '${value}'.`];
      }
      return [num, null];
    }
    case "boolean": {
      if (typeof value === "boolean") return [value, null];
      if (value === "true" || value === "1") return [true, null];
      if (value === "false" || value === "0") return [false, null];
      return [value, `Argument '${argName}' must be a boolean, got '${value}'.`];
    }
    case "json": {
      if (typeof value === "object" && value !== null) return [value, null];
      if (typeof value === "string") {
        try {
          return [JSON.parse(value), null];
        } catch {
          return [value, `Argument '${argName}' must be valid JSON.`];
        }
      }
      return [value, null];
    }
    default:
      return [value, null];
  }
}

export class LeafNode extends CLINode {
  readonly name: string;
  readonly description: string;
  readonly requiredArgs: string[];
  readonly optionalArgs: string[];
  readonly argDescriptors: Map<string, ArgDescriptor>;
  readonly timeoutMs?: number;
  private readonly handler: (kwargs: Record<string, unknown>) => string | Promise<string>;

  constructor(config: LeafNodeConfig) {
    super();
    this.name = config.name;
    this.description = config.description;
    this.timeoutMs = config.timeoutMs;

    const req = normalizeArgs(config.requiredArgs);
    const opt = normalizeArgs(config.optionalArgs);

    this.requiredArgs = req.names;
    this.optionalArgs = opt.names;
    this.argDescriptors = new Map([...req.descriptors, ...opt.descriptors]);
    this.handler = config.handler;
  }

  isBranch(): boolean {
    return false;
  }

  getHelp(contextPath: string): string {
    const lines: string[] = [
      `=== ${this.name.toUpperCase()} ===`,
      this.description,
    ];

    if (this.requiredArgs.length > 0) {
      lines.push("", "Required arguments:");
      for (const arg of this.requiredArgs) {
        const desc = this.argDescriptors.get(arg);
        const parts = [arg];
        if (desc?.type) parts.push(`(${desc.type})`);
        if (desc?.description) parts.push(`- ${desc.description}`);
        lines.push(`  - ${parts.join(" ")}`);
      }
    }

    if (this.optionalArgs.length > 0) {
      lines.push("", "Optional arguments:");
      for (const arg of this.optionalArgs) {
        const desc = this.argDescriptors.get(arg);
        const parts = [arg];
        if (desc?.type) parts.push(`(${desc.type})`);
        if (desc?.description) parts.push(`- ${desc.description}`);
        if (desc?.default !== undefined) parts.push(`[default: ${desc.default}]`);
        lines.push(`  - ${parts.join(" ")}`);
      }
    }

    lines.push("", `Usage: command="${contextPath}", kwargs={...}`);

    return lines.join("\n");
  }

  async execute(
    pathTokens: string[],
    kwargs: Record<string, unknown>,
  ): Promise<string> {
    if (pathTokens.length > 0) {
      return this.formatError(
        "TooDeep",
        `'${this.name}' is an action, it has no sub-menus.`,
      );
    }

    // Apply defaults for optional args
    const resolvedKwargs = { ...kwargs };
    for (const arg of this.optionalArgs) {
      if (!(arg in resolvedKwargs)) {
        const desc = this.argDescriptors.get(arg);
        if (desc?.default !== undefined) {
          resolvedKwargs[arg] = desc.default;
        }
      }
    }

    const missing = this.requiredArgs.filter((arg) => !(arg in resolvedKwargs));
    if (missing.length > 0) {
      return this.formatError(
        "MissingArguments",
        `You are missing required arguments: ${missing.join(", ")}.`,
      );
    }

    // Type coercion and validation
    for (const [argName, descriptor] of this.argDescriptors) {
      if (!(argName in resolvedKwargs)) continue;

      // Type coercion
      if (descriptor.type) {
        const [coerced, error] = coerceValue(resolvedKwargs[argName], descriptor.type, argName);
        if (error) {
          return this.formatError("InvalidArgument", error);
        }
        resolvedKwargs[argName] = coerced;
      }

      // Custom validation
      if (descriptor.validator && !descriptor.validator(resolvedKwargs[argName])) {
        return this.formatError(
          "InvalidArgument",
          `Argument '${argName}' failed validation.`,
        );
      }
    }

    try {
      if (this.timeoutMs) {
        const handlerPromise = Promise.resolve(this.handler(resolvedKwargs));
        const timeoutPromise = new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error(`Timed out after ${this.timeoutMs}ms`)), this.timeoutMs),
        );
        return await Promise.race([handlerPromise, timeoutPromise]);
      }
      return await this.handler(resolvedKwargs);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      return this.formatError(
        "HandlerException",
        `Command '${this.name}' failed: ${message}`,
      );
    }
  }
}
