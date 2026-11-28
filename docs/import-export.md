# Import / export contract

Goal: **lossless round trip**. Export a library, import it back, and every field
is byte-identical: title, body, tags (order and spelling), scope, pinned, order,
createdAt, updatedAt, lastUsedAt. Nothing is trimmed, truncated, rewritten, or
silently dropped.

Two producers exist: our own `json` and `md` output are lossless; a hand-written
plain Markdown file cannot be lossless because it carries no metadata, and that
is a property of the input, not a defect of the importer.

This file is the normative contract: `lib/format.js` implements it, `lib/index.js`
exposes it, and `test/import.test.js` checks it. Behaviour that disagrees with
this document is a bug.

## Storage model reference

Template: `{ id, title, body, tags[], scope, pinned, createdAt, updatedAt, lastUsedAt }`
Scope: `{ kind: "global" }` or `{ kind: "projects", paths: [absolute...] }`
Limits (`lib/store.js` LIMITS): id 64, title 60, body 20000, tag 20, tags 6, paths 20.

## 1. JSON export

`GET /dsh-prompt-template/export?format=json` — whole library, stored order.

```json
{
  "format": "dsh-prompt-templates",
  "formatVersion": 1,
  "exportedAt": "2026-11-28T15:04:05.123Z",
  "count": 9,
  "items": [
    { "id": "…", "title": "…", "body": "…", "tags": ["a"], "scope": { "kind": "global" },
      "pinned": false, "createdAt": 1764000000000, "updatedAt": 1764000000000, "lastUsedAt": null }
  ]
}
```

`items` is the complete stored array. A `formatVersion` greater than 1 marks only
that **file** invalid (`format-too-new`); the remaining files in the same batch are
still previewed and importable.

## 2. Markdown export

```
<!-- dsh-prompt-templates v1 | exported 2026-11-28T15:04:05.123Z | 9 templates -->

## 标题

<!-- dpt {"v":1,"id":"…","tags":["a"],"scope":{"kind":"global"},"pinned":false,"createdAt":1764000000000,"updatedAt":1764000000000,"lastUsedAt":null,"sha256":"…"} -->

````text
正文原样，含 ## 与 ``` 都不影响
````
```

- Fence: backtick, length = max(3, longest backtick run inside body + 1), info string `text`.
- Emission: `fence` + `\n` + body + `\n` + `fence` + `\n`. Structural newlines are
  always `\n`; the body itself is copied **byte for byte** — no EOL normalization,
  no BOM stripping, no trimming. A body that already ends with `\n` therefore
  gains one syntactic newline, which the parser removes exactly by joining the
  fence lines with `\n`.
- Consequence: because the parser splits the file on `\n` and keeps a `\r` that
  precedes it inside the line, a body with `\r\n`, mixed `a\r\nb\nc` or a leading
  `U+FEFF` comes back unchanged. There is no `eol` field; an `eol` key found in
  metadata is ignored.
- A file whose newlines are **all** `\r\n` (saved by an editor) is read in CRLF
  mode: one trailing `\r` per line is removed before parsing and restored as part
  of the joined body, so such a file still yields the intended text.
- `sha256` = lowercase hex SHA-256 of the exact body, computed after emission and
  before any import-side transformation; it is the lossless proof for that entry.
- `title` is present in metadata only when the heading line cannot carry it (the
  title contains `\n` or `\r`); the parser prefers `metadata.title` when present.
- Metadata JSON is a single line, no spaces after `:` or `,`, inside an HTML
  comment so it stays invisible when rendered.

Import of our Markdown: metadata + fenced body are authoritative. If `sha256`
does not match the body we recomputed (external tool rewrote the file), the entry
is still imported with the recomputed body and flagged `body-edited` in the
preview as a warning, never as a hard failure, and the preview shows that warning.

Robustness rules for a damaged file:

- An opening fence that never closes makes **that entry** invalid
  (`fence-unclosed`); later `## ` headings stay entries instead of being
  swallowed.
- A line that starts with `<!-- dpt` but does not parse as metadata makes that
  entry invalid (`metadata-invalid`) instead of being imported as body text.
- The file extension decides the format first (`.json` → JSON, `.md`/`.markdown`
  → Markdown); content sniffing applies only to unknown extensions.

## 3. Markdown import of a hand-written file

No metadata block, no fence: split at lines matching `^##[ \t]+(title)`.
Body = following lines up to the next such line or EOF, blank lines trimmed at
both ends. Each entry becomes `{ tags: [], scope: global, pinned: false,
createdAt/updatedAt: now, id: generated }`.
A file without any `## ` heading is one entry: first non-empty line is the title,
the rest is the body (a single-line file uses that line for both).
Content before the first `## ` that is not the header comment is ignored and
counted as `ignoredLeadingLines`.

## 4. Validation and limits

- ≤ 50 files, decoded text ≤ 8 MiB in total, ≤ 2000 candidate entries.
  Over → whole import refused: `too-many-files`, `import-too-large`,
  `import-too-many`. Never truncate.
- Every entry is validated with the same rules as `normalizeTemplate`
  (title/body/tags/scope limits, absolute scope paths).
- Invalid entries are listed with a stable reason code, never dropped silently.

## 5. Preview

`POST /dsh-prompt-template/import/preview`
Body: `{ "files": [{ "name": "a.json", "text": "…" }] }` (client already decoded
UTF-8; invalid UTF-8 is a client-side refusal for that file).

Response:

