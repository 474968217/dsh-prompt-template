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
 *     id, title, body, category, tags[], scope,
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
  category: 20,
  tag: 12,
  tags: 5,
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
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail("invalid-input", "tags must be an array of strings", { field: "tags" });
  if (value.length > LIMITS.tags) {
    fail("invalid-input", `tags must hold at most ${LIMITS.tags} entries`, { field: "tags" });
  }
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const tag = text(entry, "tag", LIMITS.tag);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
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
 * @returns {string}
 */
function defaultNewId() {
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
  const category = text(raw.category, "category", LIMITS.category);
  const tags = normalizeTags(raw.tags);
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

  return { id, title, body, category, tags, scope, pinned, createdAt, updatedAt, lastUsedAt };
}

/**
 * @returns {{ revision: number, seeded: boolean, items: any[] }}
 */
export function emptyState() {
  return { revision: 0, seeded: false, items: [] };
}

/**
 * Validate a whole stored document.
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
 * Four Chinese starters, inserted once on a fresh install (never again).
 * @type {ReadonlyArray<any>}
 */
export const SEED_TEMPLATES = Object.freeze([
  {
    title: "先给结论再展开",
    body: "请用简体中文回答：先给结论，再给理由，最后列出下一步行动。",
    category: "通用",
    tags: ["通用", "结构化"],
    scope: { kind: "global" },
    pinned: true,
  },
  {
    title: "审查这段代码",
    body: "请审查下面的代码，从正确性、边界条件、可读性、性能四个方面列出问题，按严重程度排序，并给出最小修改建议。",
    category: "工程",
    tags: ["代码审查", "重构"],
    scope: { kind: "global" },
    pinned: false,
  },
  {
    title: "排查一个 Bug",
    body: "我遇到一个问题：\n\n现象：\n复现步骤：\n期望行为：\n\n请先复述你对我目标的理解，再列出最可能的 3 个原因（按验证成本从低到高排序），然后给出最小修复方案。",
    category: "工程",
    tags: ["调试", "排查"],
    scope: { kind: "global" },
    pinned: false,
  },
  {
    title: "解释这段代码",
    body: "请用简体中文解释下面这段代码：先说它解决的问题，再按执行顺序讲关键步骤，最后指出容易误解的地方。",
    category: "学习",
    tags: ["解释", "阅读"],
    scope: { kind: "global" },
    pinned: false,
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
