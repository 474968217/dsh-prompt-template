/**
 * dsh-prompt-template — import / export formats, host side.
 *
 * The contract is frozen in `docs/design/import-export-spec.md`; every rule in
 * this file points back at a section of it. Nothing here touches the network,
 * the filesystem, or a DeepSeek Harness service: these are pure functions over
 * strings and plain objects, which is what makes the round trip testable.
 *
 * The one dependency worth naming is `./store.js`, imported for the canonical
 * field rules (`normalizeTemplate`, `pathKey`). The direction is deliberate and
 * one-way: `store.js` never imports this file, so no cycle exists.
 *
 * `missingPaths` is the single place where the outside world leaks in: the
 * caller injects an `isDirectory` predicate (the host half passes `fs.statSync`),
 * and the default treats every path as present so the module stays pure.
 */

import { createHash } from "node:crypto";

import { defaultNewId, normalizeTemplate, pathKey, StoreError } from "./store.js";

/** Marker written into every JSON export and into the Markdown head comment. */
export const FORMAT_NAME = "dsh-prompt-templates";
/** Bump only together with the contract; the importer rejects anything newer. */
export const FORMAT_VERSION = 1;

/** Batch ceilings (spec §4): over any of these the whole import is refused. */
export const IMPORT_LIMITS = Object.freeze({
  files: 50,
  bytes: 8 * 1024 * 1024,
  entries: 2000,
});

/** Download mime types, keyed by the `format` query value. */
export const MIME_BY_FORMAT = Object.freeze({
  json: "application/json",
  md: "text/markdown",
});

const EXTENSION_BY_FORMAT = Object.freeze({ json: "json", md: "md" });
const SHA256_HEX = /^[0-9a-f]{64}$/;
const HEADER_COMMENT = /^<!--\s*dsh-prompt-templates\s+v(\d+)\b/;
const METADATA_COMMENT = /^<!--\s*dpt\s+(\{.*\})\s*-->[ \t]*$/;
const METADATA_START = /^<!--\s*dpt\b/;
const HEADING = /^##(?!#)[ \t]+(.+?)[ \t]*$/;
const OPEN_FENCE = /^(`{3,})[ \t]*([^\s`]*)[ \t]*$/;
const CLOSE_FENCE = /^(`{3,})[ \t]*$/;

const encoder = new TextEncoder();

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
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep copy of a JSON-shaped value. Preview payloads are copies so a caller can
 * never mutate the store through them.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function clone(value) {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {string} value
 * @returns {string}
 */
function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

/**
 * @param {string} value
 * @returns {string}
 */
function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Longest run of consecutive backticks, so the fence can always outrun the body.
 * @param {string} value
 * @returns {number}
 */
function longestBacktickRun(value) {
  let longest = 0;
  let current = 0;
  for (const char of value) {
    if (char === "`") {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

/**
 * True when every LF in the text belongs to a CRLF pair — the signature of an
 * editor that re-saved the whole file with Windows line endings (spec §2).
 * @param {string} value
 * @returns {boolean}
 */
function isCrlfOnly(value) {
  return value.includes("\n") && !value.replace(/\r\n/g, "").includes("\n");
}

/**
 * Split on LF only and keep a line-final CR (spec §2). A lone CR is content, not
 * a line break, so splitting on it would silently rewrite bodies. In CRLF mode
 * the per-line CR is stripped here and restored by joining bodies with "\r\n".
 * @param {string} value
 * @param {string} lineEnding "\n" or "\r\n"
 * @returns {string[]}
 */
function splitLines(value, lineEnding) {
  const lines = value.split("\n");
  if (lineEnding !== "\r\n") return lines;
  return lines.map((line, index) => (index < lines.length - 1 && line.endsWith("\r") ? line.slice(0, -1) : line));
}

/**
 * @param {string[]} lines
 * @returns {string[]}
 */
function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end);
}

/**
 * @param {string} line
 * @returns {{ length: number, info: string } | null}
 */
function matchOpeningFence(line) {
  const match = OPEN_FENCE.exec(line);
  if (!match) return null;
  return { length: match[1].length, info: match[2] };
}

/**
 * @param {string} line
 * @param {{ length: number }} open
 * @returns {boolean}
 */
function isClosingFence(line, open) {
  const match = CLOSE_FENCE.exec(line);
  return Boolean(match) && match[1].length >= open.length;
}

/**
 * @param {string} line
 * @returns {string | null}
 */
