import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
  buildPreview,
  exportFilename,
  FORMAT_NAME,
  FORMAT_VERSION,
  IMPORT_LIMITS,
  parseImportFiles,
  serializeJsonExport,
  serializeMarkdownExport,
} from "../lib/format.js";
import { createRouteHandler } from "../lib/index.js";
import { TemplateStore } from "../lib/store.js";

/**
 * Canonical stored record, in the shape `normalizeTemplate` produces.
 * @param {Record<string, unknown>} [overrides]
 */
function record(overrides = {}) {
  return {
    id: "tpl-a",
    title: "标题 A",
    body: "正文 A",
    tags: ["标签"],
    scope: { kind: "global" },
    pinned: false,
    createdAt: 1000,
    updatedAt: 2000,
    lastUsedAt: null,
    ...overrides,
  };
}

/**
 * Every lossless case the contract cares about: `## ` inside a body, a backtick
 * fence inside a body, CRLF, a trailing newline, no trailing newline, Chinese and
 * emoji, project scope, pinned, and both `lastUsedAt` shapes.
 */
function samples() {
  return [
    record({
      id: "tpl-one",
      title: "解释 🚀 调用链",
      body: "第一行\n## 这不是标题\n```js\nconst a = 1;\n```\n结束 🚀",
      tags: ["中文标签", "emoji 🚀"],
      pinned: true,
      createdAt: 1764000000000,
      updatedAt: 1764000000123,
      lastUsedAt: 1764000000456,
    }),
    record({
      id: "tpl-two",
      title: "CRLF body",
      body: "第一行\r\n第二行\r\n",
      tags: [],
      scope: { kind: "projects", paths: ["C:\\work\\a", "/opt/b"] },
      pinned: false,
      createdAt: 1764000001000,
      updatedAt: 1764000002000,
      lastUsedAt: null,
    }),
    record({
      id: "tpl-three",
      title: "trailing newline",
      body: "结尾带一个换行\n",
      tags: ["a", "b"],
      createdAt: 1,
      updatedAt: 2,
      lastUsedAt: 3,
    }),
  ];
}

/**
 * Every body shape the fence must carry through byte for byte: mixed line
 * endings, pure CRLF, a lone CR, a leading BOM and trailing blank lines.
 */
function bodyShapes() {
  return [
    ["mixed", "a\r\nb\nc"],
    ["crlf", "第一行\r\n第二行\r\n"],
    ["crlf-no-trailing", "a\r\nb\r\nc"],
    ["lone-cr", "第一行\r第二行"],
    ["trailing-lf", "结尾带一个换行\n"],
    ["trailing-blank", "两行结尾\n\n"],
    ["leading-bom", "\uFEFF开头是 BOM\n第二行"],
    ["bom-and-crlf", "\uFEFFa\r\nb"],
  ];
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function httpHarness(items = [], options = {}) {
  const writes = [];
  const store = new TemplateStore({
    state: { revision: options.revision ?? 0, seeded: true, items },
    persist: async (next) => {
      writes.push(JSON.parse(JSON.stringify(next)));
    },
  });
  const handler = createRouteHandler({ ensureStore: async () => store, getOrigin: () => "http://localhost" });
  async function call(pathname, body, method) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.url = `/dsh-prompt-template${pathname}`;
    req.method = method ?? (body === undefined ? "GET" : "POST");
    req.headers = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
    let status;
    let result;
    await handler(req, {
      writeHead: (value) => {
        status = value;
      },
      end: (value) => {
        result = JSON.parse(value);
      },
    });
    return { status, body: result };
  }
  return { store, writes, call };
}

/** @param {string} text @param {string} [name] */
function parsed(text, name = "a.json") {
  return parseImportFiles([{ name, text }], { now: () => 777, newId: () => "generated" });
}

/* ------------------------------------------------------------------ JSON */

test("JSON export carries the documented envelope and stored order", () => {
  const items = samples();
  const text = serializeJsonExport(items, { exportedAt: "2026-11-28T15:04:05.123Z" });
  const document = JSON.parse(text);
  assert.equal(document.format, FORMAT_NAME);
  assert.equal(document.formatVersion, FORMAT_VERSION);
  assert.equal(document.exportedAt, "2026-11-28T15:04:05.123Z");
  assert.equal(document.count, items.length);
  assert.deepEqual(
    document.items.map((item) => item.id),
    items.map((item) => item.id),
  );
  assert.deepEqual(document.items[0], items[0], "every field is emitted verbatim");
});

