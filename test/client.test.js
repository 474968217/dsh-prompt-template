import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { TemplateStore, emptyState } from "../lib/store.js";

// Only evaluate pure exports. No DOM, components, hooks or renderer are invoked.
const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
let entry;
vm.runInNewContext(source, {
  window: { __ModuleLoader__: { load(value) { entry = value; } } },
  navigator: { userAgent: "Windows" },
  TextDecoder,
  TextEncoder,
  URLSearchParams,
}, { timeout: 1000 });
const client = entry.factory((id) => {
  assert.ok(["react", "react-dom"].includes(id));
  return {}; // Pure helper evaluation must never call any UI module method.
});
const helpers = client.__testing;
const plain = (value) => JSON.parse(JSON.stringify(value));
const global = { id: "global", title: "Explain", body: "中文结论", tags: ["Review"], scope: { kind: "global", paths: [] } };
const project = { id: "project", title: "Project", body: "x", scope: { kind: "projects", paths: ["G:/work/app"] } };

test("client loader exposes the expected entry without rendering UI", () => {
  assert.equal(entry.id, "dsh-prompt-template");
  assert.deepEqual(plain(client.inject), ["slots", "locale"]);
});

test("client search matches body and case-insensitive tags", () => {
  assert.deepEqual(plain(helpers.filterTemplates([global, project], "review")).map((item) => item.id), ["global"]);
  assert.equal(helpers.filterTemplates([global], "结论").length, 1);
  assert.equal(helpers.filterTemplates([global], "absent").length, 0);
});

test("project filtering uses exact normalized directories and hides unknown workspaces", () => {
  assert.equal(helpers.matchesWorkspace(project, "g:\\work\\APP\\"), true);
  assert.equal(helpers.matchesWorkspace(project, "G:/work/app/subdir"), false);
  for (const workspace of ["", "   ", undefined, null]) {
    assert.equal(helpers.matchesWorkspace(project, workspace), false);
    assert.deepEqual(plain(helpers.groupTemplates([global, project], "", workspace)).project, []);
  }
});

test("pinning preserves manual order within each group despite recency", () => {
  const items = [{ id: "a", lastUsedAt: 900 }, { id: "b", pinned: true }, { id: "c", pinned: true }, { id: "d", lastUsedAt: 999 }];
  assert.deepEqual(plain(helpers.sortTemplates(items)).map((item) => item.id), ["b", "c", "a", "d"]);
});

test("empty selected-project scope never silently becomes global", () => {
  const draft = { ...helpers.toDraft(global), scopeKind: "projects", paths: [] };
  assert.ok(helpers.draftErrors(draft).includes("scopeRequired"));
  assert.deepEqual(plain(helpers.fromDraft(draft)).scope, { kind: "projects", paths: [] });
});

test("editing a template retains its scope and body through draft conversion", () => {
  const item = { ...project, category: "Code", tags: ["a", "b"], pinned: true, body: "  Keep whitespace\n" };
  const { category, ...canonical } = item;
  assert.deepEqual(plain(helpers.fromDraft(helpers.toDraft(item))), { ...canonical, tags: ["a", "b", category] });
});

test("unpinning the selected row then saving its editor must remain unpinned", async () => {
  const store = new TemplateStore({ state: emptyState(), persist: async () => {} });
  const item = await store.save({ template: { ...global, id: undefined, pinned: true } });
  let draft = helpers.toDraft(item);
  const unpinned = await store.save({ template: helpers.fromDraft({ ...helpers.toDraft(item), pinned: false }), revision: store.revision });
  draft = helpers.syncDraftPin(draft, unpinned, item);
  const saved = await store.save({ template: helpers.fromDraft(draft), revision: store.revision });
  assert.equal(unpinned.pinned, false);
  assert.equal(saved.pinned, false, "Save must not reapply the editor's stale pinned value");
});

test("pin synchronization preserves other edits, row switches and newer checkbox changes", () => {
  const previous = { id: "a", pinned: false };
  const saved = { id: "a", pinned: true };
  const draft = { id: "a", pinned: false, title: "Unsaved title", body: "Unsaved body" };
  assert.deepEqual(plain(helpers.syncDraftPin(draft, saved, previous)), { ...draft, pinned: true });
  const other = { ...draft, id: "b" };
  assert.equal(helpers.syncDraftPin(other, saved, previous), other);
  assert.equal(helpers.syncDraftPin(null, saved, previous), null);
  const newer = { ...draft, pinned: true };
  assert.equal(helpers.syncDraftPin(newer, saved, previous), newer);
});