function matchHeading(line) {
  const match = HEADING.exec(line);
  return match ? match[1].trim() : null;
}

/**
 * @param {string} line
 * @returns {{ version: number } | null}
 */
function parseHeaderComment(line) {
  const match = HEADER_COMMENT.exec(line);
  if (!match) return null;
  return { version: Number.parseInt(match[1], 10) };
}

/**
 * One-line `<-- dpt {...} -->` metadata block.
 * @param {string} line
 * @returns {{ meta: any } | { error: string } | null} null when the line is not metadata
 */
function parseMetadataComment(line) {
  const match = METADATA_COMMENT.exec(line);
  if (!match) return null;
  let meta;
  try {
    meta = JSON.parse(match[1]);
  } catch {
    return { error: "metadata comment is not valid JSON" };
  }
  if (!isPlainObject(meta)) return { error: "metadata comment must hold an object" };
  return { meta };
}

/**
 * Canonical scope shape for serialization.
 * @param {any} scope
 * @returns {{ kind: string, paths?: string[] }}
 */
function exportScope(scope) {
  if (scope && scope.kind === "projects" && Array.isArray(scope.paths)) {
    return { kind: "projects", paths: [...scope.paths] };
  }
  return { kind: "global" };
}

/**
 * Project one stored template onto the wire shape, in the documented key order.
 * @param {any} item
 * @returns {any}
 */
function exportItem(item) {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    tags: Array.isArray(item.tags) ? [...item.tags] : [],
    scope: exportScope(item.scope),
    pinned: item.pinned === true,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastUsedAt: item.lastUsedAt ?? null,
  };
}

/**
 * Build the JSON export document (spec §1). Always the complete stored array.
 * @param {ReadonlyArray<any>} items
 * @param {{ exportedAt?: string }} [options]
 * @returns {string}
 */
