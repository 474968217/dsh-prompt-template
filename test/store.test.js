import test from "node:test";
import assert from "node:assert/strict";

import {
  emptyState,
  LIMITS,
  normalizeScope,
  normalizeState,
  normalizeTemplate,
  pathMatches,
  SEED_TEMPLATES,
  StoreError,
  TemplateStore,
} from "../lib/store.js";

/**
 * Build a store with an in-memory medium that records every persisted state.
 * @param {{ failOn?: number, state?: any }} [options]
 */
function makeStore(options = {}) {
  const writes = [];
  let calls = 0;
  const store = new TemplateStore({
    state: options.state ?? emptyState(),
    persist: async (next) => {
      calls += 1;
      if (options.failOn === calls) throw new Error("disk full");
      writes.push(JSON.parse(JSON.stringify(next)));
    },
  });
  return { store, writes };
}

function base(overrides = {}) {
  return {
    title: "标题",
    body: "正文内容",
    category: "工程",
    tags: ["a"],
    scope: { kind: "global" },
    pinned: false,
    ...overrides,
  };
}

test("normalizeTemplate rejects invalid input", () => {
  assert.throws(() => normalizeTemplate({ body: "x" }, { newId: () => "id1" }), (error) => {
    return error instanceof StoreError && error.code === "invalid-input" && error.field === "title";
  });
  assert.throws(() => normalizeTemplate({ title: "x", body: "   " }), /body/);
  assert.throws(() => normalizeTemplate(base({ title: "x".repeat(LIMITS.title + 1) })), /at most/);
  assert.throws(() => normalizeTemplate(base({ body: "x".repeat(LIMITS.body + 1) })), /at most/);
  assert.throws(() => normalizeTemplate(base({ tags: Array.from({ length: LIMITS.tags + 1 }, (_, i) => `t${i}`) })), /at most/);
  assert.throws(() => normalizeTemplate(base({ pinned: "yes" })), /pinned/);
});

test("normalizeScope accepts global, absolute paths, dedupes and rejects relatives", () => {
  assert.deepEqual(normalizeScope(undefined), { kind: "global" });
  assert.deepEqual(normalizeScope({ kind: "global" }), { kind: "global" });
  const scoped = normalizeScope({ kind: "projects", paths: ["C:\\work\\a", "C:\\work\\a\\", "/opt/b"] });
  assert.equal(scoped.kind, "projects");
  assert.equal(scoped.paths.length, 2, "trailing separator duplicate collapses");
  assert.throws(() => normalizeScope({ kind: "projects", paths: ["relative/path"] }), /absolute/);
  assert.throws(() => normalizeScope({ kind: "projects", paths: [] }), /at least one/);
  assert.throws(() => normalizeScope({ kind: "weird" }), /scope.kind/);
});

test("pathMatches follows path normalization, not string equality", () => {
  assert.equal(pathMatches("C:\\work\\a", "C:\\work\\a\\"), true);
  assert.equal(pathMatches("G:/work/a", "G:\\work\\a"), true);
  assert.equal(pathMatches("C:\\work\\a", "C:\\work\\b"), false);
  assert.equal(pathMatches("", ""), false);
  assert.equal(pathMatches("C:\\work\\ab", "C:\\work\\a"), false, "prefix must not match");
});

test("save creates an item, fills timestamps and returns it", async () => {
  const { store: s, writes } = makeStore();
  const item = await s.save({ template: base() });
  assert.match(item.id, /^[0-9a-zA-Z_-]+$/);
  assert.equal(item.title, "标题");
  assert.ok(item.createdAt > 0);
  assert.equal(item.updatedAt, item.createdAt);
  assert.equal(item.lastUsedAt, null);
  assert.equal(s.revision, 1);
  assert.equal(writes.length, 1, "persisted before the revision became readable");
  assert.equal(writes[0].revision, 1);
  assert.equal(s.snapshot().items.length, 1);
});

test("save with a known id updates in place and preserves createdAt", async () => {
  const { store: s } = makeStore();
  const created = await s.save({ template: base() });
  const updated = await s.save({ template: base({ id: created.id, title: "新标题" }) });
  assert.equal(updated.id, created.id);
  assert.equal(updated.title, "新标题");
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(s.snapshot().items.length, 1);
});

test("save with an unknown id reports not-found", async () => {
  const { store: s } = makeStore();
  await assert.rejects(s.save({ template: base({ id: "missing" }) }), (error) => {
    return error instanceof StoreError && error.code === "not-found";
  });
  assert.equal(s.revision, 0);
});

test("revision guard reports a conflict with the current revision", async () => {
  const { store: s } = makeStore();
  await s.save({ template: base() });
  await assert.rejects(s.save({ template: base(), revision: 0 }), (error) => {
    return error instanceof StoreError && error.code === "revision-conflict" && error.revision === 1;
  });
});

