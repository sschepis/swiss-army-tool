import { describe, it, expect } from "vitest";
import { Router } from "../src/router.js";
import { BranchNode } from "../src/nodes/branch-node.js";
import { LeafNode } from "../src/nodes/leaf-node.js";
import { SessionManager } from "../src/session.js";

function makeRouter() {
  const root = new BranchNode({ name: "root", description: "Root" });
  const cloud = new BranchNode({ name: "cloud", description: "Cloud services" });
  const aws = new BranchNode({ name: "aws", description: "AWS" });
  const s3ls = new LeafNode({
    name: "ls",
    description: "List S3 buckets",
    handler: () => "[SUCCESS] bucket-a, bucket-b",
  });
  aws.addChild(s3ls);
  cloud.addChild(aws);
  root.addChild(cloud);

  const session = new SessionManager("test");
  const router = new Router(root, session);
  return { router, session, root };
}

describe("Router", () => {
  it("help returns root menu", async () => {
    const { router } = makeRouter();
    const result = await router.execute("help");
    expect(result).toContain("ROOT MENU");
  });

  it("pwd returns cwd", async () => {
    const { router } = makeRouter();
    const result = await router.execute("pwd");
    expect(result).toContain("/");
  });

  it("routes absolute paths", async () => {
    const { router } = makeRouter();
    const result = await router.execute("cloud aws ls");
    expect(result).toContain("bucket-a");
  });

  it("cd changes directory and enables relative commands", async () => {
    const { router, session } = makeRouter();
    const cdResult = await router.execute("cd cloud/aws");
    expect(cdResult).toContain("SUCCESS");
    expect(session.cwd).toBe("/cloud/aws");

    const result = await router.execute("ls");
    expect(result).toContain("bucket-a");
  });

  it("cd rejects non-existent paths", async () => {
    const { router } = makeRouter();
    const result = await router.execute("cd nope");
    expect(result).toContain("ERROR");
  });

  it("cd rejects leaf nodes", async () => {
    const { router } = makeRouter();
    const result = await router.execute("cd cloud/aws/ls");
    expect(result).toContain("executable action");
  });

  it("tree returns the full hierarchy", async () => {
    const { router } = makeRouter();
    const result = await router.execute("tree");
    expect(result).toContain("cloud");
    expect(result).toContain("aws");
    expect(result).toContain("ls");
  });

  it("breadcrumbs are prepended", async () => {
    const { router } = makeRouter();
    const result = await router.execute("help");
    expect(result).toContain("[Context: /]");
  });

  it("pinned context is included", async () => {
    const { router, session } = makeRouter();
    session.kvStore.set("note", "important");
    session.pinnedKeys.add("note");
    const result = await router.execute("help");
    expect(result).toContain("PINNED MEMORY");
    expect(result).toContain("important");
  });
});