test("visible hints omit arrow button descriptions in both languages", () => {
  for (const language of [helpers.dict.zh, helpers.dict.en]) {
    for (const key of ["insertHint", "dragOrder", "reorderHint"]) assert.doesNotMatch(language[key], /[↑↓]/);
  }
});

test("manager choices come from the full library and preserve first occurrence", () => {
  const items = [
    { category: "开发", tags: ["排障", "审查"] },
    { category: "开发", tags: ["排障", "测试"] },
    { category: "写作", tags: [] },
    { category: "", tags: [] },
    { category: " 开发 ", tags: [" 排障 ", " "] },
  ];
  assert.deepEqual(plain(helpers.collectTemplateChoices(items)), {
    tags: ["排障", "审查", "开发", "测试", "写作"],
  });
});

test("manager tag checkbox filters use OR and combine with text search by AND", () => {
  const items = [
    { id: "a", title: "修复接口", category: "开发", tags: [" 排障 "] },
    { id: "b", title: "修复文案", category: "写作", tags: ["排障", "审查"] },
    { id: "c", title: "测试接口", category: "开发", tags: ["测试"] },
    { id: "d", title: "修复设计", category: "设计", tags: ["审查"] },
  ];
  const ids = (...args) => plain(helpers.filterManageTemplates(items, ...args)).map((item) => item.id);
  assert.deepEqual(ids("", []), ["a", "b", "c", "d"]);
  assert.deepEqual(ids("修复", ["开发", "写作"]), ["a", "b"]);
  assert.deepEqual(ids("接口", ["测试"]), ["c"]);
  assert.deepEqual(ids("", ["不存在"]), []);
  assert.deepEqual(ids("修复", [" 排障 ", "审查"]), ["a", "b", "d"]);
});

const orderItems = ["a", "hidden-1", "b", "hidden-2", "c"].map((id) => ({ id }));
const visibleIds = ["a", "b", "c"];

test("drag ordering preserves hidden slots and supports before and after drops", () => {
  assert.deepEqual(plain(helpers.reorderVisibleIds(orderItems, visibleIds, "c", "a", "before")), ["c", "hidden-1", "a", "hidden-2", "b"]);
  assert.deepEqual(plain(helpers.reorderVisibleIds(orderItems, visibleIds, "a", "c", "after")), ["b", "hidden-1", "c", "hidden-2", "a"]);
  assert.deepEqual(plain(helpers.reorderVisibleIds(orderItems, visibleIds, "b", "c", "before")), orderItems.map((item) => item.id));
  assert.deepEqual(plain(helpers.reorderVisibleIds(orderItems, visibleIds, "absent", "a")), orderItems.map((item) => item.id));
  assert.deepEqual(plain(helpers.reorderVisibleIds(orderItems, visibleIds, "a", "a")), orderItems.map((item) => item.id));
});

test("drag ordering rejects stale or invalid visible orders without dropping ids", () => {
  const original = orderItems.map((item) => item.id);
  for (const visible of [["b", "a", "c"], ["a", "a", "c"], ["a", "b", "absent"]]) {
    assert.deepEqual(plain(helpers.reorderVisibleIds(orderItems, visible, "a", "c")), original);
  }
  assert.deepEqual(plain(helpers.reorderVisibleIds(orderItems, visibleIds, "a", "c", "invalid")), original);
});

test("keyboard ordering moves within visible rows and clamps at boundaries", () => {
  assert.deepEqual(plain(helpers.moveVisibleIds(orderItems, visibleIds, "a", 1)), ["b", "hidden-1", "a", "hidden-2", "c"]);
  assert.deepEqual(plain(helpers.moveVisibleIds(orderItems, visibleIds, "c", -1)), ["a", "hidden-1", "c", "hidden-2", "b"]);
  assert.deepEqual(plain(helpers.moveVisibleIds(orderItems, visibleIds, "a", -1)), orderItems.map((item) => item.id));
  assert.deepEqual(plain(helpers.moveVisibleIds(orderItems, visibleIds, "c", 1)), orderItems.map((item) => item.id));
});

