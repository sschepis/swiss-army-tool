import { formatError } from "../errors.js";

export abstract class CLINode {
  abstract readonly name: string;
  abstract readonly description: string;

  abstract getHelp(contextPath: string): string;

  abstract execute(
    pathTokens: string[],
    kwargs: Record<string, unknown>,
  ): string | Promise<string>;

  formatError(errorType: string, hint: string): string {
    return formatError(errorType, hint, this.name);
  }

  abstract isBranch(): boolean;
}
