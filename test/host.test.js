import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { collectProjects, createRouteHandler, isSameOriginWrite, parseRequestUrl } from "../lib/index.js";
import { emptyState, SEED_TEMPLATES, TemplateStore } from "../lib/store.js";

const ORIGIN = "http://127.0.0.1:3723";
const PREFIX = "/dsh-prompt-template";

/**
 * @param {{ workspace?: string, projects?: Array<{path: string, label?: string}>, origin?: string | null }} [options]
 */
function makeHandler(options = {}) {
  const workspace = options.workspace ?? "G:\\work\\a";
  const projects = options.projects ?? [{ path: "G:\\work\\b", label: "B 项目" }];
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  const writes = [];
  const store = new TemplateStore({
    state: emptyState(),
    persist: async (next) => {
      writes.push(next);
    },
  });
  const handler = createRouteHandler({
    ensureStore: async () => store,
    getOrigin: () => origin,
    resolveWorkspace: (sessionId) => (sessionId === "s1" ? workspace : ""),
    listProjects: () => projects,
  });
  return { store, handler, writes };
}

/**
 * @param {{ method?: string, url?: string, body?: unknown, headers?: Record<string, string> }} [spec]
 */
function makeRequest(spec = {}) {
  const method = spec.method ?? "GET";
  const url = spec.url ?? `${PREFIX}/ping`;
  const payload = spec.body === undefined ? [] : [Buffer.from(typeof spec.body === "string" ? spec.body : JSON.stringify(spec.body))];
  const req = Readable.from(payload);
  req.method = method;
  req.url = url;
  req.headers = { host: "127.0.0.1:3723", ...(spec.headers ?? {}) };
  return req;
}

function makeResponse() {
  const state = { status: 0, headers: {}, body: "" };
  const res = {
    writeHead(status, headers) {
      state.status = status;
      state.headers = headers ?? {};
    },
    end(body) {
      state.body = body ?? "";
    },
  };
  return { res, state, json: () => JSON.parse(state.body) };
}

function post(url, body, headers = {}) {
  return {
    method: "POST",
    url,
    body,
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
  };
}

async function call(handler, spec) {
  const { res, state } = makeResponse();
  await handler(makeRequest(spec), res);
  return { status: state.status, headers: state.headers, body: state.body ? JSON.parse(state.body) : null };
}

test("ping answers without touching storage", async () => {
  const { handler } = makeHandler();
  const result = await call(handler, { url: `${PREFIX}/ping` });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.version, "0.1.0");
});

test("unknown routes answer 404 and writes answer 405 for the wrong method", async () => {
  const { handler } = makeHandler();
  const missing = await call(handler, { url: `${PREFIX}/nope` });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.ok, false);

  const wrongMethod = await call(handler, { url: `${PREFIX}/save` });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.error, "method-not-allowed");
});

test("list filters by the calling session's workspace", async () => {
  const { handler, store } = makeHandler();
  await store.save({ template: { title: "global", body: "x", scope: { kind: "global" } } });
  await store.save({ template: { title: "here", body: "x", scope: { kind: "projects", paths: ["G:\\work\\a"] } } });
  await store.save({ template: { title: "there", body: "x", scope: { kind: "projects", paths: ["G:\\work\\b"] } } });

  const scoped = await call(handler, { url: `${PREFIX}/list?sessionId=s1` });
  assert.equal(scoped.status, 200);
  assert.equal(scoped.body.workspace, "G:\\work\\a");
  assert.deepEqual(
    scoped.body.items.map((item) => item.title),
    ["global", "here"],
  );

  const all = await call(handler, { url: `${PREFIX}/list?all=1` });
  assert.equal(all.body.items.length, 3);
  assert.equal(all.body.all, true);
});