export function serializeJsonExport(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const payload = {
    format: FORMAT_NAME,
    formatVersion: FORMAT_VERSION,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    count: list.length,
    items: list.map(exportItem),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * A Markdown heading is one line: this is the readable form only. A title that
 * really contains a line break is carried exactly by the `title` metadata key.
 * @param {unknown} value
 * @returns {string}
 */
function headingText(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/**
 * One Markdown entry: heading, metadata comment, fenced body (spec §2).
 *
 * The body is copied into the fence byte for byte: no EOL normalisation, no BOM
 * stripping, no trimming. `sha256` is taken over exactly those bytes, so the
 * reader can prove that what it reconstructed is what was exported.
 *
 * @param {any} item
 * @returns {string}
 */
function renderMarkdownEntry(item) {
  const body = String(item.body ?? "");
  const title = String(item.title ?? "");
  const fence = "`".repeat(Math.max(3, longestBacktickRun(body) + 1));
  /** @type {any} */
  const meta = {
    v: FORMAT_VERSION,
    id: item.id,
    tags: Array.isArray(item.tags) ? [...item.tags] : [],
    scope: exportScope(item.scope),
    pinned: item.pinned === true,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastUsedAt: item.lastUsedAt ?? null,
    sha256: sha256Hex(body),
  };
  // A title carrying a line break cannot travel on the heading line (a Markdown
  // heading is one line), so the exact value goes in the metadata comment and
  // the heading keeps a readable single-line form.
  if (title.includes("\n") || title.includes("\r")) meta.title = title;
  return `## ${headingText(title)}\n\n<!-- dpt ${JSON.stringify(meta)} -->\n\n${fence}text\n${body}\n${fence}\n`;
}

/**
 * Build the Markdown export document (spec §2).
 * @param {ReadonlyArray<any>} items
 * @param {{ exportedAt?: string }} [options]
 * @returns {string}
 */
export function serializeMarkdownExport(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const head = `<!-- ${FORMAT_NAME} v${FORMAT_VERSION} | exported ${exportedAt} | ${list.length} templates -->`;
  if (list.length === 0) return `${head}\n`;
  return `${head}\n\n${list.map(renderMarkdownEntry).join("\n")}`;
}

/**
 * `dsh-prompt-templates-YYYYMMDD-HHmm.json|.md` in host local time (spec §7).
 * @param {"json"|"md"} format
 * @param {Date} [date]
 * @returns {string}
 */
export function exportFilename(format, date = new Date()) {
  const extension = EXTENSION_BY_FORMAT[format];
  if (!extension) fail("invalid-input", 'format must be "json" or "md"', { field: "format" });
  const pad = (value) => String(value).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${FORMAT_NAME}-${stamp}.${extension}`;
}

/**
 * Map a canonical validation failure onto the import reason vocabulary (§5).
 * @param {StoreError} error
 * @param {any} raw
 * @returns {string}
 */
function importReason(error, raw) {
  const field = typeof error.field === "string" ? error.field : "";
  if (field === "title") {
    return typeof raw.title === "string" && raw.title.trim() === "" ? "title-empty" : "title-invalid";
  }
  if (field === "body") {
    return typeof raw.body === "string" && raw.body.trim() === "" ? "body-empty" : "body-invalid";
  }
  if (field === "tags" || field === "tag" || field === "category") return "tags-invalid";
  if (field === "scope" || field === "scope.kind" || field === "scope.paths") return "scope-invalid";
  // id / pinned / createdAt / updatedAt / lastUsedAt and anything unknown.
  return "metadata-invalid";
}

/**
 * Validate one incoming record with the store's own rules, reporting a stable
 * reason instead of throwing (spec §4: never drop an entry silently).
 * @param {any} raw
 * @param {{ now: () => number, newId: () => string }} options
 * @returns {{ ok: true, value: any } | { ok: false, reason: string, message: string }}
 */
function validateIncoming(raw, options) {
  try {
    const value = normalizeTemplate(raw, { loading: true, now: options.now, newId: options.newId });
    return { ok: true, value };
  } catch (error) {
    if (!(error instanceof StoreError)) throw error;
    return { ok: false, reason: importReason(error, raw), message: error.message };
  }
}

/**
 * A file that could not be read as a whole still gets a status row.
 * @param {{ name: string }} file
 * @param {string} reason
 * @param {string} message
 * @returns {{ status: any, candidates: any[] }}
 */
function fileError(file, reason, message) {
  return {
    status: { name: file.name, status: "invalid", entries: 0, reason, message },
    candidates: [],
  };
}

/**
 * @param {{ name: string, index: number }} file
 * @param {string} at
 * @param {number} index
 * @param {any} result
 * @param {string} titleHint
 * @param {string | undefined} warning
 * @returns {any}
 */
function candidateFrom(file, at, index, result, titleHint, warning) {
  if (!result.ok) {
    const candidate = { at, file: file.name, index, kind: "invalid", title: titleHint, reason: result.reason, message: result.message };
    if (warning) candidate.warning = warning;
    return candidate;
  }
  const candidate = { at, file: file.name, index, kind: "valid", value: result.value };
  if (warning) candidate.warning = warning;
  return candidate;
}

/**
 * JSON export file (spec §1). A too-new version invalidates this file only.
 * @param {{ name: string, text: string, index: number }} file
 * @param {{ now: () => number, newId: () => string }} options
 * @returns {{ status: any, candidates: any[] }}
 */
function parseJsonFile(file, options) {
  let raw;
  try {
    raw = JSON.parse(file.text);
  } catch {
    return fileError(file, "bad-json", `${file.name}: not valid JSON`);
  }
  if (!isPlainObject(raw)) return fileError(file, "metadata-invalid", `${file.name}: a JSON export must be an object`);
  if (raw.format !== FORMAT_NAME) {
    return fileError(file, "metadata-invalid", `${file.name}: expected format "${FORMAT_NAME}"`);
  }
  const version = raw.formatVersion;
  if (!Number.isInteger(version) || version < 1) {
    return fileError(file, "metadata-invalid", `${file.name}: formatVersion must be a positive integer`);
  }
  if (version > FORMAT_VERSION) {
    // Per-file verdict, not a batch refusal: a v2 payload cannot be read
    // losslessly, but the other files still preview (spec §5).
    return fileError(
      file,
      "format-too-new",
      `${file.name}: format version ${version} is newer than this plugin supports (${FORMAT_VERSION})`,
    );
  }
  if (!Array.isArray(raw.items)) return fileError(file, "metadata-invalid", `${file.name}: items must be an array`);

  const candidates = raw.items.map((entry, index) => {
    const at = `f${file.index}#${index}`;
    const titleHint = isPlainObject(entry) && typeof entry.title === "string" ? entry.title.trim() : "";
    if (!isPlainObject(entry)) {
      return { at, file: file.name, index, kind: "invalid", title: "", reason: "metadata-invalid", message: "entry must be an object" };
    }
    return candidateFrom(file, at, index, validateIncoming(entry, options), titleHint, undefined);
  });
  return { status: { name: file.name, status: "ok", entries: candidates.length }, candidates };
}

/**
 * Read a fenced block that starts at `from`. `closed: false` means the fence was
 * never terminated: the entry is broken, but the lines it swallowed must not
 * become its body (spec §5, `fence-unclosed`).
 * @param {string[]} lines
 * @param {number} from index of the opening fence line
 * @param {{ length: number }} open
 * @returns {{ lines: string[], closed: boolean }}
 */
function readFence(lines, from, open) {
  const bodyLines = [];
  for (let i = from + 1; i < lines.length; i += 1) {
    if (isClosingFence(lines[i], open)) return { lines: bodyLines, closed: true };
    bodyLines.push(lines[i]);
  }
  return { lines: bodyLines, closed: false };
}

/**
 * Index of the line that closes `open`, or -1 when the fence never closes.
 * @param {string[]} lines
 * @param {number} from first candidate line index
 * @param {{ length: number }} open
 * @returns {number}
 */
function findClosingFence(lines, from, open) {
  for (let i = from; i < lines.length; i += 1) {
    if (isClosingFence(lines[i], open)) return i;
  }
  return -1;
}

/**
 * Hand-written Markdown document without any `## ` heading (spec §3).
 * @param {{ name: string, index: number }} file
 * @param {string[]} lines
 * @param {string} lineEnding "\n" or "\r\n"
 * @param {{ now: () => number, newId: () => string }} options
 * @returns {{ status: any, candidates: any[] }}
 */
function parsePlainFile(file, lines, lineEnding, options) {
  const start = lines.findIndex((line) => line.trim() !== "");
  if (start < 0) return fileError(file, "file-empty", `${file.name}: file has no content`);
  const title = lines[start].trim();
  const rest = trimBlankLines(lines.slice(start + 1));
  // A single-line file is both the title and the body.
  const body = rest.length === 0 ? title : rest.join(lineEnding);
  const stamp = options.now();
  const raw = {
    id: options.newId(),
    title,
    body,
    tags: [],
    scope: { kind: "global" },
    pinned: false,
    createdAt: stamp,
    updatedAt: stamp,
    lastUsedAt: null,
  };
  const at = `f${file.index}#0`;
  const candidate = candidateFrom(file, at, 0, validateIncoming(raw, options), title, undefined);
  return { status: { name: file.name, status: "ok", entries: 1 }, candidates: [candidate] };
}

/**
 * One `## title` section. Metadata and fenced body are authoritative when the
 * metadata comment is present; otherwise the section is hand-written content.
 * @param {{ name: string, index: number }} file
 * @param {string} at
 * @param {number} index
 * @param {string} headingTitle
 * @param {string[]} sectionLines lines after the heading, before the next one
 * @param {string} lineEnding "\n" or "\r\n", used only to join body lines back
 * @param {{ now: () => number, newId: () => string }} options
 * @returns {any}
 */
function parseMarkdownSection(file, at, index, headingTitle, sectionLines, lineEnding, options) {
  let cursor = 0;
  while (cursor < sectionLines.length && sectionLines[cursor].trim() === "") cursor += 1;

  let parsedMeta = null;
  let metaIssue = "";
  if (cursor < sectionLines.length) {
    const line = sectionLines[cursor];
    const comment = parseMetadataComment(line);
    if (comment) {
      if (comment.error) metaIssue = comment.error;
      else parsedMeta = comment.meta;
      cursor += 1;
    } else if (METADATA_START.test(line)) {
      // A `<!-- dpt` line that is not a complete comment is a truncated export,
      // never body text: the entry is broken, and the raw comment must not leak
      // into the body (spec §5, `metadata-invalid`).
      metaIssue = "metadata comment is truncated";
      cursor += 1;
    }
  }

  if (metaIssue) {
    return { at, file: file.name, index, kind: "invalid", title: headingTitle, reason: "metadata-invalid", message: metaIssue };
  }

  // A title containing a line break travels in the metadata comment and wins
  // over the single-line heading form (spec §2).
  const title = parsedMeta && typeof parsedMeta.title === "string" ? parsedMeta.title : headingTitle;

  while (cursor < sectionLines.length && sectionLines[cursor].trim() === "") cursor += 1;

  // Only our own export puts the body in a fence (metadata first, then the
  // fenced body). A hand-written section keeps its lines verbatim — including a
  // code block it may itself contain — so nothing after that block is dropped.
  const fence = parsedMeta ? matchOpeningFence(sectionLines[cursor] ?? "") : null;
  let body;
  if (fence) {
    const fenced = readFence(sectionLines, cursor, fence);
    if (!fenced.closed) {
      return { at, file: file.name, index, kind: "invalid", title, reason: "fence-unclosed", message: "the fenced body is never closed" };
    }
    body = fenced.lines.join(lineEnding);
  } else {
    body = trimBlankLines(sectionLines.slice(cursor)).join(lineEnding);
  }

  if (!parsedMeta) {
    const stamp = options.now();
    const raw = {
      id: options.newId(),
      title,
      body,
      tags: [],
      scope: { kind: "global" },
      pinned: false,
      createdAt: stamp,
      updatedAt: stamp,
      lastUsedAt: null,
    };
    return candidateFrom(file, at, index, validateIncoming(raw, options), title, undefined);
  }

  const meta = parsedMeta;
  if (meta.v !== undefined && meta.v !== FORMAT_VERSION) {
    if (Number.isInteger(meta.v) && meta.v > FORMAT_VERSION) {
      return { at, file: file.name, index, kind: "invalid", title, reason: "format-too-new", message: `entry metadata v${meta.v} is newer than ${FORMAT_VERSION}` };
    }
    return { at, file: file.name, index, kind: "invalid", title, reason: "metadata-invalid", message: "entry metadata v must be a positive integer" };
  }
  // `eol` no longer exists: the body is byte-exact, and a legacy key is ignored.

  let warning;
  if (typeof meta.sha256 === "string" && SHA256_HEX.test(meta.sha256.toLowerCase()) && sha256Hex(body) !== meta.sha256.toLowerCase()) {
    // The file was rewritten outside the plugin: keep the recomputed body and
    // surface the discrepancy as a warning (spec §2), never as a failure.
    warning = "body-edited";
  }

  const raw = {
    id: meta.id,
    title,
    body,
    tags: meta.tags === undefined ? [] : meta.tags,
    scope: meta.scope === undefined ? { kind: "global" } : meta.scope,
    pinned: meta.pinned === undefined ? false : meta.pinned,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    lastUsedAt: meta.lastUsedAt === undefined ? null : meta.lastUsedAt,
  };
  return candidateFrom(file, at, index, validateIncoming(raw, options), title, warning);
}

/**
 * Markdown export (metadata + fence) or hand-written Markdown (spec §2 and §3).
 * @param {{ name: string, text: string, index: number }} file
 * @param {{ now: () => number, newId: () => string }} options
 * @returns {{ status: any, candidates: any[] }}
 */
function parseMarkdownFile(file, options) {
  const text = stripBom(file.text);
  // A file re-saved with CRLF everywhere is read in CRLF mode: the per-line CR
  // is stripped while splitting and restored when bodies are joined back.
  const lineEnding = isCrlfOnly(text) ? "\r\n" : "\n";
  const lines = splitLines(text, lineEnding);

  let firstNonBlank = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim()) {
      firstNonBlank = i;
      break;
    }
  }

  let headerLine = -1;
  if (firstNonBlank >= 0) {
    const header = parseHeaderComment(lines[firstNonBlank]);
    if (header) {
      if (header.version > FORMAT_VERSION) {
        // A document from a newer format cannot be read losslessly; only this
        // file is invalid, the rest of the batch still previews (spec §5).
        return fileError(
          file,
          "format-too-new",
          `${file.name}: Markdown format v${header.version} is newer than this plugin supports (v${FORMAT_VERSION})`,
        );
      }
      if (header.version < 1) return fileError(file, "metadata-invalid", `${file.name}: header version must be positive`);
      headerLine = firstNonBlank;
    }
  }

  // Headings inside fenced code blocks are body text, never entry boundaries.
  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = matchOpeningFence(line);
    if (fence) {
      const close = findClosingFence(lines, i + 1, fence);
      // A fence that never closes must not swallow the rest of the file: keep
      // scanning for headings so later entries survive, and let the owning
      // section report `fence-unclosed` (spec §5).
      if (close >= 0) i = close;
      continue;
    }
    const title = matchHeading(line);
    if (title !== null) headings.push({ line: i, title });
  }

  if (headings.length === 0) {
    // A head comment with no headings is an export of an empty library.
    if (headerLine >= 0) return { status: { name: file.name, status: "ok", entries: 0 }, candidates: [] };
    return parsePlainFile(file, lines, lineEnding, options);
  }

  let ignoredLeadingLines = 0;
  for (let i = 0; i < headings[0].line; i += 1) {
    if (i === headerLine) continue;
    if (lines[i].trim()) ignoredLeadingLines += 1;
  }

  const candidates = headings.map((heading, index) => {
    const end = index + 1 < headings.length ? headings[index + 1].line : lines.length;
    const sectionLines = lines.slice(heading.line + 1, end);
    return parseMarkdownSection(file, `f${file.index}#${index}`, index, heading.title, sectionLines, lineEnding, options);
  });
  const status = { name: file.name, status: "ok", entries: candidates.length };
  if (ignoredLeadingLines > 0) status.ignoredLeadingLines = ignoredLeadingLines;
  return { status, candidates };
}