test("JSON round trip restores every field byte for byte", () => {
  const items = samples();
  const result = parsed(serializeJsonExport(items));
  assert.deepEqual(result.files, [{ name: "a.json", status: "ok", entries: 3 }]);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.value),
    items,
  );
});

test("JSON entries are validated individually with stable reason codes", () => {
  const document = {
    format: FORMAT_NAME,
    formatVersion: 1,
    items: [
      { ...record(), title: "   " },
      { ...record(), body: "  " },
      { ...record(), tags: ["1", "2", "3", "4", "5", "6", "7"] },
      { ...record(), scope: { kind: "projects", paths: ["relative/path"] } },
      { ...record(), createdAt: undefined },
      { ...record(), id: "not valid!" },
      { ...record(), title: "合法" },
    ],
  };
  const result = parsed(JSON.stringify(document));
  assert.equal(result.files[0].status, "ok");
  assert.equal(result.files[0].entries, 7);
  assert.deepEqual(
    result.candidates.map((candidate) => (candidate.kind === "invalid" ? candidate.reason : "ok")),
    ["title-empty", "body-empty", "tags-invalid", "scope-invalid", "metadata-invalid", "metadata-invalid", "ok"],
  );
  assert.equal(result.candidates[5].at, "f0#5");
});

test("JSON files that are not our format are refused as a file, not as entries", () => {
  const badJson = parsed("{ not json", "broken.json");
  assert.equal(badJson.files[0].status, "invalid");
  assert.equal(badJson.files[0].reason, "bad-json");
  assert.deepEqual(badJson.candidates, []);

  const wrongFormat = parsed(JSON.stringify({ format: "something-else", formatVersion: 1, items: [] }));
  assert.equal(wrongFormat.files[0].status, "invalid");
  assert.equal(wrongFormat.files[0].reason, "metadata-invalid");

  const noItems = parsed(JSON.stringify({ format: FORMAT_NAME, formatVersion: 1 }));
  assert.equal(noItems.files[0].reason, "metadata-invalid");

  const empty = parsed("   \n", "empty.json");
  assert.equal(empty.files[0].reason, "file-empty");
});

/* -------------------------------------------------------------- Markdown */

test("Markdown round trip restores every field including CRLF and trailing newlines", () => {
  const items = samples();
  const text = serializeMarkdownExport(items, { exportedAt: "2026-11-28T15:04:05.123Z" });
  assert.match(text, /^<!-- dsh-prompt-templates v1 \| exported 2026-11-28T15:04:05.123Z \| 3 templates -->/);
  const result = parsed(text, "a.md");
  assert.deepEqual(result.files, [{ name: "a.md", status: "ok", entries: 3 }]);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.value),
    items,
  );
  assert.equal(result.candidates[1].value.body, "第一行\r\n第二行\r\n");
  assert.equal(result.candidates[2].value.body, "结尾带一个换行\n");
});

test("Markdown round trip is byte-exact for mixed EOL, lone CR, BOM and trailing newlines", () => {
  const items = bodyShapes().map(([id, body]) =>
    record({ id: `body-${id}`, title: `正文形态 ${id}`, body, tags: [] }),
  );
  const text = serializeMarkdownExport(items);
  const result = parsed(text, "bodies.md");
  assert.deepEqual(result.files, [{ name: "bodies.md", status: "ok", entries: items.length }]);
  assert.equal(result.candidates.length, items.length);
  result.candidates.forEach((candidate, index) => {
    assert.equal(candidate.kind, "valid", `entry ${index} must be valid`);
    assert.equal(candidate.warning, undefined, `entry ${index} must not be flagged as edited`);
    assert.equal(candidate.value.body, items[index].body, `body ${index} must be byte-identical`);
    assert.deepEqual(candidate.value, items[index]);
  });
});

