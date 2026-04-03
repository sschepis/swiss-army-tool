import { describe, it, expect } from "vitest";
import { createMemoryModule } from "../src/memory.js";
import { SessionManager } from "../src/session.js";

describe("MemoryModule", () => {
  function setup() {
    const session = new SessionManager("test");
    const memory = createMemoryModule(session);
    return { session, memory };
  }

  it("set stores a value", async () => {
    const { session, memory } = setup();
    const result = await memory.execute(["set"], { key: "port", value: "5432" });
    expect(result).toContain("SUCCESS");
    expect(session.kvStore.get("port")).toBe("5432");
  });

  it("get retrieves a stored value", async () => {
    const { session, memory } = setup();
    session.kvStore.set("port", "5432");
    const result = await memory.execute(["get"], { key: "port" });
    expect(result).toContain("5432");
  });

  it("get returns error for missing key", async () => {
    const { memory } = setup();
    const result = await memory.execute(["get"], { key: "nope" });
    expect(result).toContain("KeyNotFound");
  });

  it("list shows all keys", async () => {
    const { session, memory } = setup();
    session.kvStore.set("a", "1");
    session.kvStore.set("b", "2");
    const result = await memory.execute(["list"], {});
    expect(result).toContain("a");
    expect(result).toContain("b");
  });

  it("list shows empty message when no keys", async () => {
    const { memory } = setup();
    const result = await memory.execute(["list"], {});
    expect(result).toContain("No memories");
  });

  it("pin marks a key as pinned", async () => {
    const { session, memory } = setup();
    session.kvStore.set("port", "5432");
    const result = await memory.execute(["pin"], { key: "port" });
    expect(result).toContain("SUCCESS");
    expect(session.pinnedKeys.has("port")).toBe(true);
  });

  it("pin errors on missing key", async () => {
    const { memory } = setup();
    const result = await memory.execute(["pin"], { key: "nope" });
    expect(result).toContain("KeyNotFound");
  });

  it("unpin removes a pin", async () => {
    const { session, memory } = setup();
    session.kvStore.set("port", "5432");
    session.pinnedKeys.add("port");
    const result = await memory.execute(["unpin"], { key: "port" });
    expect(result).toContain("SUCCESS");
    expect(session.pinnedKeys.has("port")).toBe(false);
  });
});
