import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DOMAIN_NAME, DOMAIN_VERSION } from "../../lib/index.js";
import { createStateSchema, emptyState, normalizeState, TemplateStore } from "../../lib/store.js";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const childScript = join(here, "..", "..", "scripts", "json-medium-child.mjs");

/**
 * The desktop binary doubles as a Node runtime once `ELECTRON_RUN_AS_NODE=1`
 * is set, and Electron's patched `fs` is what makes `app.asar` importable.
 * Override the location with `DSH_DESKTOP_EXE` on another machine.
 */
const DESKTOP_CANDIDATES = [
  process.env.DSH_DESKTOP_EXE,
  "D:\\dsh\\DeepSeek Harness.exe",
  join(process.env.LOCALAPPDATA ?? "", "Programs", "DeepSeek Harness", "DeepSeek Harness.exe"),
].filter(Boolean);

function findRuntime() {
  for (const exe of DESKTOP_CANDIDATES) {
    if (!existsSync(exe)) continue;
    // `app.asar` is a file, so plain fs cannot probe inside it; the archive's
    // presence plus the binary is all this test needs (the child does the import).
    const archive = join(dirname(exe), "resources", "app.asar");
    if (!existsSync(archive)) continue;
    const adapter = join(archive, "dsh", "node_modules", "@deepseek-ai", "dsh-storage-json", "lib", "index.js");
    return { exe, adapter };
  }
  return null;
}

const runtime = process.env.DSH_SKIP_JSON_MEDIUM === "1" ? null : findRuntime();

function runChild({ exe, adapter }, root, mode, state) {
  const envelope = JSON.stringify({ adapter, root, mode, state });
  const result = spawnSync(exe, [childScript, envelope], {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    windowsHide: true,
    timeout: 60_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.error, undefined, `child failed to start: ${result.error}`);
  assert.equal(result.status, 0, `child exited ${result.status}: ${output.slice(0, 800)}`);
  assert.match(output, new RegExp(`CHILD_DONE ${mode}`), output.slice(0, 800));
  return output;
}

test("the real storage-json medium round-trips a cold reopen", { skip: runtime === null && "no desktop install with app.asar found" }, async () => {
  // Build the payload through the production store, so the bytes under test are
  // exactly what the host half would write.
  let written;
  const store = new TemplateStore({
    state: emptyState(),
    persist: async (next) => {
      written = next;
    },
  });
  await store.ensureSeeded();
  assert.ok(written, "seeding should produce a persisted state");
  assert.equal(written.items.length, 4);

  const root = mkdtempSync(join(tmpdir(), "dpt-json-medium-"));
  try {
    runChild(runtime, root, "write", written);

    // A second process = a genuinely cold read of the medium, not a cached object.
    const read = runChild(runtime, root, "read");
    const payload = read.split("CHILD_STATE ")[1]?.split(/\r?\n/)[0];
    assert.ok(payload, `child did not report state: ${read.slice(0, 500)}`);
    assert.deepEqual(JSON.parse(payload), written);

    const file = join(root, `${DOMAIN_NAME}.json`);
    assert.ok(existsSync(file), "the single-layout unit file should exist");
    const document = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(Object.keys(document).sort(), ["global", "tables", "unit"]);
    assert.equal(document.unit.name, DOMAIN_NAME);
    assert.equal(document.unit.version, DOMAIN_VERSION);
    assert.deepEqual(document.tables, {}, "this plugin keeps no record tables");

    // The medium's own output must satisfy our schema and rebuild a store.
    const schema = createStateSchema();
    assert.equal(schema.safeParse(document.global).success, true);
    const rebuilt = new TemplateStore({ state: normalizeState(document.global), persist: async () => {} });
    assert.deepEqual(
      rebuilt.list({ all: true }).map((item) => item.title),
      written.items.map((item) => item.title),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the domain name satisfies the storage unit-name rule", () => {
  assert.match(DOMAIN_NAME, /^[a-z][a-z0-9_]*$/);
});
