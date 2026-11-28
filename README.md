# Prompt templates for DSH

[简体中文](README.zh-CN.md)

A DeepSeek Harness plugin that puts a **Prompts** button beside the conversation composer. Pick a saved prompt to insert its text at the caret, then edit it before sending.

## Features

- Create, edit and delete your own templates, including title, body and a single set of tags.
- Search titles, bodies and tags from a compact picker. Use ↑ / ↓, Enter and Escape.
- Make a template available globally or in several selected project directories.
- Filter the manager by checked tags, combined with text search.
- Pin templates and drag row handles to reorder them, with keyboard controls as an alternative.
- Reuse tags from the full library, add your own, and remove selected tag chips.
- Keep templates in Host-managed persistent storage, shared across that Host's sessions.
- Chinese and English interface; follows the DSH theme.
- Inserts plain text without sending the message. A successful insertion is one undo step.
- Export the library to JSON (full backup) or Markdown, and import either back without losing a field; conflicts are reviewed before anything is written.

Six editable Chinese engineering prompts are added to a fresh library: understand code and call chains, implement with minimal changes, diagnose root causes, review with evidence, add valuable tests, and verify before completion. Debugging, review and verification are pinned; all six use global scope. Existing libraries are preserved on upgrade, and deleting all templates leaves the library empty.

