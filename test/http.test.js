import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createRouteHandler } from "../lib/index.js";
import { TemplateStore } from "../lib/store.js";

function harness() {
  const writes = [];
  const legacy = {
    revision: 4, seeded: true,
    items: [{
      id: "legacy", title: "用户模板", body: "保留正文", category: "一".repeat(20),
      tags: ["a", "b", "c", "d", "e"], scope: { kind: "global" }, pinned: true,
      createdAt: 1, updatedAt: 2, lastUsedAt: null,
    }],
  };
  const store = new TemplateStore({ state: legacy, persist: async (next) => { writes.push(next); } });
  const handler = createRouteHandler({ ensureStore: async () => store, getOrigin: () => "http://localhost" });
  async function call(path, body) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.url = `/dsh-prompt-template${path}`;
    req.method = body === undefined ? "GET" : "POST";
    req.headers = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
    let status;
    let result;
    await handler(req, { writeHead: (value) => { status = value; }, end: (value) => { result = JSON.parse(value); } });
    return { status, body: result };
  }
  return { store, writes, call };
}

test("HTTP lists legacy labels canonically and saves the complete six-tag item", async () => {
  const { call, writes } = harness();
  const list = await call("/list?all=1");
  assert.equal(list.status, 200);
  assert.equal(list.body.revision, 4);
  assert.equal(writes.length, 0);
  const item = list.body.items[0];
  assert.deepEqual(item.tags, ["a", "b", "c", "d", "e", "一".repeat(20)]);
  assert.ok(!("category" in item));
  const saved = await call("/save", { revision: 4, template: { ...item, title: "修改标题" } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 5);
  assert.deepEqual(saved.body.item.tags, item.tags);
  assert.ok(!("category" in writes[0].items[0]));
});

test("HTTP accepts legacy saves, dedupes category, and retains punctuation as one label", async () => {
  const { call } = harness();
  const saved = await call("/save", {
    revision: 4,
    template: { title: "旧客户端", body: "x", category: "Review, 审查", tags: [" review, 审查 ", "a"] },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.item.tags, ["review, 审查", "a"]);
  assert.ok(!("category" in saved.body.item));
});

test("HTTP rejects over-limit or stale saves without mutating a migrated library", async () => {
  const { call, store, writes } = harness();
  const before = store.snapshot();
  const item = before.items[0];
  const overflow = await call("/save", { revision: 4, template: { ...item, tags: [...item.tags, "extra"] } });
  assert.equal(overflow.status, 400);
  assert.equal(overflow.body.error, "invalid-input");
  const stale = await call("/save", { revision: 3, template: { ...item, tags: [] } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.revision, 4);
  assert.deepEqual(store.snapshot(), before);
  assert.equal(writes.length, 0);
  const cleared = await call("/save", { revision: 4, template: { ...item, tags: [] } });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.item.tags, []);
  assert.deepEqual((await call("/list?all=1")).body.items[0].tags, []);
});

/** Raw request so a test can vary method, content type, and origin. */
async function request(handler, path, { method = "GET", headers = {}, body } = {}) {
  const payload = body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const req = Readable.from(payload);
  req.url = `/dsh-prompt-template${path}`;
  req.method = method;
  req.headers = { host: "localhost", ...headers };
  let status;
  let result;
  await handler(req, { writeHead: (value) => { status = value; }, end: (value) => { result = JSON.parse(value); } });
  return { status, body: result };
}

const SAME_ORIGIN_JSON = { origin: "http://localhost", "content-type": "application/json" };

test("HTTP export is a pure read: GET for the library, POST for subsets", async () => {
  const { store, writes, call } = harness();
  const before = store.snapshot();
  const exported = await call("/export?format=json");
  assert.equal(exported.status, 200);
  assert.equal(exported.body.ok, true);
  assert.equal(exported.body.format, "json");
  assert.equal(exported.body.mime, "application/json");
  assert.equal(exported.body.count, 1);
  assert.match(exported.body.filename, /^dsh-prompt-templates-\d{8}-\d{4}\.json$/);
  const document = JSON.parse(exported.body.content);
  assert.deepEqual(document.items[0].tags, ["a", "b", "c", "d", "e", "一".repeat(20)]);
  assert.ok(!("category" in document.items[0]));
  assert.deepEqual(store.snapshot(), before);
  assert.equal(store.revision, 4);
  assert.equal(writes.length, 0);

  const handler = createRouteHandler({ ensureStore: async () => store, getOrigin: () => "http://localhost" });

  // POST without ids is the whole library; JSON never narrows even with ids.
  const postedAll = await request(handler, "/export", { method: "POST", headers: SAME_ORIGIN_JSON, body: {} });
  assert.equal(postedAll.status, 200);
  assert.equal(postedAll.body.format, "json");
  assert.equal(postedAll.body.count, 1);
  const postedJsonIds = await request(handler, "/export", {
    method: "POST",
    headers: SAME_ORIGIN_JSON,
    body: { format: "json", ids: ["legacy"] },
  });
  assert.equal(postedJsonIds.body.count, 1);

  // Markdown subsets travel in the body, including an empty filter result.
  const postedMd = await request(handler, "/export", {
    method: "POST",
    headers: SAME_ORIGIN_JSON,
    body: { format: "md", ids: ["legacy"] },
  });
  assert.equal(postedMd.status, 200);
  assert.equal(postedMd.body.mime, "text/markdown");
  assert.equal(postedMd.body.count, 1);
  const postedEmpty = await request(handler, "/export", {
    method: "POST",
    headers: SAME_ORIGIN_JSON,
    body: { format: "md", ids: [] },
  });
  assert.equal(postedEmpty.status, 200);
  assert.equal(postedEmpty.body.count, 0);

  const postedUnknown = await request(handler, "/export", {
    method: "POST",
    headers: SAME_ORIGIN_JSON,
    body: { format: "md", ids: ["ghost"] },
  });
  assert.equal(postedUnknown.status, 400);
  assert.equal(postedUnknown.body.error, "unknown-id");

  // A cross-origin POST stays refused even though export writes nothing.
  const crossOrigin = await request(handler, "/export", {
    method: "POST",
    headers: { host: "localhost", origin: "http://evil.example", "content-type": "application/json" },
    body: { format: "md", ids: ["legacy"] },
  });
  assert.equal(crossOrigin.status, 403);

  assert.deepEqual(store.snapshot(), before);
  assert.equal(store.revision, 4);
  assert.equal(writes.length, 0);
});

test("HTTP Markdown export honours ids and refuses unknown ones", async () => {
  const { store, call } = harness();
  const markdown = await call("/export?format=md&ids=legacy");
  assert.equal(markdown.status, 200);
  assert.equal(markdown.body.mime, "text/markdown");
  assert.match(markdown.body.content, /^<!-- dsh-prompt-templates v1 \| exported \S+ \| 1 templates -->/);
  assert.match(markdown.body.content, /\n## 用户模板\n/);

  const unknown = await call("/export?format=md&ids=legacy,ghost");
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, "unknown-id");
  assert.equal(unknown.body.id, "ghost");
  const bad = await call("/export?format=yaml");
  assert.equal(bad.status, 400);
  assert.equal(store.revision, 4);
});

test("HTTP import routes are same-origin JSON writes and reject other methods", async () => {
  const { store } = harness();
  const handler = createRouteHandler({ ensureStore: async () => store, getOrigin: () => "http://localhost" });
  const files = [{ name: "a.md", text: "## t\n\nb\n" }];

  const read = await request(handler, "/import/preview");
  assert.equal(read.status, 405);

  const wrongType = await request(handler, "/import/preview", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "text/plain" }, body: files,
  });
  assert.equal(wrongType.status, 415);
  assert.equal(wrongType.body.error, "unsupported-media-type");

  const crossOrigin = await request(handler, "/import/commit", {
    method: "POST", headers: { origin: "http://evil.test", "content-type": "application/json" }, body: { revision: 4, files },
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.body.error, "forbidden-origin");

  const malformed = await request(handler, "/import/preview", {
    method: "POST", headers: SAME_ORIGIN_JSON, body: { files: "nope" },
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error, "invalid-input");
  assert.equal(store.revision, 4);
});

test("HTTP preview then commit round-trips through the host", async () => {
  const { store, writes, call } = harness();
  const handler = createRouteHandler({ ensureStore: async () => store, getOrigin: () => "http://localhost" });
  const exported = await request(handler, "/export?format=md", { headers: SAME_ORIGIN_JSON });
  const files = [{ name: "backup.md", text: exported.body.content }];

  const preview = await call("/import/preview", { files });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.preview.summary.identical, 1);
  assert.equal(writes.length, 0);

  const added = await call("/import/commit", {
    revision: 4,
    files: [{ name: "notes.md", text: "## 手写标题\n\n手写正文\n" }],
  });
  assert.equal(added.status, 200);
  assert.deepEqual([added.body.added, added.body.replaced, added.body.skipped], [1, 0, 0]);
  assert.equal(added.body.revision, 5);
  assert.equal(added.body.touched.length, 1);
  assert.match(added.body.touched[0].at, /^f0#0$/);
  assert.deepEqual((await call("/list?all=1")).body.items.map((item) => item.title), ["用户模板", "手写标题"]);
});

test("HTTP keeps unrelated routes unknown after the export/import additions", async () => {
  const { call } = harness();
  for (const path of ["/exportx", "/import", "/import/other", "/export/import"]) {
    const response = await call(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.body.error, "not-found");
  }
  assert.equal((await call("/ping")).body.ok, true);
});
