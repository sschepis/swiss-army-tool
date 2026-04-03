export interface CLINodeConfig {
  name: string;
  description: string;
}

export type ArgType = "string" | "number" | "boolean" | "json";

export interface ArgDescriptor {
  type?: ArgType;
  description?: string;
  default?: unknown;
  validator?: (value: unknown) => boolean;
}

export interface LeafNodeConfig extends CLINodeConfig {
  requiredArgs?: string[] | Record<string, ArgDescriptor>;
  optionalArgs?: string[] | Record<string, ArgDescriptor>;
  handler: (kwargs: Record<string, unknown>) => string | Promise<string>;
  /** Timeout in milliseconds for handler execution. */
  timeoutMs?: number;
}

export interface DynamicBranchConfig extends CLINodeConfig {
  ttlMs?: number;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface SchemaOptions {
  name?: string;
  description?: string;
}
