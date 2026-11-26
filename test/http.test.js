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