test("list reports the workspace, project paths and project labels", async () => {
  const { handler, store } = makeHandler();
  await store.save({ template: { title: "x", body: "x", scope: { kind: "projects", paths: ["G:\\history\\c"] } } });

  const result = await call(handler, { url: `${PREFIX}/list?sessionId=s1` });
  assert.deepEqual(result.body.projects, ["G:\\work\\a", "G:\\work\\b", "G:\\history\\c"]);
  assert.equal(result.body.projectLabels["G:\\work\\b"], "B 项目");
  assert.equal(result.body.projectLabels["G:\\history\\c"], "c");
  assert.equal(result.body.seeded, false);
});

test("a request without a session sees global templates only", async () => {
  const { handler, store } = makeHandler();
  await store.save({ template: { title: "global", body: "x", scope: { kind: "global" } } });
  await store.save({ template: { title: "here", body: "x", scope: { kind: "projects", paths: ["G:\\work\\a"] } } });

  const result = await call(handler, { url: `${PREFIX}/list` });
  assert.equal(result.body.workspace, "");
  assert.deepEqual(
    result.body.items.map((item) => item.title),
    ["global"],
  );
});

test("save returns the complete stored item", async () => {
  const { handler, store } = makeHandler();
  const result = await call(handler, post(`${PREFIX}/save`, { template: { title: "新模板", body: "内容" } }));
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.ok(result.body.item.id);
  assert.equal(result.body.item.title, "新模板");
  assert.ok(result.body.item.createdAt > 0);
  assert.equal(result.body.revision, 1);
  assert.equal(store.snapshot().items.length, 1);
});

test("save updates an existing template and keeps createdAt", async () => {
  const { handler } = makeHandler();
  const created = await call(handler, post(`${PREFIX}/save`, { template: { title: "第一版", body: "x" } }));
  const updated = await call(handler, post(`${PREFIX}/save`, { template: { id: created.body.item.id, title: "第二版", body: "y" } }));
  assert.equal(updated.body.item.id, created.body.item.id);
  assert.equal(updated.body.item.title, "第二版");
  assert.equal(updated.body.item.createdAt, created.body.item.createdAt);
});

test("save rejects an unknown id and a bad scope with 400/404", async () => {
  const { handler } = makeHandler();
  const missing = await call(handler, post(`${PREFIX}/save`, { template: { id: "missing", title: "x", body: "x" } }));
  assert.equal(missing.status, 404);

  const badScope = await call(
    handler,
    post(`${PREFIX}/save`, { template: { title: "x", body: "x", scope: { kind: "projects", paths: ["x"] } } }),
  );
  assert.equal(badScope.status, 400);
  assert.equal(badScope.body.error, "invalid-input");
});

test("delete, touch and reorder keep the list consistent", async () => {
  const { handler } = makeHandler();
  const a = await call(handler, post(`${PREFIX}/save`, { template: { title: "a", body: "x" } }));
  const b = await call(handler, post(`${PREFIX}/save`, { template: { title: "b", body: "x" } }));

  const touched = await call(handler, post(`${PREFIX}/touch`, { id: a.body.item.id }));
  assert.equal(touched.status, 200);
  assert.ok(touched.body.item.lastUsedAt > 0);

  const reordered = await call(handler, post(`${PREFIX}/reorder`, { ids: [b.body.item.id, a.body.item.id] }));
  assert.equal(reordered.status, 200);
  assert.deepEqual(
    reordered.body.items.map((item) => item.title),
    ["b", "a"],
  );

  const removed = await call(handler, post(`${PREFIX}/delete`, { id: a.body.item.id }));
  assert.equal(removed.status, 200);
  assert.equal(removed.body.ok, true);

  const list = await call(handler, { url: `${PREFIX}/list?all=1` });
  assert.deepEqual(
    list.body.items.map((item) => item.title),
    ["b"],
  );

  const again = await call(handler, post(`${PREFIX}/delete`, { id: a.body.item.id }));
  assert.equal(again.status, 404);
});