test("a Markdown file saved with CRLF everywhere still round-trips its CRLF body", () => {
  const item = record({ id: "saved-crlf", title: "另存为 CRLF", body: "a\r\nb\r\nc", tags: [] });
  const text = serializeMarkdownExport([item]).replace(/\r?\n/g, "\r\n");
  assert.ok(!/[^\r]\n/.test(text), "the fixture really uses CRLF for every newline");
  const result = parsed(text, "saved.md");
  assert.equal(result.candidates[0].kind, "valid");
  assert.equal(result.candidates[0].warning, undefined);
  assert.deepEqual(result.candidates[0].value, item);
});

test("the export no longer records eol; an eol key in metadata is ignored", () => {
  const item = record({ id: "no-eol", title: "无 eol", body: "a\r\nb\nc", tags: [] });
  const text = serializeMarkdownExport([item]);
  assert.ok(!/"eol"/.test(text), "the eol field is gone from the metadata");
  const patched = text.replace('"sha256"', '"eol":"crlf","sha256"');
  assert.ok(patched.includes('"eol":"crlf"'), "the fixture really carries a legacy eol key");
  const result = parsed(patched, "eol.md");
  assert.equal(result.candidates[0].kind, "valid");
  assert.equal(result.candidates[0].warning, undefined, "sha256 is computed over the exact body");
  assert.equal(result.candidates[0].value.body, "a\r\nb\nc");
});

test("a title containing a newline travels in metadata and comes back byte-identical", () => {
  const item = record({ id: "multi-line-title", title: "第一行标题\n第二行标题", body: "正文", tags: [] });
  const text = serializeMarkdownExport([item]);
  const metadataLine = text.split("\n").find((line) => line.includes("<!-- dpt "));
  assert.equal(JSON.parse(/<!-- dpt (\{.*\}) -->/.exec(metadataLine)[1]).title, "第一行标题\n第二行标题");
  const result = parsed(text, "title.md");
  assert.equal(result.candidates[0].kind, "valid");
  assert.equal(result.candidates[0].value.title, "第一行标题\n第二行标题");
  assert.deepEqual(result.candidates[0].value, item);

  const carriage = record({ id: "carriage-title", title: "甲\r乙", body: "正文", tags: [] });
  const carriageResult = parsed(serializeMarkdownExport([carriage]), "carriage.md");
  assert.equal(carriageResult.candidates[0].value.title, "甲\r乙");

  const singleLine = serializeMarkdownExport([record({ id: "plain-title", title: "单行", body: "正文", tags: [] })]);
  assert.ok(!singleLine.includes('"title"'), "a single-line title stays on the heading line only");
});

test("an unclosed fence invalidates only its entry and later headings stay entries", () => {
  const first = record({ id: "fence-a", title: "条目 A", body: "A 的正文", tags: [] });
  const truncated = serializeMarkdownExport([first]).replace(/```\n$/, "");
  assert.ok(truncated.endsWith("A 的正文\n"), "the fixture lost the closing fence");
  const damaged = `${truncated}## 条目 B\n\nB 的正文\n`;
  const result = parsed(damaged, "fence.md");
  assert.deepEqual(result.files, [{ name: "fence.md", status: "ok", entries: 2 }]);
  assert.equal(result.candidates.length, 2, "B survives the unclosed fence");
  assert.equal(result.candidates[0].kind, "invalid");
  assert.equal(result.candidates[0].reason, "fence-unclosed");
  assert.equal(result.candidates[0].title, "条目 A");
  assert.equal(result.candidates[1].kind, "valid");
  assert.equal(result.candidates[1].value.title, "条目 B");
  assert.equal(result.candidates[1].value.body, "B 的正文");
});

test("a truncated metadata comment makes its entry invalid instead of leaking into the body", () => {
  const item = record({ id: "truncated", title: "截断元信息", body: "正文", tags: [] });
  const text = serializeMarkdownExport([item]);
  const damaged = text.replace(/("sha256":"[0-9a-f]{64}"\})\s*-->/, "$1");
  const damagedMetadata = damaged.split("\n").find((line) => line.includes("<!-- dpt "));
  assert.ok(damagedMetadata && !damagedMetadata.includes("-->"), "the fixture really lost the comment tail");
  const result = parsed(damaged, "metadata.md");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].kind, "invalid");
  assert.equal(result.candidates[0].reason, "metadata-invalid");
  assert.ok(!("value" in result.candidates[0]), "the raw comment is never imported as a body");

  const broken = parsed('## t\n\n<!-- dpt {not json} -->\n\n正文\n', "broken-meta.md");
  assert.equal(broken.candidates[0].reason, "metadata-invalid");
});