test("a failed write leaves memory and revision untouched", async () => {
  const { store: s } = makeStore({ failOn: 1 });
  await assert.rejects(s.save({ template: base() }), /disk full/);
  assert.equal(s.revision, 0);
  assert.equal(s.snapshot().items.length, 0);
});

test("mutations are serialized: two saves keep both items and sequential revisions", async () => {
  const { store: s } = makeStore();
  await Promise.all([s.save({ template: base({ title: "one" }) }), s.save({ template: base({ title: "two" }) })]);
  assert.equal(s.revision, 2);
  assert.deepEqual(
    s.snapshot().items.map((item) => item.title),
    ["one", "two"],
  );
});

test("delete removes the item and reports missing ids", async () => {
  const { store: s } = makeStore();
  const item = await s.save({ template: base() });
  await s.remove({ id: item.id });
  assert.equal(s.snapshot().items.length, 0);
  await assert.rejects(s.remove({ id: item.id }), (error) => error.code === "not-found");
});

test("touch records lastUsedAt without requiring a revision", async () => {
  const { store: s } = makeStore();
  const item = await s.save({ template: base() });
  const touched = await s.touch({ id: item.id });
  assert.ok(touched.lastUsedAt >= item.createdAt);
  assert.equal(touched.updatedAt, item.updatedAt);
  assert.equal(s.revision, 2);
});

test("reorder requires the exact set of ids and rewrites the order", async () => {
  const { store: s } = makeStore();
  const a = await s.save({ template: base({ title: "a" }) });
  const b = await s.save({ template: base({ title: "b" }) });
  const c = await s.save({ template: base({ title: "c" }) });
  const items = await s.reorder({ ids: [c.id, a.id, b.id] });
  assert.deepEqual(
    items.map((item) => item.title),
    ["c", "a", "b"],
  );
  await assert.rejects(s.reorder({ ids: [a.id] }), (error) => error.code === "invalid-order");
  await assert.rejects(s.reorder({ ids: [a.id, b.id, "ghost"] }), (error) => error.code === "invalid-order");
});

test("ensureSeeded inserts starters once and never resurrects deleted ones", async () => {
  const { store: s } = makeStore();
  const first = await s.ensureSeeded(SEED_TEMPLATES);
  assert.equal(first.created, SEED_TEMPLATES.length);
  assert.equal(s.snapshot().items.length, SEED_TEMPLATES.length);
  const items = s.snapshot().items;
  assert.ok(items.every((item) => item.scope.kind === "global"));
  assert.ok(items.some((item) => item.pinned));

  for (const item of items) await s.remove({ id: item.id });
  await s.ensureSeeded(SEED_TEMPLATES);
  assert.equal(s.snapshot().items.length, 0, "seed must not run twice");
});

test("list filters by workspace: global plus matching projects only", async () => {
  const { store: s } = makeStore();
  await s.save({ template: base({ title: "global", scope: { kind: "global" } }) });
  await s.save({ template: base({ title: "here", scope: { kind: "projects", paths: ["G:\\work\\a"] } }) });
  await s.save({ template: base({ title: "there", scope: { kind: "projects", paths: ["G:\\work\\b"] } }) });

  assert.deepEqual(
    s.list({ workspace: "G:\\work\\a" }).map((item) => item.title),
    ["global", "here"],
  );
  assert.deepEqual(
    s.list({ all: true }).map((item) => item.title),
    ["global", "here", "there"],
  );
  assert.deepEqual(
    s.list({ workspace: "G:\\elsewhere" }).map((item) => item.title),
    ["global"],
  );
});

test("normalizeState rejects corrupt documents", () => {
  assert.deepEqual(normalizeState(null), emptyState());
  assert.throws(() => normalizeState({ revision: -1, items: [] }), /revision/);
  assert.throws(() => normalizeState({ revision: 1, items: "nope" }), /items/);
  const once = normalizeTemplate(base(), { newId: () => "same" });
  assert.throws(() => normalizeState({ revision: 1, items: [once, once] }), /duplicate/);
  assert.throws(() => normalizeState({ revision: 1, items: [{ ...once, createdAt: "yesterday" }] }), /createdAt/);
});

test("a store can be rebuilt from its persisted state", async () => {
  const { store: s, writes } = makeStore();
  await s.save({ template: base({ title: "persisted" }) });
  const rebuilt = new TemplateStore({ state: writes[writes.length - 1], persist: async () => undefined });
  assert.equal(rebuilt.revision, s.revision);
  assert.equal(rebuilt.snapshot().items[0].title, "persisted");
});