/**
 * Lower-case file extension without the dot, or "" when there is none.
 * @param {string} name
 * @returns {string}
 */
function fileExtension(name) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Decide the reader for one file. The extension decides first, so a `.md` file
 * that happens to start with `{` stays Markdown; only an unknown extension falls
 * back to sniffing the first meaningful character (spec §3).
 * @param {{ name: string, text: string, index: number }} file
 * @param {{ now: () => number, newId: () => string }} options
 * @returns {{ status: any, candidates: any[] }}
 */
function parseOneFile(file, options) {
  const text = stripBom(file.text);
  if (!text.trim()) return fileError(file, "file-empty", `${file.name}: file is empty`);
  const extension = fileExtension(file.name);
  if (extension === "json") return parseJsonFile(file, options);
  if (extension === "md" || extension === "markdown") return parseMarkdownFile(file, options);
  if (text.trimStart().startsWith("{")) return parseJsonFile(file, options);
  return parseMarkdownFile(file, options);
}

/**
 * Parse a batch of already-decoded files (spec §4, §5).
 *
 * Batch ceilings throw — the whole import is refused rather than truncated.
 * Every per-file problem, including `format-too-new`, stays soft
 * (`files[].status = "invalid"` + `reason`) so one unreadable file does not hide
 * the preview of the others (spec §5).
 *
 * @param {ReadonlyArray<{ name: string, text: string }>} files
 * @param {{ now?: () => number, newId?: () => string }} [options]
 * @returns {{ files: any[], candidates: any[] }}
 */