test("the file extension decides the format before any content sniffing", () => {
  const markdownStartingWithBrace = parsed('{\n  "note": 1\n}\n', "prose.md");
  assert.equal(markdownStartingWithBrace.files[0].status, "ok");
  assert.equal(markdownStartingWithBrace.candidates[0].kind, "valid");
  assert.equal(markdownStartingWithBrace.candidates[0].value.title, "{");

  const markdownExtension = parsed('{\n  "note": 1\n}\n', "prose.markdown");
  assert.equal(markdownExtension.files[0].status, "ok");
  assert.equal(markdownExtension.candidates[0].kind, "valid");

  const unknownExtension = parsed(
    serializeJsonExport([record({ id: "sniff", title: "随扩展名", body: "正文", tags: [] })]),
    "backup.txt",
  );
  assert.equal(unknownExtension.files[0].status, "ok", "an unknown extension still sniffs JSON");

  const markdownAsJson = parsed("## 标题\n\n正文\n", "notes.json");
  assert.equal(markdownAsJson.files[0].status, "invalid");
  assert.equal(markdownAsJson.files[0].reason, "bad-json");
});

test("Markdown fence outruns the longest backtick run in the body", () => {
  const body = "a\n```\n````\nb";
  const item = record({ id: "fency", body, tags: [] });
  const text = serializeMarkdownExport([item]);
  assert.ok(text.includes("\n`````text\n"), "fence is one backtick longer than the longest run");
  const result = parsed(text, "fency.md");
  assert.equal(result.candidates[0].value.body, body);
  assert.equal(result.candidates[0].warning, undefined);
});

test("a body edited outside the plugin imports with a body-edited warning", () => {
  const item = record({ id: "edited", body: "第一行正文\n第二行正文" });
  const text = serializeMarkdownExport([item]).replace("第二行正文", "被外部工具改过");
  const result = parsed(text, "edited.md");
  assert.equal(result.candidates[0].kind, "valid");
  assert.equal(result.candidates[0].warning, "body-edited");
  assert.equal(result.candidates[0].value.body, "第一行正文\n被外部工具改过");
  assert.equal(result.candidates[0].value.id, "edited");
});

test("Markdown with a header comment and no entries is an empty library, not a template", () => {
  const text = serializeMarkdownExport([]);
  const result = parsed(text, "empty.md");
  assert.deepEqual(result.files, [{ name: "empty.md", status: "ok", entries: 0 }]);
  assert.deepEqual(result.candidates, []);
});

test("hand-written Markdown splits at headings and counts ignored leading lines", () => {
  const text = "前言一\n前言二\n\n## 第一个标题\n\n正文一\n第二行\n\n## 第二个标题\n单行正文\n";
  const result = parsed(text, "notes.md");
  assert.equal(result.files[0].ignoredLeadingLines, 2);
  const values = result.candidates.map((candidate) => candidate.value);
  assert.deepEqual(
    values.map((value) => [value.title, value.body]),
    [
      ["第一个标题", "正文一\n第二行"],
      ["第二个标题", "单行正文"],
    ],
  );
  for (const value of values) {
    assert.deepEqual(value.tags, []);
    assert.deepEqual(value.scope, { kind: "global" });
    assert.equal(value.pinned, false);
    assert.equal(value.createdAt, 777);
    assert.equal(value.updatedAt, 777);
    assert.equal(value.lastUsedAt, null);
    assert.equal(value.id, "generated");
  }
});

test("hand-written sections keep their own code blocks, headings included", () => {
  const text = "## 代码示例\n```js\nconst a = 1;\n## 这不是标题\n```\n后面还有正文\n";
  const result = parsed(text, "code.md");
  assert.equal(result.candidates.length, 1, "a heading inside a code block is not an entry");
  const value = result.candidates[0].value;
  assert.equal(value.title, "代码示例");
  assert.equal(value.body, "```js\nconst a = 1;\n## 这不是标题\n```\n后面还有正文");
});

