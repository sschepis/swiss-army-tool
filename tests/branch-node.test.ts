import { describe, it, expect } from "vitest";
import { BranchNode } from "../src/nodes/branch-node.js";
import { LeafNode } from "../src/nodes/leaf-node.js";

describe("BranchNode", () => {
  function makeTree() {
    const root = new BranchNode({ name: "root", description: "Root menu" });
    const sub = new BranchNode({ name: "sub", description: "Sub menu" });
    const action = new LeafNode({
      name: "greet",
      description: "Say hello",
      requiredArgs: ["name"],
      handler: (kw) => `Hello, ${kw.name}!`,
    });
    sub.addChild(action);
    root.addChild(sub);
    return { root, sub, action };
  }

  it("returns menu when no path tokens", async () => {
    const { root } = makeTree();
    const result = await root.execute([], {});
    expect(result).toContain("ROOT MENU");
    expect(result).toContain("sub");
  });

  it("routes to child nodes", async () => {
    const { root } = makeTree();
    const result = await root.execute(["sub", "greet"], { name: "Alice" });
    expect(result).toBe("Hello, Alice!");
  });

  it("returns error for unknown child", async () => {
    const { root } = makeTree();
    const result = await root.execute(["nope"], {});
    expect(result).toContain("ERROR: CommandNotFound");
    expect(result).toContain("nope");
  });

  it("shows branch icon for sub-menus and action icon for leaves", async () => {
    const { root } = makeTree();
    const menu = await root.execute([], {});
    expect(menu).toContain("\u{1F4C1}");
  });

  it("addChild returns this for chaining", () => {
    const branch = new BranchNode({ name: "b", description: "d" });
    const leaf = new LeafNode({ name: "a", description: "d", handler: () => "ok" });
    const result = branch.addChild(leaf);
    expect(result).toBe(branch);
  });

  it("removeChild works", () => {
    const { root } = makeTree();
    expect(root.children.has("sub")).toBe(true);
    root.removeChild("sub");
    expect(root.children.has("sub")).toBe(false);
  });
});