test("stale revisions answer 409 with the current revision", async () => {
  const { handler } = makeHandler();
  await call(handler, post(`${PREFIX}/save`, { template: { title: "a", body: "x" } }));
  const conflict = await call(handler, post(`${PREFIX}/save`, { template: { title: "b", body: "x" }, revision: 0 }));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "revision-conflict");
  assert.equal(conflict.body.revision, 1);
});

test("writes require JSON content type and a same-origin Origin", async () => {
  const { handler } = makeHandler();
  const wrongType = await call(handler, { ...post(`${PREFIX}/save`, { template: { title: "x", body: "x" } }), headers: { "content-type": "text/plain" } });
  assert.equal(wrongType.status, 415);

  const crossOrigin = await call(handler, {
    ...post(`${PREFIX}/save`, { template: { title: "x", body: "x" } }),
    headers: { "content-type": "application/json", origin: "http://evil.example" },
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.body.error, "forbidden-origin");
});

test("malformed JSON answers 400 instead of crashing", async () => {
  const { handler } = makeHandler();
  const result = await call(handler, { ...post(`${PREFIX}/save`, "not json"), headers: { "content-type": "application/json", origin: ORIGIN } });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "invalid-input");
});

test("a fresh install is seeded on the first list and never again", async () => {
  const writes = [];
  const store = new TemplateStore({
    state: emptyState(),
    persist: async (next) => {
      writes.push(next);
    },
  });
  const handler = createRouteHandler({
    ensureStore: async () => {
      await store.ensureSeeded(SEED_TEMPLATES);
      return store;
    },
    getOrigin: () => ORIGIN,
  });

  const first = await call(handler, { url: `${PREFIX}/list?all=1` });
  assert.equal(first.body.seeded, true);
  assert.equal(first.body.items.length, SEED_TEMPLATES.length);
  assert.ok(first.body.items.some((item) => item.pinned));

  const second = await call(handler, { url: `${PREFIX}/list?all=1` });
  assert.equal(second.body.items.length, SEED_TEMPLATES.length, "seed must not duplicate");
  assert.equal(second.body.revision, first.body.revision, "a no-op seed must not write");
  assert.equal(writes.length, 1);
});

test("parseRequestUrl splits path and query including encoded values", () => {
  const parsed = parseRequestUrl(`${PREFIX}/list?sessionId=a%20b&all=1`);
  assert.equal(parsed.pathname, `${PREFIX}/list`);
  assert.equal(parsed.searchParams.get("sessionId"), "a b");
  assert.equal(parsed.searchParams.get("all"), "1");
});

test("isSameOriginWrite accepts same-origin, fetch metadata and matching host", () => {
  assert.equal(isSameOriginWrite({ headers: { origin: ORIGIN } }, ORIGIN), true);
  assert.equal(isSameOriginWrite({ headers: { origin: "http://evil.example" } }, ORIGIN), false);
  assert.equal(isSameOriginWrite({ headers: { "sec-fetch-site": "same-origin" } }, ORIGIN), true);
  assert.equal(isSameOriginWrite({ headers: { "sec-fetch-site": "cross-site" } }, ORIGIN), false);
  assert.equal(isSameOriginWrite({ headers: { host: "127.0.0.1:3723" } }, ORIGIN), true);
  assert.equal(isSameOriginWrite({ headers: { host: "evil.example" } }, ORIGIN), false);
  assert.equal(isSameOriginWrite({ headers: {} }, null), true);
});

test("collectProjects dedupes, keeps the workspace first and labels by basename", () => {
  const items = [{ scope: { kind: "projects", paths: ["G:\\work\\a", "G:\\history\\c"] } }];
  const result = collectProjects("G:\\work\\a", items, [{ path: "G:\\work\\b", label: "B 项目" }]);
  assert.deepEqual(result.paths, ["G:\\work\\a", "G:\\work\\b", "G:\\history\\c"]);
  assert.equal(result.labels["G:\\work\\a"], "a");
  assert.equal(result.labels["G:\\work\\b"], "B 项目");
});
