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

test("both interface languages have the same translation keys", () => {
  assert.deepEqual(Object.keys(helpers.dict.zh).sort(), Object.keys(helpers.dict.en).sort());
});