test("filtered reorder always remains a full permutation with fixed hidden positions", () => {
  const items = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  const original = items.map((item) => item.id);
  for (let mask = 1; mask < 32; mask++) {
    const visible = original.filter((_, index) => mask & (1 << index));
    for (const source of visible) for (const target of visible) for (const position of ["before", "after"]) {
      const next = plain(helpers.reorderVisibleIds(items, visible, source, target, position));
      assert.deepEqual([...next].sort(), [...original].sort());
      original.forEach((id, index) => {
        if (!visible.includes(id)) assert.equal(next[index], id);
      });
      if (source !== target) {
        assert.equal(position === "before" ? next.indexOf(source) < next.indexOf(target) : next.indexOf(source) > next.indexOf(target), true);
      }
    }
  }
});

test("tag shortcuts toggle without duplicates and respect the tag limit", () => {
  assert.deepEqual(plain(helpers.parseTags(helpers.toggleTagChoice("排障, 审查", "排障"))), ["审查"]);
  assert.deepEqual(plain(helpers.parseTags(helpers.toggleTagChoice("排障", "测试"))), ["排障", "测试"]);
  assert.deepEqual(plain(helpers.toggleTagChoice("a,b,c,d,e", "f")), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(plain(helpers.toggleTagChoice(["a", "b", "c", "d", "e", "f"], "g")), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(plain(helpers.parseTags(helpers.toggleTagChoice("a,b,c,d,e", "c"))), ["a", "b", "d", "e"]);
});

test("legacy category remains atomic and tags use the same canonical model as the host", async () => {
  const legacy = { ...global, category: "开发,设计，审查", tags: [" Review ", "review", " TEST "] };
  const draft = helpers.toDraft(legacy);
  assert.deepEqual(plain(draft.tags), ["Review", "TEST", "开发,设计，审查"]);
  assert.equal(draft.tagInput, "");
  assert.equal("category" in draft, false);
  assert.deepEqual(plain(helpers.templateTags(legacy)), plain(draft.tags));
  assert.deepEqual(plain(helpers.collectTemplateChoices([legacy, { tags: ["test", "new"] }])), { tags: ["Review", "TEST", "开发,设计，审查", "new"] });
  const store = new TemplateStore({ state: emptyState(), persist: async () => {} });
  const saved = await store.save({ template: { ...helpers.fromDraft(draft), id: undefined } });
  assert.deepEqual(saved.tags, plain(draft.tags));
  assert.equal("category" in saved, false);
  const cleared = await store.save({ template: helpers.fromDraft({ ...helpers.toDraft(saved), tags: [], tagInput: "" }), revision: store.revision });
  assert.deepEqual(cleared.tags, []);
});

test("pending tag input is saved and validated without truncating legacy labels", () => {
  const draft = { ...helpers.toDraft(global), tags: ["原子,标签", "a", "b", "c", "d"], tagInput: " e, A " };
  assert.deepEqual(plain(helpers.fromDraft(draft)).tags, ["原子,标签", "a", "b", "c", "d", "e"]);
  assert.deepEqual(plain(helpers.draftErrors(draft)), []);
  assert.ok(helpers.draftErrors({ ...draft, tagInput: "e,f" }).includes("tooManyTags"));
  assert.ok(helpers.draftErrors({ ...draft, tagInput: "x".repeat(21) }).includes("tagTooLong"));
  assert.equal(helpers.draftIsValid({ ...helpers.toDraft(global), tags: ["x".repeat(20)] }), true);
  assert.deepEqual(plain(helpers.toggleTagChoice([" Review ", "原子,标签"], "review")), ["原子,标签"]);
});

test("selecting then removing a pending tag cannot resurrect it on save", () => {
  const draft = { ...helpers.toDraft(global), tags: [], tagInput: " Review, keep " };
  const selected = { ...draft, ...helpers.toggleDraftTag(draft, "review") };
  assert.deepEqual(plain(selected.tags), ["review"]);
  assert.equal(selected.tagInput, "keep");
  const removed = { ...selected, ...helpers.toggleDraftTag(selected, "REVIEW") };
  assert.deepEqual(plain(helpers.fromDraft(removed)).tags, ["keep"]);
  const duplicate = { ...helpers.toDraft(global), tags: ["Review"], tagInput: "review, keep" };
  assert.deepEqual(plain(helpers.fromDraft({ ...duplicate, ...helpers.toggleDraftTag(duplicate, "Review") })).tags, ["keep"]);
});

test("both interface languages have the same translation keys", () => {
  assert.deepEqual(Object.keys(helpers.dict.zh).sort(), Object.keys(helpers.dict.en).sort());
});

test("utf-8 import decoding strips a BOM and rejects invalid bytes per file", () => {
  assert.deepEqual(plain(helpers.decodeUtf8(new TextEncoder().encode("中文 title\nbody"))), { ok: true, text: "中文 title\nbody" });
  // A BOM is consumed, never handed to the JSON parser.
  assert.deepEqual(plain(helpers.decodeUtf8(new TextEncoder().encode("\uFEFF{\"version\":1}"))), { ok: true, text: "{\"version\":1}" });
  assert.deepEqual(plain(helpers.decodeUtf8(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]))), { ok: false, reason: "decode" });
  const pre = plain(helpers.precheckImportFiles([{ name: "a.json", size: 4 }, { name: "b.md", size: 6 }]));
  assert.deepEqual(pre, { count: 2, totalBytes: 10, tooManyFiles: false, tooLarge: false });
  assert.equal(helpers.precheckImportFiles(Array.from({ length: 51 }, () => ({ size: 1 }))).tooManyFiles, true);
  assert.equal(helpers.precheckImportFiles([{ name: "a.json", size: helpers.IMPORT_LIMITS.bytes + 1 }]).tooLarge, true);
});

