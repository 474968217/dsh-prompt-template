import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Only evaluate pure exports. No DOM, components, hooks or renderer are invoked.
const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
let entry;
vm.runInNewContext(source, {
  window: { __ModuleLoader__: { load(value) { entry = value; } } },
  navigator: { userAgent: "Windows" },
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
  assert.deepEqual(plain(helpers.fromDraft(helpers.toDraft(item))), item);
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
    categories: ["开发", "写作"], tags: ["排障", "审查", "测试"],
  });
});

test("manager checkbox filters use OR within dimensions and AND across dimensions and query", () => {
  const items = [
    { id: "a", title: "修复接口", category: "开发", tags: [" 排障 "] },
    { id: "b", title: "修复文案", category: "写作", tags: ["排障", "审查"] },
    { id: "c", title: "测试接口", category: "开发", tags: ["测试"] },
    { id: "d", title: "修复设计", category: "设计", tags: ["审查"] },
  ];
  const ids = (...args) => plain(helpers.filterManageTemplates(items, ...args)).map((item) => item.id);
  assert.deepEqual(ids("", [], []), ["a", "b", "c", "d"]);
  assert.deepEqual(ids("修复", ["开发", "写作"], ["排障", "测试"]), ["a", "b"]);
  assert.deepEqual(ids("接口", ["开发"], ["测试"]), ["c"]);
  assert.deepEqual(ids("", ["不存在"], []), []);
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
  assert.deepEqual(plain(helpers.parseTags(helpers.toggleTagChoice("a,b,c,d,e", "f"))), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(plain(helpers.parseTags(helpers.toggleTagChoice("a,b,c,d,e", "c"))), ["a", "b", "d", "e"]);
});

test("both interface languages have the same translation keys", () => {
  assert.deepEqual(Object.keys(helpers.dict.zh).sort(), Object.keys(helpers.dict.en).sort());
});
