/**
 * dsh-prompt-template — pure store logic.
 *
 * No DeepSeek Harness and no npm imports live here on purpose: the plugin is
 * installed as a junction into the desktop profile, so Node resolves its
 * dependencies from the real path (the git checkout) — where `zod` and friends
 * are not available. The storage-domain facility only ever calls
 * `valueSchema.parse()` while loading, never while writing, so shape checks
 * must happen here before anything reaches the medium.
 *
 * State model (one JSON document, the `global` slot of the domain):
 *   { revision, seeded, items: PromptTemplate[] }
 *
 *   PromptTemplate = {
 *     id, title, body, tags[], scope,
 *     pinned, createdAt, updatedAt, lastUsedAt
 *   }
 *   scope = { kind: "global" } | { kind: "projects", paths: string[] }
 *
 * Every mutation follows one rule: build a draft, persist the draft, and only
 * then swap it in. A failed write therefore never leaves memory ahead of disk.
 */

/** Field limits, exported so the tests (and the client contract) can name them. */
export const LIMITS = Object.freeze({
  id: 64,
  title: 60,
  body: 20000,
  // Six 20-character labels preserve the old category plus all five old tags.
  tag: 20,
  tags: 6,
  paths: 20,
});

/** Absolute POSIX, UNC, or Windows drive path. Scope paths must be absolute. */
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Store failures carry a stable `code`; the HTTP layer maps it to a status. */
export class StoreError extends Error {
  /**
   * @param {string} code stable discriminant, e.g. "invalid-input"
   * @param {string} message human-readable detail
   * @param {Record<string, unknown>} [extra] extra payload (e.g. `revision`)
   */
  constructor(code, message, extra) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    if (extra) Object.assign(this, extra);
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep copy of a JSON-shaped value.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function clone(value) {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 * @returns {never}
 */
function fail(code, message, extra) {
  throw new StoreError(code, message, extra);
}

/**
 * Validate and trim a user text field.
 * @param {unknown} value
 * @param {string} field
 * @param {number} max
 * @param {{ required?: boolean }} [options]
 * @returns {string}
 */
function text(value, field, max, options = {}) {
  const required = options.required === true;
  if (value === undefined || value === null) {
    if (required) fail("invalid-input", `${field} is required`, { field });
    return "";
  }
  if (typeof value !== "string") fail("invalid-input", `${field} must be a string`, { field });
  const trimmed = value.trim();
  if (required && trimmed.length === 0) fail("invalid-input", `${field} must not be empty`, { field });
  if (trimmed.length > max) fail("invalid-input", `${field} must be at most ${max} characters`, { field });
  return trimmed;
}

/**
 * Prompt bodies keep their inner formatting; only emptiness and size are checked.
 * @param {unknown} value
 * @returns {string}
 */
function bodyText(value) {
  if (typeof value !== "string") fail("invalid-input", "body must be a string", { field: "body" });
  if (value.trim().length === 0) fail("invalid-input", "body must not be empty", { field: "body" });
  if (value.length > LIMITS.body) {
    fail("invalid-input", `body must be at most ${LIMITS.body} characters`, { field: "body" });
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
function timestamp(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail("invalid-record", `${field} is not a valid timestamp`, { field });
  }
  return value;
}

/**
 * Normalize canonical tags and accept the historical category as one extra tag.
 * Existing tag order/spelling wins when category is already represented. Do not
 * split labels on commas: historical categories allowed punctuation. Enforce the
 * limit after deduplication so a duplicate category never consumes a seventh slot.
 * @param {unknown} value
 * @param {unknown} category legacy input only; never retained in canonical data
 * @returns {string[]}
 */
function normalizeTags(value, category) {
  const entries = value === undefined || value === null ? [] : value;
  if (!Array.isArray(entries)) fail("invalid-input", "tags must be an array of strings", { field: "tags" });
  const legacyTag = text(category, "category", LIMITS.tag);
  const seen = new Set();
  const out = [];
  for (const entry of [...entries, legacyTag]) {
    const tag = text(entry, "tag", LIMITS.tag);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  if (out.length > LIMITS.tags) {
    fail("invalid-input", `tags must hold at most ${LIMITS.tags} entries`, { field: "tags" });
  }
  return out;
}

/**
 * Scope is either global or an explicit set of absolute project paths.
 * @param {unknown} value
 * @returns {{ kind: "global" } | { kind: "projects", paths: string[] }}
 */
export function normalizeScope(value) {
  if (value === undefined || value === null) return { kind: "global" };
  if (!isPlainObject(value)) fail("invalid-input", "scope must be an object", { field: "scope" });
  const kind = value.kind;
  if (kind === "global") return { kind: "global" };
  if (kind !== "projects") {
    fail("invalid-input", 'scope.kind must be "global" or "projects"', { field: "scope.kind" });
  }
  const raw = value.paths;
  if (!Array.isArray(raw) || raw.length === 0) {
    fail("invalid-input", "scope.paths must list at least one project path", { field: "scope.paths" });
  }
  if (raw.length > LIMITS.paths) {
    fail("invalid-input", `scope.paths must hold at most ${LIMITS.paths} entries`, { field: "scope.paths" });
  }
  const seen = new Set();
  const paths = [];
  for (const entry of raw) {
    if (typeof entry !== "string") fail("invalid-input", "scope.paths entries must be strings", { field: "scope.paths" });
    const candidate = entry.trim();
    if (!candidate) continue;
    if (candidate.length > 1024) fail("invalid-input", "scope path is too long", { field: "scope.paths" });
    if (!ABSOLUTE_PATH.test(candidate)) {
      fail("invalid-input", `scope path must be absolute: ${candidate}`, { field: "scope.paths" });
    }
    const key = pathKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(candidate);
  }
  if (paths.length === 0) {
    fail("invalid-input", "scope.paths must list at least one project path", { field: "scope.paths" });
  }
  return { kind: "projects", paths };
}

/**
 * Comparison key for project paths: separators unified, trailing ones dropped,
 * and folded to lower case on Windows (where the filesystem is case-insensitive).
 * @param {string} value
 * @returns {string}
 */
export function pathKey(value) {
  let key = String(value).trim().replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  if (process.platform === "win32") key = key.toLowerCase();
  return key;
}

/**
 * Exact (path-normalized) equality between a workspace and a scope path.
 * @param {string} workspace
 * @param {string} scopePath
 * @returns {boolean}
 */
export function pathMatches(workspace, scopePath) {
  if (typeof workspace !== "string" || typeof scopePath !== "string") return false;
  if (!workspace.trim() || !scopePath.trim()) return false;
  return pathKey(workspace) === pathKey(scopePath);
}

/**
 * Default id source. Exported so `lib/format.js` can mint ids for hand-written
 * imports without duplicating the fallback.
 * @returns {string}
 */
export function defaultNewId() {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Validate one template, either from user input (`loading: false`) or from the
 * medium (`loading: true`, where timestamps must already be present).
 * @param {unknown} raw
 * @param {{ now?: () => number, newId?: () => string, existing?: any, loading?: boolean }} [options]
 * @returns {any}
 */
export function normalizeTemplate(raw, options = {}) {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? defaultNewId;
  const existing = options.existing;
  const loading = options.loading === true;

  if (!isPlainObject(raw)) fail(loading ? "invalid-record" : "invalid-input", "template must be an object");

  let id;
  if (existing) {
    id = existing.id;
  } else if (loading) {
    id = text(raw.id, "id", LIMITS.id, { required: true });
    if (!ID_PATTERN.test(id)) fail("invalid-record", `stored template id is not url-safe: ${id}`, { field: "id" });
  } else {
    const requested = typeof raw.id === "string" ? raw.id.trim() : "";
    if (requested && !ID_PATTERN.test(requested)) {
      fail("invalid-input", "id must be 1-64 characters of [A-Za-z0-9_-]", { field: "id" });
    }
    id = requested || newId();
  }

  const title = text(raw.title, "title", LIMITS.title, { required: true });
  const body = bodyText(raw.body);
  const tags = normalizeTags(raw.tags, raw.category);
  const scope = normalizeScope(raw.scope);

  let pinned;
  if (raw.pinned === undefined || raw.pinned === null) {
    pinned = existing?.pinned === true;
  } else if (typeof raw.pinned !== "boolean") {
    fail(loading ? "invalid-record" : "invalid-input", "pinned must be a boolean", { field: "pinned" });
  } else {
    pinned = raw.pinned;
  }

  const createdAt = loading
    ? timestamp(raw.createdAt, "createdAt")
    : existing?.createdAt ?? now();
  const updatedAt = loading ? timestamp(raw.updatedAt, "updatedAt") : now();

  let lastUsedAt = null;
  if (loading) {
    lastUsedAt = raw.lastUsedAt === undefined || raw.lastUsedAt === null ? null : timestamp(raw.lastUsedAt, "lastUsedAt");
  } else if (existing?.lastUsedAt != null) {
    lastUsedAt = existing.lastUsedAt;
  }

  return { id, title, body, tags, scope, pinned, createdAt, updatedAt, lastUsedAt };
}

/**
 * @returns {{ revision: number, seeded: boolean, items: any[] }}
 */
export function emptyState() {
  return { revision: 0, seeded: false, items: [] };
}

/**
 * Validate a whole stored document. Legacy categories are converted in memory
 * without writing or changing revision; the next normal mutation persists the
 * canonical tags-only state through the same draft → persist → swap path.
 * @param {unknown} raw
 * @returns {{ revision: number, seeded: boolean, items: any[] }}
 */
export function normalizeState(raw) {
  if (raw === undefined || raw === null) return emptyState();
  if (!isPlainObject(raw)) fail("invalid-record", "stored state must be an object");
  const revision = raw.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
    fail("invalid-record", "stored state has no valid revision");
  }
  if (!Array.isArray(raw.items)) fail("invalid-record", "stored state has no items array");
  const seen = new Set();
  const items = raw.items.map((entry) => {
    const item = normalizeTemplate(entry, { loading: true, now: Date.now, newId: defaultNewId });
    if (seen.has(item.id)) fail("invalid-record", `duplicate template id in storage: ${item.id}`);
    seen.add(item.id);
    return item;
  });
  return { revision, seeded: raw.seeded === true, items };
}

/**
 * The `valueSchema` handed to the storage-domain facility. Only `parse` is used
 * by the facility (on load); `safeParse` exists so a declaration-time check
 * against `null` also behaves.
 */
export function createStateSchema() {
  return {
    parse(raw) {
      return normalizeState(raw);
    },
    safeParse(raw) {
      try {
        return { success: true, data: normalizeState(raw) };
      } catch (error) {
        return { success: false, error };
      }
    },
  };
}

/**
 * Six engineering prompts, inserted once on a fresh install (never again).
 * Original Chinese adaptations; sources and usage are documented in the README.
 * @type {ReadonlyArray<any>}
 */
export const SEED_TEMPLATES = Object.freeze([
  {
    title: "理解代码与调用链",
    body: "先不要修改代码。围绕我指出的功能，找到入口、关键调用链、状态或数据流、外部依赖和相关测试。引用实际文件与符号说明职责及边界，区分已核实事实与推测。最后给出完成本次任务需要阅读的最小文件集合，以及仍缺少的信息。",
    tags: ["调用链", "接手项目", "代码理解"],
    scope: { kind: "global" },
    pinned: false,
  },
  {
    title: "最小变更实现需求",
    body: "先检查项目已有实现与约束，把需求转为可验证的验收条件，再实现满足这些条件的最小改动。优先复用现有模式，避免顺手重构和新增不必要的依赖。只对会改变方案的关键未知项提问。完成后说明行为变化、验证结果及未覆盖的边界；未经执行的检查不要写成通过。",
    tags: ["最小改动", "验收", "功能开发"],
    scope: { kind: "global" },
    pinned: false,
  },
  {
    title: "先定位根因，再修 Bug",
    body: "先复现问题并记录预期、实际结果和触发条件。沿调用链与数据流定位异常首次出现的位置，检查近期变更及相似的正常实现。列出有证据支持的根因假设，用最小实验逐个验证。确认后添加能复现原问题的回归测试，再做最小修复。若无法复现，说明缺少什么证据，不要堆叠猜测性补丁。",
    tags: ["根因", "回归测试", "调试排障"],
    scope: { kind: "global" },
    pinned: true,
  },
  {
    title: "只报有证据的代码审查",
    body: "审查当前指定的代码变更，结合调用方、项目约束和测试判断影响。优先找功能错误、数据丢失、安全缺陷、并发及兼容性问题，跳过纯风格偏好。每项给出位置、触发条件、实际影响、证据和修复建议，严重程度按影响判断。区分确认缺陷与待验证风险；未发现问题时说明审查范围和验证缺口，不要据此保证没有缺陷。",
    tags: ["变更", "正确性", "代码审查"],
    scope: { kind: "global" },
    pinned: true,
  },
  {
    title: "补有价值的测试",
    body: "根据需求、公开接口和已知风险检查测试缺口。优先覆盖关键业务行为、边界输入、失败路径和适用的并发场景。测试应验证可观察结果，避免照抄实现或过度 mock。修 Bug 时确认回归测试在修复前失败、修复后通过。执行相关测试，并报告实际结果与仍未覆盖的风险。",
    tags: ["边界", "失败路径", "测试质量"],
    scope: { kind: "global" },
    pinned: false,
  },
  {
    title: "完成前做证据验收",
    body: "对照本次需求逐项验收，选择能证明行为正确的检查并实际执行。区分语法检查、单元测试、集成测试和真实用户流程各自证明的范围。检查最终差异是否包含遗漏或无关改动。报告已完成项、验证证据、未验证项及阻碍；不要把静态检查或模拟结果当作真实环境验收。",
    tags: ["验证", "收尾", "交付验收"],
    scope: { kind: "global" },
    pinned: true,
  },
]);

/**
 * Serialized, revision-guarded template store.
 */
export class TemplateStore {
  #state;
  #persist;
  #now;
  #newId;
  #tail = Promise.resolve();

  /**
   * @param {{ state?: any, persist: (next: any) => Promise<void>, now?: () => number, newId?: () => string }} options
   */
  constructor(options) {
    if (!options || typeof options.persist !== "function") {
      throw new TypeError("TemplateStore needs a persist function");
    }
    this.#state = normalizeState(options.state);
    this.#persist = options.persist;
    this.#now = options.now ?? Date.now;
    this.#newId = options.newId ?? defaultNewId;
  }

  /** @returns {number} */
  get revision() {
    return this.#state.revision;
  }

  /** @returns {boolean} */
  get seeded() {
    return this.#state.seeded;
  }

  /** @returns {{ revision: number, seeded: boolean, items: any[] }} */
  snapshot() {
    return clone(this.#state);
  }

  /**
   * Queue one mutation behind the previous one: draft → persist → swap.
   * @param {(draft: any) => any} mutator
   * @returns {Promise<any>} whatever the mutator returned
   */
  #run(mutator) {
    const job = this.#tail.then(async () => {
      const draft = clone(this.#state);
      const outcome = mutator(draft);
      draft.revision = this.#state.revision + 1;
      await this.#persist(clone(draft));
      this.#state = draft;
      return outcome;
    });
    this.#tail = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  /**
   * @param {any} draft
   * @param {unknown} expected
   */
  #assertRevision(draft, expected) {
    if (expected === undefined || expected === null) return;
    if (!Number.isInteger(expected)) fail("invalid-input", "revision must be an integer", { field: "revision" });
    if (expected !== draft.revision) {
      fail("revision-conflict", "the template list changed since you loaded it", { revision: draft.revision });
    }
  }

  /**
   * Insert the starter set exactly once, and only into an empty list.
   * @param {ReadonlyArray<any>} seeds
   * @returns {Promise<{ seeded: boolean, created: number }>}
   */
  async ensureSeeded(seeds = SEED_TEMPLATES) {
    if (this.#state.seeded) return { seeded: false, created: 0 };
    return this.#run((draft) => {
      let created = 0;
      if (draft.items.length === 0) {
        for (const seed of seeds) {
          draft.items.push(normalizeTemplate(seed, { now: this.#now, newId: this.#newId }));
          created += 1;
        }
      }
      draft.seeded = true;
      return { seeded: true, created };
    });
  }

  /**
   * Create (no id) or replace (known id) one template.
   * @param {{ template: any, revision?: number|null }} input
   * @returns {Promise<any>} the stored item
   */
  async save(input) {
    const template = input?.template;
    if (!isPlainObject(template)) fail("invalid-input", "template must be an object");
    const revision = input?.revision;
    return this.#run((draft) => {
      this.#assertRevision(draft, revision);
      const requested = typeof template.id === "string" ? template.id.trim() : "";
      const index = requested ? draft.items.findIndex((item) => item.id === requested) : -1;
      if (requested && index < 0) fail("not-found", `template ${requested} does not exist`, { id: requested });
      const existing = index >= 0 ? draft.items[index] : undefined;
      const item = normalizeTemplate(template, { now: this.#now, newId: this.#newId, existing });
      if (index >= 0) draft.items[index] = item;
      else draft.items.push(item);
      return item;
    });
  }

  /**
   * @param {{ id: string, revision?: number|null }} input
   * @returns {Promise<void>}
   */
  async remove(input) {
    const id = text(input?.id, "id", LIMITS.id, { required: true });
    const revision = input?.revision;
    await this.#run((draft) => {
      this.#assertRevision(draft, revision);
      const index = draft.items.findIndex((item) => item.id === id);
      if (index < 0) fail("not-found", `template ${id} does not exist`, { id });
      draft.items.splice(index, 1);
    });
  }

  /**
   * Record a use. Deliberately unguarded by revision: a stale list must not
   * stop an insertion the user already performed.
   * @param {{ id: string }} input
   * @returns {Promise<any>} the updated item
   */
  async touch(input) {
    const id = text(input?.id, "id", LIMITS.id, { required: true });
    return this.#run((draft) => {
      const item = draft.items.find((entry) => entry.id === id);
      if (!item) fail("not-found", `template ${id} does not exist`, { id });
      // Touching records a use, not an edit: `updatedAt` keeps the last real
      // modification so sorting by "recently changed" stays meaningful.
      item.lastUsedAt = this.#now();
      return item;
    });
  }

  /**
   * Replace the stored order; `ids` must be a permutation of every known id.
   * @param {{ ids: string[], revision?: number|null }} input
   * @returns {Promise<any[]>}
   */
  async reorder(input) {
    const ids = input?.ids;
    if (!Array.isArray(ids)) fail("invalid-input", "ids must be an array", { field: "ids" });
    const revision = input?.revision;
    return this.#run((draft) => {
      this.#assertRevision(draft, revision);
      const known = new Set(draft.items.map((item) => item.id));
      if (ids.length !== known.size) {
        fail("invalid-order", "ids must list exactly the templates you loaded", { field: "ids" });
      }
      const next = [];
      for (const raw of ids) {
        const id = text(raw, "id", LIMITS.id, { required: true });
        if (!known.has(id)) fail("invalid-order", `unknown template id in order: ${id}`, { field: "ids" });
        known.delete(id);
        next.push(draft.items.find((item) => item.id === id));
      }
      draft.items = next;
      return draft.items;
    });
  }

  /**
   * Apply one import batch as a single write behind the mutation queue.
   *
   * The caller has already parsed and classified (see `lib/format.js`); it hands
   * over explicit operations, because re-matching inside the queue would need the
   * format module and create an import cycle. Order and identity rules come from
   * the contract (docs/design/import-export-spec.md §6):
   *   - `add`     appends in encounter order, keeping the file's id, timestamps
   *               and `lastUsedAt`; a duplicate id inside one batch falls back to
   *               a fresh id so storage can never hold two records with one id.
   *   - `replace` swaps the matched local record in place (same index), keeps the
   *               local `id` (local identity, not content) and takes every other
   *               field from the file.
   *   - `skip`    leaves the record untouched (identical, or conflict kept local).
   *
   * The batch writes exactly once: a no-op batch still advances the revision, so
   * the caller's revision guard stays meaningful for every commit.
   *
   * @param {{
   *   entries: ReadonlyArray<{ op: "add" | "replace" | "skip", at?: string, id?: string, template?: any }>,
   *   revision?: number | null,
   * }} input
   * @returns {Promise<{ added: number, replaced: number, skipped: number, touched: Array<{ at: string, id: string }> }>}
   */
  async importTemplates(input) {
    const entries = input?.entries;
    if (!Array.isArray(entries)) fail("invalid-input", "entries must be an array", { field: "entries" });
    const revision = input?.revision;

    // Validate the whole batch before it reaches the queue: a malformed request
    // must never be able to persist a partial document.
    const ops = entries.map((entry, index) => {
      if (!isPlainObject(entry)) fail("invalid-input", `entries[${index}] must be an object`, { field: "entries" });
      const at = typeof entry.at === "string" ? entry.at : "";
      if (entry.op === "skip") return { op: "skip", at };
      if (entry.op !== "add" && entry.op !== "replace") {
        fail("invalid-input", `entries[${index}].op must be "add", "replace" or "skip"`, { field: "entries" });
      }
      let template;
      try {
        template = normalizeTemplate(entry.template, { loading: true });
      } catch (error) {
        if (error instanceof StoreError) {
          fail("invalid-input", `entries[${index}]: ${error.message}`, { field: error.field });
        }
        throw error;
      }
      if (entry.op === "add") return { op: "add", at, template };
      return { op: "replace", at, id: text(entry.id, "id", LIMITS.id, { required: true }), template };
    });

    return this.#run((draft) => {
      this.#assertRevision(draft, revision);
      // Check every replacement target first, so a stale batch changes nothing.
      for (const op of ops) {
        if (op.op === "replace" && !draft.items.some((item) => item.id === op.id)) {
          fail("not-found", `template ${op.id} does not exist`, { id: op.id });
        }
      }

      let added = 0;
      let replaced = 0;
      let skipped = 0;
      const touched = [];
      for (const op of ops) {
        if (op.op === "skip") {
          skipped += 1;
          continue;
        }
        if (op.op === "replace") {
          const index = draft.items.findIndex((item) => item.id === op.id);
          const local = draft.items[index];
          draft.items[index] = { ...op.template, id: local.id };
          replaced += 1;
          touched.push({ at: op.at, id: local.id });
          continue;
        }
        let id = op.template.id;
        for (let attempt = 0; draft.items.some((item) => item.id === id); attempt += 1) {
          if (attempt >= 50) fail("invalid-input", "could not allocate a unique template id", { field: "id" });
          id = this.#newId();
        }
        draft.items.push({ ...op.template, id });
        added += 1;
        touched.push({ at: op.at, id });
      }
      return { added, replaced, skipped, touched };
    });
  }

  /**
   * Templates visible in one workspace: global ones plus those scoped to it.
   * @param {{ workspace?: string|null, all?: boolean }} [options]
   * @returns {any[]}
   */
  list(options = {}) {
    const items = clone(this.#state.items);
    if (options.all === true) return items;
    const workspace = typeof options.workspace === "string" ? options.workspace : null;
    if (!workspace) return items.filter((item) => item.scope.kind === "global");
    return items.filter(
      (item) =>
        item.scope.kind === "global" ||
        (item.scope.kind === "projects" && item.scope.paths.some((path) => pathMatches(workspace, path))),
    );
  }
}
