import { BranchNode } from "./nodes/branch-node.js";
import { LeafNode } from "./nodes/leaf-node.js";
import type { SessionManager } from "./session.js";

/**
 * Creates a `/memory` branch pre-populated with set, get, list, search, pin, unpin, delete, tag actions.
 * Operates on the SessionManager's KV store, pinned keys, and tags.
 */
export function createMemoryModule(session: SessionManager): BranchNode {
  const branch = new BranchNode({
    name: "memory",
    description: "Persistent scratchpad for storing and retrieving notes.",
  });

  branch.addChild(
    new LeafNode({
      name: "set",
      description: "Write a note to the persistent scratchpad, optionally with tags.",
      requiredArgs: ["key", "value"],
      optionalArgs: { tags: { type: "string", description: "Comma-separated tags for categorization" } },
      handler: (kwargs) => {
        const key = String(kwargs.key);
        const value = String(kwargs.value);
        session.kvStore.set(key, value);

        // Handle tags
        if (kwargs.tags) {
          const tags = String(kwargs.tags).split(",").map((t) => t.trim()).filter(Boolean);
          if (tags.length > 0) {
            session.kvTags.set(key, new Set(tags));
          }
        }

        return `[SUCCESS] Memory saved: '${key}'\nTip: Use command='memory get' kwargs={key: '${key}'} to retrieve this later.`;
      },
    }),
  );

  branch.addChild(
    new LeafNode({
      name: "get",
      description: "Retrieve a note from the scratchpad.",
      requiredArgs: ["key"],
      handler: (kwargs) => {
        const key = String(kwargs.key);
        const value = session.kvStore.get(key);
        if (value === undefined) {
          return `[ERROR: KeyNotFound] '${key}' does not exist in the scratchpad.\nTip: Use command='memory list' to see all stored keys.`;
        }
        const tags = session.kvTags.get(key);
        const tagStr = tags && tags.size > 0 ? ` [tags: ${[...tags].join(", ")}]` : "";
        return `[SUCCESS] ${key} = ${value}${tagStr}`;
      },
    }),
  );

  branch.addChild(
    new LeafNode({
      name: "list",
      description: "List all keys in the scratchpad, optionally filtered by prefix or tag.",
      optionalArgs: {
        prefix: { type: "string", description: "Filter keys by prefix" },
        tag: { type: "string", description: "Filter keys by tag" },
      },
      handler: (kwargs) => {
        const prefix = kwargs.prefix ? String(kwargs.prefix) : undefined;
        const tag = kwargs.tag ? String(kwargs.tag) : undefined;
        let keys = [...session.kvStore.keys()];

        if (prefix) {
          keys = keys.filter((k) => k.startsWith(prefix));
        }
        if (tag) {
          keys = keys.filter((k) => {
            const tags = session.kvTags.get(k);
            return tags?.has(tag);
          });
        }

        if (keys.length === 0) {
          return "[INFO] No memories stored yet.";
        }

        const pinned = session.pinnedKeys;
        const lines = keys.map((k) => {
          const tags = session.kvTags.get(k);
          const tagStr = tags && tags.size > 0 ? ` [${[...tags].join(", ")}]` : "";
          return `  ${pinned.has(k) ? "\u{1F4CC}" : "  "} ${k}${tagStr}`;
        });
        return `[SUCCESS] Stored keys (${keys.length}):\n${lines.join("\n")}`;
      },
    }),
  );

  branch.addChild(
    new LeafNode({
      name: "search",
      description: "Search memory keys and values by substring match.",
      requiredArgs: { query: { type: "string", description: "Search query" } },
      optionalArgs: { limit: { type: "number", description: "Max results", default: 10 } },
      handler: (kwargs) => {
        const query = String(kwargs.query).toLowerCase();
        const limit = Number(kwargs.limit) || 10;
        const matches: string[] = [];

        for (const [key, value] of session.kvStore) {
          if (
            key.toLowerCase().includes(query) ||
            value.toLowerCase().includes(query)
          ) {
            const tags = session.kvTags.get(key);
            const tagStr = tags && tags.size > 0 ? ` [${[...tags].join(", ")}]` : "";
            matches.push(`  ${key}${tagStr} = ${value.length > 80 ? value.slice(0, 80) + "..." : value}`);
            if (matches.length >= limit) break;
          }
        }

        if (matches.length === 0) {
          return `[INFO] No memories matching '${kwargs.query}'.`;
        }
        return `[SUCCESS] Found ${matches.length} match(es):\n${matches.join("\n")}`;
      },
    }),
  );

  branch.addChild(
    new LeafNode({
      name: "tag",
      description: "Add or replace tags on an existing memory key.",
      requiredArgs: ["key", "tags"],
      handler: (kwargs) => {
        const key = String(kwargs.key);
        if (!session.kvStore.has(key)) {
          return `[ERROR: KeyNotFound] '${key}' does not exist in the scratchpad. Set it first.`;
        }
        const tags = String(kwargs.tags).split(",").map((t) => t.trim()).filter(Boolean);
        session.kvTags.set(key, new Set(tags));
        return `[SUCCESS] Tags updated for '${key}': ${tags.join(", ")}`;
      },
    }),
  );

  branch.addChild(
    new LeafNode({
      name: "pin",
      description:
        "Pin a memory key so it is always visible in the response context.",
      requiredArgs: ["key"],
      handler: (kwargs) => {
        const key = String(kwargs.key);
        if (!session.kvStore.has(key)) {
          return `[ERROR: KeyNotFound] '${key}' does not exist in the scratchpad. Set it first.`;
        }
        session.pinnedKeys.add(key);
        return `[SUCCESS] '${key}' is now pinned. Its value will be injected into your context on all future turns.`;
      },
    }),
  );

  branch.addChild(
    new LeafNode({
      name: "unpin",
      description: "Unpin a previously pinned memory key.",
      requiredArgs: ["key"],
      handler: (kwargs) => {
        const key = String(kwargs.key);
        if (!session.pinnedKeys.has(key)) {
          return `[INFO] '${key}' is not currently pinned.`;
        }
        session.pinnedKeys.delete(key);
        return `[SUCCESS] '${key}' has been unpinned.`;
      },
    }),
  );

  branch.addChild(
    new LeafNode({
      name: "delete",
      description: "Delete a key from the scratchpad.",
      requiredArgs: ["key"],
      handler: (kwargs) => {
        const key = String(kwargs.key);
        if (!session.kvStore.has(key)) {
          return `[ERROR: KeyNotFound] '${key}' does not exist in the scratchpad.\nTip: Use command='memory list' to see all stored keys.`;
        }
        session.pinnedKeys.delete(key);
        session.kvTags.delete(key);
        session.kvStore.delete(key);
        return `[SUCCESS] '${key}' has been deleted from the scratchpad.`;
      },
    }),
  );

  return branch;
}
