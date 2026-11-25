# Prompt templates for DSH

[简体中文](README.zh-CN.md)

A DeepSeek Harness plugin that puts a **Prompts** button beside the conversation composer. Pick a saved prompt to insert its text at the caret, then edit it before sending.

## Features

- Create, edit and delete your own templates, including title, body, category and tags.
- Search titles, bodies and tags from a compact picker. Use ↑ / ↓, Enter and Escape.
- Make a template available globally or in several selected project directories.
- Filter the manager by checked categories and tags, combined with text search.
- Pin templates and drag row handles to reorder them, with keyboard controls as an alternative.
- Reuse existing categories and tags while retaining free-text entry.
- Keep templates in Host-managed persistent storage, shared across that Host's sessions.
- Chinese and English interface; follows the DSH theme.
- Inserts plain text without sending the message. A successful insertion is one undo step.

Six editable Chinese engineering prompts are added to a fresh library: understand code and call chains, implement with minimal changes, diagnose root causes, review with evidence, add valuable tests, and verify before completion. Debugging, review and verification are pinned; all six use global scope. Existing libraries are preserved on upgrade, and deleting all templates leaves the library empty.

The prompts are original Chinese adaptations of engineering practices, informed by [Superpowers](https://github.com/obra/superpowers) (systematic debugging and verification) and [PGP](https://github.com/jgamblin/PGP) (review dimensions); they are not verbatim copies or bundled skills.

## Requirements

- DeepSeek Harness `>=0.2.3-alpha.2 <0.3.0-0`, with Web UI services enabled (including Desktop's Web UI).
- Node.js 20 or newer for source checks and tests. No build step or third-party runtime dependencies.

This version was developed against DSH `0.2.3-alpha.2`.

## Install

Open DSH's plugin management page and add the GitHub package using an **exact 40-character commit SHA** from this repository's commit history:

```text
github:474968217/dsh-prompt-template#<40-character-commit-SHA>
```

Replace the placeholder with a real commit SHA. A branch or tag is not an immutable installation reference. Follow the activation guidance shown by Plugin Manager.

For local development, install the checkout's absolute directory through Plugin Manager; DSH links that directory. After editing an installed package, re-enable its plugin row to recompose and reload it. Check the reported activation result.

## Use

1. Place the caret or select text in the composer, then click **Prompts**.
2. Search and choose a template. Enter inserts the selected result; Escape closes the picker. Nothing is sent automatically.
3. Open **Manage templates…** to create or edit templates, pin or reorder them, or delete them after confirmation.
4. For a project-specific template, choose **Selected projects** and select one or more directories. You can change this scope when editing.

The manager's left pane handles selection and ordering. Pin and delete actions belong to the current template's header on the right; deletion names the template, and Save/Cancel stay in a fixed footer. Narrow windows switch between library and editor views while protecting unsaved edits when going back.

Combine search with checked categories and tags in the manager: selections within a group match any value; different groups must all match. Drag row handles to reorder, or focus a handle and press ↑ / ↓. When filtering, only visible positions change; hidden rows keep their positions. Click existing categories and tags in the editor to reuse them, or type new values.

Project matching uses the conversation's **exact working directory**, after path normalization. A template for `/work/app` does not automatically appear in `/work/app/subdir`. On Windows, path comparison is case-insensitive. The manager lets you manage templates from other projects as well; the picker only offers templates available in the current conversation.

Opening the picker captures the original insertion position. If the draft changes before selection, insertion is rejected instead of overwriting newer text. Reopen the picker to capture a fresh position. Selected composer text is replaced through the same undoable insertion action.

## Data and upgrades

Data stays with the DSH Host rather than the browser's local storage or this Git repository. Refreshing a page does not reset the library. Uninstalling the package does not intentionally erase the Host's template data. Project scope controls where templates are offered; it is not an access-control boundary between Host users.

To upgrade, choose the desired newer commit and update the GitHub installation reference through Plugin Manager. Keep the same package name and Host storage. If DSH rejects the declared compatibility range, use a compatible plugin release rather than bypassing the version check.

## Development

```sh
npm run check
npm test
npm pack --dry-run
```

The Host entry is `lib/index.js`, the data model is `lib/store.js`, and the Client entry is the hand-written `window.__ModuleLoader__` artifact in `lib/client.js`. React comes from the DSH module table. Never install a second React runtime into the page.

The composer contribution uses `conversation.input.left` with id `prompt-template-trigger`. Overlays are rendered through React portals so the sticky composer does not clip them. Plugin resources are disposed with their Cordis context.

See [the implementation plan](docs/plan.md) and [verification record](docs/verification.md). Files under `docs/mockup/` are design references, not screenshots of the installed implementation.

## Limitations

- No variable substitution, Markdown preview, import/export, slash trigger or global shortcut in v0.1.
- One DSH Host process owns the data; multiple processes writing the same storage are unsupported.
- Project templates match exact directories, including separate worktrees as separate paths.
- Remote and custom file-system workspace behavior has not been verified.
- Installed visual layout, theme switching and the full management flow still require interactive acceptance when browser control is unavailable; consult the verification record for tested behavior.

## License

MIT © 2026 474968217
