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

test("fresh installs get the six engineering prompts with three pinned", async () => {
  const { store: s } = makeStore();
  await s.ensureSeeded();
  const items = s.snapshot().items;
  assert.deepEqual(items.map((item) => item.title), [
    "理解代码与调用链", "最小变更实现需求", "先定位根因，再修 Bug",
    "只报有证据的代码审查", "补有价值的测试", "完成前做证据验收",
  ]);
  assert.deepEqual(items.filter((item) => item.pinned).map((item) => item.tags[2]), ["调试排障", "代码审查", "交付验收"]);
  assert.ok(items.every((item) => item.scope.kind === "global" && item.tags.length === 3 && !("category" in item)));
  assert.ok(SEED_TEMPLATES.every((item) => !("category" in item)));
  assert.equal(new Set(items.map((item) => item.id)).size, 6);
  assert.match(items[2].body, /不要堆叠猜测性补丁/);
  assert.match(items[5].body, /不要把静态检查或模拟结果当作真实环境验收/);
});

test("new defaults do not modify an existing user's library", async () => {
  const { store: s } = makeStore();
  await s.save({ template: base({ title: "我的模板" }) });
  const before = s.snapshot().items;
  await s.ensureSeeded();
  assert.deepEqual(s.snapshot().items, before);
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

function legacyState(overrides = {}) {
  return {
    revision: 17,
    seeded: true,
    items: [{
      id: "legacy",
      title: "自定义标题",
      body: "  用户正文\n保留格式  ",
      category: "一".repeat(20),
      tags: ["a", "b", "c", "d", "e"],
      scope: { kind: "projects", paths: ["G:/work/custom"] },
      pinned: false,
      createdAt: 10,
      updatedAt: 20,
      lastUsedAt: 30,
      ...overrides,
    }],
  };
}

test("legacy category becomes the sixth tag without truncation or implicit writes", async () => {
  const raw = legacyState();
  const before = JSON.parse(JSON.stringify(raw));
  const { store, writes } = makeStore({ state: raw });
  const migrated = store.snapshot().items[0];
  assert.deepEqual(migrated.tags, ["a", "b", "c", "d", "e", "一".repeat(20)]);
  const { category, tags, ...unchanged } = before.items[0];
  const { tags: convertedTags, ...actual } = migrated;
  assert.deepEqual(actual, unchanged, "all user content and metadata are preserved");
  assert.deepEqual(raw, before, "normalization must not mutate the storage-domain value");
  assert.equal(store.revision, 17);
  await store.ensureSeeded();
  assert.equal(writes.length, 0, "opening an already seeded library must not persist migration");
});

test("mixed old and canonical records dedupe labels without splitting punctuation", () => {
  const raw = legacyState({ category: " CODE, review，审查 ", tags: ["First", "code, review，审查", "first", "  "] });
  raw.items.push({ ...raw.items[0], id: "canonical", category: undefined, tags: ["新标签", "二".repeat(20)] });
  const state = normalizeState(raw);
  assert.deepEqual(state.items[0].tags, ["First", "code, review，审查"]);
  assert.deepEqual(state.items[1].tags, ["新标签", "二".repeat(20)]);
  assert.ok(state.items.every((item) => !("category" in item)));
  assert.deepEqual(normalizeState(state), state, "canonical normalization must be idempotent");
});

test("unified limits allow six unique 20-character tags and reject overflow without writing", async () => {
  const { store, writes } = makeStore();
  const tags = Array.from({ length: 6 }, (_, i) => `${i}${"x".repeat(19)}`);
  const item = await store.save({ template: base({ category: undefined, tags }) });
  assert.deepEqual(item.tags, tags);
  assert.deepEqual(normalizeTemplate(base({ category: tags[0].toUpperCase(), tags })).tags, tags);
  const before = store.snapshot();
  await assert.rejects(store.save({ template: { ...item, tags: [...tags, "seventh"] } }), /at most 6/);
  await assert.rejects(store.save({ template: { ...item, tags: ["x".repeat(21)] } }), /at most 20/);
  await assert.rejects(store.save({ template: { ...item, category: "new" } }), /at most 6/);
  assert.deepEqual(store.snapshot(), before);
  assert.equal(writes.length, 1);
});

test("saving a migrated library is revision guarded and canonical after a cold rebuild", async () => {
  const { store, writes } = makeStore({ state: legacyState() });
  const item = store.list({ all: true })[0];
  await assert.rejects(store.save({ template: { ...item, title: "changed" }, revision: 16 }), (error) => error.code === "revision-conflict" && error.revision === 17);
  assert.equal(writes.length, 0);
  const updated = await store.save({ template: { ...item, title: "changed" }, revision: 17 });
  assert.equal(store.revision, 18);
  assert.deepEqual(updated.tags, item.tags);
  assert.ok(!("category" in writes[0].items[0]));
  const { store: cold, writes: coldWrites } = makeStore({ state: writes[0] });
  assert.deepEqual(cold.snapshot(), store.snapshot());
  await cold.ensureSeeded();
  assert.equal(coldWrites.length, 0);
});

test("migration stays readable after a failed persistence and can retry at the same revision", async () => {
  const { store, writes } = makeStore({ state: legacyState(), failOn: 1 });
  const before = store.snapshot();
  const item = before.items[0];
  await assert.rejects(store.save({ template: { ...item, tags: [] }, revision: 17 }), /disk full/);
  assert.deepEqual(store.snapshot(), before);
  assert.equal(writes.length, 0);
  await store.save({ template: { ...item, tags: [] }, revision: 17 });
  assert.equal(store.revision, 18);
  assert.deepEqual(writes[0].items[0].tags, []);
});

test("cleared migrated tags and deleted seeded records never resurrect on a cold reopen", async () => {
  const { store, writes } = makeStore({ state: legacyState() });
  const item = store.list({ all: true })[0];
  await store.save({ template: { ...item, tags: [] }, revision: 17 });
  const { store: cold, writes: coldWrites } = makeStore({ state: writes[0] });
  await cold.ensureSeeded();
  assert.deepEqual(cold.list({ all: true })[0].tags, []);
  await cold.remove({ id: item.id, revision: 18 });
  const { store: empty, writes: emptyWrites } = makeStore({ state: coldWrites[0] });
  await empty.ensureSeeded();
  assert.deepEqual(empty.list({ all: true }), []);
  assert.equal(emptyWrites.length, 0);
});

test("a store can be rebuilt from its persisted state", async () => {
  const { store: s, writes } = makeStore();
  await s.save({ template: base({ title: "persisted" }) });
  const rebuilt = new TemplateStore({ state: writes[writes.length - 1], persist: async () => undefined });
  assert.equal(rebuilt.revision, s.revision);
  assert.equal(rebuilt.snapshot().items[0].title, "persisted");
});

/** Canonical stored record for importTemplates assertions. */
function imported(overrides = {}) {
  return {
    id: "file-id",
    title: "文件标题",
    body: "文件正文",
    tags: ["t"],
    scope: { kind: "global" },
    pinned: false,
    createdAt: 100,
    updatedAt: 200,
    lastUsedAt: null,
    ...overrides,
  };
}

test("importTemplates appends adds in encounter order with the file's id and timestamps", async () => {
  const { store, writes } = makeStore();
  const result = await store.importTemplates({
    revision: 0,
    entries: [
      { op: "add", at: "f0#0", template: imported({ id: "a", title: "第一个", lastUsedAt: 900 }) },
      { op: "add", at: "f0#1", template: imported({ id: "b", title: "第二个" }) },
    ],
  });
  assert.deepEqual(result, { added: 2, replaced: 0, skipped: 0, touched: [{ at: "f0#0", id: "a" }, { at: "f0#1", id: "b" }] });
  assert.equal(writes.length, 1, "the whole batch is one write");
  assert.equal(store.revision, 1);
  const items = store.snapshot().items;
  assert.deepEqual(items.map((item) => item.id), ["a", "b"]);
  assert.equal(items[0].lastUsedAt, 900);
  assert.equal(items[1].createdAt, 100);
  assert.deepEqual(writes[0].items, items);
});

test("importTemplates replaces in place, keeps the local id, and takes file fields", async () => {
  const { store, writes } = makeStore();
  await store.save({ template: base({ title: "一", body: "一" }) });
  await store.save({ template: base({ title: "二", body: "二" }) });
  await store.save({ template: base({ title: "三", body: "三" }) });
  const before = store.snapshot().items;
  assert.equal(writes.length, 3);

  const result = await store.importTemplates({
    revision: store.revision,
    entries: [
      { op: "skip", at: "f0#0" },
      { op: "replace", at: "f0#2", id: before[1].id, template: imported({ id: "ignored", title: "新的二", body: "新正文", pinned: true, createdAt: 11, updatedAt: 22, lastUsedAt: 33 }) },
    ],
  });
  assert.equal(writes.length, 4, "one more write for the batch");
  assert.deepEqual(result, { added: 0, replaced: 1, skipped: 1, touched: [{ at: "f0#2", id: before[1].id }] });
  const items = store.snapshot().items;
  assert.deepEqual(items.map((item) => item.id), before.map((item) => item.id), "order is stable");
  const replaced = items[1];
  assert.equal(replaced.id, before[1].id, "the file id never overwrites local identity");
  assert.equal(replaced.title, "新的二");
  assert.equal(replaced.body, "新正文");
  assert.deepEqual(replaced.tags, ["t"]);
  assert.equal(replaced.pinned, true);
  assert.deepEqual([replaced.createdAt, replaced.updatedAt, replaced.lastUsedAt], [11, 22, 33]);
  assert.deepEqual([items[0], items[2]], [before[0], before[2]], "the rest of the library is untouched");
});

test("importTemplates writes once for a no-op batch and still advances the revision", async () => {
  const { store, writes } = makeStore();
  await store.save({ template: base() });
  const before = store.snapshot().items;
  const revision = store.revision;

  const result = await store.importTemplates({ revision, entries: [{ op: "skip", at: "f0#0" }, { op: "skip", at: "f0#1" }] });
  assert.deepEqual(result, { added: 0, replaced: 0, skipped: 2, touched: [] });
  assert.equal(writes.length, 2);
  assert.equal(store.revision, revision + 1);
  assert.deepEqual(store.snapshot().items, before);
});

test("importTemplates never stores two records with one id", async () => {
  const { store } = makeStore({ state: { revision: 0, seeded: true, items: [imported({ id: "taken" })] } });
  let counter = 0;
  const fresh = new TemplateStore({
    state: store.snapshot(),
    persist: async () => {},
    newId: () => `fresh-${(counter += 1)}`,
  });
  const result = await fresh.importTemplates({
    revision: 0,
    entries: [
      { op: "add", at: "f0#0", template: imported({ id: "dup", title: "一" }) },
      { op: "add", at: "f0#1", template: imported({ id: "dup", title: "二" }) },
    ],
  });
  assert.deepEqual(result.touched, [{ at: "f0#0", id: "dup" }, { at: "f0#1", id: "fresh-1" }]);
  assert.deepEqual(fresh.snapshot().items.map((item) => item.id), ["taken", "dup", "fresh-1"]);
});

test("importTemplates refuses bad batches without writing", async () => {
  const { store, writes } = makeStore();
  await store.save({ template: base() });
  const before = store.snapshot();
  const revision = store.revision;

  await assert.rejects(
    () => store.importTemplates({ revision, entries: [{ op: "replace", at: "f0#0", id: "ghost", template: imported() }] }),
    (error) => error instanceof StoreError && error.code === "not-found" && error.id === "ghost",
  );
  await assert.rejects(
    () => store.importTemplates({ revision: revision + 5, entries: [{ op: "skip", at: "f0#0" }] }),
    (error) => error instanceof StoreError && error.code === "revision-conflict" && error.revision === revision,
  );
  await assert.rejects(
    () => store.importTemplates({ revision, entries: [{ op: "delete", at: "f0#0" }] }),
    (error) => error.code === "invalid-input",
  );
  await assert.rejects(
    () =>
      store.importTemplates({
        revision,
        entries: [
          {
            op: "add",
            at: "f0#0",
            template: { id: "x", title: "缺正文", tags: [], scope: { kind: "global" }, pinned: false, createdAt: 1, updatedAt: 2 },
          },
        ],
      }),
    (error) => error.code === "invalid-input" && error.field === "body",
  );
  await assert.rejects(() => store.importTemplates({ revision, entries: "nope" }), (error) => error.code === "invalid-input");

  assert.equal(writes.length, 1, "only the initial save wrote");
  assert.deepEqual(store.snapshot(), before);
});

test("an imported library rebuilds cold without renormalizing", async () => {
  const { store, writes } = makeStore();
  const result = await store.importTemplates({
    revision: 0,
    entries: [{ op: "add", at: "f0#0", template: imported({ id: "kept", scope: { kind: "projects", paths: ["C:\\work"] }, tags: ["中文", "emoji 🚀"] }) }],
  });
  assert.equal(result.added, 1);
  const reloaded = new TemplateStore({ state: writes.at(-1), persist: async () => {} });
  assert.deepEqual(reloaded.snapshot(), store.snapshot());
  assert.deepEqual(reloaded.snapshot().items[0].tags, ["中文", "emoji 🚀"]);
  assert.deepEqual(reloaded.list({ workspace: "C:\\work" }).map((item) => item.id), ["kept"]);
});