test("a file without headings is one entry; a single line is title and body", () => {
  const single = parsed("只有这一行", "one.md");
  assert.equal(single.candidates.length, 1);
  assert.equal(single.candidates[0].value.title, "只有这一行");
  assert.equal(single.candidates[0].value.body, "只有这一行");

  const multi = parsed("标题行\n\n正文第一行\n正文第二行\n", "two.md");
  assert.equal(multi.candidates[0].value.title, "标题行");
  assert.equal(multi.candidates[0].value.body, "正文第一行\n正文第二行");
});

/* --------------------------------------------------------------- limits */

test("format-too-new marks only that file invalid; entries keep entry-level behaviour", () => {
  const json = JSON.stringify({ format: FORMAT_NAME, formatVersion: FORMAT_VERSION + 1, items: [] });
  const future = parsed(json);
  assert.equal(future.files[0].status, "invalid");
  assert.equal(future.files[0].reason, "format-too-new");
  assert.deepEqual(future.candidates, []);

  const markdown = `<!-- ${FORMAT_NAME} v${FORMAT_VERSION + 1} | exported 2026-11-28T15:04:05.123Z | 0 templates -->\n`;
  const futureMarkdown = parsed(markdown, "a.md");
  assert.equal(futureMarkdown.files[0].status, "invalid");
  assert.equal(futureMarkdown.files[0].reason, "format-too-new");

  const entryLevel = `## t\n\n<!-- dpt ${JSON.stringify({ v: FORMAT_VERSION + 1, id: "x" })} -->\n\n\`\`\`text\nt\n\`\`\`\n`;
  const soft = parsed(entryLevel, "entry.md");
  assert.equal(soft.candidates[0].kind, "invalid");
  assert.equal(soft.candidates[0].reason, "format-too-new");
});

test("a too-new file in a batch leaves the other files importable", () => {
  const good = record({ id: "good", title: "正常条目", body: "正常正文", tags: [] });
  const batch = [
    { name: "future.json", text: JSON.stringify({ format: FORMAT_NAME, formatVersion: FORMAT_VERSION + 1, items: [] }) },
    { name: "good.json", text: serializeJsonExport([good]) },
    { name: "future.md", text: `<!-- ${FORMAT_NAME} v${FORMAT_VERSION + 1} | exported 2026-11-28T15:04:05.123Z | 0 templates -->\n` },
  ];
  const result = parseImportFiles(batch, { now: () => 777, newId: () => "generated" });
  assert.deepEqual(
    result.files.map((file) => [file.name, file.status, file.reason]),
    [
      ["future.json", "invalid", "format-too-new"],
      ["good.json", "ok", undefined],
      ["future.md", "invalid", "format-too-new"],
    ],
  );
  assert.equal(result.files[1].entries, 1);
  assert.deepEqual(result.candidates.map((candidate) => candidate.value), [good]);

  const preview = buildPreview(batch, [], { now: () => 777, newId: () => "generated" });
  assert.equal(preview.summary.add, 1);
  assert.equal(preview.summary.total, 1);
});

test("batch ceilings refuse the whole import instead of truncating", () => {
  const many = Array.from({ length: IMPORT_LIMITS.files + 1 }, (_, index) => ({ name: `f${index}.md`, text: "## t\n\nb\n" }));
  assert.throws(() => parseImportFiles(many), (error) => error.code === "too-many-files");

  const huge = [{ name: "huge.md", text: `${"x".repeat(IMPORT_LIMITS.bytes)}y` }];
  assert.throws(() => parseImportFiles(huge), (error) => error.code === "import-too-large");

  const entries = Array.from({ length: IMPORT_LIMITS.entries + 1 }, (_, index) => `## t${index}\n\nb\n`).join("\n");
  assert.throws(() => parseImportFiles([{ name: "many.md", text: entries }]), (error) => error.code === "import-too-many");
});

/* ------------------------------------------------------- classification */

