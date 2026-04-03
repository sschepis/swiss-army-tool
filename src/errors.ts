export class CLIError extends Error {
  constructor(
    public readonly errorType: string,
    public readonly hint: string,
    public readonly nodeName?: string,
  ) {
    super(`[ERROR: ${errorType}] ${hint}`);
    this.name = "CLIError";
  }
}

export class CommandNotFoundError extends CLIError {
  constructor(command: string, parentName?: string) {
    super(
      "CommandNotFound",
      `'${command}' is not recognized${parentName ? ` under '${parentName}'` : ""}.`,
      parentName,
    );
  }
}

export class MissingArgsError extends CLIError {
  constructor(missing: string[], nodeName?: string) {
    super(
      "MissingArguments",
      `You are missing required arguments: ${missing.join(", ")}.`,
      nodeName,
    );
  }
}

export class InvalidPathError extends CLIError {
  constructor(path: string, reason?: string) {
    super(
      "InvalidPath",
      reason || `'${path}' does not exist.`,
    );
  }
}

export class TooDeepError extends CLIError {
  constructor(nodeName: string) {
    super(
      "TooDeep",
      `'${nodeName}' is an action, it has no sub-menus.`,
      nodeName,
    );
  }
}

export function formatError(errorType: string, hint: string, nodeName?: string): string {
  const tip = nodeName
    ? `\nTip: Type 'help ${nodeName}' for usage instructions.`
    : `\nTip: Run 'help' to see the main menu.`;
  return `[ERROR: ${errorType}] ${hint}${tip}`;
}
