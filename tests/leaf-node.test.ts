import { describe, it, expect } from "vitest";
import { LeafNode } from "../src/nodes/leaf-node.js";

describe("LeafNode", () => {
  it("executes handler with kwargs", async () => {
    const node = new LeafNode({
      name: "echo",
      description: "Echoes input",
      requiredArgs: ["msg"],
      handler: (kw) => `Echo: ${kw.msg}`,
    });
    const result = await node.execute([], { msg: "hi" });
    expect(result).toBe("Echo: hi");
  });

  it("returns error for missing required args", async () => {
    const node = new LeafNode({
      name: "echo",
      description: "Echoes input",
      requiredArgs: ["msg", "count"],
      handler: () => "ok",
    });
    const result = await node.execute([], {});
    expect(result).toContain("ERROR: MissingArguments");
    expect(result).toContain("msg");
    expect(result).toContain("count");
  });

  it("returns error when path tokens remain (TooDeep)", async () => {
    const node = new LeafNode({
      name: "echo",
      description: "Echoes input",
      handler: () => "ok",
    });
    const result = await node.execute(["extra"], {});
    expect(result).toContain("ERROR: TooDeep");
  });

  it("supports async handlers", async () => {
    const node = new LeafNode({
      name: "async",
      description: "Async action",
      handler: async () => "async result",
    });
    const result = await node.execute([], {});
    expect(result).toBe("async result");
  });

  it("isBranch returns false", () => {
    const node = new LeafNode({ name: "x", description: "x", handler: () => "" });
    expect(node.isBranch()).toBe(false);
  });

  it("getHelp shows required and optional args", () => {
    const node = new LeafNode({
      name: "query",
      description: "Run a query",
      requiredArgs: ["sql"],
      optionalArgs: ["limit"],
      handler: () => "",
    });
    const help = node.getHelp("database/query");
    expect(help).toContain("QUERY");
    expect(help).toContain("sql");
    expect(help).toContain("limit");
    expect(help).toContain("Required");
    expect(help).toContain("Optional");
  });
});
