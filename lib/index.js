/**
 * dsh-prompt-template — host half.
 *
 * Responsibilities of this half:
 *  - own the stored template list (one JSON document per install, via the
 *    storage-domain facility on the `json` backend);
 *  - expose it to the client half over same-origin HTTP under
 *    /dsh-prompt-template/*, authenticated by the host web server itself;
 *  - resolve the calling session's workspace so scoped templates can be
 *    filtered before they ever reach the browser.
 *
 * Authentication is declared on the route (`auth: "required"`) and performed
 * by the web server before the handler runs: an unauthenticated request never
 * reaches this file. Nothing here may import an npm package — the plugin is
 * junction-installed, so dependencies resolve against the git checkout.
 */

import {
  createStateSchema,
  emptyState,
  pathKey,
  SEED_TEMPLATES,
  StoreError,
  TemplateStore,
} from "./store.js";

export const name = "dsh-prompt-template";

/** Host services used by this half. */
export const inject = ["webServer", "storageDomain"];

/**
 * Registered without a trailing slash: the router matches `url === path` or
 * `url.startsWith(path + "/")`, so a trailing slash here would only accept the
 * bare path itself and 404 every sub-route.
 */
const ROUTE_PREFIX = "/dsh-prompt-template";

/** Storage unit name. The medium's UNIT_NAME_RE forbids hyphens. */
const DOMAIN_NAME = "prompt_templates";
// Version 2 writes tags-only records with wider limits. Read old units without
// rewriting them; the first normal write stamps v2 and blocks unsafe downgrade.
const DOMAIN_VERSION = 2;
const DOMAIN_COMPATIBLE_VERSIONS = Object.freeze([1]);

export { DOMAIN_NAME, DOMAIN_VERSION, DOMAIN_COMPATIBLE_VERSIONS };

const PLUGIN_VERSION = "0.1.0";
const MAX_BODY_BYTES = 256 * 1024;

/** Routes that mutate state and therefore accept POST only. */
const WRITE_ROUTES = new Set(["/save", "/delete", "/touch", "/reorder"]);

/** Store error code → HTTP status. Unknown codes are programming errors (500). */
const STATUS_BY_CODE = new Map([
  ["invalid-input", 400],
  ["invalid-record", 500],
  ["invalid-order", 400],
  ["not-found", 404],
  ["revision-conflict", 409],
  ["unsupported-media-type", 415],
  ["forbidden-origin", 403],
  ["method-not-allowed", 405],
  ["storage-unavailable", 503],
]);

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Split a request target into pathname and query.
 * @param {unknown} raw
 * @returns {{ pathname: string, searchParams: URLSearchParams }}
 */
export function parseRequestUrl(raw) {
  const target = String(raw ?? "/");
  const question = target.indexOf("?");
  const pathname = question === -1 ? target : target.slice(0, question);
  const query = question === -1 ? "" : target.slice(question + 1);
  return { pathname, searchParams: new URLSearchParams(query) };
}

/**
 * Read and parse a JSON request body, refusing anything oversized.
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<any>}
 */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new StoreError("invalid-input", "request body is too large");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new StoreError("invalid-input", "request body must be valid JSON");
  }
}

/**
 * Whether a write request came from this application's own origin.
 * A cross-site POST (CSRF) always carries `Origin`, so requiring it to match
 * the web server origin closes that hole; the fetch-metadata header covers the
 * same-origin case where `Origin` is elided.
 * @param {import("node:http").IncomingMessage} req
 * @param {string | null} expectedOrigin
 * @returns {boolean}
 */