```json
{ "ok": true, "revision": 34,
  "preview": {
    "files": [{ "name": "a.json", "status": "ok", "entries": 3 },
              { "name": "b.json", "status": "invalid", "entries": 0, "reason": "format-too-new", "message": "…" }],
    "entries": [
      { "at": "f0#0", "file": "a.json", "kind": "add", "title": "…",
        "incoming": { "…": "…" }, "missingPaths": ["D:\\gone"] },
      { "at": "f0#1", "kind": "conflict", "title": "…", "incoming": {}, "local": {}, "reason": "id" },
      { "at": "f0#2", "kind": "identical", "title": "…" },
      { "at": "f0#3", "kind": "invalid", "title": "…", "reason": "body-invalid", "message": "…" }
    ],
    "summary": { "add": 8, "conflict": 3, "identical": 0, "invalid": 1, "missingPaths": 2, "total": 12 }
  } }
```

Classification, in this order:
1. `id` of the incoming item already stored → `identical` when content matches
   (title, body, tags in order, scope paths compared with `pathKey`, pinned), else
   `conflict` with `reason: "id"`.
2. Normalized title (`trim().toLowerCase()`) matches a stored item → same
   `identical` / `conflict` test, `reason: "title"`.
3. Otherwise `add`.

`missingPaths` lists incoming scope paths that are not directories on this host.
It is informational only: the scope is **never** rewritten.

Reason codes for `invalid`: `file-empty`, `bad-json`, `format-too-new`,
`metadata-invalid`, `fence-unclosed`, `title-invalid`, `body-invalid`,
`tags-invalid`, `scope-invalid`, `title-empty`, `body-empty`.

## 6. Commit

`POST /dsh-prompt-template/import/commit`

```json
{ "revision": 34, "files": [{ "name": "a.json", "text": "…" }],
  "resolution": { "f0#1": "import", "f0#2": "local" } }
```

- The host re-parses and re-classifies; the preview is never trusted.
- `revision` must equal the current revision, else `revision-conflict` (409).
- Missing `resolution` key means `local`. Other values → `invalid-input`.
- One write for the whole batch through the store's single mutation queue.
- `add`: appended in encounter order, keeping the file's id, timestamps and
  `lastUsedAt`.
- `conflict` + `import`: the matched local record is replaced **in place** (same
  index) and keeps its local `id`; title, body, tags, scope, pinned, createdAt,
  updatedAt and lastUsedAt all come from the file. Keeping the local id is the
  one deliberate exception — `id` is the local identity of that record, not its
  content.
- `conflict` + `local`, and every `identical`: untouched.
- Response: `{ ok: true, added, replaced, skipped, revision, touched: [{ at, id }] }`.

## 7. Export request details

- `GET /dsh-prompt-template/export?format=json|md` (default `json`) exports the
  whole library. A legacy `ids=a,b,c` query is still honoured for compatibility,
  but the client never sends it because long lists overflow the request line.
- `POST /dsh-prompt-template/export` with `{ "format": "md", "ids": ["…"] }`
  exports an ordered subset (used by Markdown export of the current filter). An
  unknown id → 400 `unknown-id`. Sending the ids in the body keeps the request
  line short for large libraries.
- Response `{ ok: true, format, filename, mime, content, count }` where
  `filename` = `dsh-prompt-templates-YYYYMMDD-HHmm.json|.md` (host local time).
- Export is a pure read: no mutation, no revision change, no persist call.
- JSON export is always the whole library; the client never narrows it.

## 8. HTTP surface

| Route | Method | Purpose |
| --- | --- | --- |
| `/export` | GET | whole library, in memory |
| `/export` | POST | ordered subset (`ids` in body), in memory |
| `/import/preview` | POST | parse + classify, no write |
| `/import/commit` | POST | one guarded write |

New status codes: `import-too-large` 413, `import-too-many` 413,
`too-many-files` 413, `unknown-id` 400. `format-too-new` is a per-file verdict,
not a batch failure: `/import/preview` answers 200 with
`preview.files[].status = "invalid"` for that one file while every other file in
the batch stays importable, and a single entry whose metadata is newer is
`invalid`/`format-too-new` instead of aborting the file.
Request body cap for `/import/preview`, `/import/commit` and `POST /export` is
32 MiB (absorbing JSON escaping of 8 MiB of text, and long `ids` lists); every
other route keeps 256 KiB.

## 9. Client

- Two text buttons in `.dpt-modal-head`, left of the close button: `导入` / `导出`.
- `导出` opens a menu: JSON (whole library, backup) and Markdown (current filter
  result; no filter = whole library). Download happens from a Blob built from the
  response `content`, file name from the response `filename`.
- `导入` opens a hidden multi-select file input (`.json .md .markdown .txt`),
  reads each file as `ArrayBuffer`, decodes with `TextDecoder("utf-8", { fatal: true })`,
  strips a leading BOM, and refuses only that file on decode failure. Files are
  picked **before** any draft is discarded: cancelling the file dialog leaves the
  editor untouched.
- Preview replaces the panel body (header and card size unchanged). Summary bar,
  three sections (add / conflict / invalid), footer with the totals plus cancel
  and the primary button `写入 N 条` where N = add + the conflicts resolved to
  `import`.
- An entry carrying `warning: "body-edited"` shows that warning on its row (both
  in the add and conflict sections) and in the footer totals; it is never silent,
  because its body was rewritten by an external tool.
- Markdown export of a filtered list sends the ids with `POST /export`; an
  unfiltered export uses `GET /export` and never puts ids in the URL.
- Conflict rows default to the local version, state it explicitly, offer a
  checkbox to use the imported version, two bulk buttons (`全部用导入版本`,
  `全部保留本地`), and an expandable read-only side-by-side comparison.
- A dirty editor draft must be confirmed with the existing discard guard before
  the preview replaces the body.
- Esc cancels the preview back to the list; the panel stays open after a write.