test("import preview totals drive the summary bar and the write count", () => {
  const entries = [
    { at: "f0#1", kind: "add", title: "A" },
    { at: "f0#2", kind: "identical", title: "B" },
    { at: "f0#3", kind: "conflict", title: "C", local: {}, incoming: {} },
    { at: "f0#4", kind: "conflict", title: "D", local: {}, incoming: {}, missingPaths: ["G:/x"] },
    { at: "f0#5", kind: "invalid", title: "E", reason: "body-empty" },
  ];
  // Every conflict keeps the local record until that row is switched.
  const defaults = plain(helpers.defaultImportResolutions(entries));
  assert.deepEqual(defaults, { "f0#3": "local", "f0#4": "local" });
  assert.deepEqual(plain(helpers.importSummary(entries, defaults)), {
    add: 1, conflict: 2, identical: 1, invalid: 1, missingPaths: 1, overwrite: 0, keptLocal: 2, warnings: 0, total: 5, skip: 3, write: 1,
  });
  const flipped = plain(helpers.importSummary(entries, { "f0#3": "import" }));
  assert.equal(flipped.overwrite, 1);
  assert.equal(flipped.write, 2);
  assert.equal(flipped.skip, 2);
  assert.deepEqual(plain(helpers.importResolutions(entries, "import")), { "f0#3": "import", "f0#4": "import" });
  assert.deepEqual(plain(helpers.importResolutions(entries, "local")), { "f0#3": "local", "f0#4": "local" });
});

test("conflicts are written from the local version unless switched", () => {
  assert.equal(helpers.importResolution({}, "f0#1"), "local");
  assert.equal(helpers.importResolution(null, "f0#1"), "local");
  assert.equal(helpers.importResolution({ "f0#1": "bogus" }, "f0#1"), "local");
  assert.equal(helpers.importResolution({ "f0#1": "import" }, "f0#1"), "import");
  const entries = [{ at: "f0#1", kind: "conflict" }, { at: "f0#2", kind: "add" }];
  assert.deepEqual(plain(helpers.importResolutionMap(entries, { "f0#1": "import" })), { "f0#1": "import" });
  // A dropped key can never mean "import": the host reads it as local too.
  assert.deepEqual(plain(helpers.importResolutionMap(entries, {})), { "f0#1": "local" });
  const stored = { title: "t", body: "b", tags: ["a"], scope: { kind: "global", paths: [] } };
  assert.deepEqual(plain(helpers.importDiffFields(stored, { ...stored })), []);
  assert.deepEqual(plain(helpers.importDiffFields(stored, { ...stored, tags: ["a", "b"] })), ["tags"]);
  assert.deepEqual(
    plain(helpers.importDiffFields(stored, { title: "t2", body: "b2", tags: ["x"], scope: { kind: "projects", paths: ["G:/w"] } })),
    ["title", "body", "tags", "scope"]
  );
});

