import { BranchNode } from "./nodes/branch-node.js";
import { LeafNode } from "./nodes/leaf-node.js";
import type { LeafNodeConfig, ArgDescriptor } from "./types.js";

export interface LeafOptions {
  description: string;
  requiredArgs?: string[] | Record<string, ArgDescriptor>;
  optionalArgs?: string[] | Record<string, ArgDescriptor>;
  handler: LeafNodeConfig["handler"];
}

/**
 * Fluent builder for constructing command trees.
 *
 * ```ts
 * const root = TreeBuilder.create("root", "Main system")
 *   .branch("database", "Query the DB", db => {
 *     db.leaf("query", { description: "Run SQL", requiredArgs: ["sql"], handler: ... });
 *   })
 *   .leaf("status", { description: "System status", handler: ... })
 *   .build();
 * ```
 */
export class TreeBuilder {
  private readonly node: BranchNode;

  private constructor(name: string, description: string) {
    this.node = new BranchNode({ name, description });
  }

  static create(name: string, description: string): TreeBuilder {
    return new TreeBuilder(name, description);
  }

  /** Add a branch (sub-menu) with a callback to define its children. */
  branch(
    name: string,
    description: string,
    configure?: (builder: TreeBuilder) => void,
  ): this {
    const childBuilder = new TreeBuilder(name, description);
    if (configure) {
      configure(childBuilder);
    }
    this.node.addChild(childBuilder.node);
    return this;
  }

  /** Add a pre-built BranchNode directly. */
  addBranch(branchNode: BranchNode): this {
    this.node.addChild(branchNode);
    return this;
  }

  /** Add a leaf (executable action). */
  leaf(name: string, options: LeafOptions): this {
    this.node.addChild(
      new LeafNode({
        name,
        description: options.description,
        requiredArgs: options.requiredArgs,
        optionalArgs: options.optionalArgs,
        handler: options.handler,
      }),
    );
    return this;
  }

  /** Build and return the root BranchNode. */
  build(): BranchNode {
    return this.node;
  }
}
