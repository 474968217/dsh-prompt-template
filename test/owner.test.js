import test from "node:test";
import assert from "node:assert/strict";

import { createStorageOwner, isSameOriginWrite } from "../lib/index.js";
import { emptyState, LIMITS, SEED_TEMPLATES } from "../lib/store.js";

/** A storage domain stand-in that records how often it was closed. */
function makeDomain(state = emptyState()) {
  const domain = {
    state,
    closed: 0,
    global: {
      get: () => domain.state,
      set: async (next) => {
        domain.state = next;
      },
    },
    async close() {
      domain.closed += 1;
    },
  };
  return domain;
}

/** A host context exposing only the storageDomain service. */
function makeCtx(open) {
  const calls = [];
  return {
    calls,
    ctx: {
      get: (key) => (key === "storageDomain" ? { open: async (spec) => {
        calls.push(spec);
        return open(spec);
      } } : undefined),
    },
  };
}

test("field limits match the frozen plan", () => {
  assert.equal(LIMITS.title, 60);
  assert.equal(LIMITS.category, 20);
  assert.equal(LIMITS.tags, 5);
  assert.equal(LIMITS.tag, 12);
  assert.equal(LIMITS.body, 20000);
});

test("six seed templates ship, none of them scoped", () => {
  assert.equal(SEED_TEMPLATES.length, 6);
  for (const seed of SEED_TEMPLATES) assert.deepEqual(seed.scope, { kind: "global" });
});

test("concurrent ensureStore calls share one open", async () => {
  const domain = makeDomain();
  const { ctx, calls } = makeCtx(async () => domain);
  const owner = createStorageOwner(ctx);
  const [a, b] = await Promise.all([owner.ensureStore(), owner.ensureStore()]);
  assert.equal(a, b);
  assert.equal(calls.length, 1);
  await owner.dispose();
  assert.equal(domain.closed, 1);
});

test("a failed seed releases its domain so a retry can open again", async () => {
  const broken = makeDomain();
  broken.global.set = async () => {
    throw new Error("disk full");
  };
  const healthy = makeDomain();
  const queue = [broken, healthy];
  const { ctx, calls } = makeCtx(async () => queue.shift());
  const owner = createStorageOwner(ctx);

  await assert.rejects(owner.ensureStore(), /disk full/);
  assert.equal(broken.closed, 1, "the failed attempt must close its handle");

  const store = await owner.ensureStore();
  assert.equal(calls.length, 2);
  assert.equal(store.list({ all: true }).length, 6);
  await owner.dispose();
  assert.equal(healthy.closed, 1);
});

test("dispose waits for an in-flight open and closes its domain", async () => {
  const domain = makeDomain();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { ctx } = makeCtx(async () => {
    await gate;
    return domain;
  });
  const owner = createStorageOwner(ctx);
  const pending = owner.ensureStore();
  pending.catch(() => undefined);

  const disposing = owner.dispose();
  release();
  await disposing;

  await assert.rejects(pending, (error) => error.code === "storage-unavailable");
  assert.equal(domain.closed, 1, "a handle opened after dispose must be released");
  assert.equal(owner.isDisposed(), true);
  await assert.rejects(owner.ensureStore(), (error) => error.code === "storage-unavailable");
});

test("dispose is idempotent and closes each domain once", async () => {
  const domain = makeDomain();
  const { ctx } = makeCtx(async () => domain);
  const owner = createStorageOwner(ctx);
  await owner.ensureStore();
  await owner.dispose();
  await owner.dispose();
  assert.equal(domain.closed, 1);
  assert.equal(owner.isDisposed(), true);
});

test("a missing storageDomain surfaces as storage-unavailable", async () => {
  const owner = createStorageOwner({ get: () => undefined });
  await assert.rejects(owner.ensureStore(), (error) => error.code === "storage-unavailable");
  await owner.dispose();
});

test("cross-site fetch metadata is rejected even without an Origin header", () => {
  const local = "http://127.0.0.1:3723";
  const write = (headers) => ({ headers });
  assert.equal(isSameOriginWrite(write({ "sec-fetch-site": "cross-site", host: "127.0.0.1:3723" }), local), false);
  assert.equal(
    isSameOriginWrite(write({ "sec-fetch-site": "cross-site", origin: local, host: "127.0.0.1:3723" }), local),
    false,
  );
  assert.equal(isSameOriginWrite(write({ "sec-fetch-site": "same-site", host: "127.0.0.1:3723" }), local), false);
  assert.equal(isSameOriginWrite(write({ "sec-fetch-site": "same-origin", host: "127.0.0.1:3723" }), local), true);
  assert.equal(isSameOriginWrite(write({ "sec-fetch-site": "none", host: "127.0.0.1:3723" }), local), true);
});

test("origin comparison falls back to host only when nothing else is known", () => {
  const local = "http://127.0.0.1:3723";
  const write = (headers) => ({ headers });
  assert.equal(isSameOriginWrite(write({ origin: local, host: "127.0.0.1:3723" }), local), true);
  assert.equal(isSameOriginWrite(write({ origin: "http://evil.test", host: "127.0.0.1:3723" }), local), false);
  assert.equal(isSameOriginWrite(write({ origin: local, host: "127.0.0.1:3723" }), null), true);
  assert.equal(isSameOriginWrite(write({ origin: "http://evil.test", host: "evil.test" }), null), true);
  assert.equal(isSameOriginWrite(write({ host: "127.0.0.1:3723" }), null), true);
  assert.equal(isSameOriginWrite(write({ host: "127.0.0.1:3723" }), local), true);
  assert.equal(isSameOriginWrite(write({ host: "evil.test" }), local), false);
});
