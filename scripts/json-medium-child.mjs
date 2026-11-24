/**
 * Standalone child used by `test/integration/json-medium.test.js`.
 *
 * It runs under the desktop binary started with `ELECTRON_RUN_AS_NODE=1`,
 * which is the only way to `import` a module that lives inside `app.asar`:
 * plain Node cannot read asar archives, but Electron patches `fs` for them.
 *
 * The script exercises the *real* `@deepseek-ai/dsh-storage-json` backend —
 * never a mock — against a throwaway root directory, so it never touches the
 * live `~/.dsh/storages` unit.
 *
 * argv[2] is a JSON envelope: `{ adapter, root, mode, state? }`.
 */
const envelope = JSON.parse(process.argv[2] ?? "{}");
const { adapter, root, mode, state } = envelope;

const fail = (error) => {
  console.error(`CHILD_ERROR ${error?.stack ?? error}`);
  process.exit(2);
};

if (!adapter || !root || !mode) fail(new Error("envelope needs adapter, root, mode"));

const url = new URL(`file:///${String(adapter).replace(/\\/g, "/")}`).href;
const module = await import(url).catch(fail);
const { JsonStorageBackend } = module ?? {};
if (typeof JsonStorageBackend !== "function") fail(new Error("adapter did not export JsonStorageBackend"));

// The descriptor mirrors what our host half passes to `ctx.storageDomain.open`
// (single layout, one global slot, no record tables used by this plugin).
const descriptor = {
  name: "prompt_templates",
  version: 1,
  tables: [],
  hasGlobal: true,
  layout: "single",
};

const backend = new JsonStorageBackend(root);
const unit = await backend.kv.open(descriptor).catch(fail);

try {
  if (mode === "write") {
    await unit.setGlobal(state).catch(fail);
  } else if (mode === "read") {
    const snapshot = await unit.loadAll();
    process.stdout.write(`CHILD_STATE ${JSON.stringify(snapshot.global)}\n`);
  } else {
    fail(new Error(`unknown mode '${mode}'`));
  }
} finally {
  await unit.close().catch(fail);
  await backend.close().catch(fail);
}

process.stdout.write(`CHILD_DONE ${mode}\n`);