test("classification prefers id, then normalized title, and detects identical content", () => {
  const local = [
    record({ id: "id-1", title: "Same Title", body: "local body" }),
    record({ id: "id-2", title: "Identical", body: "same body", tags: [], pinned: false }),
    record({ id: "id-3", title: "Untouched", body: "keep as is" }),
  ];
  const document = {
    format: FORMAT_NAME,
    formatVersion: 1,
    items: [
      record({ id: "id-1", title: "Same Title", body: "file body" }),
      record({ id: "id-2", title: "Identical", body: "same body", tags: [], pinned: false }),
      record({ id: "id-9", title: "  identical  ", body: "different body", tags: [], pinned: false }),
      record({ id: "id-4", title: "全新模板", body: "new body" }),
    ],
  };
  const preview = buildPreview([{ name: "a.json", text: JSON.stringify(document) }], local, { isDirectory });
  assert.deepEqual(
    preview.entries.map((entry) => [entry.kind, entry.reason]),
    [
      ["conflict", "id"],
      ["identical", undefined],
      ["conflict", "title"],
      ["add", undefined],
    ],
  );
  assert.equal(preview.entries[0].local.id, "id-1");
  assert.equal(preview.entries[2].local.id, "id-2");
  assert.equal(preview.entries[3].incoming.title, "全新模板");
  assert.deepEqual(preview.summary, { add: 1, conflict: 2, identical: 1, invalid: 0, missingPaths: 0, total: 4 });
});

test("identical ignores scope path order but not the path itself", () => {
  const local = [record({ id: "s", scope: { kind: "projects", paths: ["C:\\a", "C:\\b"] } })];
  const same = { format: FORMAT_NAME, formatVersion: 1, items: [record({ id: "s", scope: { kind: "projects", paths: ["C:\\b", "C:\\a"] } })] };
  assert.equal(buildPreview([{ name: "a.json", text: JSON.stringify(same) }], local).entries[0].kind, "identical");

  const other = { format: FORMAT_NAME, formatVersion: 1, items: [record({ id: "s", scope: { kind: "projects", paths: ["C:\\c"] } })] };
  assert.equal(buildPreview([{ name: "a.json", text: JSON.stringify(other) }], local).entries[0].kind, "conflict");
});