test("export menu offers a whole-library JSON backup and a filtered Markdown view", () => {
  const items = plain(helpers.exportMenuItems());
  assert.deepEqual(items.map((entry) => entry.format), ["json", "md"]);
  assert.deepEqual(items.map((entry) => entry.scope), ["library", "filter"]);
  for (const entry of items) {
    assert.ok(entry.labelKey in helpers.dict.zh);
    assert.ok(entry.labelKey in helpers.dict.en);
    assert.ok(entry.hintKey in helpers.dict.zh);
    assert.ok(entry.hintKey in helpers.dict.en);
  }
  // An unfiltered export sends no ids at all, so the host returns the library.
  assert.equal(helpers.exportIds([global, project], false), null);
  assert.deepEqual(plain(helpers.exportIds([global, project, {}], true)), [global.id, project.id]);
  assert.equal(helpers.formatBytes(0), "0 B");
  assert.equal(helpers.formatBytes(2048), "2.0 KB");
});

test("only a filtered Markdown export sends ids, and they travel in a POST body", () => {
  // A whole-library export is a plain GET with no ids: a large library must not
  // be pasted into the query string (431 request-header/URL limits).
  assert.deepEqual(plain(helpers.exportRequest("json", null)), { method: "GET", path: "/export?format=json" });
  assert.deepEqual(plain(helpers.exportRequest("md", null)), { method: "GET", path: "/export?format=md" });
  assert.deepEqual(plain(helpers.exportRequest("md", [])), { method: "GET", path: "/export?format=md" });
  // JSON is always the whole library, even when the caller passes ids by mistake.
  assert.deepEqual(plain(helpers.exportRequest("json", [global.id])), { method: "GET", path: "/export?format=json" });
  const filtered = plain(helpers.exportRequest("md", [global.id, project.id, ""]));
  assert.equal(filtered.method, "POST");
  assert.equal(filtered.path, "/export");
  assert.deepEqual(filtered.body, { format: "md", ids: [global.id, project.id] });
});

test("body-edited warnings surface on import rows and in the totals", () => {
  assert.equal(helpers.importWarningKey({ warning: "body-edited" }), "impBodyEdited");
  assert.equal(helpers.importWarningKey({ warning: "" }), null);
  assert.equal(helpers.importWarningKey({}), null);
  assert.equal(helpers.importWarningKey(null), null);
  // An unknown future warning is still shown rather than silently dropped.
  assert.equal(helpers.importWarningKey({ warning: "something-new" }), "impWarning");
  for (const key of ["impBodyEdited", "impWarning", "impWarnCount"]) {
    assert.equal(typeof helpers.dict.zh[key], "string", key + " must exist in zh");
    assert.equal(typeof helpers.dict.en[key], "string", key + " must exist in en");
  }
  const entries = [
    { at: "f0#1", kind: "add", title: "A" },
    { at: "f0#2", kind: "add", title: "B", warning: "body-edited" },
    { at: "f0#3", kind: "conflict", title: "C", local: {}, incoming: {}, warning: "body-edited" },
    // Identical/invalid rows are not written, so their warning is not counted.
    { at: "f0#4", kind: "identical", title: "D", warning: "body-edited" },
    { at: "f0#5", kind: "add", title: "E" },
  ];
  assert.equal(plain(helpers.importSummary(entries)).warnings, 2);
  // A clean batch renders no warning line and no footer count.
  assert.equal(plain(helpers.importSummary([{ at: "f0#1", kind: "add" }])).warnings, 0);
});

test("a cancelled file dialog never discards the draft or leaves the editor", () => {
  const draft = { id: "a", title: "Unsaved", body: "draft", tags: [], scopeKind: "global", paths: [], tagInput: "", pinned: false };
  for (const picked of [[], null, undefined]) {
    for (const editor of [{ selectedId: "a", draft }, { selectedId: null, draft }, { selectedId: null, draft: null }]) {
      assert.deepEqual(plain(helpers.importPickTransition(picked, editor)), { action: "none" });
    }
  }
  const picked = [{ name: "a.json" }];
  // Only a real pick can switch views: an edited row is reset, a new draft is dropped.
  assert.deepEqual(plain(helpers.importPickTransition(picked, { selectedId: "a", draft })), { action: "select", id: "a" });
  assert.deepEqual(plain(helpers.importPickTransition(picked, { selectedId: null, draft })), { action: "back" });
  assert.deepEqual(plain(helpers.importPickTransition(picked, { selectedId: null, draft: null })), { action: "none" });
  assert.deepEqual(plain(helpers.importPickTransition(picked, {})), { action: "none" });
});
