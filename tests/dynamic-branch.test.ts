import { describe, it, expect, vi } from "vitest";
import { DynamicBranchNode } from "../src/nodes/dynamic-branch-node.js";
import { LeafNode } from "../src/nodes/leaf-node.js";

class TestDynamicBranch extends DynamicBranchNode {
  refreshCount = 0;

  protected refresh(): void {
    this.refreshCount++;
    this.addChild(
      new LeafNode({
        name: "item",
        description: "Dynamic item",
        handler: () => `[SUCCESS] Item from refresh #${this.refreshCount}`,
      }),
    );
  }
}

describe("DynamicBranchNode", () => {
  it("calls refresh on first execute", async () => {
    const node = new TestDynamicBranch({ name: "dyn", description: "Dynamic" });
    const result = await node.execute(["item"], {});
    expect(result).toContain("SUCCESS");
    expect(node.refreshCount).toBe(1);
  });

  it("caches within TTL", async () => {
    const node = new TestDynamicBranch({
      name: "dyn",
      description: "Dynamic",
      ttlMs: 60000,
    });
    await node.execute(["item"], {});
    await node.execute(["item"], {});
    expect(node.refreshCount).toBe(1);
  });

  it("refreshes after TTL expires", async () => {
    const node = new TestDynamicBranch({
      name: "dyn",
      description: "Dynamic",
      ttlMs: 10,
    });
    await node.execute(["item"], {});
    expect(node.refreshCount).toBe(1);

    // Advance time past TTL
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 50);
    await node.execute(["item"], {});
    expect(node.refreshCount).toBe(2);

    vi.restoreAllMocks();
  });

  it("invalidate forces refresh", async () => {
    const node = new TestDynamicBranch({
      name: "dyn",
      description: "Dynamic",
      ttlMs: 60000,
    });
    await node.execute(["item"], {});
    expect(node.refreshCount).toBe(1);

    node.invalidate();
    await node.execute(["item"], {});
    expect(node.refreshCount).toBe(2);
  });

  it("shows menu when no path tokens", async () => {
    const node = new TestDynamicBranch({ name: "dyn", description: "Dynamic" });
    const menu = await node.execute([], {});
    expect(menu).toContain("DYN MENU");
    expect(menu).toContain("item");
  });
});