The prompts are original Chinese adaptations of engineering practices, informed by [Superpowers](https://github.com/obra/superpowers) (systematic debugging and verification) and [PGP](https://github.com/jgamblin/PGP) (review dimensions); they are not verbatim copies or bundled skills.

## Requirements

- DeepSeek Harness `>=0.2.3-alpha.2 <0.3.0-0`, with Web UI services enabled (including Desktop's Web UI).
- Node.js 20 or newer for source checks and tests. No build step or third-party runtime dependencies.

This version was developed against DSH `0.2.3-alpha.2`.

## Install

Install the published package from npm through DSH's plugin management page:

```text
@474968217/dsh-prompt-template
```

Plugin Manager resolves the latest published version, pins that exact version in the profile, and reports the activation result. To upgrade later, install a newer version the same way and follow the activation guidance.

To pin an immutable source instead, add this GitHub package with an **exact 40-character commit SHA** from this repository's commit history:

```text
github:474968217/dsh-prompt-template#<40-character-commit-SHA>
```

Replace the placeholder with a real commit SHA. A branch or tag is not an immutable installation reference.

For local development, install the checkout's absolute directory through Plugin Manager; DSH links that directory. After editing an installed package, re-enable its plugin row to recompose and reload it. Check the reported activation result.

## Use

1. Place the caret or select text in the composer, then click **Prompts**.
2. Search and choose a template. Enter inserts the selected result; Escape closes the picker. Nothing is sent automatically.
3. Open **Manage templates…** to create or edit templates, pin or reorder them, or delete them after confirmation.
4. For a project-specific template, choose **Selected projects** and select one or more directories. You can change this scope when editing.
5. Use **Export** in the manager header to save the library, and **Import** to read a previous export or a hand-written Markdown file.

The manager's left pane handles selection and ordering. Pin and delete actions belong to the current template's header on the right; deletion names the template, and Save/Cancel stay in a fixed footer. Narrow windows switch between library and editor views while protecting unsaved edits when going back.

Combine search with checked tags in the manager: a template must match the search text and any selected tag. Tag choices come from the full library, even while the list is filtered. In the editor, click an existing tag to reuse it or type new tags and press Enter or **Add tags**; commas separate new entries. Save also includes any pending tag text. Remove selected tags using their chips. Each template supports up to 6 tags of 20 characters each; surrounding whitespace and case-insensitive duplicates are removed.

Drag row handles to reorder, or focus a handle and press ↑ / ↓. When filtering, only visible positions change; hidden rows keep their positions.

Project matching uses the conversation's **exact working directory**, after path normalization. A template for `/work/app` does not automatically appear in `/work/app/subdir`. On Windows, path comparison is case-insensitive. The manager lets you manage templates from other projects as well; the picker only offers templates available in the current conversation.

Opening the picker captures the original insertion position. If the draft changes before selection, insertion is rejected instead of overwriting newer text. Reopen the picker to capture a fresh position. Selected composer text is replaced through the same undoable insertion action.

## Data and upgrades

Data stays with the DSH Host rather than the browser's local storage or this Git repository. Refreshing a page does not reset the library. Uninstalling the package does not intentionally erase the Host's template data. Project scope controls where templates are offered; it is not an access-control boundary between Host users.

To upgrade, choose the desired newer commit and update the GitHub installation reference through Plugin Manager. Keep the same package name and Host storage. If DSH rejects the declared compatibility range, use a compatible plugin release rather than bypassing the version check.

The tags-only model reads version 1 libraries without rewriting them or increasing their revision. Existing tags retain their order and spelling; a nonempty legacy category is appended as one tag, including any commas, then whitespace and case-insensitive duplicates are removed. The first successful normal mutation (save, delete, pin, reorder or recorded use) persists the canonical tags-only library in storage-domain version 2. Older version 1 readers reject that file, so retain a backup before downgrading. This conversion preserves user templates and does not restore deleted defaults.

## Import and export

**Export JSON** writes the whole library: every template's id, title, body, tags, scope, pinned flag, order and three timestamps. **Export Markdown** writes the manager's current filter result (everything when no filter is set) as readable Markdown. Each entry keeps a single HTML-comment metadata line and puts the body inside a backtick fence that is made longer than the longest fence inside the body, so a body containing `##`, triple backticks or CRLF still round-trips exactly.

Importing either format reproduces those fields unchanged. A Markdown file without that metadata line is treated as hand-written: `## ` starts a new template, the rest of the first line is the title, and the template becomes global with no tags and no pin, because the file never carried that information. If an external tool rewrote an exported file (trailing whitespace, line endings, re-indentation), the affected entry still imports as written and its preview row carries a visible “body edited outside the extension” warning instead of failing silently. The byte-level contract, including the sha256 check that proves a body was reproduced exactly, is documented in [the import/export contract](docs/import-export.md).

Import never writes before you confirm. The preview classifies every entry as new, conflicting or invalid and shows the counts plus the source file; conflicts match by id or by trimmed, lower-cased title. Conflicting rows keep the local version by default and offer the imported one per row, with bulk buttons for both. Commit sends the previewed files and your choices in one request: the Host re-parses, validates the revision guard and writes the whole batch through one storage transaction. Entries pointing at project directories this Host cannot see keep their paths and are reported instead of silently becoming global. A batch is limited to 50 files, 8 MiB of text and 2000 templates; exceeding a limit rejects the batch rather than truncating it.

## Development

```sh
npm run check
npm test
npm pack --dry-run
```

The Host entry is `lib/index.js`, the data model is `lib/store.js`, the import/export format is `lib/format.js`, and the Client entry is the hand-written `window.__ModuleLoader__` artifact in `lib/client.js`. React comes from the DSH module table. Never install a second React runtime into the page.

The composer contribution uses `conversation.input.left` with id `prompt-template-trigger`. Overlays are rendered through React portals so the sticky composer does not clip them. Plugin resources are disposed with their Cordis context.

See [the implementation plan](docs/plan.md) and [verification record](docs/verification.md). Files under `docs/mockup/` are design references, not screenshots of the installed implementation.

## Limitations

- No variable substitution, Markdown preview, slash trigger or global shortcut.
- Hand-written Markdown cannot restore metadata it never had; use a JSON or generated Markdown export when the round trip must be exact.
- One DSH Host process owns the data; multiple processes writing the same storage are unsupported.
- Project templates match exact directories, including separate worktrees as separate paths.
- Remote and custom file-system workspace behavior has not been verified.
- Installed visual layout, theme switching and the full management flow still require interactive acceptance when browser control is unavailable; consult the verification record for tested behavior.

## License

MIT © 2026 474968217