export function isSameOriginWrite(req, expectedOrigin) {
  const headers = req.headers ?? {};
  const origin = headers.origin;
  const host = headers.host;
  const site = headers["sec-fetch-site"];
  // Fetch metadata is authoritative when present: a browser that labels the
  // request cross-site must never be rescued by an absent Origin header.
  if (typeof site === "string" && site) {
    if (site !== "same-origin" && site !== "none") return false;
  }
  if (typeof origin === "string" && origin) {
    if (expectedOrigin) {
      try {
        return new URL(origin).origin === new URL(expectedOrigin).origin;
      } catch {
        return false;
      }
    }
    try {
      return typeof host === "string" && new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  if (site === "same-origin" || site === "none") return true;
  if (typeof host === "string" && host && expectedOrigin) {
    try {
      return new URL(expectedOrigin).host === host;
    } catch {
      return false;
    }
  }
  // No origin, no fetch metadata: only acceptable when we have nothing to
  // compare against (headless/local tooling) — never when an origin is known.
  return !expectedOrigin;
}

/**
 * Reject writes that are not JSON or not same-origin.
 * @param {import("node:http").IncomingMessage} req
 * @param {string | null} expectedOrigin
 */
function assertWritableRequest(req, expectedOrigin) {
  const contentType = String((req.headers ?? {})["content-type"] ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    throw new StoreError("unsupported-media-type", "content-type must be application/json");
  }
  if (!isSameOriginWrite(req, expectedOrigin)) {
    throw new StoreError("forbidden-origin", "cross-origin writes are not allowed");
  }
}

/**
 * Last path segment, used as a project label fallback.
 * @param {string} value
 * @returns {string}
 */
function basename(value) {
  const trimmed = String(value).replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

/**
 * Build the list of projects offered in the editor: the current workspace
 * first, then registered workspaces, then every path any template mentions.
 * @param {string} workspace
 * @param {ReadonlyArray<any>} items
 * @param {ReadonlyArray<{ path: string, label?: string }>} known
 * @returns {{ paths: string[], labels: Record<string, string> }}
 */
export function collectProjects(workspace, items, known) {
  /** @type {string[]} */
  const paths = [];
  /** @type {Record<string, string>} */
  const labels = {};
  const seen = new Set();
  const push = (path, label) => {
    if (typeof path !== "string") return;
    const trimmed = path.trim();
    if (!trimmed) return;
    const key = pathKey(trimmed);
    if (!key || seen.has(key)) return;
    seen.add(key);
    paths.push(trimmed);
    labels[trimmed] = typeof label === "string" && label.trim() ? label.trim() : basename(trimmed);
  };
  if (workspace) push(workspace, "");
  for (const entry of known ?? []) push(entry?.path, entry?.label);
  for (const item of items ?? []) {
    if (item?.scope?.kind !== "projects") continue;
    for (const path of item.scope.paths ?? []) push(path, "");
  }
  return { paths, labels };
}

/**
 * Handle one request. Exported for tests: production wires it through the
 * web server, which has already enforced `auth: "required"`.
 * @param {{
 *   ensureStore: () => Promise<TemplateStore>,
 *   getOrigin?: () => string | null,
 *   resolveWorkspace?: (sessionId: string) => string,
 *   listProjects?: () => ReadonlyArray<{ path: string, label?: string }>,
 *   logger?: { warn?: (message: string) => void, error?: (message: string) => void },
 * }} deps
 */
export function createRouteHandler(deps) {
  const ensureStore = deps.ensureStore;
  const getOrigin = deps.getOrigin ?? (() => null);
  const resolveWorkspace = deps.resolveWorkspace ?? (() => "");
  const listProjects = deps.listProjects ?? (() => []);
  const logger = deps.logger;

  return async function handler(req, res) {
    try {
      const { pathname, searchParams } = parseRequestUrl(req.url);
      if (!pathname.startsWith(ROUTE_PREFIX)) {
        writeJson(res, 404, { ok: false, error: "not-found", message: "unknown route" });
        return;
      }
      const route = pathname.slice(ROUTE_PREFIX.length) || "/";
      const method = String(req.method ?? "GET").toUpperCase();

      if (route === "/ping") {
        writeJson(res, 200, { ok: true, version: PLUGIN_VERSION });
        return;
      }

      if (route === "/list" && method === "GET") {
        const store = await ensureStore();
        const all = searchParams.get("all") === "1";
        const sessionId = searchParams.get("sessionId") ?? "";
        const workspace = resolveWorkspace(sessionId) || "";
        const snapshot = store.snapshot();
        const items = store.list({ workspace: workspace || null, all });
        const projects = collectProjects(workspace, snapshot.items, listProjects());
        writeJson(res, 200, {
          ok: true,
          items,
          revision: store.revision,
          workspace,
          projects: projects.paths,
          projectLabels: projects.labels,
          seeded: store.seeded,
          all,
        });
        return;
      }

      if (!WRITE_ROUTES.has(route)) {
        writeJson(res, 404, { ok: false, error: "not-found", message: `unknown route ${route}` });
        return;
      }
      if (method !== "POST") {
        throw new StoreError("method-not-allowed", `${method} is not allowed on ${route}`);
      }

      assertWritableRequest(req, getOrigin() ?? null);
      const store = await ensureStore();

      if (route === "/save") {
        const body = await readJsonBody(req);
        const item = await store.save({ template: body?.template, revision: body?.revision });
        writeJson(res, 200, { ok: true, item, revision: store.revision });
        return;
      }

      if (route === "/delete") {
        const body = await readJsonBody(req);
        await store.remove({ id: body?.id, revision: body?.revision });
        writeJson(res, 200, { ok: true, revision: store.revision });
        return;
      }

      if (route === "/touch") {
        const body = await readJsonBody(req);
        const item = await store.touch({ id: body?.id });
        writeJson(res, 200, { ok: true, item, revision: store.revision });
        return;
      }

      if (route === "/reorder") {
        const body = await readJsonBody(req);
        const items = await store.reorder({ ids: body?.ids, revision: body?.revision });
        writeJson(res, 200, { ok: true, items, revision: store.revision });
        return;
      }
    } catch (error) {
      const code = error instanceof StoreError ? error.code : "internal_error";
      const status = STATUS_BY_CODE.get(code) ?? 500;
      if (status >= 500) {
        logger?.error?.(`dsh-prompt-template: ${code}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const body = { ok: false, error: code, message: error instanceof Error ? error.message : String(error) };
      if (error && typeof error === "object" && "revision" in error) body.revision = error.revision;
      writeJson(res, status, body);
    }
  };
}

/**
 * Resolve a service defensively: a half-loaded profile must degrade to a clear
 * error instead of throwing during request handling.
 * @param {any} ctx
 * @param {string} key
 * @returns {any}
 */
function getService(ctx, key) {
  try {
    return typeof ctx.get === "function" ? ctx.get(key) : ctx[key];
  } catch {
    return undefined;
  }
}

/**
 * Workspace for one session: the working-directory service first, then the
 * session header's recorded cwd.
 * @param {any} ctx
 * @param {string} sessionId
 * @returns {string}
 */
function resolveSessionWorkspace(ctx, sessionId) {
  if (!sessionId) return "";
  const sessions = getService(ctx, "sessions");
  if (typeof sessions?.get !== "function") return "";
  let session;
  try {
    session = sessions.get(sessionId);
  } catch {
    return "";
  }
  if (!session) return "";
  const workingDirectory = getService(ctx, "workingDirectory");
  if (typeof workingDirectory?.get === "function") {
    try {
      const resolved = workingDirectory.get(session);
      if (typeof resolved === "string" && resolved.trim()) return resolved.trim();
    } catch {
      // fall through to the header
    }
  }
  const cwd = session.header?.cwd;
  return typeof cwd === "string" && cwd.trim() ? cwd.trim() : "";
}

/**
 * Registered workspaces, for the editor's project picker.
 * @param {any} ctx
 * @returns {Array<{ path: string, label?: string }>}
 */
function listRegisteredProjects(ctx) {
  const registry = getService(ctx, "workspaceRegistry");
  if (typeof registry?.list !== "function") return [];
  try {
    const workspaces = registry.list();
    if (!Array.isArray(workspaces)) return [];
    return workspaces
      .filter((entry) => entry && typeof entry.path === "string" && entry.path)
      .map((entry) => ({ path: entry.path, label: typeof entry.title === "string" ? entry.title : "" }));
  } catch {
    return [];
  }
}

/**
 * Owns the lazily opened storage domain for one plugin instance.
 * Opening is single-flight: concurrent callers share one promise. Disposal
 * waits for an in-flight open to settle and then closes every domain exactly
 * once, so a recompose can never race a half-open domain into `already-open`.
 * @param {any} ctx
 * @param {{ seeds?: ReadonlyArray<any> }} [options]
 */
export function createStorageOwner(ctx, options = {}) {
  const seeds = options.seeds ?? SEED_TEMPLATES;
  /** @type {Set<any>} */
  const opened = new Set();
  /** @type {Promise<TemplateStore> | null} */
  let storePromise = null;
  let disposed = false;

  const closeDomain = async (domain) => {
    opened.delete(domain);
    try {
      await domain?.close?.();
    } catch {
      // disposal must never throw
    }
  };

  const open = async () => {
    const storage = getService(ctx, "storageDomain");
    if (typeof storage?.open !== "function") {
      throw new StoreError("storage-unavailable", "the storageDomain service is not mounted");
    }
    const domain = await storage.open({
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      compatibleVersions: DOMAIN_COMPATIBLE_VERSIONS,
      layout: "single",
      global: { schema: createStateSchema(), initial: emptyState() },
      tables: {},
    });
    opened.add(domain);
    if (disposed) {
      await closeDomain(domain);
      throw new StoreError("storage-unavailable", "the plugin has been disposed");
    }
    try {
      const store = new TemplateStore({
        state: domain.global.get(),
        persist: (next) => domain.global.set(next),
      });
      await store.ensureSeeded(seeds);
      return store;
    } catch (error) {
      // Release the handle so a retry re-opens instead of hitting an
      // `already-open` domain that nobody owns any more.
      await closeDomain(domain);
      throw error;
    }
  };

  const ensureStore = () => {
    if (disposed) {
      return Promise.reject(new StoreError("storage-unavailable", "the plugin has been disposed"));
    }
    if (!storePromise) {
      const pending = open();
      storePromise = pending;
      pending.catch(() => {
        if (storePromise === pending) storePromise = null;
      });
    }
    return storePromise;
  };

  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    const pending = storePromise;
    if (pending) await pending.then(() => undefined, () => undefined);
    for (const domain of [...opened]) await closeDomain(domain);
  };

  return { ensureStore, dispose, isDisposed: () => disposed };
}

/**
 * Host entry point.
 * @param {any} ctx - host Cordis context
 */
export function apply(ctx) {
  const server = ctx.webServer;
  if (typeof server?.register !== "function") {
    ctx.logger?.warn?.("dsh-prompt-template: webServer.register unavailable");
    return;
  }

  const owner = createStorageOwner(ctx);

  ctx.effect(
    () => async () => {
      await owner.dispose();
    },
    "dsh-prompt-template: storage",
  );

  const handler = createRouteHandler({
    ensureStore: owner.ensureStore,
    getOrigin: () => (typeof server.getOrigin === "function" ? server.getOrigin() : null),
    resolveWorkspace: (sessionId) => resolveSessionWorkspace(ctx, sessionId),
    listProjects: () => listRegisteredProjects(ctx),
    logger: ctx.logger,
  });

  ctx.effect(
    () =>
      server.register({
        kind: "prefix",
        path: ROUTE_PREFIX,
        auth: "required",
        handler,
      }),
    "dsh-prompt-template: routes",
  );
}