test("missingPaths is reported but the incoming scope is never rewritten", () => {
  const base = mkdtempSync(join(tmpdir(), "dpt-import-"));
  const gone = join(base, "gone");
  try {
    const scope = { kind: "projects", paths: [base, gone] };
    const document = { format: FORMAT_NAME, formatVersion: 1, items: [record({ id: "p", scope })] };
    const preview = buildPreview([{ name: "a.json", text: JSON.stringify(document) }], [], { isDirectory });
    assert.deepEqual(preview.entries[0].missingPaths, [gone]);
    assert.deepEqual(preview.entries[0].incoming.scope.paths, [base, gone], "scope is informational only");
    assert.equal(preview.summary.missingPaths, 1);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

/* ----------------------------------------------------------- export API */

test("export is a pure read and an unknown id is refused", async () => {
  const items = samples();
  const { store, writes, call } = httpHarness(items, { revision: 7 });
  const before = store.snapshot();

  const json = await call("/export").catch(() => undefined);
  assert.equal(json.status, 200);
  assert.equal(json.body.format, "json");
  assert.equal(json.body.mime, "application/json");
  assert.equal(json.body.count, 3);
  assert.match(json.body.filename, /^dsh-prompt-templates-\d{8}-\d{4}\.json$/);
  assert.equal(JSON.parse(json.body.content).items.length, 3);

  const markdown = await call("/export?format=md&ids=tpl-three,tpl-one");
  assert.equal(markdown.status, 200);
  assert.equal(markdown.body.mime, "text/markdown");
  assert.match(markdown.body.filename, /\.md$/);
  assert.equal(markdown.body.count, 2);
  const content = markdown.body.content;
  assert.ok(
    content.indexOf("## trailing newline") < content.indexOf("## 解释 🚀 调用链"),
    "ids keep the requested order",
  );
  assert.ok(!content.includes("## 标题 A"), "ids select a subset");

  const unknown = await call("/export?format=md&ids=tpl-one,ghost");
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, "unknown-id");
  assert.equal(unknown.body.id, "ghost");

  const badFormat = await call("/export?format=xml");
  assert.equal(badFormat.status, 400);

  assert.equal(writes.length, 0, "export never persists");
  assert.equal(store.revision, 7);
  assert.deepEqual(store.snapshot(), before);
});

test("exportFilename uses host local time and the format extension", () => {
  const at = new Date(2026, 10, 28, 15, 4);
  assert.equal(exportFilename("json", at), "dsh-prompt-templates-20261128-1504.json");
  assert.equal(exportFilename("md", at), "dsh-prompt-templates-20261128-1504.md");
});

/* --------------------------------------------------------- preview/commit */

test("preview reflects the stored library and writes nothing", async () => {
  const { store, writes, call } = httpHarness(samples(), { revision: 12 });
  const text = serializeJsonExport([record({ id: "brand-new", title: "新条目", body: "新正文", tags: [] })]);
  const preview = await call("/import/preview", { files: [{ name: "a.json", text }] });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.revision, 12);
  assert.equal(preview.body.preview.summary.add, 1);
  assert.deepEqual(preview.body.preview.files, [{ name: "a.json", status: "ok", entries: 1 }]);
  assert.equal(writes.length, 0);
});

test("commit applies a mixed resolution in one write and keeps order", async () => {
  const local = [
    record({ id: "keep", title: "保留本地", body: "local", tags: [] }),
    record({ id: "swap", title: "替换我", body: "local body", tags: [], createdAt: 5, updatedAt: 6, lastUsedAt: 7 }),
    record({ id: "same", title: "一样", body: "same", tags: [] }),
  ];
  const { store, writes, call } = httpHarness(local, { revision: 3 });
  const document = {
    format: FORMAT_NAME,
    formatVersion: 1,
    items: [
      record({ id: "keep", title: "保留本地", body: "file body", tags: [] }),
      record({ id: "swap", title: "被替换", body: "file body", tags: ["x"], pinned: true, createdAt: 100, updatedAt: 200, lastUsedAt: null }),
      record({ id: "same", title: "一样", body: "same", tags: [] }),
      record({ id: "added", title: "新增", body: "added body", tags: [], createdAt: 300, updatedAt: 400, lastUsedAt: 500 }),
    ],
  };
  const files = [{ name: "a.json", text: JSON.stringify(document) }];
  const preview = await call("/import/preview", { files });
  assert.deepEqual(
    preview.body.preview.entries.map((entry) => `${entry.kind}:${entry.reason ?? ""}`),
    ["conflict:id", "conflict:id", "identical:", "add:"],
  );

  const commit = await call("/import/commit", { revision: 3, files, resolution: { "f0#1": "import" } });
  assert.equal(commit.status, 200);
  assert.deepEqual(
    { added: commit.body.added, replaced: commit.body.replaced, skipped: commit.body.skipped },
    { added: 1, replaced: 1, skipped: 2 },
  );
  assert.equal(commit.body.revision, 4);
  assert.deepEqual(commit.body.touched, [
    { at: "f0#1", id: "swap" },
    { at: "f0#3", id: "added" },
  ]);
  assert.equal(writes.length, 1, "one write for the whole batch");

  const items = store.snapshot().items;
  assert.deepEqual(
    items.map((item) => item.id),
    ["keep", "swap", "same", "added"],
    "replaced in place, added at the end",
  );
  const swapped = items[1];
  assert.equal(swapped.id, "swap", "local identity survives the import");
  assert.equal(swapped.title, "被替换");
  assert.equal(swapped.body, "file body");
  assert.deepEqual(swapped.tags, ["x"]);
  assert.equal(swapped.pinned, true);
  assert.equal(swapped.createdAt, 100, "file timestamps are authoritative");
  assert.equal(swapped.updatedAt, 200);
  assert.equal(swapped.lastUsedAt, null);
  assert.equal(items[0].body, "local", "conflict kept local is untouched");
  assert.equal(items[2].body, "same");
  assert.equal(items[3].createdAt, 300);
});

test("commit re-classifies against the current library and refuses a stale revision", async () => {
  const { store, writes, call } = httpHarness([], { revision: 0 });
  const text = serializeJsonExport([record({ id: "twice", title: "两次", body: "body", tags: [] })]);
  const first = await call("/import/commit", { revision: 0, files: [{ name: "a.json", text }] });
  assert.equal(first.status, 200);
  assert.equal(first.body.added, 1);

  // Same file again: the host never trusts a preview, so this is now identical.
  const second = await call("/import/commit", { revision: 1, files: [{ name: "a.json", text }] });
  assert.equal(second.status, 200);
  assert.deepEqual([second.body.added, second.body.replaced, second.body.skipped], [0, 0, 1]);
  assert.equal(store.snapshot().items.length, 1);

  const stale = await call("/import/commit", { revision: 1, files: [{ name: "a.json", text }] });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "revision-conflict");
  assert.equal(stale.body.revision, 2);
  assert.equal(writes.length, 2, "a refused commit writes nothing");
});