export function parseImportFiles(files, options = {}) {
  const resolved = { now: options.now ?? Date.now, newId: options.newId ?? defaultNewId };
  if (!Array.isArray(files)) fail("invalid-input", "files must be an array", { field: "files" });
  if (files.length > IMPORT_LIMITS.files) {
    fail("too-many-files", `at most ${IMPORT_LIMITS.files} files can be imported at once`, { limit: IMPORT_LIMITS.files });
  }

  let bytes = 0;
  const prepared = files.map((file, index) => {
    if (!isPlainObject(file)) fail("invalid-input", `files[${index}] must be an object`, { field: "files" });
    if (typeof file.text !== "string") fail("invalid-input", `files[${index}].text must be a string`, { field: "files" });
    const name = typeof file.name === "string" && file.name.trim() ? file.name.trim() : `file-${index + 1}`;
    bytes += encoder.encode(file.text).length;
    if (bytes > IMPORT_LIMITS.bytes) {
      fail("import-too-large", `import text must be at most ${IMPORT_LIMITS.bytes} bytes in total`, { limit: IMPORT_LIMITS.bytes });
    }
    return { name, text: file.text, index };
  });

  const statuses = [];
  const candidates = [];
  for (const file of prepared) {
    const parsed = parseOneFile(file, resolved);
    statuses.push(parsed.status);
    for (const candidate of parsed.candidates) {
      candidates.push(candidate);
      if (candidates.length > IMPORT_LIMITS.entries) {
        fail("import-too-many", `at most ${IMPORT_LIMITS.entries} entries can be imported at once`, {
          limit: IMPORT_LIMITS.entries,
        });
      }
    }
  }
  return { files: statuses, candidates };
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizedTitle(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Content equality for `identical` (spec §5): title, body, tag order, pinned and
 * scope; paths compare through `pathKey` and are order-insensitive.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function sameContent(a, b) {
  if (a.title !== b.title || a.body !== b.body || a.pinned !== b.pinned) return false;
  if (a.tags.length !== b.tags.length) return false;
  if (a.tags.some((tag, index) => tag !== b.tags[index])) return false;
  const left = a.scope;
  const right = b.scope;
  if (left.kind !== right.kind) return false;
  if (left.kind === "global") return true;
  const x = left.paths.map(pathKey).sort();
  const y = right.paths.map(pathKey).sort();
  return x.length === y.length && x.every((value, index) => value === y[index]);
}

/**
 * Scope paths that are not directories on this host (informational only — the
 * scope is never rewritten, spec §5).
 * @param {any} item
 * @param {(path: string) => boolean} isDirectory
 * @returns {string[]}
 */
function missingScopePaths(item, isDirectory) {
  if (item.scope.kind !== "projects") return [];
  return item.scope.paths.filter((path) => {
    try {
      return !isDirectory(path);
    } catch {
      return true;
    }
  });
}

/**
 * Classify candidate entries against the stored library (spec §5).
 *
 * Order matters: id first, then normalized title, then add. `missingPaths` is
 * attached to entries that would write something; it never changes the scope.
 *
 * @param {ReadonlyArray<any>} candidates from `parseImportFiles`
 * @param {ReadonlyArray<any>} items current stored templates
 * @param {{ isDirectory?: (path: string) => boolean }} [options]
 * @returns {{ entries: any[], summary: any }}
 */
export function classifyImport(candidates, items, options = {}) {
  const isDirectory = options.isDirectory ?? (() => true);
  const byId = new Map();
  const byTitle = new Map();
  for (const item of items ?? []) {
    byId.set(item.id, item);
    const key = normalizedTitle(item.title);
    if (!byTitle.has(key)) byTitle.set(key, item);
  }

  const entries = [];
  const summary = { add: 0, conflict: 0, identical: 0, invalid: 0, missingPaths: 0, total: 0 };

  for (const candidate of candidates ?? []) {
    if (candidate.kind === "invalid") {
      const entry = {
        at: candidate.at,
        file: candidate.file,
        kind: "invalid",
        title: candidate.title ?? "",
        reason: candidate.reason,
        message: candidate.message,
      };
      if (candidate.warning) entry.warning = candidate.warning;
      entries.push(entry);
      summary.invalid += 1;
      summary.total += 1;
      continue;
    }

    /** @type {any} */
    const incoming = candidate.value;
    let local = byId.get(incoming.id);
    let reason;
    if (local) reason = "id";
    else {
      local = byTitle.get(normalizedTitle(incoming.title));
      if (local) reason = "title";
    }

    if (!local) {
      const entry = { at: candidate.at, file: candidate.file, kind: "add", title: incoming.title, incoming: clone(incoming) };
      const missing = missingScopePaths(incoming, isDirectory);
      if (missing.length > 0) {
        entry.missingPaths = missing;
        summary.missingPaths += 1;
      }
      if (candidate.warning) entry.warning = candidate.warning;
      entries.push(entry);
      summary.add += 1;
      summary.total += 1;
      continue;
    }

    if (sameContent(incoming, local)) {
      const entry = { at: candidate.at, file: candidate.file, kind: "identical", title: incoming.title };
      if (candidate.warning) entry.warning = candidate.warning;
      entries.push(entry);
      summary.identical += 1;
      summary.total += 1;
      continue;
    }

    const entry = {
      at: candidate.at,
      file: candidate.file,
      kind: "conflict",
      title: incoming.title,
      incoming: clone(incoming),
      local: clone(local),
      reason,
    };
    const missing = missingScopePaths(incoming, isDirectory);
    if (missing.length > 0) {
      entry.missingPaths = missing;
      summary.missingPaths += 1;
    }
    if (candidate.warning) entry.warning = candidate.warning;
    entries.push(entry);
    summary.conflict += 1;
    summary.total += 1;
  }

  return { entries, summary };
}

/**
 * Parse then classify in one call — the preview the API returns (spec §5).
 * @param {ReadonlyArray<{ name: string, text: string }>} files
 * @param {ReadonlyArray<any>} items
 * @param {{ now?: () => number, newId?: () => string, isDirectory?: (path: string) => boolean }} [options]
 * @returns {{ files: any[], entries: any[], summary: any }}
 */
export function buildPreview(files, items, options = {}) {
  const parsed = parseImportFiles(files, options);
  const { entries, summary } = classifyImport(parsed.candidates, items, options);
  return { files: parsed.files, entries, summary };
}