test("commit rejects malformed resolutions and revisions", async () => {
  const { store, writes, call } = httpHarness([], { revision: 0 });
  const text = serializeJsonExport([record({ id: "x", title: "x", body: "b", tags: [] })]);
  const files = [{ name: "a.json", text }];

  const noRevision = await call("/import/commit", { files });
  assert.equal(noRevision.status, 400);
  assert.equal(noRevision.body.error, "invalid-input");

  const badResolution = await call("/import/commit", { revision: 0, files, resolution: { "f0#0": "maybe" } });
  assert.equal(badResolution.status, 400);
  assert.equal(badResolution.body.error, "invalid-input");
  assert.equal(store.revision, 0);
  assert.equal(writes.length, 0);
});

test("import routes report 413 for batch ceilings and keep per-file verdicts", async () => {
  const { call } = httpHarness([], { revision: 0 });
  const tooMany = Array.from({ length: IMPORT_LIMITS.files + 1 }, (_, index) => ({ name: `f${index}.md`, text: "## t\n\nb\n" }));
  const tooManyFiles = await call("/import/preview", { files: tooMany });
  assert.equal(tooManyFiles.status, 413);
  assert.equal(tooManyFiles.body.error, "too-many-files");

  const entries = Array.from({ length: IMPORT_LIMITS.entries + 1 }, (_, index) => `## t${index}\n\nb\n`).join("\n");
  const tooManyEntries = await call("/import/preview", { files: [{ name: "many.md", text: entries }] });
  assert.equal(tooManyEntries.status, 413);
  assert.equal(tooManyEntries.body.error, "import-too-many");

  const tooNew = await call("/import/preview", {
    files: [
      { name: "future.json", text: JSON.stringify({ format: FORMAT_NAME, formatVersion: FORMAT_VERSION + 1, items: [] }) },
      { name: "good.json", text: serializeJsonExport([record({ id: "ok", title: "可用", body: "正文", tags: [] })]) },
    ],
  });
  assert.equal(tooNew.status, 200, "a too-new file is a per-file problem, not a batch refusal");
  assert.deepEqual(
    tooNew.body.preview.files.map((file) => [file.name, file.status, file.reason]),
    [
      ["future.json", "invalid", "format-too-new"],
      ["good.json", "ok", undefined],
    ],
  );
  assert.equal(tooNew.body.preview.summary.add, 1);
});

test("import bodies use the 32 MiB cap while other routes keep 256 KiB", async () => {
  const { call } = httpHarness([], { revision: 0 });
  const body = "x".repeat(8000);
  const text = Array.from({ length: 40 }, (_, index) => `## 大条目 ${index}\n\n${body}\n`).join("\n");
  assert.ok(Buffer.byteLength(JSON.stringify({ files: [{ name: "big.md", text }] })) > 256 * 1024);

  const preview = await call("/import/preview", { files: [{ name: "big.md", text }] });
  assert.equal(preview.status, 200, "import routes accept bodies over the 256 KiB route cap");
  assert.equal(preview.body.preview.summary.add, 40);

  const save = await call("/save", { revision: 0, template: { title: "t", body: "x".repeat(300 * 1024) } });
  assert.equal(save.status, 400);
  assert.equal(save.body.error, "invalid-input");
});
