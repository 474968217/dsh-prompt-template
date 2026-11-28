/**
 * dsh-prompt-template — client half.
 *
 * Two surfaces, both mounted from the composer slot `conversation.input.left`:
 *
 *  1. the trigger (B1 text button, 76x28 / 84 min for English) opens a search
 *     popover grouped by 本项目 / 全局 and inserts the chosen template body at
 *     the caret as ONE undoable edit;
 *  2. the manage panel is a full-screen dialog of our own (list + editor), so
 *     the plugin never depends on a settings-page route that may not exist.
 *
 * Only baseline platform modules are required (`react`, `react-dom`); Harness
 * client packages are never required, which is what keeps a third-party slot
 * entry from being reported as crashed.
 *
 * The insertion contract: capture the caret BEFORE the popover takes focus,
 * then hand that span to `insertText` exactly once. `setDraft` is never used —
 * it would wipe reference chips and the user's existing draft.
 */

window.__ModuleLoader__.load({
	id: "dsh-prompt-template",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");
		let react_dom = require("react-dom");

		const h = react.createElement;

		/** Locale namespace and HTTP prefix owned by this bundle. */
		const NS = "dsh-prompt-template";
		const API_BASE = "/dsh-prompt-template";
		const STYLE_ID = "dpt-style";
		const POPOVER_WIDTH = 560;
		const POPOVER_MAX_HEIGHT = 600;
		const POPOVER_GAP = 8;

		// #region dictionaries
		const zh = {
			"meta.title": "提示词模板",
			"meta.description":
				"在输入框旁快捷选择常用提示词，插入光标位置，不自动发送。支持创建、修改、删除、搜索、置顶与调整顺序；每条模板可用于全局或指定的多个项目目录。模板由 DSH 宿主持久化并在会话间共享，项目范围与会话工作目录精确匹配。支持把模板库导出为 JSON 或 Markdown 并导入回来，写入前先预览冲突。支持中文和英文。",
			trigger: "提示词",
			triggerTitle: "插入提示词模板",
			searchPlaceholder: "搜索标题、正文或标签",
			groupProject: "本项目",
			groupGlobal: "全局",
			pinned: "置顶",
			emptyTitle: "还没有提示词模板",
			emptyHint: "把你反复要说的要求存成模板，下次一键插入。",
			emptySearch: "没有匹配的模板",
			loading: "正在读取模板…",
			loadFailed: "读取模板失败",
			retry: "重试",
			manage: "管理模板…",
			manageTitle: "提示词模板",
			manageSub: "模板库",
			newTemplate: "新建提示词",
			editTitleLabel: "编辑提示词",
			createTitleLabel: "新建提示词",
			save: "保存",
			saving: "保存中…",
			cancel: "取消",
			close: "关闭",
			edit: "编辑",
			remove: "删除",
			removeConfirm: "确认删除？",
			removeWarning: "删除后不可恢复。",
			back: "返回列表",
			pin: "置顶",
			unpin: "取消置顶",
			moveUp: "上移",
			moveDown: "下移",
			fieldTitle: "标题",
			titlePlaceholder: "例如：代码审查",
			fieldBody: "正文",
			bodyPlaceholder: "插入到输入框里的完整内容",
			fieldTags: "标签",
			tagsPlaceholder: "可选，用逗号分隔",
			fieldScope: "生效范围",
			scopeGlobal: "全局（所有项目）",
			scopeProject: "指定项目",
			scopeHint: "按会话所在工作目录匹配；不匹配的模板不会出现在悬浮列表里。",
			selectProjects: "选择项目（可多选）",
			selectedProjects: "已选 {n} 个项目",
			noProjects: "还没有已知项目路径，先选择一个会话，或保存为全局模板。",
			pinnedLabel: "在列表顶部置顶",
			fieldTitleRequired: "标题不能为空",
			fieldBodyRequired: "正文不能为空",
			insertFailed: "当前输入框不可插入文本",
			draftChanged: "草稿已变化，请重新打开后再插入",
			insertHint: "Enter 插入 · Esc 关闭",
			count: "{n} 条",
			scopeGlobalChip: "全局",
			scopeProjectChip: "{n} 个项目",
			unauthorized: "登录状态已失效，请刷新页面",
			saveFailed: "保存失败",
			deleteFailed: "删除失败",
			reorderFailed: "排序失败",
			dirtyHint: "有未保存的修改",
			discardAsk: "有未保存的修改，继续将丢弃它们。",
			continueEditing: "继续编辑",
			discardChanges: "放弃修改",
			manageEmpty: "没有匹配的模板",
			savedStatus: "已保存",
			selectHint: "从左侧选择一条模板开始编辑",
			allScope: "所有项目",
			updatedAt: "更新于 {time}",
			projectChipAdd: "添加项目",
			libraryHint: "选择模板编辑，或新建一条常用提示词。",
			editingNow: "正在编辑",
			newDraftHint: "保存后加入模板库",
			deleteTemplate: "删除“{title}”？",
			deleteDraftWarning: "这条模板及当前未保存的修改都将被删除。",
			bodyHint: "插入输入框的完整内容，不会自动发送。",
			organizeSection: "标签",
			scopeSection: "使用范围",
			selectedTemplate: "当前模板",
			impAction: "导入",
			impTitle: "导入预览",
			impSub: "确认后一次写入；确认前不改动模板库",
			impReading: "正在读取…",
			impSummaryFiles: "已读取 {files} 个文件 · {size}",
			impJumpAdd: "新增 {n}",
			impJumpConflict: "冲突 {n}",
			impJumpInvalid: "无效 {n}",
			impSecNew: "将新增",
			impSecConflict: "冲突",
			impSecInvalid: "无效",
			impSecNewNote: "写入后追加到列表末尾",
			impSecConflictNote: "默认保留本地版本，勾选后改用导入版本",
			impSecInvalidNote: "这些条目不会写入",
			impUseAll: "全部用导入版本",
			impKeepAll: "全部保留本地",
			impUseImported: "用导入版本",
			impCurrentLocal: "当前写入：本地版本",
			impCurrentImported: "当前写入：导入版本",
			impDiffFields: "与本地差异：{fields}",
			impDiffNone: "与本地一致",
			impExpand: "对照：{title}",
			impCollapse: "收起对照：{title}",
			impSideLocal: "本地版本",
			impSideImported: "导入版本",
			impLocalBody: "本地正文（只读）",
			impImportedBody: "导入正文（只读）",
			impFieldTitle: "标题",
			impFieldTags: "标签",
			impFieldScope: "范围",
			impBodyChars: "正文 {n} 字",
			impBodyEdited: "正文与校验值不一致，文件可能被外部编辑过。",
			impWarning: "文件带有校验警告，可能被外部编辑过。",
			impNoTags: "无标签",
			impUnknownPaths: "{n} 条路径本机不存在",
			impUntitled: "（无标题）",
			impWrite: "写入 {n} 条",
			impWriteWithOverwrite: "写入 {n} 条（含覆盖 {m}）",
			impWriting: "正在写入…",
			impSummaryBar: "将新增 {add} · 覆盖 {over} · 跳过 {skip}",
			impWarnCount: "其中 {n} 条带有校验警告",
			impEmptyTitle: "没有可导入的内容",
			impEmptyHint: "所选文件里没有可识别的模板，换一批文件再试。",
			impPickAgain: "重新选择文件",
			impFailures: "{n} 个文件未读取成功",
			impOverTitle: "超出导入上限",
			impOverFiles: "共 {n} 个文件，上限 {max} 个",
			impOverSize: "合计 {size}，上限 {limit}",
			impOverHint: "请分批导入，或先精简文件。",
			impWritten: "已导入 {n} 条",
			impWrittenOverwrite: "已导入 {n} 条，覆盖 {m} 条",
			impStale: "模板库在预览期间发生了变化，请刷新后重新确认",
			impRefresh: "刷新预览",
			expAction: "导出",
			expJson: "导出 JSON（全库备份）",
			expJsonHint: "含标签、范围与置顶，可完整回读",
			expMd: "导出 Markdown（当前筛选）",
			expMdHint: "仅标题与正文；无筛选时为全库",
			expLoading: "正在导出…",
			expDone: "已导出 {n} 条到 {file}",
			expEmpty: "模板库为空，暂无可导出的模板",
			expEmptyFilter: "当前筛选没有匹配的模板",
			impReasonDecode: "文件不是有效的 UTF-8 文本",
			impReasonEmpty: "空文件",
			impReasonBadJson: "不是有效的 JSON",
			impReasonVersion: "文件版本过高，请先升级插件",
			impReasonMetadata: "元数据不完整",
			impReasonTitle: "标题无效或为空",
			impReasonBody: "正文无效或为空",
			impReasonTags: "标签不符合要求",
			impReasonScope: "范围路径无效",
			impReasonTooManyFiles: "文件数量超过上限",
			impReasonTooLarge: "合计体积超过上限",
			impReasonTooMany: "候选条目超过上限",
			impReasonUnknown: "无法识别的错误",
		};

		const en = {
			"meta.title": "Prompt templates",
			"meta.description":
				"Choose a saved prompt beside the composer and insert it at the caret without sending it. Create, edit, search, pin and reorder templates; make each available globally or in selected project directories. Templates are stored by the DSH Host and shared across its sessions. Project matching uses the session's exact working directory. Export the library to JSON or Markdown and import it back after reviewing conflicts. Supports Chinese and English.",
			trigger: "Prompts",
			triggerTitle: "Insert a prompt template",
			searchPlaceholder: "Search title, body or tag",
			groupProject: "This project",
			groupGlobal: "Global",
			pinned: "Pinned",
			emptyTitle: "No prompt templates yet",
			emptyHint: "Save the instructions you keep retyping, then insert them in one click.",
			emptySearch: "No matching template",
			loading: "Loading templates…",
			loadFailed: "Could not load templates",
			retry: "Retry",
			manage: "Manage templates…",
			manageTitle: "Prompt templates",
			manageSub: "Library",
			newTemplate: "New prompt",
			editTitleLabel: "Edit prompt",
			createTitleLabel: "New prompt",
			save: "Save",
			saving: "Saving…",
			cancel: "Cancel",
			close: "Close",
			edit: "Edit",
			remove: "Delete",
			removeConfirm: "Delete?",
			removeWarning: "This cannot be undone.",
			back: "Back to list",
			pin: "Pin",
			unpin: "Unpin",
			moveUp: "Move up",
			moveDown: "Move down",
			fieldTitle: "Title",
			titlePlaceholder: "e.g. Code review",
			fieldBody: "Body",
			bodyPlaceholder: "The exact text inserted into the composer",
			fieldTags: "Tags",
			tagsPlaceholder: "Optional, comma separated",
			fieldScope: "Scope",
			scopeGlobal: "Global (all projects)",
			scopeProject: "Selected projects",
			scopeHint: "Matched against the session working directory; templates that do not match stay hidden.",
			selectProjects: "Choose projects (multiple allowed)",
			selectedProjects: "{n} projects selected",
			noProjects: "No known project paths yet. Pick a session first, or save a global template.",
			pinnedLabel: "Pin to the top of the list",
			fieldTitleRequired: "Title is required",
			fieldBodyRequired: "Body is required",
			insertFailed: "This composer cannot take inserted text",
			draftChanged: "The draft changed, reopen the picker before inserting",
			insertHint: "Enter insert · Esc close",
			count: "{n}",
			scopeGlobalChip: "Global",
			scopeProjectChip: "{n} projects",
			unauthorized: "Your session expired. Reload the page.",
			saveFailed: "Could not save",
			deleteFailed: "Could not delete",
			reorderFailed: "Could not reorder",
			dirtyHint: "Unsaved changes",
			discardAsk: "You have unsaved changes. Continuing discards them.",
			continueEditing: "Keep editing",
			discardChanges: "Discard changes",
			manageEmpty: "No matching templates",
			savedStatus: "Saved",
			selectHint: "Pick a template on the left to edit it",
			allScope: "All projects",
			updatedAt: "Updated {time}",
			projectChipAdd: "Add project",
			libraryHint: "Choose a template to edit, or create a reusable prompt.",
			editingNow: "Editing template",
			newDraftHint: "Save to add this prompt to your library",
			deleteTemplate: "Delete “{title}”?",
			deleteDraftWarning: "This template and its unsaved changes will be deleted.",
			bodyHint: "The full text inserted into the composer. Nothing is sent automatically.",
			organizeSection: "Tags",
			scopeSection: "Availability",
			selectedTemplate: "Current template",
			impAction: "Import",
			impTitle: "Import preview",
			impSub: "Written once on confirm; the library is untouched until then",
			impReading: "Reading…",
			impSummaryFiles: "{files} files read · {size}",
			impJumpAdd: "Add {n}",
			impJumpConflict: "Conflict {n}",
			impJumpInvalid: "Invalid {n}",
			impSecNew: "Will be added",
			impSecConflict: "Conflicts",
			impSecInvalid: "Invalid",
			impSecNewNote: "Appended to the end of the library",
			impSecConflictNote: "Local is kept unless you tick the imported version",
			impSecInvalidNote: "These entries are not written",
			impUseAll: "Use imported for all",
			impKeepAll: "Keep local for all",
			impUseImported: "Use imported version",
			impCurrentLocal: "Writing: local version",
			impCurrentImported: "Writing: imported version",
			impDiffFields: "Differs from local: {fields}",
			impDiffNone: "No differences from local",
			impExpand: "Compare: {title}",
			impCollapse: "Collapse comparison: {title}",
			impSideLocal: "Local",
			impSideImported: "Imported",
			impLocalBody: "Local body (read-only)",
			impImportedBody: "Imported body (read-only)",
			impFieldTitle: "Title",
			impFieldTags: "Tags",
			impFieldScope: "Scope",
			impBodyChars: "{n} body characters",
			impBodyEdited: "The body no longer matches its checksum; the file may have been edited externally.",
			impWarning: "This file carries a checksum warning and may have been edited externally.",
			impNoTags: "No tags",
			impUnknownPaths: "{n} paths not on this machine",
			impUntitled: "(untitled)",
			impWrite: "Import {n}",
			impWriteWithOverwrite: "Import {n} (overwrites {m})",
			impWriting: "Writing…",
			impSummaryBar: "Add {add} · overwrite {over} · skip {skip}",
			impWarnCount: "{n} entries carry a checksum warning",
			impEmptyTitle: "Nothing to import",
			impEmptyHint: "No recognisable templates in these files. Try another batch.",
			impPickAgain: "Choose files again",
			impFailures: "{n} files could not be read",
			impOverTitle: "Over the import limit",
			impOverFiles: "{n} files, limit {max}",
			impOverSize: "{size} total, limit {limit}",
			impOverHint: "Import in batches, or trim the files first.",
			impWritten: "Imported {n}",
			impWrittenOverwrite: "Imported {n}, overwrote {m}",
			impStale: "The library changed during the preview. Refresh, then confirm again.",
			impRefresh: "Refresh preview",
			expAction: "Export",
			expJson: "Export JSON (full backup)",
			expJsonHint: "Tags, scope and pin included; round-trips intact",
			expMd: "Export Markdown (current filter)",
			expMdHint: "Title and body only; the whole library when unfiltered",
			expLoading: "Exporting…",
			expDone: "Exported {n} to {file}",
			expEmpty: "The library is empty",
			expEmptyFilter: "Nothing matches the current filter",
			impReasonDecode: "Not valid UTF-8 text",
			impReasonEmpty: "Empty file",
			impReasonBadJson: "Not valid JSON",
			impReasonVersion: "File version is too new; upgrade the plugin first",
			impReasonMetadata: "Incomplete metadata",
			impReasonTitle: "Title is invalid or empty",
			impReasonBody: "Body is invalid or empty",
			impReasonTags: "Tags do not meet the rules",
			impReasonScope: "Invalid scope path",
			impReasonTooManyFiles: "Too many files",
			impReasonTooLarge: "Total size is over the limit",
			impReasonTooMany: "Too many candidate entries",
			impReasonUnknown: "Unrecognised error",
		};

		/** @type {any} */
		let localeService = null;

		/**
		 * Build a translator for one language.
		 * @param {string} lang
		 * @returns {(key: string, vars?: Record<string, unknown>) => string}
		 */
		function makeT(lang) {
			const table = DICT[lang] ?? zh;
			return (key, vars) => {
				const raw = table[key] ?? zh[key] ?? key;
				if (vars === undefined) return raw;
				return raw.replace(/\{(\w+)\}/g, (match, name) =>
					vars[name] === undefined ? match : String(vars[name])
				);
			};
		}

		const DICT = { zh, en };

		/** Field limits; lib/store.js validates the same numbers on the host. */
		const LIMITS = Object.freeze({ title: 60, body: 20000, tag: 20, tags: 6, paths: 20 });

		Object.assign(zh, {
			titleTooLong: "标题最多 {n} 个字符",
			bodyTooLong: "正文最多 {n} 个字符",
			tooManyTags: "最多 {n} 个标签",
			tagTooLong: "单个标签最多 {n} 个字符",
			scopeRequired: "请至少选择一个项目，或改为全局",
			conflictKeep: "列表已被其他会话修改，请刷新后再试",
			refresh: "刷新",
			notFound: "模板已不存在，列表已刷新",
			invalidInput: "内容不符合要求，请检查后重试",
			invalidOrder: "顺序已过期，列表已刷新",
			storageUnavailable: "存储暂不可用，请稍后重试",
			forbiddenOrigin: "来源校验失败，请刷新页面后重试",
			requestFailed: "请求失败，请重试",
			tooManyProjects: "最多选择 {n} 个项目",
			filters: "筛选",
			clearFilters: "清除筛选",
			filterCount: "{visible} / {total} 条",
			filterHint: "匹配任一已选标签，并同时匹配搜索内容",
			noChoices: "还没有标签",
			existingChoices: "模板库标签，点击复用",
			tagChoicesHint: "最多 {n} 个标签；可从模板库选择或添加新标签",
			addTags: "添加标签",
			removeTag: "移除标签“{tag}”",
			tagInputLabel: "新增标签",
			tagInputHint: "输入后按 Enter 或点击添加；逗号可一次添加多个。",
			dragOrder: "拖动排序",
			reorderHint: "拖动行首手柄调整顺序",
			orderSaved: "顺序已保存",
			reorderSaving: "正在保存顺序…",
			filterEmpty: "没有符合搜索或筛选条件的模板",
		});

		Object.assign(en, {
			titleTooLong: "Title must be at most {n} characters",
			bodyTooLong: "Body must be at most {n} characters",
			tooManyTags: "At most {n} tags",
			tagTooLong: "Each tag must be at most {n} characters",
			scopeRequired: "Pick at least one project, or switch to Global",
			conflictKeep: "This list changed in another session. Refresh, then try again.",
			refresh: "Refresh",
			notFound: "That template no longer exists. The list was refreshed.",
			invalidInput: "Some fields are not acceptable. Check them and retry.",
			invalidOrder: "The order was stale. The list was refreshed.",
			storageUnavailable: "Storage is unavailable right now. Try again shortly.",
			forbiddenOrigin: "Origin check failed. Reload the page and retry.",
			requestFailed: "The request failed. Try again.",
			tooManyProjects: "At most {n} projects",
			filters: "Filters",
			clearFilters: "Clear filters",
			filterCount: "{visible} / {total}",
			filterHint: "Match any selected tag and the search text",
			noChoices: "No tags yet",
			existingChoices: "Library tags · choose to reuse",
			tagChoicesHint: "Up to {n} tags · reuse a library tag or add your own",
			addTags: "Add tags",
			removeTag: "Remove tag “{tag}”",
			tagInputLabel: "New tags",
			tagInputHint: "Press Enter or Add; use commas to add several tags.",
			dragOrder: "Drag to reorder",
			reorderHint: "Drag a row handle to reorder",
			orderSaved: "Order saved",
			reorderSaving: "Saving order…",
			filterEmpty: "No templates match this search or filter",
		});

		/** Active language id, tolerant of a host without the locale service. */
		function currentLanguage() {
			try {
				const active = localeService?.getSnapshot?.().active;
				if (typeof active === "string" && active.toLowerCase().startsWith("en")) return "en";
			} catch {
				/* fall through to the default */
			}
			return "zh";
		}

		/** Stable subscribe callback for useSyncExternalStore. */
		function subscribeLocale(onChange) {
			try {
				if (typeof localeService?.subscribe === "function") return localeService.subscribe(onChange);
			} catch {
				/* a host without subscription just keeps the initial language */
			}
			return () => {};
		}

		/** Re-render on language change. */
		function useLanguage() {
			return react.useSyncExternalStore(subscribeLocale, currentLanguage, () => "zh");
		}
		// #endregion

		// #region http
		class ApiError extends Error {
			/**
			 * @param {string} code
			 * @param {number} [status]
			 * @param {number} [revision] the host's current revision on a conflict
			 */
			constructor(code, status, revision) {
				super(code);
				this.name = "ApiError";
				this.code = code;
				this.status = status;
				this.revision = typeof revision === "number" ? revision : undefined;
			}
		}

		/**
		 * @param {string} path
		 * @param {RequestInit} [init]
		 */
		async function request(path, init) {
			const res = await fetch(API_BASE + path, {
				credentials: "same-origin",
				cache: "no-store",
				...init,
			});
			/** @type {any} */
			let body = null;
			try {
				body = await res.json();
			} catch {
				body = null;
			}
			if (res.status === 401) throw new ApiError("unauthorized", res.status);
			// Every host failure is `{ ok: false, error, revision? }`; anything that
			// is not an explicit success must not be mistaken for data, so the body
			// is trusted only when `ok === true`.
			if (body === null || body.ok !== true) {
				const code = typeof body?.error === "string" ? body.error : "request_failed";
				const revision = typeof body?.revision === "number" ? body.revision : undefined;
				throw new ApiError(code, res.status, revision);
			}
			return body;
		}

		/**
		 * @param {unknown} value
		 * @param {string} [query]
		 */
		function postJson(path, value) {
			return request(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(value),
			});
		}

		const api = {
			/**
			 * @param {string} sessionId
			 * @param {boolean} all
			 */
			list(sessionId, all) {
				const params = new URLSearchParams();
				if (sessionId) params.set("sessionId", sessionId);
				if (all) params.set("all", "1");
				return request("/list?" + params.toString());
			},
			/**
			 * Saves are revision-guarded: the host answers 409 (`revision-conflict`)
			 * instead of silently overwriting a list that changed since load.
			 * @param {Record<string, unknown>} template
			 * @param {number|null} revision
			 * @param {string} sessionId
			 */
			save(template, revision, sessionId) {
				return postJson("/save", { template, revision, sessionId });
			},
			/** @param {string} id @param {number|null} revision @param {string} sessionId */
			remove(id, revision, sessionId) {
				return postJson("/delete", { id, revision, sessionId });
			},
			/**
			 * Records a use. The host deliberately does not guard this by revision:
			 * a stale list must never block an insertion already performed.
			 * @param {string} id
			 * @param {string} sessionId
			 */
			touch(id, sessionId) {
				return postJson("/touch", { id, sessionId });
			},
			/**
			 * `ids` must be exactly every stored id, in the wanted order.
			 * @param {string[]} ids
			 * @param {number|null} revision
			 * @param {string} sessionId
			 */
			reorder(ids, revision, sessionId) {
				return postJson("/reorder", { ids, revision, sessionId });
			},
			/**
			 * Builds the file in memory; nothing is downloaded by the host.
			 * `ids` is an ordered subset (Markdown of the current filter) — the JSON
			 * export is always the whole library, so it never passes ids.
			 * @param {string} format
			 * @param {string[]|null} ids
			 */
			exportFile(format, ids) {
				const req = exportRequest(format, ids);
				return req.method === "POST" ? postJson(req.path, req.body) : request(req.path);
			},
			/** Parse + classify, no write. The client sends already-decoded text. */
			importPreview(files) {
				return postJson("/import/preview", { files });
			},
			/**
			 * One guarded write for the whole batch; `revision` must match the host
			 * or the request answers 409 `revision-conflict`.
			 * @param {{name: string, text: string}[]} files
			 * @param {number|null} revision
			 * @param {Record<string, string>} resolution
			 */
			importCommit(files, revision, resolution) {
				return postJson("/import/commit", { files, revision, resolution });
			},
		};
		// #endregion

		// #region helpers
		/** @param {Record<string, unknown>} item */
		function scopeKind(item) {
			return item?.scope?.kind === "projects" ? "projects" : "global";
		}

		/** @param {Record<string, unknown>} item */
		function scopePaths(item) {
			const paths = item?.scope?.paths;
			return Array.isArray(paths) ? paths.filter((value) => typeof value === "string" && value !== "") : [];
		}

		/**
		 * @param {Record<string, unknown>} item
		 * @param {string} workspace
		 */
		function matchesWorkspace(item, workspace) {
			if (scopeKind(item) === "global") return true;
			if (typeof workspace !== "string" || workspace.trim() === "") return false;
			const key = pathKey(workspace);
			return scopePaths(item).some((path) => pathKey(path) === key);
		}

		/**
		 * Path comparison key, matching lib/store.js: separators unified, trailing
		 * ones dropped, and folded to lower case on Windows.
		 * @param {string} value
		 */
		function pathKey(value) {
			let key = String(value).trim().replace(/[\\/]+/g, "/").replace(/\/+$/, "");
			if (/windows/i.test(navigator.userAgent)) key = key.toLowerCase();
			return key;
		}

		/**
		 * @param {Record<string, unknown>[]} items
		 * @param {string} query
		 */
		function filterTemplates(items, query) {
			const needle = query.trim().toLowerCase();
			if (needle === "") return items;
			return items.filter((item) => {
				const haystack = [
					item.title,
					item.body,
					...templateTags(item),
				]
					.filter((part) => typeof part === "string")
					.join("\n")
					.toLowerCase();
				return haystack.includes(needle);
			});
		}

		/** Read legacy categories as one atomic tag; canonical records only contain tags. */
		function templateTags(item) {
			return parseTags([...(Array.isArray(item?.tags) ? item.tags : []), item?.category]);
		}

		/** Existing values always come from the full library, in first-use order. */
		function collectTemplateChoices(items) {
			return { tags: parseTags(items.flatMap(templateTags)) };
		}

		/** Any selected tag may match; the text query must also match. */
		function filterManageTemplates(items, query, tags = []) {
			const selected = parseTags(tags).map((tag) => tag.toLowerCase());
			return filterTemplates(items, query).filter((item) =>
				selected.length === 0 || templateTags(item).some((tag) => selected.includes(tag.toLowerCase()))
			);
		}

		/** Replace only visible slots; hidden rows never move. Invalid/stale input is a no-op. */
		function reorderVisibleIds(items, visibleIds, sourceId, targetId, position = "before") {
			const ids = items.map((item) => item.id);
			const visible = new Set(visibleIds);
			if (new Set(ids).size !== ids.length || visible.size !== visibleIds.length ||
				!sameList(ids.filter((id) => visible.has(id)), visibleIds) ||
				!visible.has(sourceId) || !visible.has(targetId) || sourceId === targetId ||
				(position !== "before" && position !== "after")) return ids;
			const next = visibleIds.filter((id) => id !== sourceId);
			next.splice(next.indexOf(targetId) + (position === "after" ? 1 : 0), 0, sourceId);
			let index = 0;
			return ids.map((id) => visible.has(id) ? next[index++] : id);
		}

		function moveVisibleIds(items, visibleIds, id, delta) {
			const index = visibleIds.indexOf(id);
			if ((delta !== -1 && delta !== 1) || index < 0 || index + delta < 0 || index + delta >= visibleIds.length) {
				return items.map((item) => item.id);
			}
			return reorderVisibleIds(items, visibleIds, id, visibleIds[index + delta], delta < 0 ? "before" : "after");
		}

		/** Toggle an atomic tag without duplicates or exceeding the stored limit. */
		function toggleTagChoice(value, tag, limit = LIMITS.tags) {
			const current = parseTags(value);
			const choice = String(tag ?? "").trim();
			const key = choice.toLowerCase();
			if (current.some((entry) => entry.toLowerCase() === key)) return current.filter((entry) => entry.toLowerCase() !== key);
			if (choice === "" || choice.length > LIMITS.tag || current.length >= limit) return current;
			return [...current, choice];
		}

		/**
		 * @param {Record<string, unknown>[]} items
		 * @param {string} query
		 * @param {string} workspace
		 */
		function groupTemplates(items, query, workspace) {
			const matched = filterTemplates(items, query);
			const project = [];
			const global = [];
			for (const item of matched) {
				if (scopeKind(item) === "global") global.push(item);
				else if (matchesWorkspace(item, workspace)) project.push(item);
			}
			return { project: sortTemplates(project), global: sortTemplates(global) };
		}

		/**
		 * Pinned templates float to the top of the picker; everything else keeps
		 * the stored order the user arranged by hand in the manage panel.
		 * Recency is deliberately ignored here — sorting by `lastUsedAt` would
		 * silently override that manual order.
		 * @param {Record<string, unknown>[]} items
		 */
		function sortTemplates(items) {
			const pinned = items.filter((item) => Boolean(item.pinned));
			const rest = items.filter((item) => !item.pinned);
			return [...pinned, ...rest];
		}

		/** @param {Record<string, unknown>} item */
		function toDraft(item) {
			const paths = scopePaths(item);
			return {
				id: typeof item?.id === "string" ? item.id : null,
				title: typeof item?.title === "string" ? item.title : "",
				body: typeof item?.body === "string" ? item.body : "",
				tags: templateTags(item),
				tagInput: "",
				scopeKind: scopeKind(item),
				paths,
				pinned: Boolean(item?.pinned),
			};
		}

		/** Keep a selected editor in sync with a row pin action without losing other edits. */
		function syncDraftPin(draft, item, previous) {
			if (draft === null || draft.id !== item.id || previous?.id !== item.id || draft.pinned !== previous.pinned) return draft;
			return { ...draft, pinned: Boolean(item.pinned) };
		}

		/** Arrays preserve atomic legacy values; new text accepts comma separators. */
		function parseTags(value) {
			const source = Array.isArray(value) ? value : String(value ?? "").split(/[,，]/);
			const seen = new Set();
			return source.filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter((tag) => {
				const key = tag.toLowerCase();
				if (tag === "" || seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		}

		/** Consume matching pending text when a visible tag is toggled, so removal stays removed. */
		function toggleDraftTag(draft, tag) {
			const key = String(tag).trim().toLowerCase();
			return {
				tags: toggleTagChoice(draft.tags, tag),
				tagInput: parseTags(draft.tagInput).filter((entry) => entry.toLowerCase() !== key).join(", "),
			};
		}

		/** Include pending text on save so a typed tag is never silently dropped. */
		function draftTags(draft) {
			return parseTags([...parseTags(draft.tags), ...parseTags(draft.tagInput)]);
		}

		/**
		 * Draft → host payload. Faithful on purpose: an empty project selection
		 * stays empty and is rejected by `draftErrors`, never silently rewritten
		 * into a global template.
		 * @param {Record<string, unknown>} draft
		 */
		function fromDraft(draft) {
			const paths = Array.isArray(draft.paths)
				? draft.paths.filter((path) => typeof path === "string" && path !== "")
				: [];
			return {
				...(typeof draft.id === "string" ? { id: draft.id } : {}),
				title: String(draft.title ?? "").trim(),
				body: String(draft.body ?? ""),
				tags: draftTags(draft),
				scope: draft.scopeKind === "projects" ? { kind: "projects", paths } : { kind: "global", paths: [] },
				pinned: Boolean(draft.pinned),
			};
		}

		/**
		 * Every reason this draft cannot be saved, as stable codes the editor
		 * translates. Mirrors lib/store.js so the UI explains itself before a
		 * round trip instead of surfacing a bare 400.
		 * @param {Record<string, unknown>} draft
		 * @returns {string[]}
		 */
		function draftErrors(draft) {
			const errors = [];
			const title = String(draft.title ?? "").trim();
			if (title === "") errors.push("titleRequired");
			else if (title.length > LIMITS.title) errors.push("titleTooLong");
			const body = String(draft.body ?? "");
			if (body.trim() === "") errors.push("bodyRequired");
			else if (body.length > LIMITS.body) errors.push("bodyTooLong");
			const tags = draftTags(draft);
			if (tags.length > LIMITS.tags) errors.push("tooManyTags");
			if (tags.some((tag) => tag.length > LIMITS.tag)) errors.push("tagTooLong");
			if (draft.scopeKind === "projects") {
				const paths = Array.isArray(draft.paths) ? draft.paths.filter(Boolean) : [];
				if (paths.length === 0) errors.push("scopeRequired");
				else if (paths.length > LIMITS.paths) errors.push("tooManyProjects");
			}
			return errors;
		}

		/** @param {Record<string, unknown>} draft */
		function draftIsValid(draft) {
			return draftErrors(draft).length === 0;
		}

		/**
		 * @param {string[]} a
		 * @param {string[]} b
		 */
		function sameList(a, b) {
			if (a.length !== b.length) return false;
			return a.every((value, index) => value === b[index]);
		}

		/** Short display name for a workspace root (its last path segment). */
		function shortPath(value) {
			const parts = String(value).split(/[\\/]/).filter((part) => part !== "");
			if (parts.length === 0) return String(value);
			return parts[parts.length - 1];
		}
		// #endregion

		// #region import / export helpers
		/** Ceilings from the frozen contract (docs/design/import-export-spec.md §4). */
		const IMPORT_LIMITS = Object.freeze({ files: 50, bytes: 8 * 1024 * 1024 });

		/**
		 * Strict UTF-8 for one picked file. A leading BOM is stripped; invalid bytes
		 * refuse only this file, never the whole batch.
		 * @param {ArrayBuffer|Uint8Array} buffer
		 * @returns {{ok: true, text: string} | {ok: false, reason: string}}
		 */
		function decodeUtf8(buffer) {
			try {
				const decoder = new TextDecoder("utf-8", { fatal: true });
				const text = decoder.decode(buffer);
				return { ok: true, text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text };
			} catch {
				return { ok: false, reason: "decode" };
			}
		}

		/**
		 * Local pre-check before any byte is read. Over the limit the whole batch is
		 * refused — never truncated — and the numbers are shown to the user.
		 * @param {{name?: string, size?: number}[]} files
		 */
		function precheckImportFiles(files) {
			const list = Array.isArray(files) ? files : [];
			const totalBytes = list.reduce((sum, file) => sum + (Number(file?.size) || 0), 0);
			return {
				count: list.length,
				totalBytes,
				tooManyFiles: list.length > IMPORT_LIMITS.files,
				tooLarge: totalBytes > IMPORT_LIMITS.bytes,
			};
		}

		/**
		 * What starting an import does to the editor. The file dialog always runs
		 * first, so an empty pick (the dialog was cancelled) is `none`: the draft,
		 * the selection and the view all stay exactly as they were. Only files that
		 * really were picked may reset the selected row or drop a new draft.
		 * @param {any[]|null|undefined} picked
		 * @param {{selectedId?: string|null, draft?: unknown}} [editor]
		 * @returns {{action: "none"} | {action: "select", id: string} | {action: "back"}}
		 */
		function importPickTransition(picked, editor) {
			const count = Array.isArray(picked) ? picked.length : 0;
			if (count === 0) return { action: "none" };
			const selectedId = typeof editor?.selectedId === "string" ? editor.selectedId : null;
			if (selectedId !== null) return { action: "select", id: selectedId };
			// A new (unsaved) template has no row to fall back to; going "back"
			// clears it, which is exactly what the discard confirmation promised.
			const draft = editor?.draft;
			return draft === null || draft === undefined ? { action: "none" } : { action: "back" };
		}

		/** A conflict is written from the local record unless "import" was chosen. */
		function importResolution(resolutions, at) {
			return resolutions !== null && typeof resolutions === "object" && resolutions[at] === "import" ? "import" : "local";
		}

		/**
		 * Resolution map for every conflict of a batch.
		 * @param {any[]} entries
		 * @param {string} value
		 */
		function importResolutions(entries, value) {
			const out = {};
			for (const entry of Array.isArray(entries) ? entries : []) {
				if (entry?.kind === "conflict" && typeof entry.at === "string") out[entry.at] = value === "import" ? "import" : "local";
			}
			return out;
		}

		/** Preview defaults: every conflict keeps the local version. */
		function defaultImportResolutions(entries) {
			return importResolutions(entries, "local");
		}

		/**
		 * Host warning codes that must be visible on the preview. `body-edited`
		 * means the sha256 in the file metadata no longer matches its body: the
		 * entry is still imported, but the user has to see that it was rewritten
		 * outside the plugin.
		 */
		const IMPORT_WARNING_KEYS = Object.freeze({ "body-edited": "impBodyEdited" });

		/**
		 * Dictionary key for an entry's warning, or null when it carries none — a
		 * warning-free row must render no placeholder at all.
		 * @param {any} entry
		 * @returns {string|null}
		 */
		function importWarningKey(entry) {
			const code = typeof entry?.warning === "string" ? entry.warning : "";
			if (code === "") return null;
			// An unknown future code is still surfaced instead of silently dropped.
			return IMPORT_WARNING_KEYS[code] ?? "impWarning";
		}

		/**
		 * Totals for the summary bar and the primary button. `overwrite` counts the
		 * conflicts switched to the imported version, `skip` the identical rows plus
		 * the conflicts left local, and `write` is what the button promises.
		 * @param {any[]} entries
		 * @param {Record<string, string>} [resolutions]
		 */
		function importSummary(entries, resolutions) {
			const list = Array.isArray(entries) ? entries : [];
			const summary = { add: 0, conflict: 0, identical: 0, invalid: 0, missingPaths: 0, overwrite: 0, keptLocal: 0, warnings: 0 };
			for (const entry of list) {
				if (entry?.kind === "add") summary.add++;
				else if (entry?.kind === "conflict") {
					summary.conflict++;
					if (importResolution(resolutions, entry.at) === "import") summary.overwrite++;
					else summary.keptLocal++;
				} else if (entry?.kind === "identical") summary.identical++;
				else if (entry?.kind === "invalid") summary.invalid++;
				if (Array.isArray(entry?.missingPaths)) summary.missingPaths += entry.missingPaths.length;
				// Only written rows (new or overwritten) can carry the warning into the
				// library, so only those are counted for the footer.
				if ((entry?.kind === "add" || entry?.kind === "conflict") && importWarningKey(entry) !== null) summary.warnings++;
			}
			return {
				...summary,
				total: list.length,
				skip: summary.identical + summary.keptLocal,
				write: summary.add + summary.overwrite,
			};
		}

		/**
		 * The `resolution` map sent on commit. The host treats a missing key as
		 * "local", but every conflict is spelled out so the request is self-describing.
		 * @param {any[]} entries
		 * @param {Record<string, string>} [resolutions]
		 */
		function importResolutionMap(entries, resolutions) {
			const out = {};
			for (const entry of Array.isArray(entries) ? entries : []) {
				if (entry?.kind === "conflict" && typeof entry.at === "string") out[entry.at] = importResolution(resolutions, entry.at);
			}
			return out;
		}

		/** Field-level differences between the stored and the incoming record. */
		function importDiffFields(local, incoming) {
			const fields = [];
			if (String(local?.title ?? "") !== String(incoming?.title ?? "")) fields.push("title");
			if (String(local?.body ?? "") !== String(incoming?.body ?? "")) fields.push("body");
			if (!sameList(parseTags(local?.tags), parseTags(incoming?.tags))) fields.push("tags");
			const scopeKey = (item) =>
				scopeKind(item) === "projects" ? "projects:" + scopePaths(item).map(pathKey).join("|") : "global";
			if (scopeKey(local) !== scopeKey(incoming)) fields.push("scope");
			return fields;
		}

		/** Export menu: JSON is the whole-library backup, Markdown follows the filter. */
		function exportMenuItems() {
			return [
				{ key: "json", format: "json", scope: "library", labelKey: "expJson", hintKey: "expJsonHint" },
				{ key: "md", format: "md", scope: "filter", labelKey: "expMd", hintKey: "expMdHint" },
			];
		}

		/** Ordered id subset for a Markdown export; null means "the whole library". */
		function exportIds(items, filtered) {
			if (filtered !== true) return null;
			return (Array.isArray(items) ? items : []).map((item) => item.id).filter((id) => typeof id === "string");
		}

		/**
		 * The export request shape. A Markdown subset can name thousands of ids,
		 * which does not fit a query string (431), so it travels as a POST body;
		 * a whole-library export — always including every JSON export — stays a
		 * plain GET with no ids at all.
		 * @param {string} format
		 * @param {string[]|null} ids
		 * @returns {{method: "GET", path: string} | {method: "POST", path: string, body: {format: string, ids: string[]}}}
		 */
		function exportRequest(format, ids) {
			const list = format === "json" || !Array.isArray(ids) ? [] : ids.filter((id) => typeof id === "string" && id !== "");
			if (list.length === 0) {
				const params = new URLSearchParams({ format });
				return { method: "GET", path: "/export?" + params.toString() };
			}
			return { method: "POST", path: "/export", body: { format, ids: list } };
		}

		const IMPORT_REASON_KEYS = Object.freeze({
			decode: "impReasonDecode",
			"file-empty": "impReasonEmpty",
			"bad-json": "impReasonBadJson",
			"format-too-new": "impReasonVersion",
			"metadata-invalid": "impReasonMetadata",
			"title-invalid": "impReasonTitle",
			"title-empty": "impReasonTitle",
			"body-invalid": "impReasonBody",
			"body-empty": "impReasonBody",
			"tags-invalid": "impReasonTags",
			"scope-invalid": "impReasonScope",
			"too-many-files": "impReasonTooManyFiles",
			"import-too-large": "impReasonTooLarge",
			"import-too-many": "impReasonTooMany",
		});

		/** Stable reason code → dictionary key. */
		function importReasonKey(code) {
			return IMPORT_REASON_KEYS[String(code)] ?? "impReasonUnknown";
		}

		/** DOM id for a preview row, derived from its stable `at` key. */
		function importElementId(prefix, at) {
			return prefix + "-" + String(at ?? "").replace(/[^A-Za-z0-9_-]/g, "-");
		}

		/** Human file size for the summary bar. */
		function formatBytes(bytes) {
			const value = Number(bytes) || 0;
			if (value < 1024) return value + " B";
			if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
			return (value / (1024 * 1024)).toFixed(1) + " MB";
		}

		/** Download one export response: Blob from `content`, name from `filename`. */
		function downloadExport(body) {
			const blob = new Blob([String(body?.content ?? "")], {
				type: typeof body?.mime === "string" && body.mime !== "" ? body.mime : "application/octet-stream",
			});
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = typeof body?.filename === "string" && body.filename !== "" ? body.filename : "dsh-prompt-templates.txt";
			link.rel = "noopener";
			document.body.appendChild(link);
			link.click();
			link.remove();
			// Let the browser start the download before the blob is released.
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		}
		// #endregion

		// #region styles
		const CSS = `
.dpt-trigger {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	box-sizing: border-box;
	height: 28px;
	padding: 0 10px;
	border: 1px solid var(--dsw-alias-border-l2);
	border-radius: 8px;
	background: var(--dsw-alias-bg-layer-1);
	color: var(--dsw-alias-label-secondary);
	font-family: inherit;
	font-size: 12px;
	line-height: 18px;
	cursor: pointer;
	transition: background 100ms ease, border-color 100ms ease, color 100ms ease;
}
.dpt-trigger[data-lang="en"] { min-width: 84px; }
.dpt-trigger:hover,
.dpt-trigger[data-open="true"] {
	background: var(--dsw-alias-bg-layer-2);
	color: var(--dsw-alias-label-primary);
}
.dpt-trigger[data-open="true"] { border-color: var(--dsw-alias-border-l2); }
.dpt-trigger:active { background: var(--dsw-alias-bg-layer-2); }
.dpt-trigger:disabled { opacity: 0.5; cursor: default; }
.dpt-trigger:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dpt-trigger-label { white-space: nowrap; }

.dpt-pop, .dpt-modal {
	font-family: inherit;
	color: var(--dsw-alias-label-primary);
	font-size: 13px;
	line-height: 20px;
	-webkit-font-smoothing: antialiased;
}
.dpt-pop {
	position: fixed;
	z-index: 2147483000;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	box-sizing: border-box;
	border: 1px solid var(--dsw-alias-border-l2);
	border-radius: 12px;
	background: var(--dsw-alias-bg-layer-2);
	box-shadow: 0 10px 30px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);
}
.dpt-pop[data-theme] { color-scheme: inherit; }
.dpt-search {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 12px;
	border-bottom: 1px solid var(--dsw-alias-border-l1);
	color: var(--dsw-alias-label-secondary);
}
.dpt-search input {
	flex: 1 1 auto;
	min-width: 0;
	border: 0;
	outline: none;
	background: transparent;
	color: var(--dsw-alias-label-primary);
	font: inherit;
	padding: 0;
}
.dpt-search input::placeholder { color: var(--dsw-alias-label-secondary); }
.dpt-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px; }
.dpt-group-title {
	padding: 8px 10px 4px;
	color: var(--dsw-alias-label-secondary);
	font-size: 12px;
	line-height: 16px;
}
.dpt-item {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	width: 100%;
	box-sizing: border-box;
	padding: 8px 10px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}
.dpt-item[data-active="true"] { background: var(--dsw-alias-bg-layer-2); }
.dpt-item-main { flex: 1 1 auto; min-width: 0; }
.dpt-item-title {
	display: flex;
	align-items: center;
	gap: 6px;
	font-weight: 500;
	line-height: 20px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.dpt-item-body {
	color: var(--dsw-alias-label-secondary);
	font-size: 12px;
	line-height: 18px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.dpt-item-side {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	gap: 4px;
	color: var(--dsw-alias-label-secondary);
	padding-top: 2px;
}
.dpt-chip {
	display: inline-flex;
	align-items: center;
	gap: 2px;
	padding: 0 6px;
	height: 18px;
	border-radius: 6px;
	background: var(--dsw-alias-bg-layer-1);
	color: var(--dsw-alias-label-secondary);
	font-size: 11px;
	line-height: 18px;
	white-space: nowrap;
}
.dpt-empty {
	padding: 24px 16px;
	text-align: center;
	color: var(--dsw-alias-label-secondary);
}
.dpt-empty strong { display: block; color: var(--dsw-alias-label-primary); font-weight: 500; margin-bottom: 4px; }
.dpt-empty .dpt-empty-hint { font-size: 12px; line-height: 18px; }
.dpt-empty button { margin-top: 12px; }
.dpt-foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 8px 10px;
	border-top: 1px solid var(--dsw-alias-border-l1);
	color: var(--dsw-alias-label-secondary);
	font-size: 12px;
}
.dpt-foot .dpt-hint { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dpt-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	box-sizing: border-box;
	height: 28px;
	padding: 0 10px;
	border: 1px solid transparent;
	border-radius: 8px;
	background: transparent;
	color: var(--dsw-alias-label-secondary);
	font: inherit;
	font-size: 12px;
	cursor: pointer;
	white-space: nowrap;
}
.dpt-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dpt-btn:disabled { opacity: 0.5; cursor: default; }
.dpt-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dpt-btn[data-variant="primary"] {
	border-color: var(--dsw-alias-border-l2);
	background: var(--dsw-alias-bg-layer-1);
	color: var(--dsw-alias-label-primary);
	font-weight: 500;
}
.dpt-btn[data-variant="primary"]:hover { background: var(--dsw-alias-bg-layer-2); }
.dpt-btn[data-variant="danger"] { color: var(--dsw-alias-state-error-primary); }
.dpt-btn[data-variant="ghost"] { padding: 0 6px; }
.dpt-icon { display: inline-flex; align-items: center; justify-content: center; }

.dpt-modal {
	position: fixed;
	inset: 0;
	z-index: 2147483100;
	display: flex;
	align-items: center;
	justify-content: center;
	box-sizing: border-box;
	padding: 24px;
	background: color-mix(in srgb, var(--dsw-alias-bg-base) 78%, transparent);
}
.dpt-modal-card {
	display: flex;
	flex-direction: column;
	width: min(1080px, 100%);
	height: min(760px, 100%);
	overflow: hidden;
	box-sizing: border-box;
	border: 1px solid var(--dsw-alias-border-l2);
	border-radius: 16px;
	background: var(--dsw-alias-bg-layer-1);
	box-shadow: 0 24px 64px color-mix(in srgb, var(--dsw-alias-label-primary) 24%, transparent);
}
.dpt-modal-head {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 18px 24px;
	flex: 0 0 auto;
	border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dpt-modal-title { font-size: 18px; line-height: 26px; font-weight: 600; letter-spacing: -0.02em; }
.dpt-modal-sub { margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dpt-modal-head .dpt-spacer { flex: 1 1 auto; }
.dpt-modal-body { display: flex; flex: 1 1 auto; min-height: 0; }
.dpt-pane {
	display: flex;
	flex-direction: column;
	min-height: 0;
	width: 304px;
	flex: 0 0 304px;
	background: var(--dsw-alias-bg-layer-2);
	border-right: 1px solid var(--dsw-alias-border-l1);
}
.dpt-pane-head { display: flex; flex: 0 0 auto; flex-direction: column; gap: 12px; padding: 18px 16px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dpt-pane-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; }
.dpt-pane-heading { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.dpt-pane-title { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600; }
.dpt-pane-count { flex: 0 0 auto; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dpt-filter-panel { overflow-y: auto; max-height: 200px; flex-shrink: 0; padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dpt-filter-group { border: 0; padding: 0; margin: 0 0 10px; min-width: 0; }
.dpt-filter-group legend { padding: 0; margin-bottom: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dpt-filter-checks { display: flex; flex-wrap: wrap; gap: 6px 12px; }
.dpt-filter-check { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; font-size: 12px; cursor: pointer; }
.dpt-filter-check span { overflow-wrap: anywhere; }
.dpt-filter-check input { margin: 0; accent-color: var(--dsw-alias-brand-primary); }
.dpt-order-hint { padding: 10px 16px 6px; font-size: 11px; line-height: 17px; color: var(--dsw-alias-label-secondary); }
.dpt-manage-list { overflow-y: auto; padding: 4px 10px 12px; flex: 1 1 auto; min-height: 0; }
.dpt-reuse { margin-top: 7px; }
.dpt-reuse .dpt-choices { max-height: 96px; overflow-y: auto; margin-top: 5px; padding: 2px; }
.dpt-choice:focus-visible, .dpt-drag-handle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dpt-choice:disabled { opacity: 0.45; cursor: default; }
.dpt-drag-handle { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 28px; width: 28px; height: 44px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: grab; }
.dpt-drag-handle:hover { background: var(--dsw-alias-bg-layer-2); }
.dpt-drag-handle:active { cursor: grabbing; }
.dpt-drag-handle[aria-disabled="true"] { opacity: 0.4; cursor: default; }
.dpt-mrow[data-dragging="true"] { opacity: 0.45; }
.dpt-mrow[data-drop="before"] { box-shadow: 0 -2px 0 var(--dsw-alias-brand-primary); }
.dpt-mrow[data-drop="after"] { box-shadow: 0 2px 0 var(--dsw-alias-brand-primary); }
.dpt-manage-search {
	flex: 1 1 auto;
	min-width: 0;
	height: 36px;
	padding: 0 10px;
	border-radius: 8px;
	border: 1px solid var(--dsw-alias-border-l1);
	background: var(--dsw-alias-bg-base);
	color: var(--dsw-alias-label-primary);
	font: inherit;
	font-size: 12px;
}
.dpt-manage-search:focus-visible {
	outline: 2px solid var(--dsw-alias-brand-primary);
	outline-offset: 1px;
}
.dpt-mrow {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 4px;
	padding: 4px 8px 4px 2px;
	border: 1px solid transparent;
	border-radius: 10px;
}
.dpt-mrow:hover { background: var(--dsw-alias-bg-layer-2); }
.dpt-mrow[data-selected="true"] { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); box-shadow: inset 3px 0 0 var(--dsw-alias-brand-primary); }
.dpt-mrow-main { flex: 1 1 0; min-width: 0; min-height: 52px; cursor: pointer; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; text-align: left; padding: 6px 0; }
.dpt-mrow-main:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dpt-mrow-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; line-height: 20px; }
.dpt-mrow-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dpt-mrow-title .dpt-icon { flex: 0 0 auto; }
.dpt-mrow-meta { margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dpt-mrow-current { flex: 0 0 auto; display: inline-flex; color: var(--dsw-alias-label-secondary); }
.dpt-confirm { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 14px 24px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); font-size: 12px; line-height: 18px; }
.dpt-confirm-copy { flex: 1 1 180px; min-width: 0; }
.dpt-confirm-title { margin: 0 0 3px; font-weight: 600; overflow-wrap: anywhere; }
.dpt-confirm-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }
.dpt-confirm[data-danger="true"] { border-left: 3px solid var(--dsw-alias-state-error-primary); }
.dpt-btn[data-danger="true"] { color: var(--dsw-alias-state-error-primary); }

.dpt-editor { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; min-height: 0; background: var(--dsw-alias-bg-layer-1); }
.dpt-editor-head { display: flex; align-items: center; justify-content: space-between; flex: 0 0 auto; gap: 16px; padding: 18px 24px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dpt-editor-heading { min-width: 0; }
.dpt-editor-eyebrow { margin-bottom: 3px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
.dpt-editor-title { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dpt-editor-tools { display: flex; align-items: center; flex: 0 0 auto; gap: 6px; padding-left: 12px; border-left: 1px solid var(--dsw-alias-border-l1); }
.dpt-editor-tools .dpt-btn { height: 36px; }
.dpt-editor-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 22px 24px 8px; }
.dpt-editor-section { margin: 4px 0 20px; padding-top: 20px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dpt-section-title { margin: 0 0 14px; font-size: 13px; line-height: 20px; font-weight: 600; }
.dpt-field { margin-bottom: 20px; }
.dpt-label { display: block; margin-bottom: 7px; color: var(--dsw-alias-label-primary); font-size: 12px; font-weight: 500; line-height: 18px; }
.dpt-field-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dpt-field-count { font-size: 11px; line-height: 18px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dpt-input, .dpt-textarea {
	box-sizing: border-box;
	width: 100%;
	padding: 7px 10px;
	border: 1px solid var(--dsw-alias-border-l2);
	border-radius: 8px;
	background: var(--dsw-alias-bg-layer-1);
	color: var(--dsw-alias-label-primary);
	font: inherit;
	outline: none;
}
.dpt-input:focus, .dpt-textarea:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dpt-input { min-height: 38px; }
.dpt-textarea { min-height: 190px; resize: vertical; line-height: 22px; }
.dpt-tag-entry { margin-top: 12px; }
.dpt-tag-input-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; }
.dpt-tag-input-row .dpt-input { flex: 1 1 0; min-width: 0; }
.dpt-tag-input-row .dpt-btn { flex: 0 0 auto; min-height: 38px; }
.dpt-selected-tags { margin-top: 10px; }
.dpt-selected-tags svg { width: 12px; height: 12px; flex-shrink: 0; }
.dpt-error { margin-top: 4px; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.dpt-hintline { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dpt-choices { display: flex; flex-wrap: wrap; gap: 6px; }
.dpt-choice {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	max-width: 100%;
	padding: 4px 8px;
	border: 1px solid var(--dsw-alias-border-l2);
	border-radius: 6px;
	background: transparent;
	color: var(--dsw-alias-label-secondary);
	font: inherit;
	font-size: 12px;
	line-height: 18px;
	cursor: pointer;
}
.dpt-choice[data-on="true"] {
	border-color: var(--dsw-alias-border-l2);
	background: var(--dsw-alias-bg-layer-2);
	color: var(--dsw-alias-label-primary);
}
.dpt-choice span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dpt-scope-options, .dpt-project-options { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; }
.dpt-scope-option {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	box-sizing: border-box;
	min-height: 44px;
	max-width: 100%;
	min-width: 0;
	padding: 8px 10px;
	border: 2px solid var(--dsw-alias-border-l2);
	border-radius: 8px;
	background: var(--dsw-alias-bg-layer-1);
	color: var(--dsw-alias-label-primary);
	font-size: 12px;
	line-height: 20px;
	cursor: pointer;
}
.dpt-scope-options > .dpt-scope-option { flex: 1 1 180px; }
.dpt-scope-option[data-on="true"] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); font-weight: 600; }
.dpt-scope-option:hover { border-color: var(--dsw-alias-brand-primary); }
.dpt-scope-option:has(input:focus-visible) { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dpt-scope-option input { flex: 0 0 auto; width: 16px; height: 16px; margin: 0; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }
.dpt-scope-option span { min-width: 0; overflow-wrap: anywhere; }
.dpt-project-heading { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; margin: 14px 0 8px; font-size: 12px; line-height: 20px; }
.dpt-project-count { font-weight: 600; font-variant-numeric: tabular-nums; }
.dpt-switch { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dpt-switch input { accent-color: var(--dsw-alias-brand-primary); }
.dpt-editor-foot {
	display: flex;
	flex: 0 0 auto;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	min-height: 72px;
	box-sizing: border-box;
	padding: 16px 24px;
	border-top: 1px solid var(--dsw-alias-border-l1);
	background: var(--dsw-alias-bg-layer-1);
}
.dpt-editor-foot .dpt-btn { min-width: 72px; height: 38px; }
.dpt-editor-foot .dpt-btn[data-variant="primary"] { border-color: var(--dsw-alias-brand-primary); }
.dpt-editor-status { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dpt-status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-secondary); flex: 0 0 auto; }
.dpt-editor-status[data-dirty="true"] .dpt-status-dot { background: var(--dsw-alias-brand-primary); }
.dpt-editor-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }
.dpt-blank-copy { max-width: 280px; }
.dpt-blank-copy .dpt-icon { width: 48px; height: 48px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; margin-bottom: 16px; }
.dpt-blank-title { margin: 0 0 6px; font-size: 15px; line-height: 22px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dpt-blank-copy .dpt-btn { margin-top: 18px; height: 36px; }
.dpt-blank {
	display: flex;
	flex: 1 1 auto;
	align-items: center;
	justify-content: center;
	padding: 24px;
	color: var(--dsw-alias-label-secondary);
	text-align: center;
}
.dpt-back { display: none; }

.dpt-head-actions { position: relative; display: flex; flex: 0 0 auto; align-items: center; gap: 4px; }
.dpt-head-actions .dpt-btn { height: 32px; padding: 0 10px; }
.dpt-menu-wrap { position: relative; display: inline-flex; }
.dpt-menu {
	position: absolute;
	top: calc(100% + 6px);
	right: 0;
	z-index: 2;
	display: flex;
	flex-direction: column;
	width: 248px;
	max-width: calc(100vw - 32px);
	box-sizing: border-box;
	padding: 4px;
	border: 1px solid var(--dsw-alias-border-l2);
	border-radius: 10px;
	background: var(--dsw-alias-bg-layer-2);
	box-shadow: 0 10px 30px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);
}
.dpt-menu-item {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 1px;
	width: 100%;
	box-sizing: border-box;
	padding: 7px 10px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--dsw-alias-label-primary);
	font: inherit;
	text-align: left;
	cursor: pointer;
}
.dpt-menu-item:hover { background: var(--dsw-alias-bg-layer-1); }
.dpt-menu-item:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dpt-menu-item:disabled { opacity: 0.5; cursor: default; }
.dpt-menu-item-title { font-size: 12px; line-height: 18px; font-weight: 500; }
.dpt-menu-item-hint { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); }

.dpt-sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0 0 0 0);
	white-space: nowrap;
	border: 0;
}
.dpt-notice {
	display: flex;
	flex: 0 0 auto;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 10px 24px;
	border-bottom: 1px solid var(--dsw-alias-border-l1);
	color: var(--dsw-alias-label-secondary);
	font-size: 12px;
	line-height: 18px;
}
.dpt-notice[data-kind="error"] { color: var(--dsw-alias-state-error-primary); }
.dpt-notice .dpt-btn { flex: 0 0 auto; }

.dpt-import { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; }
.dpt-import-head { flex: 0 0 auto; padding: 16px 24px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dpt-import-title { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; }
.dpt-import-title:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dpt-import-sub { margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dpt-isum {
	display: flex;
	flex: 0 0 auto;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 8px 16px;
	padding: 8px 24px;
	border-bottom: 1px solid var(--dsw-alias-border-l1);
	color: var(--dsw-alias-label-secondary);
	font-size: 12px;
	line-height: 18px;
}
.dpt-isum-jumps { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dpt-jump {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
	box-sizing: border-box;
	height: 26px;
	padding: 0 8px;
	border: 1px solid var(--dsw-alias-border-l2);
	border-radius: 6px;
	background: transparent;
	color: var(--dsw-alias-label-primary);
	font: inherit;
	font-size: 12px;
	font-variant-numeric: tabular-nums;
	cursor: pointer;
}
.dpt-jump:hover { background: var(--dsw-alias-bg-layer-2); }
.dpt-jump:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dpt-jump:disabled { opacity: 0.5; cursor: default; }
.dpt-isum-files { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dpt-import-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 16px 24px 8px; }
.dpt-isec { margin-bottom: 18px; }
.dpt-isec-head {
	position: sticky;
	top: 0;
	z-index: 1;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px 12px;
	padding: 8px 0;
	border-bottom: 1px solid var(--dsw-alias-border-l1);
	background: var(--dsw-alias-bg-layer-1);
}
.dpt-isec-title { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600; }
.dpt-isec-title:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dpt-isec-count { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dpt-isec-note { flex: 1 1 160px; min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 17px; }
.dpt-isec-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }
.dpt-isec-list { margin: 4px 0 0; padding: 0; list-style: none; }
.dpt-irow {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-start;
	gap: 6px 8px;
	padding: 8px;
	border: 1px solid transparent;
	border-radius: 10px;
}
.dpt-irow:hover { background: var(--dsw-alias-bg-layer-2); }
.dpt-irow-line { display: flex; flex: 1 1 100%; align-items: flex-start; gap: 8px; }
.dpt-irow-main {
	flex: 1 1 0;
	min-width: 0;
	padding: 2px 0;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}
.dpt-irow-main:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dpt-irow-main-static { flex: 1 1 0; min-width: 0; }
.dpt-irow-title { display: flex; align-items: center; gap: 6px; font-size: 13px; line-height: 20px; font-weight: 500; overflow-wrap: anywhere; }
.dpt-irow-arrow { display: inline-flex; flex: 0 0 auto; transition: transform 120ms ease; }
.dpt-irow-arrow[data-open="true"] { transform: rotate(90deg); }
.dpt-irow-meta { margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 17px; overflow-wrap: anywhere; }
.dpt-irow-meta[data-imported="true"] { color: var(--dsw-alias-label-primary); font-weight: 500; }
.dpt-irow-reason { color: var(--dsw-alias-state-error-primary); }
.dpt-irow-warning {
	flex: 1 1 100%;
	display: flex;
	align-items: flex-start;
	gap: 6px;
	box-sizing: border-box;
	margin-left: 20px;
	padding: 4px 8px;
	border-left: 2px solid var(--dsw-alias-border-l2);
	border-radius: 4px;
	background: var(--dsw-alias-bg-layer-2);
	color: var(--dsw-alias-label-primary);
	font-size: 11px;
	line-height: 17px;
	overflow-wrap: anywhere;
}
.dpt-irow-warning-icon { display: inline-flex; flex: 0 0 auto; margin-top: 2px; color: var(--dsw-alias-label-secondary); }
.dpt-import-warn { display: flex; align-items: flex-start; gap: 6px; margin-top: 2px; color: var(--dsw-alias-label-primary); }
.dpt-import-warn .dpt-irow-warning-icon { color: inherit; }
.dpt-irow-choice { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; min-height: 32px; padding: 0 2px; font-size: 12px; cursor: pointer; }
.dpt-irow-choice input { width: 16px; height: 16px; margin: 0; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }
.dpt-irow-choice:has(input:focus-visible) { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 6px; }
.dpt-irow-side { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; max-width: 180px; }
.dpt-irow-side .dpt-chip { overflow: hidden; text-overflow: ellipsis; }
.dpt-compare { display: grid; flex: 1 1 100%; grid-template-columns: 1fr 1fr; gap: 16px; padding: 6px 0 12px; }
.dpt-compare[data-single="true"] { grid-template-columns: 1fr; }
.dpt-cmp-col { min-width: 0; }
.dpt-cmp-head { margin-bottom: 6px; font-size: 12px; line-height: 18px; font-weight: 600; }
.dpt-cmp-field { display: flex; gap: 6px; font-size: 12px; line-height: 20px; }
.dpt-cmp-label { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 20px; }
.dpt-cmp-value { min-width: 0; overflow-wrap: anywhere; }
.dpt-cmp-subtitle { margin: 8px 0 4px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
.dpt-cmp-body {
	margin: 0;
	max-height: 240px;
	overflow: auto;
	box-sizing: border-box;
	padding: 8px 10px;
	border: 1px solid var(--dsw-alias-border-l1);
	border-radius: 8px;
	background: var(--dsw-alias-bg-layer-2);
	color: var(--dsw-alias-label-primary);
	font-family: inherit;
	font-size: 12px;
	line-height: 20px;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
.dpt-cmp-body:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dpt-fails { max-height: 96px; overflow-y: auto; margin: 4px 0 0; padding: 0; list-style: none; font-size: 12px; line-height: 18px; }
.dpt-import-foot {
	display: flex;
	flex: 0 0 auto;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	min-height: 72px;
	box-sizing: border-box;
	padding: 16px 24px;
	border-top: 1px solid var(--dsw-alias-border-l1);
}
.dpt-import-status { min-width: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dpt-import-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }
.dpt-import-actions .dpt-btn { min-width: 72px; height: 38px; }
.dpt-import-actions .dpt-btn[data-variant="primary"] { border-color: var(--dsw-alias-brand-primary); }
.dpt-import-empty {
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 6px;
	padding: 24px;
	text-align: center;
	color: var(--dsw-alias-label-secondary);
	font-size: 12px;
	line-height: 18px;
}
.dpt-import-empty strong { color: var(--dsw-alias-label-primary); font-size: 15px; line-height: 22px; font-weight: 500; }
.dpt-import-empty .dpt-btn { margin-top: 12px; height: 36px; }
@media (max-width: 800px) {
	.dpt-modal { padding: 16px; }
	.dpt-pane { width: 264px; flex-basis: 264px; }
	.dpt-editor-head, .dpt-editor-foot, .dpt-confirm { padding-left: 18px; padding-right: 18px; }
	.dpt-editor-scroll { padding: 18px 18px 4px; }
	.dpt-editor-tools { padding-left: 8px; }
	.dpt-tag-input-row { flex-wrap: wrap; }
	.dpt-tag-input-row .dpt-input { flex-basis: 100%; }
	.dpt-import-head, .dpt-isum, .dpt-import-scroll, .dpt-import-foot { padding-left: 18px; padding-right: 18px; }
	.dpt-compare { gap: 12px; }
	.dpt-irow-side { max-width: 140px; }
}
@media (max-width: 640px) {
	.dpt-modal { padding: 8px; }
	.dpt-modal-card { height: 100%; border-radius: 12px; }
	.dpt-modal-head { padding: 14px 18px; }
	.dpt-modal-title { font-size: 16px; }
	.dpt-modal-sub { display: none; }
	.dpt-pane { width: 100%; flex: 1 1 auto; border-right: 0; }
	.dpt-modal-body[data-editing="true"] .dpt-pane { display: none; }
	.dpt-modal-body[data-editing="false"] > .dpt-blank { display: none; }
	.dpt-editor-head { flex-wrap: wrap; gap: 10px; }
	.dpt-editor-heading { flex: 1 1 140px; }
	.dpt-editor-tools { border: 0; padding-left: 0; margin-left: auto; }
	.dpt-back { display: inline-flex; }
	.dpt-editor-status { font-size: 11px; }
	.dpt-editor-foot { gap: 8px; }
	.dpt-editor-foot .dpt-btn { min-width: 64px; }
	.dpt-head-actions .dpt-btn { height: 28px; padding: 0 8px; }
	.dpt-menu { width: min(248px, calc(100vw - 36px)); }
	.dpt-import-head { padding: 14px 18px; }
	.dpt-import-title { font-size: 15px; }
	.dpt-import-sub { display: none; }
	.dpt-isum { gap: 6px 10px; }
	.dpt-import-scroll { padding: 12px 18px 6px; }
	.dpt-compare { grid-template-columns: 1fr; gap: 10px; }
	.dpt-cmp-body { max-height: 180px; }
	.dpt-irow-side { max-width: 110px; }
	.dpt-import-foot { flex-wrap: wrap; gap: 10px; min-height: 0; }
	.dpt-import-actions { width: 100%; justify-content: flex-end; }
	.dpt-import-actions .dpt-btn { flex: 1 1 auto; }
}
@media (pointer: coarse) {
	.dpt-modal .dpt-btn, .dpt-choice, .dpt-drag-handle, .dpt-filter-check { min-height: 44px; }
	.dpt-drag-handle { width: 44px; flex-basis: 44px; }
	.dpt-jump, .dpt-menu-item, .dpt-irow-choice { min-height: 44px; }
	.dpt-irow-main { min-height: 44px; }
}
@media (prefers-reduced-motion: reduce) {
	.dpt-trigger { transition: none; }
}
`;

		/**
		 * Append the bundle stylesheet once. A hot reload re-runs this with the
		 * same document, so an existing tag is refreshed instead of skipped —
		 * otherwise edits to the CSS would never show up until a full reload.
		 */
		function installStyle() {
			if (typeof document === "undefined") return () => {};
			const existing = document.getElementById(STYLE_ID);
			if (existing !== null) {
				existing.textContent = CSS;
				return () => {};
			}
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
			return () => {
				style.remove();
			};
		}
		// #endregion

		// #region icons
		/**
		 * @param {string} path
		 * @param {number} [size]
		 */
		function glyph(path, size) {
			return h(
				"svg",
				{
					width: size ?? 14,
					height: size ?? 14,
					viewBox: "0 0 16 16",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": "true",
				},
				h("path", { d: path })
			);
		}

		const icons = {
			trigger: () =>
				h(
					"svg",
					{
						width: 14,
						height: 14,
						viewBox: "0 0 16 16",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: 1.5,
						strokeLinecap: "round",
						strokeLinejoin: "round",
						"aria-hidden": "true",
					},
					h("rect", { x: 3.2, y: 2.6, width: 9.6, height: 10.8, rx: 2 }),
					h("path", { d: "M5.9 6.1h4.2M5.9 8.5h4.2M5.9 10.9h2.4" })
				),
			search: () =>
				h(
					"svg",
					{
						width: 14,
						height: 14,
						viewBox: "0 0 16 16",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: 1.5,
						strokeLinecap: "round",
						"aria-hidden": "true",
					},
					h("circle", { cx: 7.2, cy: 7.2, r: 4.2 }),
					h("path", { d: "m10.4 10.4 3 3" })
				),
			pin: () => glyph("M8 2.2v4.1M8 2.2 4.6 6M8 2.2 11.4 6M8 6.3v7.5"),
			grip: () => glyph("M6 3h.1M10 3h.1M6 8h.1M10 8h.1M6 13h.1M10 13h.1"),
			filter: () => glyph("M2.5 3h11L9.5 8v4L6.5 14V8z"),
			up: () => glyph("M4 10.2 8 6l4 4.2"),
			down: () => glyph("M4 5.8 8 10l4-4.2"),
			edit: () => glyph("M10.8 2.8 13.2 5.2 5.6 12.8 2.9 13.1l.3-2.7z"),
			trash: () => glyph("M3 4.4h10M6.4 4.4V3h3.2v1.4M4.6 4.4l.5 8.4h5.8l.5-8.4M6.6 6.9v3.8M9.4 6.9v3.8"),
			plus: () => glyph("M8 3.2v9.6M3.2 8h9.6"),
			close: () => glyph("M4 4l8 8M12 4l-8 8"),
			chevron: () => glyph("M6 4l4 4-4 4"),
			imp: () => glyph("M8 2.6v6.2M5.2 6.2 8 9l2.8-2.8M2.8 11.2v1.4h10.4v-1.4"),
			exp: () => glyph("M8 9.6V3.4M5.2 6.2 8 3.4l2.8 2.8M2.8 11.2v1.4h10.4v-1.4"),
			warn: () =>
				h(
					"svg",
					{
						width: 14,
						height: 14,
						viewBox: "0 0 16 16",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: 1.5,
						strokeLinecap: "round",
						strokeLinejoin: "round",
						"aria-hidden": "true",
					},
					h("path", { d: "M8 2.4 1.9 13h12.2z" }),
					h("path", { d: "M8 6.4v3.1M8 11.4h.1" })
				),
		};
		// #endregion

		// #region picker
		/**
		 * @param {{t: Function, items: any[], workspace: string, query: string,
		 *   loading: boolean, error: string|null, activeIndex: number,
		 *   onQuery: Function, onActive: Function, onChoose: Function,
		 *   onManage: Function, onCreate: Function, onRetry: Function,
		 *   style: Record<string, unknown>, searchRef: any, listRef: any, lang: string}} props
		 */
		function Picker(props) {
			const t = props.t;
			const groups = react.useMemo(
				() => groupTemplates(props.items, props.query, props.workspace),
				[props.items, props.query, props.workspace]
			);
			const flat = react.useMemo(() => [...groups.project, ...groups.global], [groups]);
			const total = flat.length;

			react.useEffect(() => {
				if (props.activeIndex > total - 1) props.onActive(Math.max(0, total - 1));
			}, [total, props.activeIndex]);

			// Keep the keyboard cursor inside the scroll viewport without moving the page.
			react.useEffect(() => {
				const list = props.listRef?.current;
				if (list === null || list === undefined) return;
				const node = list.querySelector('[data-active="true"]');
				if (node !== null && node !== undefined) node.scrollIntoView({ block: "nearest" });
			}, [props.activeIndex, props.listRef]);

			/** @param {any[]} rows @param {string} title */
			const section = (rows, title) => {
				if (rows.length === 0) return null;
				return h(
					"div",
					{ key: title },
					h("div", { className: "dpt-group-title" }, title),
					rows.map((item, index) => {
						const offset = rows === groups.project ? index : groups.project.length + index;
						return row(item, offset);
					})
				);
			};

			const row = (item, index) => {
				const active = index === props.activeIndex;
				return h(
					"button",
					{
						type: "button",
						key: item.id ?? index,
						className: "dpt-item",
						id: "dpt-opt-" + index,
						role: "option",
						tabIndex: -1,
						"aria-selected": active,
						"data-active": active ? "true" : "false",
						onMouseEnter: () => props.onActive(index),
						onClick: () => props.onChoose(item),
						title: String(item.body ?? "").slice(0, 200),
					},
					h(
						"div",
						{ className: "dpt-item-main" },
						h(
							"div",
							{ className: "dpt-item-title" },
							Boolean(item.pinned) ? h("span", { className: "dpt-icon", style: { opacity: 0.6 } }, icons.pin()) : null,
							item.title
						),
						h("div", { className: "dpt-item-body" }, String(item.body ?? ""))
					),
					h(
						"div",
						{ className: "dpt-item-side" },
						templateTags(item).length === 0 ? null : h("span", {
							className: "dpt-chip", title: templateTags(item).join(" · "),
						}, templateTags(item)[0] + (templateTags(item).length > 1 ? " +" + (templateTags(item).length - 1) : ""))
					)
				);
			};

			const onKeyDown = (event) => {
				// An IME composing a candidate must keep Enter and Escape.
				if (event.isComposing === true || event.keyCode === 229) return;
				if (event.key === "ArrowDown") {
					event.preventDefault();
					// Clamped, not wrapping: pressing Down on the last row stays put.
					if (total > 0) props.onActive(Math.min(total - 1, props.activeIndex + 1));
				} else if (event.key === "ArrowUp") {
					event.preventDefault();
					if (total > 0) props.onActive(Math.max(0, props.activeIndex - 1));
				} else if (event.key === "Enter") {
					event.preventDefault();
					const item = flat[props.activeIndex];
					if (item !== undefined) props.onChoose(item);
				} else if (event.key === "Escape") {
					event.preventDefault();
					props.onClose();
				}
			};

			/** @type {any} */
			let body;
			if (props.loading && props.items.length === 0) {
				body = h("div", { className: "dpt-empty" }, t("loading"));
			} else if (props.error !== null) {
				body = h(
					"div",
					{ className: "dpt-empty" },
					h("strong", null, t("loadFailed")),
					h("div", { className: "dpt-empty-hint" }, props.error),
					h(
						"button",
						{ type: "button", className: "dpt-btn", "data-variant": "primary", onClick: props.onRetry },
						t("retry")
					)
				);
			} else if (total === 0) {
				const searching = props.query.trim() !== "";
				body = h(
					"div",
					{ className: "dpt-empty" },
					h("strong", null, searching ? t("emptySearch") : t("emptyTitle")),
					searching ? null : h("div", { className: "dpt-empty-hint" }, t("emptyHint")),
					h(
						"button",
						{
							type: "button",
							className: "dpt-btn",
							"data-variant": "primary",
							onClick: props.onCreate,
						},
						icons.plus(),
						h("span", null, t("newTemplate"))
					)
				);
			} else {
				body = h(
					"div",
					{
						className: "dpt-list",
						ref: props.listRef,
						id: "dpt-listbox",
						role: "listbox",
						"aria-label": t("trigger"),
					},
					section(groups.project, t("groupProject")),
					section(groups.global, t("groupGlobal"))
				);
			}

			return h(
				"div",
				{
					ref: props.rootRef,
					className: "dpt-pop",
					style: props.style,
					role: "dialog",
					"aria-modal": "false",
					"aria-label": t("manageTitle"),
				},
				h(
					"div",
					{ className: "dpt-search" },
					icons.search(),
					h("input", {
						ref: props.searchRef,
						type: "text",
						value: props.query,
						placeholder: t("searchPlaceholder"),
						"aria-label": t("searchPlaceholder"),
						role: "combobox",
						"aria-autocomplete": "list",
						"aria-expanded": true,
						"aria-controls": total > 0 ? "dpt-listbox" : undefined,
						"aria-activedescendant": total > 0 ? "dpt-opt-" + props.activeIndex : undefined,
						onChange: (event) => props.onQuery(event.target.value),
						onKeyDown,
					})
				),
				body,
				h(
					"div",
					{ className: "dpt-foot" },
					h("span", { className: "dpt-hint" }, t("insertHint")),
					h(
						"button",
						{ type: "button", className: "dpt-btn", onClick: props.onManage },
						t("manage")
					)
				)
			);
		}
		// #endregion

		// #region manage panel
		/**
		 * @param {{t: Function, lang: string, items: any[], projects: string[],
		 *   projectLabels: Record<string, string>, workspace: string, loading: boolean,
		 *   error: string|null, draft: any|null, selectedId: string|null, saving: boolean,
		 *   savingError: string|null, revision: number|null,
		 *   describeError: Function, reload: Function, onImported: Function,
		 *   onClose: Function, onBack: Function, onSelect: Function,
		 *   onCreate: Function, onDraft: Function, onSave: Function,
		 *   onDelete: Function, onPin: Function, onReorder: Function, reordering: boolean, onRetry: Function}} props
		 */
		function ManagePanel(props) {
			const t = props.t;
			const cardRef = react.useRef(null);
			const titleRef = react.useRef(null);
			const [confirmId, setConfirmId] = react.useState(null);
			// Set when an action would discard a dirty draft; it re-runs on confirm.
			const [pending, setPending] = react.useState(null);
			const [manageQuery, setManageQuery] = react.useState("");
			const [filterOpen, setFilterOpen] = react.useState(false);
			const [tagFilters, setTagFilters] = react.useState([]);
			const [dragId, setDragId] = react.useState(null);
			const [dropTarget, setDropTarget] = react.useState(null);
			const searchRef = react.useRef(null);
			const deleteRef = react.useRef(null);
			const dragRef = react.useRef(null);

			// Import / export: the file picker, the export menu anchor and the
			// preview title all need explicit focus hand-offs.
			const fileRef = react.useRef(null);
			const exportBtnRef = react.useRef(null);
			const menuRef = react.useRef(null);
			const importBtnRef = react.useRef(null);
			const importTitleRef = react.useRef(null);
			const [exportOpen, setExportOpen] = react.useState(false);
			const [exporting, setExporting] = react.useState(null);
			// One status line for export results and import progress; it is the
			// live region, so every async outcome is announced once.
			const [notice, setNotice] = react.useState(null);
			const [imp, setImp] = react.useState(null);
			const [importBusy, setImportBusy] = react.useState(false);
			const [focusRowId, setFocusRowId] = react.useState(null);
			const describeError =
				typeof props.describeError === "function"
					? props.describeError
					: (err) => (typeof err?.message === "string" ? err.message : t("requestFailed"));

			const clearDrag = () => {
				dragRef.current = null;
				setDragId(null);
				setDropTarget(null);
			};

			react.useEffect(() => {
				// With a draft open the title is the place to type; on a bare list the
				// search box is, so the panel never opens with focus left behind.
				if (props.draft !== null) {
					const node = titleRef.current;
					if (node !== null && node !== undefined && typeof node.focus === "function") {
						node.focus();
						node.select?.();
					}
					return;
				}
				const target = searchRef.current ?? cardRef.current;
				if (target !== null && target !== undefined && typeof target.focus === "function") target.focus();
			}, [props.draft?.id, props.draft === null]);

			/** Basic focus trap: Tab stays inside the dialog. */
			const onKeyDown = (event) => {
				if (event.isComposing === true || event.keyCode === 229) return;
				if (event.key === "Escape") {
					event.stopPropagation();
					// The export menu and the import preview are the outermost
					// transient layers: one Escape leaves them, never the panel.
					if (exportOpen) {
						setExportOpen(false);
						exportBtnRef.current?.focus();
						return;
					}
					if (imp !== null) {
						// A commit already sent cannot be taken back: Escape waits for it.
						if (!importBusy) exitImport();
						return;
					}
					if (dragRef.current !== null) {
						clearDrag();
						return;
					}
					// Dismiss the innermost confirmation first: one Escape must never
					// both cancel a delete prompt and close the whole panel.
					if (pending !== null) {
						setPending(null);
						titleRef.current?.focus();
						return;
					}
					if (confirmId !== null) {
						setConfirmId(null);
						deleteRef.current?.focus();
						return;
					}
					guarded(props.onClose);
					return;
				}
				if (event.key !== "Tab") return;
				const root = cardRef.current;
				if (root === null || root === undefined) return;
				const focusables = Array.from(root.querySelectorAll(
					'button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
				)).filter((node) => node.getClientRects().length > 0);
				if (focusables.length === 0) return;
				const first = focusables[0];
				const last = focusables[focusables.length - 1];
				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault();
					last.focus();
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault();
					first.focus();
				}
			};

			// The stored order is authoritative here: move up/down submits these very
			// ids as the full permutation, so what the user sees must be what is
			// stored (only the picker floats pinned rows, and it never writes).
			const rows = props.items;
			const choices = collectTemplateChoices(rows);
			const visibleRows = filterManageTemplates(rows, manageQuery, tagFilters);
			const visibleIds = visibleRows.map((item) => item.id);
			const filterCount = tagFilters.length;
			const toggleFilter = (set, values, value) => set(values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]);
			const submitOrder = (ids) => {
				if (!props.reordering && !props.loading && !sameList(ids, rows.map((item) => item.id))) props.onReorder(ids);
			};
			const draft = props.draft;
			// A new template has no stored row to compare against, so any filled field
			// counts as unsaved work; an untouched "new" draft must stay silent.
			const dirty =
				draft === null
					? false
					: props.selectedId === null
						? String(draft.title ?? "").trim() !== "" ||
							String(draft.body ?? "").trim() !== "" ||
							draftTags(draft).length > 0
						: (() => {
								const original = props.items.find((item) => item.id === props.selectedId);
								if (original === undefined) return false;
								const before = toDraft(original);
								const after = toDraft({ ...fromDraft(draft), id: draft.id });
								return !(
									before.title === after.title &&
									before.body === after.body &&
									sameList(before.tags, after.tags) &&
									before.scopeKind === after.scopeKind &&
									before.pinned === after.pinned &&
									sameList(before.paths, after.paths)
								);
							})();

			// A dirty draft is the user's work: switching rows, starting a new
			// template, or closing the panel must be an explicit choice, never a
			// silent drop. The pending action re-runs once the user confirms.
			const guarded = (run) => {
				setConfirmId(null);
				if (dirty) {
					setPending(() => run);
					return;
				}
				run();
			};

			react.useEffect(() => {
				if (!dirty) setPending(null);
			}, [dirty]);

			const valid = draft === null ? false : draftIsValid(draft);
			const editing = draft !== null;

			// #region export menu
			const menuItems = exportMenuItems();
			const menuFocusables = () => {
				const node = menuRef.current;
				if (node === null || node === undefined) return [];
				return Array.from(node.querySelectorAll('[role="menuitem"]:not([disabled])'));
			};

			/** Arrow keys, Home/End and Escape stay inside the menu. */
			const onMenuKeyDown = (event) => {
				if (event.isComposing === true || event.keyCode === 229) return;
				const nodes = menuFocusables();
				if (nodes.length === 0) return;
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					setExportOpen(false);
					exportBtnRef.current?.focus();
					return;
				}
				if (event.key === "Tab") {
					// Tab leaves the menu like any other popup; the panel trap still
					// holds focus, and the menu does not linger behind the caret.
					setExportOpen(false);
					return;
				}
				const index = nodes.indexOf(document.activeElement);
				let next = index;
				if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % nodes.length;
				else if (event.key === "ArrowUp") next = index <= 0 ? nodes.length - 1 : index - 1;
				else if (event.key === "Home") next = 0;
				else if (event.key === "End") next = nodes.length - 1;
				else return;
				event.preventDefault();
				nodes[next].focus();
			};

			// Opening the menu moves focus into it; a pointerdown elsewhere closes it.
			react.useEffect(() => {
				if (!exportOpen) return undefined;
				const nodes = menuFocusables();
				if (nodes.length > 0) nodes[0].focus();
				const onPointerDown = (event) => {
					const menu = menuRef.current;
					const trigger = exportBtnRef.current;
					const target = event.target;
					if (menu !== null && menu !== undefined && menu.contains(target)) return;
					if (trigger !== null && trigger !== undefined && trigger.contains(target)) return;
					setExportOpen(false);
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				return () => document.removeEventListener("pointerdown", onPointerDown, true);
			}, [exportOpen]);

			/**
			 * The host builds the file in memory and hands back `content`; the
			 * client only turns it into a Blob download with the host's filename.
			 * @param {{format: string, scope: string}} entry
			 */
			const runExport = async (entry) => {
				setExportOpen(false);
				if (rows.length === 0) {
					setNotice({ kind: "error", text: t("expEmpty") });
					exportBtnRef.current?.focus();
					return;
				}
				if (entry.scope === "filter" && visibleRows.length === 0) {
					setNotice({ kind: "error", text: t("expEmptyFilter") });
					exportBtnRef.current?.focus();
					return;
				}
				setNotice(null);
				setExporting(entry.format);
				try {
					// Only a real filter narrows a Markdown export; an untouched library
					// sends no ids, so the request stays a plain GET.
					const filtered = entry.scope === "filter" && (manageQuery.trim() !== "" || filterCount > 0);
					const body = await api.exportFile(entry.format, filtered ? exportIds(visibleRows, true) : null);
					const count = Number(body?.count) || 0;
					if (count === 0) {
						setNotice({ kind: "error", text: entry.scope === "filter" ? t("expEmptyFilter") : t("expEmpty") });
						return;
					}
					downloadExport(body);
					setNotice({ kind: "status", text: t("expDone", { n: count, file: String(body?.filename ?? "") }) });
				} catch (err) {
					setNotice({ kind: "error", text: describeError(err) });
				} finally {
					setExporting(null);
					exportBtnRef.current?.focus();
				}
			};
			// #endregion

			// #region import
			const pickFiles = () => {
				setNotice(null);
				const node = fileRef.current;
				if (node !== null && node !== undefined) node.click();
			};

			/**
			 * Importing replaces the editor with the preview, so an unsaved draft has
			 * to go through the panel's existing discard confirmation — but only once
			 * the files are actually in hand. The dialog comes first: cancelling it
			 * must leave the draft (and the view) exactly as it was.
			 */
			const startImport = () => {
				pickFiles();
			};

			const previewBatch = async (files, failures, bytes) => {
				setImportBusy(true);
				try {
					const body = await api.importPreview(files);
					const preview = body?.preview !== null && typeof body?.preview === "object" ? body.preview : {};
					const entries = Array.isArray(preview.entries) ? preview.entries : [];
					// A file the host refused is reported per file; keep those reasons
					// next to the ones this client already found while decoding.
					const rejected = (Array.isArray(preview.files) ? preview.files : [])
						.filter((entry) => typeof entry?.reason === "string" && entry.reason !== "")
						.map((entry) => ({
							name: String(entry?.name ?? ""),
							reason: String(entry.reason),
							message: typeof entry?.message === "string" ? entry.message : "",
						}));
					setImp({
						status: "confirm",
						files,
						failures: [...failures, ...rejected],
						bytes,
						entries,
						// Local wins by default; each conflict row can flip itself.
						resolutions: defaultImportResolutions(entries),
						open: {},
						previewRevision: typeof body?.revision === "number" ? body.revision : props.revision,
						message: null,
						stale: false,
					});
					setNotice(null);
				} catch (err) {
					setImp({
						status: "failed",
						files,
						failures,
						bytes,
						entries: [],
						resolutions: {},
						open: {},
						previewRevision: null,
						message: describeError(err),
						stale: false,
					});
				} finally {
					setImportBusy(false);
				}
			};

			/** Reads every picked file; one bad file is dropped on its own. */
			const readPicked = async (picked, bytes) => {
				setImportBusy(true);
				setNotice({ kind: "status", text: t("impReading") });
				const failures = [];
				const files = [];
				for (const file of picked) {
					let buffer = null;
					try {
						buffer = await file.arrayBuffer();
					} catch {
						failures.push({ name: file.name, reason: "decode" });
						continue;
					}
					const decoded = decodeUtf8(buffer);
					if (!decoded.ok) {
						failures.push({ name: file.name, reason: decoded.reason });
						continue;
					}
					files.push({ name: file.name, text: decoded.text });
				}
				if (files.length === 0) {
					setImportBusy(false);
					setNotice({
						kind: "error",
						text:
							t("impFailures", { n: failures.length }) +
							" · " +
							failures.map((entry) => entry.name + ": " + t(importReasonKey(entry.reason))).join(" · "),
					});
					return;
				}
				await previewBatch(files, failures, bytes);
			};

			/** A rejected batch and a cancelled dialog both keep the editor untouched. */
			const onFilesPicked = (fileList) => {
				const picked = Array.from(fileList ?? []);
				const node = fileRef.current;
				// Clearing the value lets the user pick the same file again.
				if (node !== null && node !== undefined) node.value = "";
				// The dialog was cancelled: no files, no editor change, no error.
				if (picked.length === 0) return;
				const pre = precheckImportFiles(picked);
				if (pre.tooManyFiles || pre.tooLarge) {
					// Over the limit the batch is refused whole, never truncated.
					setNotice({
						kind: "error",
						text:
							t("impOverTitle") +
							" · " +
							(pre.tooManyFiles
								? t("impOverFiles", { n: pre.count, max: IMPORT_LIMITS.files })
								: t("impOverSize", { size: formatBytes(pre.totalBytes), limit: formatBytes(IMPORT_LIMITS.bytes) })) +
							" · " +
							t("impOverHint"),
					});
					return;
				}
				// Files are in hand, so the discard confirmation is now honest:
				// confirming drops the draft, declining keeps it and drops the pick.
				const transition = importPickTransition(picked, { selectedId: props.selectedId, draft });
				guarded(() => {
					if (transition.action === "select") {
						const original = rows.find((item) => item.id === transition.id);
						if (original !== undefined) props.onSelect(original);
						else props.onBack();
					} else if (transition.action === "back") props.onBack();
					void readPicked(picked, pre.totalBytes);
				});
			};

			const exitImport = () => {
				setImp(null);
				setImportBusy(false);
				importBtnRef.current?.focus();
			};

			const setResolution = (at, value) => {
				setImp((current) => (current === null ? current : { ...current, resolutions: { ...current.resolutions, [at]: value } }));
			};
			const setAllResolutions = (value) => {
				setImp((current) => (current === null ? current : { ...current, resolutions: importResolutions(current.entries, value) }));
			};
			const toggleCompare = (at) => {
				setImp((current) => {
					if (current === null) return current;
					const open = { ...current.open };
					if (open[at] === true) delete open[at];
					else open[at] = true;
					return { ...current, open };
				});
			};
			const refreshPreview = () => {
				if (imp === null) return;
				void previewBatch(imp.files, imp.failures ?? [], imp.bytes ?? 0);
			};

			const commitImport = async () => {
				if (imp === null || imp.status !== "confirm") return;
				const totals = importSummary(imp.entries, imp.resolutions);
				if (totals.write === 0) return;
				setImp({ ...imp, status: "committing", message: null, stale: false });
				setImportBusy(true);
				try {
					const body = await api.importCommit(imp.files, imp.previewRevision, importResolutionMap(imp.entries, imp.resolutions));
					const touched = Array.isArray(body?.touched) ? body.touched : [];
					const first = touched.find((entry) => typeof entry?.id === "string");
					const added = Number(body?.added) || 0;
					const replaced = Number(body?.replaced) || 0;
					// Leave the preview before the reload so the panel can never show
					// the old batch beside fresh rows.
					setImp(null);
					setImportBusy(false);
					// A batch can write rows the current filter hides; clearing it keeps
					// the list and the focus target truthful.
					setManageQuery("");
					setTagFilters([]);
					try {
						// The write already happened: a refresh failure must not be
						// reported as a failed import.
						await props.reload?.();
					} catch {
						/* the next manual refresh picks the list up */
					}
					setNotice({
						kind: "status",
						text:
							replaced > 0
								? t("impWrittenOverwrite", { n: added + replaced, m: replaced })
								: t("impWritten", { n: added + replaced }),
					});
					if (first !== undefined) setFocusRowId(first.id);
					if (typeof props.onImported === "function") props.onImported(first === undefined ? null : first.id);
				} catch (err) {
					setImportBusy(false);
					// A 409 keeps the whole preview: the batch is still the user's work,
					// it just has to be confirmed against the newer library.
					if (err instanceof ApiError && err.code === "revision-conflict") {
						setImp((current) => (current === null ? current : { ...current, status: "confirm", message: null, stale: true }));
						setNotice({ kind: "error", text: t("impStale") });
					} else {
						setImp((current) => (current === null ? current : { ...current, status: "confirm", message: describeError(err) }));
					}
				}
			};

			// The preview replaces the body: focus its title so the change is
			// announced, and keep the rest of the panel reachable from there.
			react.useEffect(() => {
				if (imp === null) return;
				const node = importTitleRef.current;
				if (node !== null && node !== undefined && typeof node.focus === "function") node.focus();
			}, [imp === null]);

			// Land on the first written row once the refreshed list has rendered.
			react.useEffect(() => {
				if (focusRowId === null) return;
				const root = cardRef.current;
				if (root !== null && root !== undefined) {
					const nodes = Array.from(root.querySelectorAll("[data-row-id]"));
					const node = nodes.find((entry) => entry.getAttribute("data-row-id") === focusRowId);
					if (node !== undefined && typeof node.focus === "function") node.focus();
				}
				setFocusRowId(null);
			}, [focusRowId, rows]);
			// #endregion

			/** @param {any} item */
			const listRow = (item) => {
				const selected = item.id === props.selectedId;
				return h(
					"div",
					{
						key: item.id,
						className: "dpt-mrow",
						"data-selected": selected ? "true" : "false",
						"data-dragging": dragId === item.id ? "true" : "false",
						"data-drop": dropTarget?.id === item.id ? dropTarget.position : undefined,
						onDragOver: (event) => {
							if (dragRef.current === null || dragRef.current === item.id || props.reordering || props.loading) return;
							event.preventDefault();
							event.dataTransfer.dropEffect = "move";
							const rect = event.currentTarget.getBoundingClientRect();
							setDropTarget({ id: item.id, position: event.clientY < rect.top + rect.height / 2 ? "before" : "after" });
						},
						onDragLeave: (event) => {
							if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null);
						},
						onDrop: (event) => {
							if (dragRef.current === null) return;
							event.preventDefault();
							const rect = event.currentTarget.getBoundingClientRect();
							const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
							submitOrder(reorderVisibleIds(rows, visibleIds, dragRef.current, item.id, position));
							clearDrag();
						},
					},
					h("button", {
						type: "button",
						className: "dpt-drag-handle",
						draggable: !props.reordering && !props.loading && visibleRows.length > 1,
						"aria-disabled": props.reordering || props.loading || visibleRows.length < 2,
						title: t("dragOrder"),
						"aria-label": item.title + " · " + t("dragOrder"),
						"aria-describedby": "dpt-order-hint",
						onDragStart: (event) => {
							if (props.reordering || props.loading || visibleRows.length < 2) { event.preventDefault(); return; }
							dragRef.current = item.id;
							setDragId(item.id);
							event.dataTransfer.effectAllowed = "move";
							event.dataTransfer.setData("text/plain", item.id);
						},
						onDragEnd: clearDrag,
						onKeyDown: (event) => {
							if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
							if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
							event.preventDefault();
							submitOrder(moveVisibleIds(rows, visibleIds, item.id, event.key === "ArrowUp" ? -1 : 1));
						},
					}, icons.grip()),
					h(
						"button",
						{
							type: "button",
							className: "dpt-mrow-main",
							"data-row-id": item.id,
							onClick: () => { if (!selected) guarded(() => { setConfirmId(null); props.onSelect(item); }); },
							"aria-current": selected ? "true" : undefined,
							title: String(item.body ?? "").slice(0, 200),
						},
						h(
							"div",
							{ className: "dpt-mrow-title" },
							Boolean(item.pinned) ? h("span", { className: "dpt-icon", title: t("pinned") }, icons.pin()) : null,
							h("span", { className: "dpt-mrow-title-text" }, item.title)
						),
						h(
							"div",
							{ className: "dpt-mrow-meta" },
							templateTags(item).length > 0 ? templateTags(item).join(" · ") + " · " : "",
							scopeKind(item) === "global"
								? t("scopeGlobalChip")
								: t("scopeProjectChip", { n: scopePaths(item).length }) +
										(props.workspace !== "" && scopePaths(item).includes(props.workspace)
											? " · " + shortPath(props.workspace)
											: "")
						)
					),
					selected ? h("span", { className: "dpt-mrow-current", "aria-hidden": "true" }, icons.chevron()) : null
				);
			};

			const editor = (() => {
				if (draft === null) {
					return h("div", { className: "dpt-blank" },
						h("div", { className: "dpt-blank-copy" },
							h("span", { className: "dpt-icon", "aria-hidden": "true" }, icons.trigger()),
							h("h2", { className: "dpt-blank-title" }, rows.length === 0 ? t("emptyTitle") : t("selectHint")),
							h("div", { className: "dpt-hintline" }, t("libraryHint")),
							h("button", { type: "button", className: "dpt-btn", "data-variant": "primary", onClick: props.onCreate }, icons.plus(), t("newTemplate"))
						)
					);
				}
				const errors = draftErrors(draft);
				const titleError = errors.includes("titleRequired")
					? t("fieldTitleRequired")
					: errors.includes("titleTooLong")
						? t("titleTooLong", { n: LIMITS.title })
						: null;
				const bodyError = errors.includes("bodyRequired")
					? t("fieldBodyRequired")
					: errors.includes("bodyTooLong")
						? t("bodyTooLong", { n: LIMITS.body })
						: null;
				const tagsError = errors.includes("tooManyTags")
					? t("tooManyTags", { n: LIMITS.tags })
					: errors.includes("tagTooLong")
						? t("tagTooLong", { n: LIMITS.tag })
						: null;
				const selectedTags = parseTags(draft.tags);
				const addPendingTags = () => {
					if (tagsError === null && parseTags(draft.tagInput).length > 0) props.onDraft({ tags: draftTags(draft), tagInput: "" });
				};
				const scopeError = errors.includes("scopeRequired")
					? t("scopeRequired")
					: errors.includes("tooManyProjects")
						? t("tooManyProjects", { n: LIMITS.paths })
						: null;
				return h(
					"div",
					{ className: "dpt-editor", "aria-label": t("selectedTemplate") },
					h("div", { className: "dpt-editor-head" },
						h("button", { type: "button", className: "dpt-btn dpt-back", onClick: () => guarded(() => { setConfirmId(null); props.onBack(); }) }, t("back")),
						h("div", { className: "dpt-editor-heading" },
							h("div", { className: "dpt-editor-eyebrow" }, props.selectedId === null ? t("createTitleLabel") : t("editingNow")),
							h("h2", { className: "dpt-editor-title" }, draft.title.trim() || t("createTitleLabel"))
						),
						props.selectedId === null ? null : h("div", { className: "dpt-editor-tools", role: "group", "aria-label": t("selectedTemplate") },
							h("button", {
								type: "button", className: "dpt-btn", "data-variant": "ghost",
								"aria-pressed": Boolean(rows.find((item) => item.id === props.selectedId)?.pinned),
								disabled: props.saving || props.loading || confirmId !== null,
								onClick: () => { const item = rows.find((entry) => entry.id === props.selectedId); if (item) props.onPin(item); },
							}, icons.pin(), rows.find((item) => item.id === props.selectedId)?.pinned ? t("unpin") : t("pin")),
							h("button", {
								ref: deleteRef, type: "button", className: "dpt-btn", "data-danger": "true",
								"aria-expanded": confirmId === props.selectedId, "aria-controls": "dpt-delete-confirm",
								disabled: props.saving || props.loading,
								onClick: () => { setPending(null); setConfirmId(confirmId === props.selectedId ? null : props.selectedId); },
							}, icons.trash(), t("remove"))
						)
					),
					confirmId === props.selectedId && confirmId !== null ? h("div", {
						id: "dpt-delete-confirm", className: "dpt-confirm", "data-danger": "true", role: "alert", "aria-live": "assertive",
					},
						h("div", { className: "dpt-confirm-copy" },
							h("div", { className: "dpt-confirm-title" }, t("deleteTemplate", { title: rows.find((item) => item.id === confirmId)?.title ?? draft.title })),
							h("div", { className: "dpt-hintline" }, dirty ? t("deleteDraftWarning") : t("removeWarning"))
						),
						h("div", { className: "dpt-confirm-actions" },
							h("button", { type: "button", className: "dpt-btn", onClick: () => { setConfirmId(null); deleteRef.current?.focus(); } }, t("cancel")),
							h("button", {
								type: "button", className: "dpt-btn", "data-variant": "danger", disabled: props.saving || props.loading,
								onClick: () => { const item = rows.find((entry) => entry.id === confirmId); setConfirmId(null); titleRef.current?.focus(); if (item) props.onDelete(item); },
							}, t("remove"))
						)
					) : null,
					h(
						"div",
						{ className: "dpt-editor-scroll" },
						h(
							"div",
							{ className: "dpt-field" },
							h("label", { className: "dpt-label", htmlFor: "dpt-title" }, t("fieldTitle")),
							h("input", {
								id: "dpt-title",
								ref: titleRef,
								className: "dpt-input",
								type: "text",
								maxLength: LIMITS.title,
								value: draft.title,
								placeholder: t("titlePlaceholder"),
								required: true, "aria-invalid": titleError !== null, "aria-describedby": titleError === null ? undefined : "dpt-title-error",
								onChange: (event) => props.onDraft({ title: event.target.value }),
							}),
							titleError === null ? null : h("div", { id: "dpt-title-error", className: "dpt-error" }, titleError)
						),
						h(
							"div",
							{ className: "dpt-field" },
							h("div", { className: "dpt-field-heading" },
								h("label", { className: "dpt-label", htmlFor: "dpt-body" }, t("fieldBody")),
								h("span", { className: "dpt-field-count", "aria-hidden": "true" }, draft.body.length.toLocaleString() + " / " + LIMITS.body.toLocaleString())
							),
							h("textarea", {
								id: "dpt-body",
								className: "dpt-textarea",
								maxLength: LIMITS.body,
								value: draft.body,
								placeholder: t("bodyPlaceholder"),
								required: true, "aria-invalid": bodyError !== null,
								"aria-describedby": bodyError === null ? "dpt-body-hint" : "dpt-body-hint dpt-body-error",
								onChange: (event) => props.onDraft({ body: event.target.value }),
							}),
							h("div", { id: "dpt-body-hint", className: "dpt-hintline", style: { marginTop: 6 } }, t("bodyHint")),
							bodyError === null ? null : h("div", { id: "dpt-body-error", className: "dpt-error" }, bodyError)
						),
						h("section", { className: "dpt-editor-section", "aria-labelledby": "dpt-organize-title" },
							h("div", { className: "dpt-field-heading" },
								h("h3", { id: "dpt-organize-title", className: "dpt-section-title" }, t("organizeSection")),
								h("span", { className: "dpt-field-count", role: "status" }, selectedTags.length + " / " + LIMITS.tags)
							),
							h("div", { className: "dpt-hintline" }, t("tagChoicesHint", { n: LIMITS.tags })),
							selectedTags.length === 0 ? null : h("div", { className: "dpt-choices dpt-selected-tags", role: "group", "aria-label": t("fieldTags") },
								selectedTags.map((tag) => h("button", {
									key: tag, type: "button", className: "dpt-choice", "data-on": "true",
									title: t("removeTag", { tag }), "aria-label": t("removeTag", { tag }),
									onClick: () => props.onDraft(toggleDraftTag(draft, tag)),
								}, h("span", null, tag), icons.close()))
							),
							h("div", { className: "dpt-field dpt-tag-entry" },
								h("label", { className: "dpt-label", htmlFor: "dpt-tags" }, t("tagInputLabel")),
								h("div", { className: "dpt-tag-input-row" },
									h("input", {
										id: "dpt-tags", className: "dpt-input", type: "text",
										maxLength: LIMITS.tags * (LIMITS.tag + 2), value: draft.tagInput ?? "",
										placeholder: t("tagsPlaceholder"), "aria-invalid": tagsError !== null,
										"aria-describedby": "dpt-tags-hint" + (tagsError === null ? "" : " dpt-tags-error"),
										onChange: (event) => props.onDraft({ tagInput: event.target.value }),
										onKeyDown: (event) => {
											if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
											event.preventDefault();
											addPendingTags();
										},
									}),
									h("button", { type: "button", className: "dpt-btn", disabled: parseTags(draft.tagInput).length === 0 || tagsError !== null, onClick: addPendingTags }, icons.plus(), t("addTags"))
								),
								h("div", { id: "dpt-tags-hint", className: "dpt-hintline" }, t("tagInputHint")),
								tagsError === null ? null : h("div", { id: "dpt-tags-error", className: "dpt-error", role: "status" }, tagsError)
							),
							choices.tags.length === 0 ? null : h("div", { className: "dpt-reuse" },
								h("div", { className: "dpt-hintline" }, t("existingChoices")),
								h("div", { className: "dpt-choices", role: "group", "aria-label": t("existingChoices") },
									choices.tags.map((tag) => {
										const selected = selectedTags.some((entry) => entry.toLowerCase() === tag.toLowerCase());
										return h("button", {
											key: tag, type: "button", className: "dpt-choice", title: tag,
											"data-on": selected ? "true" : "false", "aria-pressed": selected,
											disabled: !selected && selectedTags.length >= LIMITS.tags,
											onClick: () => props.onDraft(toggleDraftTag(draft, tag)),
										}, h("span", null, tag));
									})
								)
							)
						),
						h("section", { className: "dpt-editor-section", "aria-labelledby": "dpt-scope-title" },
							h("h3", { id: "dpt-scope-title", className: "dpt-section-title" }, t("scopeSection")),
						h(
							"div",
							{ className: "dpt-field" },
							h("span", { id: "dpt-scope-label", className: "dpt-label" }, t("fieldScope")),
							h("div", { className: "dpt-scope-options", role: "group", "aria-labelledby": "dpt-scope-label" },
								["global", "projects"].map((kind) => h("label", {
									key: kind, className: "dpt-scope-option", "data-on": draft.scopeKind === kind ? "true" : "false",
								}, h("input", {
									type: "radio", name: "dpt-scope-kind", checked: draft.scopeKind === kind,
									onChange: () => props.onDraft({ scopeKind: kind }),
								}), h("span", null, t(kind === "global" ? "scopeGlobal" : "scopeProject"))))
							),
							draft.scopeKind === "projects"
								? h(
										"div",
										{ style: { marginTop: 8 } },
										h("div", { className: "dpt-project-heading" },
											h("span", { id: "dpt-project-label" }, t("selectProjects")),
											h("span", { className: "dpt-project-count", role: "status" }, t("selectedProjects", { n: draft.paths.length }))
										),
										props.projects.length === 0
											? h("div", { className: "dpt-hintline" }, t("noProjects"))
											: h(
													"div",
													{ className: "dpt-project-options", role: "group", "aria-labelledby": "dpt-project-label",
														"aria-invalid": scopeError !== null, "aria-describedby": scopeError === null ? undefined : "dpt-scope-error" },
													props.projects.map((path) => h("label", {
														key: path, className: "dpt-scope-option", title: path,
														"data-on": draft.paths.includes(path) ? "true" : "false",
													}, h("input", {
														type: "checkbox", checked: draft.paths.includes(path),
														onChange: (event) => props.onDraft({ paths: event.target.checked
															? [...draft.paths, path]
															: draft.paths.filter((entry) => entry !== path) }),
													}), h("span", null, props.projectLabels?.[path] ?? shortPath(path))))
												),
										scopeError === null ? null : h("div", { id: "dpt-scope-error", className: "dpt-error" }, scopeError),
										h("div", { className: "dpt-hintline", style: { marginTop: 6 } }, t("scopeHint"))
									)
								: h("div", { className: "dpt-hintline", style: { marginTop: 6 } }, t("scopeHint"))
						),
						h(
							"div",
							{ className: "dpt-field" },
							h(
								"label",
								{ className: "dpt-switch" },
								h("input", {
									type: "checkbox",
									checked: Boolean(draft.pinned),
									disabled: props.saving,
									onChange: (event) => props.onDraft({ pinned: event.target.checked }),
								}),
								h("span", null, t("pinnedLabel"))
							)
						)
						)
					),
					pending === null ? null : h("div", { className: "dpt-confirm", role: "alert" },
						h("div", { className: "dpt-confirm-copy" }, t("discardAsk")),
						h("div", { className: "dpt-confirm-actions" },
							h("button", { type: "button", className: "dpt-btn", onClick: () => { setPending(null); titleRef.current?.focus(); } }, t("continueEditing")),
							h("button", {
								type: "button", className: "dpt-btn", "data-variant": "danger",
								onClick: () => { const run = pending; setPending(null); setConfirmId(null); if (typeof run === "function") run(); },
							}, t("discardChanges"))
						)
					),
					h("div", { className: "dpt-editor-foot" },
						h("div", { className: "dpt-editor-status", "data-dirty": dirty ? "true" : "false", role: "status" },
							h("span", { className: "dpt-status-dot", "aria-hidden": "true" }),
							h("span", null, props.saving ? t("saving") : dirty ? t("dirtyHint") : props.selectedId === null ? t("newDraftHint") : t("savedStatus"))
						),
						h("div", { className: "dpt-editor-actions" },
							h("button", { type: "button", className: "dpt-btn", onClick: () => guarded(props.onClose) }, t("cancel")),
							h("button", {
								type: "button", className: "dpt-btn", "data-variant": "primary",
								disabled: !valid || props.saving || confirmId !== null || pending !== null, onClick: props.onSave,
							}, props.saving ? t("saving") : t("save"))
						)
					)
				);
			})();

			/**
			 * The preview replaces the panel body only: the head, the card size and
			 * the close button never move, so the way out is always in the same spot.
			 */
			const importView = () => {
				const entries = Array.isArray(imp.entries) ? imp.entries : [];
				const resolutions = imp.resolutions ?? {};
				const totals = importSummary(entries, resolutions);
				const failures = Array.isArray(imp.failures) ? imp.failures : [];
				const open = imp.open ?? {};
				const adds = entries.filter((entry) => entry?.kind === "add");
				const conflicts = entries.filter((entry) => entry?.kind === "conflict");
				const invalids = entries.filter((entry) => entry?.kind === "invalid");
				const fieldLabels = { title: t("impFieldTitle"), tags: t("impFieldTags"), scope: t("impFieldScope") };
				const titleOf = (entry) => (String(entry?.title ?? "").trim() === "" ? t("impUntitled") : String(entry.title));
				const tagsLabel = (item) => {
					const tags = parseTags(item?.tags);
					return tags.length === 0 ? t("impNoTags") : tags.join(" · ");
				};
				const scopeLabel = (item) =>
					scopeKind(item) === "global" ? t("scopeGlobalChip") : t("scopeProjectChip", { n: scopePaths(item).length });
				const metaOf = (entry) => {
					const parts = [typeof entry?.file === "string" && entry.file !== "" ? entry.file : null, tagsLabel(entry?.incoming), scopeLabel(entry?.incoming)];
					if (Array.isArray(entry?.missingPaths) && entry.missingPaths.length > 0) parts.push(t("impUnknownPaths", { n: entry.missingPaths.length }));
					return parts.filter((part) => part !== null && part !== "").join(" · ");
				};
				// Rendered only when the entry carries a host warning: a clean row owns
				// no empty placeholder, so switching batches never shifts the layout.
				const warningLine = (entry) => {
					const key = importWarningKey(entry);
					if (key === null) return null;
					return h(
						"div",
						{ className: "dpt-irow-warning" },
						h("span", { className: "dpt-irow-warning-icon", "aria-hidden": "true" }, icons.warn()),
						h("span", null, t(key))
					);
				};

				const compareCol = (heading, bodyLabel, item) =>
					h(
						"div",
						{ className: "dpt-cmp-col" },
						h("div", { className: "dpt-cmp-head" }, heading),
						h("div", { className: "dpt-cmp-field" },
							h("span", { className: "dpt-cmp-label" }, fieldLabels.title),
							h("span", { className: "dpt-cmp-value" }, String(item?.title ?? "").trim() === "" ? t("impUntitled") : String(item.title))
						),
						h("div", { className: "dpt-cmp-field" },
							h("span", { className: "dpt-cmp-label" }, fieldLabels.tags),
							h("span", { className: "dpt-cmp-value" }, tagsLabel(item))
						),
						h("div", { className: "dpt-cmp-field" },
							h("span", { className: "dpt-cmp-label" }, fieldLabels.scope),
							h("span", { className: "dpt-cmp-value" }, scopeLabel(item))
						),
						h("div", { className: "dpt-cmp-subtitle" }, bodyLabel + " · " + t("impBodyChars", { n: String(item?.body ?? "").length })),
						// Plain text on purpose: a diff view would imply an editability
						// the preview does not have.
						h("pre", { className: "dpt-cmp-body", tabIndex: 0, "aria-label": bodyLabel }, String(item?.body ?? ""))
					);

				const addRow = (entry) => {
					const expanded = open[entry.at] === true;
					const panelId = importElementId("dpt-cmp", entry.at);
					const label = titleOf(entry);
					return h(
						"li",
						{ key: entry.at, className: "dpt-irow", "data-kind": "add" },
						h(
							"div",
							{ className: "dpt-irow-line" },
							h(
								"button",
								{
									type: "button",
									className: "dpt-irow-main",
									"aria-expanded": expanded,
									"aria-controls": expanded ? panelId : undefined,
									title: expanded ? t("impCollapse", { title: label }) : t("impExpand", { title: label }),
									onClick: () => toggleCompare(entry.at),
								},
								h(
									"div",
									{ className: "dpt-irow-title" },
									h("span", { className: "dpt-irow-arrow", "data-open": expanded ? "true" : "false", "aria-hidden": "true" }, icons.chevron()),
									h("span", null, label)
								),
								h("div", { className: "dpt-irow-meta" }, metaOf(entry))
							)
						),
						warningLine(entry),
						// A new entry has no local side; the panel shows what would be
						// written, read-only.
						expanded
							? h("div", { className: "dpt-compare", id: panelId, "data-single": "true" },
								compareCol(t("impSideImported"), t("impImportedBody"), entry.incoming))
							: null
					);
				};

				const conflictRow = (entry) => {
					const useImported = importResolution(resolutions, entry.at) === "import";
					const expanded = open[entry.at] === true;
					const panelId = importElementId("dpt-cmp", entry.at);
					const diff = importDiffFields(entry.local, entry.incoming);
					const label = titleOf(entry);
					return h(
						"li",
						{
							key: entry.at,
							className: "dpt-irow",
							"data-kind": "conflict",
							"data-imported": useImported ? "true" : "false",
						},
						h(
							"div",
							{ className: "dpt-irow-line" },
							h(
								"button",
								{
									type: "button",
									className: "dpt-irow-main",
									"aria-expanded": expanded,
									"aria-controls": expanded ? panelId : undefined,
									title: expanded ? t("impCollapse", { title: label }) : t("impExpand", { title: label }),
									onClick: () => toggleCompare(entry.at),
								},
								h(
									"div",
									{ className: "dpt-irow-title" },
									h("span", { className: "dpt-irow-arrow", "data-open": expanded ? "true" : "false", "aria-hidden": "true" }, icons.chevron()),
									h("span", null, label)
								),
								// The state is spelled out in words, not in a colour or an icon
								// alone: which version will be written must never be a guess.
								h("div", { className: "dpt-irow-meta", "data-imported": useImported ? "true" : "false" },
									useImported ? t("impCurrentImported") : t("impCurrentLocal")),
								h("div", { className: "dpt-irow-meta" },
									diff.length === 0 ? t("impDiffNone") : t("impDiffFields", { fields: diff.map((field) => fieldLabels[field]).join(" · ") })),
								Array.isArray(entry.missingPaths) && entry.missingPaths.length > 0
									? h("div", { className: "dpt-irow-meta" }, t("impUnknownPaths", { n: entry.missingPaths.length }))
									: null,
								typeof entry.file === "string" && entry.file !== "" ? h("div", { className: "dpt-irow-meta" }, entry.file) : null
							),
							h(
								"label",
								{ className: "dpt-irow-choice" },
								h("input", {
									type: "checkbox",
									checked: useImported,
									disabled: importBusy,
									onChange: (event) => setResolution(entry.at, event.target.checked ? "import" : "local"),
								}),
								h("span", null, t("impUseImported"))
							)
						),
						warningLine(entry),
						expanded
							? h(
									"div",
									{ className: "dpt-compare", id: panelId },
									compareCol(t("impSideLocal"), t("impLocalBody"), entry.local),
									compareCol(t("impSideImported"), t("impImportedBody"), entry.incoming)
								)
							: null
					);
				};

				const invalidRow = (entry) =>
					h(
						"li",
						{ key: entry.at, className: "dpt-irow", "data-kind": "invalid" },
						h(
							"div",
							{ className: "dpt-irow-line" },
							h(
								"div",
								{ className: "dpt-irow-main dpt-irow-main-static" },
								h("div", { className: "dpt-irow-title" }, titleOf(entry)),
								h("div", { className: "dpt-irow-meta" }, typeof entry.file === "string" && entry.file !== "" ? entry.file : null),
								h("div", { className: "dpt-irow-meta dpt-irow-reason" },
									typeof entry.message === "string" && entry.message !== ""
										? entry.message
										: t(importReasonKey(entry.reason)))
							)
						)
					);

				const jumpTo = (kind) => {
					const root = cardRef.current;
					if (root === null || root === undefined) return;
					const section = root.querySelector("#" + importElementId("dpt-isec", kind));
					if (section === null) return;
					if (typeof section.scrollIntoView === "function") section.scrollIntoView({ block: "start" });
					const heading = section.querySelector(".dpt-isec-title");
					if (heading !== null && typeof heading.focus === "function") heading.focus({ preventScroll: true });
				};

				const section = (kind, titleKey, noteKey, count, nodes, actions) =>
					count === 0
						? null
						: h(
								"section",
								{
									className: "dpt-isec",
									id: importElementId("dpt-isec", kind),
									"aria-labelledby": importElementId("dpt-isec-title", kind),
								},
								h(
									"div",
									{ className: "dpt-isec-head" },
									h("h3", { className: "dpt-isec-title", id: importElementId("dpt-isec-title", kind), tabIndex: -1 },
										t(titleKey) + " ",
										h("span", { className: "dpt-isec-count" }, String(count))),
									h("span", { className: "dpt-isec-note" }, t(noteKey)),
									actions === null ? null : h("div", { className: "dpt-isec-actions" }, ...actions)
								),
								h("ul", { className: "dpt-isec-list" }, nodes)
							);

				const hasContent = entries.length > 0 && imp.status !== "failed";
				const busy = importBusy ? "true" : "false";
				const failuresList =
					failures.length === 0
						? null
						: h(
								"section",
								{ className: "dpt-isec", "aria-label": t("impFailures", { n: failures.length }) },
								h(
									"div",
									{ className: "dpt-isec-head" },
									h("h3", { className: "dpt-isec-title" }, t("impFailures", { n: failures.length }))
								),
								h("ul", { className: "dpt-fails" },
									failures.map((entry, index) =>
										h("li", { key: String(entry?.name ?? "") + "-" + index },
											String(entry?.name ?? "") + " · " +
												(typeof entry?.message === "string" && entry.message !== ""
													? entry.message
													: t(importReasonKey(entry?.reason))))))
							);

				return h(
					"div",
					{ className: "dpt-import", "aria-busy": busy },
					h(
						"div",
						{ className: "dpt-import-head" },
						h("h2", { className: "dpt-import-title", ref: importTitleRef, tabIndex: -1 }, t("impTitle")),
						h("div", { className: "dpt-import-sub" }, t("impSub"))
					),
					hasContent
						? h(
								"div",
								{ className: "dpt-isum" },
								h("div", { className: "dpt-isum-files" },
									t("impSummaryFiles", { files: imp.files.length, size: formatBytes(imp.bytes) })),
								h(
									"div",
									{ className: "dpt-isum-jumps" },
									totals.add === 0
										? null
										: h("button", { type: "button", className: "dpt-jump", onClick: () => jumpTo("add") }, t("impJumpAdd", { n: totals.add })),
									totals.conflict === 0
										? null
										: h("button", { type: "button", className: "dpt-jump", onClick: () => jumpTo("conflict") }, t("impJumpConflict", { n: totals.conflict })),
									totals.invalid === 0
										? null
										: h("button", { type: "button", className: "dpt-jump", onClick: () => jumpTo("invalid") }, t("impJumpInvalid", { n: totals.invalid }))
								)
							)
						: null,
					hasContent
						? h(
								"div",
								{ className: "dpt-import-scroll" },
								failuresList,
								section("add", "impSecNew", "impSecNewNote", adds.length, adds.map(addRow), null),
								section(
									"conflict",
									"impSecConflict",
									"impSecConflictNote",
									conflicts.length,
									conflicts.map(conflictRow),
									[
										h("button", {
											key: "use-all",
											type: "button",
											className: "dpt-btn",
											disabled: importBusy || totals.conflict === 0 || totals.overwrite === totals.conflict,
											onClick: () => setAllResolutions("import"),
										}, t("impUseAll")),
										h("button", {
											key: "keep-all",
											type: "button",
											className: "dpt-btn",
											disabled: importBusy || totals.conflict === 0 || totals.keptLocal === totals.conflict,
											onClick: () => setAllResolutions("local"),
										}, t("impKeepAll")),
									]
								),
								section("invalid", "impSecInvalid", "impSecInvalidNote", invalids.length, invalids.map(invalidRow), null)
							)
						: h(
								"div",
								{ className: "dpt-import-empty" },
								h("strong", null, t("impEmptyTitle")),
								h("div", null, typeof imp.message === "string" && imp.message !== "" ? imp.message : t("impEmptyHint")),
								failuresList,
								h("button", { type: "button", className: "dpt-btn", onClick: pickFiles }, t("impPickAgain")),
								h("button", { type: "button", className: "dpt-btn", onClick: exitImport }, t("cancel"))
							),
					hasContent
						? h(
								"div",
								{ className: "dpt-import-foot" },
								h("div", { className: "dpt-import-status" },
									h("div", null,
										typeof imp.message === "string" && imp.message !== ""
											? imp.message
											: imp.stale
												? t("impStale")
												: t("impSummaryBar", { add: totals.add, over: totals.overwrite, skip: totals.skip })),
									// The footer repeats the warning count so a collapsed row can
									// never hide a rewritten body.
									totals.warnings > 0
										? h("div", { className: "dpt-import-warn" },
											h("span", { className: "dpt-irow-warning-icon", "aria-hidden": "true" }, icons.warn()),
											h("span", null, t("impWarnCount", { n: totals.warnings })))
										: null),
								h(
									"div",
									{ className: "dpt-import-actions" },
									imp.stale
										? h("button", { type: "button", className: "dpt-btn", disabled: importBusy, onClick: refreshPreview }, t("impRefresh"))
										: null,
									h("button", { type: "button", className: "dpt-btn", disabled: importBusy, onClick: exitImport }, t("cancel")),
									h("button", {
										type: "button",
										className: "dpt-btn",
										"data-variant": "primary",
										disabled: importBusy || totals.write === 0,
										onClick: () => void commitImport(),
									},
										imp.status === "committing"
											? t("impWriting")
											: totals.overwrite > 0
												? t("impWriteWithOverwrite", { n: totals.write, m: totals.overwrite })
												: t("impWrite", { n: totals.write }))
								)
							)
						: null
				);
			};

			return h(
				"div",
				{
					className: "dpt-modal",
					role: "dialog",
					"aria-modal": "true",
					"aria-label": t("manageTitle"),
					onKeyDown,
					onMouseDown: (event) => {
						if (event.target === event.currentTarget) guarded(props.onClose);
					},
				},
				h(
					"div",
					{ className: "dpt-modal-card", ref: cardRef, tabIndex: -1 },
					h(
						"div",
						{ className: "dpt-modal-head" },
						h("div", null, h("div", { className: "dpt-modal-title" }, t("manageTitle")), h("div", { className: "dpt-modal-sub" }, t("libraryHint"))),
						h("div", { className: "dpt-spacer" }),
						h(
							"div",
							{ className: "dpt-head-actions" },
							h(
								"button",
								{
									ref: importBtnRef,
									type: "button",
									className: "dpt-btn",
									disabled: props.loading || importBusy || exporting !== null || imp !== null,
									onClick: () => startImport(),
								},
								icons.imp(),
								t("impAction")
							),
							h(
								"div",
								{ className: "dpt-menu-wrap" },
								h(
									"button",
									{
										ref: exportBtnRef,
										type: "button",
										className: "dpt-btn",
										"aria-haspopup": "menu",
										"aria-expanded": exportOpen,
										"aria-controls": exportOpen ? "dpt-export-menu" : undefined,
										"aria-busy": exporting !== null,
										disabled: props.loading || importBusy || exporting !== null,
										onClick: () => setExportOpen(!exportOpen),
									},
									icons.exp(),
									exporting === null ? t("expAction") : t("expLoading")
								),
								exportOpen
									? h(
											"div",
											{
												id: "dpt-export-menu",
												className: "dpt-menu",
												role: "menu",
												ref: menuRef,
												"aria-label": t("expAction"),
												onKeyDown: onMenuKeyDown,
											},
											menuItems.map((entry) =>
												h(
													"button",
													{
														key: entry.key,
														type: "button",
														role: "menuitem",
														className: "dpt-menu-item",
														tabIndex: -1,
														onClick: () => void runExport(entry),
													},
													h("span", { className: "dpt-menu-item-title" }, t(entry.labelKey)),
													h("span", { className: "dpt-menu-item-hint" }, t(entry.hintKey))
												))
										)
									: null
							),
							// Hidden but not `display:none`: the picker must stay clickable
							// from the keyboard-reachable Import button.
							h("input", {
								ref: fileRef,
								type: "file",
								className: "dpt-sr-only",
								multiple: true,
								tabIndex: -1,
								"aria-hidden": "true",
								accept: ".json,.md,.markdown,.txt,application/json,text/markdown,text/plain",
								onChange: (event) => void onFilesPicked(event.target.files),
							})
						),
						h(
							"button",
							{
								type: "button",
								className: "dpt-btn",
								title: t("close"),
								"aria-label": t("close"),
								onClick: () => guarded(props.onClose),
							},
							icons.close()
						)
					),
					notice === null
						? null
						: h(
								"div",
								{ className: "dpt-notice", role: "status", "aria-live": "polite", "data-kind": notice.kind },
								h("span", null, notice.text),
								notice.kind === "error"
									? h("button", {
											type: "button",
											className: "dpt-btn",
											title: t("close"),
											"aria-label": t("close"),
											onClick: () => setNotice(null),
										}, icons.close())
									: null
							),
					props.savingError === null ? null : h("div", { className: "dpt-confirm", role: "alert" },
						h("div", { className: "dpt-confirm-copy dpt-error" }, props.savingError),
						h("button", { type: "button", className: "dpt-btn", disabled: props.saving || props.loading, onClick: props.onRetry }, t("refresh"))
					),
					h(
						"div",
						{
							className: "dpt-modal-body",
							"data-editing": editing && imp === null ? "true" : "false",
							"data-import": imp === null ? "false" : "true",
						},
						imp !== null
							? null
							: h(
							"div",
							{ className: "dpt-pane" },
							h(
								"div",
								{ className: "dpt-pane-head" },
								h("div", { className: "dpt-pane-toolbar" },
									h("div", { className: "dpt-pane-heading" },
										h("h2", { className: "dpt-pane-title" }, t("manageSub")),
										h("span", { className: "dpt-hintline dpt-pane-count", "aria-live": "polite" },
											filterCount > 0 || manageQuery.trim() !== "" ? t("filterCount", { visible: visibleRows.length, total: rows.length }) : t("count", { n: rows.length }))
									),
									h("button", { type: "button", className: "dpt-btn", "data-variant": "primary", onClick: () => guarded(() => { setConfirmId(null); props.onCreate(); }) }, icons.plus(), h("span", null, t("newTemplate")))
								),
								h("div", { className: "dpt-pane-toolbar" },
									h("input", {
										ref: searchRef, type: "search", className: "dpt-manage-search",
										placeholder: t("searchPlaceholder"), "aria-label": t("searchPlaceholder"), value: manageQuery,
										onChange: (event) => { setManageQuery(event.target.value); clearDrag(); },
									}),
									h("button", {
										type: "button", className: "dpt-btn", "data-variant": filterCount > 0 ? "primary" : "ghost",
										"aria-expanded": filterOpen, "aria-controls": "dpt-filters", onClick: () => setFilterOpen(!filterOpen),
									}, icons.filter(), t("filters") + (filterCount > 0 ? " (" + filterCount + ")" : ""))
								)
							),
							filterOpen ? h("div", { id: "dpt-filters", className: "dpt-filter-panel" },
								choices.tags.length === 0 ? null : h("fieldset", { className: "dpt-filter-group" },
									h("legend", null, t("fieldTags")),
									h("div", { className: "dpt-filter-checks" }, choices.tags.map((value) => h("label", { key: value, className: "dpt-filter-check" },
										h("input", { type: "checkbox", checked: tagFilters.includes(value), onChange: () => { toggleFilter(setTagFilters, tagFilters, value); clearDrag(); } }),
										h("span", null, value)
									)))
								),
								h("div", { className: "dpt-hintline" }, t(choices.tags.length === 0 ? "noChoices" : "filterHint")),
								h("button", { type: "button", className: "dpt-btn", disabled: filterCount === 0, onClick: () => { setTagFilters([]); clearDrag(); } }, t("clearFilters"))
							) : null,
							h("div", { id: "dpt-order-hint", className: "dpt-order-hint", role: "status" }, props.reordering ? t("reorderSaving") : t("reorderHint")),
							props.loading && rows.length === 0
								? h("div", { className: "dpt-blank" }, t("loading"))
								: props.error !== null
									? h(
											"div",
											{ className: "dpt-blank" },
											h(
												"div",
												null,
												h("div", null, t("loadFailed")),
												h(
													"button",
													{ type: "button", className: "dpt-btn", onClick: props.onRetry },
													t("retry")
												)
											)
										)
									: h(
											"div",
											{ className: "dpt-manage-list", "aria-busy": props.loading },
											visibleRows.length === 0
												? h("div", { className: "dpt-blank" }, rows.length === 0 ? t("emptyTitle") : t("filterEmpty"))
												: visibleRows.map(listRow)
										)
						),
						imp === null ? editor : importView()
					)
				)
			);
		}
		// #endregion

		// #region slot component
		/**
		 * Composer trigger: owns the picker state, the caret snapshot and both
		 * portals.
		 * @param {any} props - composer slot props (`inputActions`, `sessionId`, …)
		 */
		function PromptTemplateButton(props) {
			const lang = useLanguage();
			const t = react.useMemo(() => makeT(lang), [lang]);

			const triggerRef = react.useRef(null);
			const popRef = react.useRef(null);
			const popRootRef = react.useRef(null);
			const searchRef = react.useRef(null);
			const spanRef = react.useRef(null);
			const returnFocusRef = react.useRef(false);

			const [open, setOpen] = react.useState(false);
			const [managing, setManaging] = react.useState(false);
			const [items, setItems] = react.useState([]);
			const [projects, setProjects] = react.useState([]);
			const [workspace, setWorkspace] = react.useState("");
			const [loading, setLoading] = react.useState(false);
			const [error, setError] = react.useState(null);
			const [query, setQuery] = react.useState("");
			const [activeIndex, setActiveIndex] = react.useState(0);
			const [rect, setRect] = react.useState(null);
			const [draft, setDraft] = react.useState(null);
			const [selectedId, setSelectedId] = react.useState(null);
			const [saving, setSaving] = react.useState(false);
			const [reordering, setReordering] = react.useState(false);
			const reorderRef = react.useRef(false);
			const [savingError, setSavingError] = react.useState(null);
			// Revision of the list this tab has seen; sent with every mutation so
			// the host can answer 409 instead of silently dropping a concurrent edit.
			const [revision, setRevision] = react.useState(null);
			const [projectLabels, setProjectLabels] = react.useState({});

			// Latest draft for async handlers: a save that resolves after the user
			// edited, switched rows, or closed the panel must not overwrite them.
			const draftRef = react.useRef(null);
			draftRef.current = draft;
			const selectedIdRef = react.useRef(null);
			selectedIdRef.current = selectedId;
			const saveSeqRef = react.useRef(0);

			const sessionId = typeof props?.sessionId === "string" ? props.sessionId : "";

			const report = react.useCallback(
				/** @param {string} message */
				(message) => {
					try {
						if (typeof props?.inputActions?.notify === "function") {
							props.inputActions.notify("error", message);
							return;
						}
						if (typeof props?.notify === "function") {
							props.notify("error", message);
							return;
						}
					} catch {
						/* notification surface is optional */
					}
					console.warn("[dsh-prompt-template] " + message);
				},
				[props]
			);

			const describe = react.useCallback(
				/** @param {any} err */
				(err) => {
					const code = err instanceof ApiError ? err.code : "request_failed";
					if (code === "unauthorized") return t("unauthorized");
					if (code === "revision-conflict") return t("conflictKeep");
					if (code === "not-found") return t("notFound");
					if (code === "invalid-order") return t("invalidOrder");
					if (code === "invalid-input") return t("invalidInput");
					if (code === "storage-unavailable") return t("storageUnavailable");
					if (code === "forbidden-origin") return t("forbiddenOrigin");
					return typeof err?.message === "string" && err.message !== code ? err.message : t("requestFailed");
				},
				[t]
			);

			// Only the newest list request may write state: the picker loads the
			// scoped list while the manager loads the whole library, and a slower
			// scoped answer arriving second would silently shrink the manager.
			const loadSeqRef = react.useRef(0);

			const load = react.useCallback(
				/** @param {boolean} all */
				async (all) => {
					const seq = loadSeqRef.current + 1;
					loadSeqRef.current = seq;
					setLoading(true);
					setError(null);
					try {
						const body = await api.list(sessionId, all);
						if (seq !== loadSeqRef.current) return null;
						const next = Array.isArray(body?.items) ? body.items : [];
						setItems(next);
						// The host's revision travels with every later mutation.
						setRevision(typeof body?.revision === "number" ? body.revision : null);
						setWorkspace(typeof body?.workspace === "string" ? body.workspace : "");
						const nextProjects = Array.isArray(body?.projects)
							? body.projects
									.map((entry) => (typeof entry === "string" ? entry : entry?.path))
									.filter((entry) => typeof entry === "string" && entry !== "")
							: [];
						setProjects(nextProjects);
						const labels = body?.projectLabels;
						setProjectLabels(labels !== null && typeof labels === "object" ? labels : {});
						return next;
					} catch (err) {
						if (seq === loadSeqRef.current) setError(describe(err));
						return null;
					} finally {
						if (seq === loadSeqRef.current) setLoading(false);
					}
				},
				[sessionId, describe]
			);

			const measure = react.useCallback(() => {
				const node = triggerRef.current;
				if (node === null || node === undefined) return;
				const box = node.getBoundingClientRect();
				setRect({ left: box.left, top: box.top, bottom: box.bottom });
			}, []);

			const openPicker = react.useCallback(() => {
				const actions = props?.inputActions;
				spanRef.current =
					typeof actions?.captureInsertion === "function" ? actions.captureInsertion() : null;
				returnFocusRef.current = true;
				setQuery("");
				setActiveIndex(0);
				setOpen(true);
				measure();
				void load(false);
			}, [props, measure, load]);

			const closePicker = react.useCallback(
				/** @param {boolean} [restoreFocus] */
				(restoreFocus) => {
					setOpen(false);
					setActiveIndex(0);
					if (restoreFocus === true && returnFocusRef.current) {
						const node = triggerRef.current;
						if (node !== null && node !== undefined) node.focus();
					}
				},
				[]
			);

			const openManage = react.useCallback(
				/** @param {any} [preset] */
				(preset) => {
					setOpen(false);
					setManaging(true);
					setSavingError(null);
					void load(true);
					if (preset === "new") {
						setSelectedId(null);
						setDraft({
							id: null,
							title: "",
							body: "",
							tags: [],
							tagInput: "",
							scopeKind: "global",
							paths: [],
							pinned: false,
						});
					} else if (preset !== undefined) {
						setSelectedId(typeof preset.id === "string" ? preset.id : null);
						setDraft(toDraft(preset));
					} else {
						setSelectedId(null);
						setDraft(null);
					}
				},
				[load]
			);

			const closeManage = react.useCallback(() => {
				setManaging(false);
				setDraft(null);
				setSelectedId(null);
				setSavingError(null);
				const node = triggerRef.current;
				if (node !== null && node !== undefined) node.focus();
			}, []);

			const insert = react.useCallback(
				/** @param {any} item */
				(item) => {
					const actions = props?.inputActions;
					const span = spanRef.current;
					if (typeof actions?.insertText !== "function" || span === null || span === undefined) {
						report(t("insertFailed"));
						return;
					}
					const ok = actions.insertText(String(item.body ?? ""), span);
					if (ok !== true) {
						// The captured span is stale because the draft moved under us.
						// Close the picker instead of silently re-capturing: a fresh open
						// captures the current cursor, so the user sees where it lands.
						closePicker(false);
						report(t("draftChanged"));
						return;
					}
					setOpen(false);
					setQuery("");
					setActiveIndex(0);
					// Hand focus back to the composer trigger so the user can keep typing.
					const node = triggerRef.current;
					if (node !== null && node !== undefined) node.focus();
					// Recording the use is fire-and-forget. Its revision is deliberately
					// NOT adopted: a touch that lands later would hand this stale
					// snapshot a newer revision and let it overwrite another surface's
					// edit. The next load() is what resynchronizes.
					if (typeof item.id === "string") void api.touch(item.id, sessionId).catch(() => {});
				},
				[props, report, t, sessionId, closePicker]
			);

			// Outside click closes the popover without stealing focus back.
			react.useEffect(() => {
				if (!open) return undefined;
				const onPointerDown = (event) => {
					const pop = popRootRef.current;
					const trigger = triggerRef.current;
					const target = event.target;
					if (pop !== null && pop !== undefined && pop.contains(target)) return;
					if (trigger !== null && trigger !== undefined && trigger.contains(target)) return;
					closePicker(false);
				};
				const onEscape = (event) => {
					// An IME owns Escape while composing; closing here would eat the
					// candidate window and look like a lost draft.
					if (event.isComposing === true || event.keyCode === 229) return;
					if (event.key === "Escape") closePicker(true);
				};
				const onReposition = () => measure();
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onEscape, true);
				window.addEventListener("resize", onReposition);
				window.addEventListener("scroll", onReposition, true);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onEscape, true);
					window.removeEventListener("resize", onReposition);
					window.removeEventListener("scroll", onReposition, true);
				};
			}, [open, closePicker, measure]);

			// Search field takes focus as soon as the popover appears.
			react.useEffect(() => {
				if (!open) return;
				const node = searchRef.current;
				if (node !== null && node !== undefined && typeof node.focus === "function") node.focus();
			}, [open]);

			// Modal keeps the page scroll position but blocks background interaction.
			react.useEffect(() => {
				if (!managing) return undefined;
				const previous = document.body.style.overflow;
				document.body.style.overflow = "hidden";
				return () => {
					document.body.style.overflow = previous;
				};
			}, [managing]);

			const save = react.useCallback(async () => {
				if (draft === null || !draftIsValid(draft)) return;
				setSaving(true);
				setSavingError(null);
				const seq = saveSeqRef.current + 1;
				saveSeqRef.current = seq;
				// Snapshot by identity: React hands out a new draft object on every
				// keystroke and on every row switch, so an unchanged identity at
				// resolve time means nobody touched the editor meanwhile.
				const snapshot = draft;
				try {
					const payload = fromDraft(draft);
					const body = await api.save(payload, revision, sessionId);
					if (typeof body?.revision === "number") setRevision(body.revision);
					const saved = body?.item ?? null;
					const refreshed = await load(true);
					if (saveSeqRef.current !== seq) return;
					const list = Array.isArray(refreshed) ? refreshed : items;
					setItems(list);
					if (draftRef.current !== snapshot) return;
					const targetId = typeof saved?.id === "string" ? saved.id : typeof payload.id === "string" ? payload.id : null;
					setSelectedId(targetId);
					const fresh = targetId === null ? undefined : list.find((entry) => entry.id === targetId);
					const next = fresh ?? (saved === null ? undefined : saved);
					setDraft(next === undefined || next === null ? null : toDraft(next));
				} catch (err) {
					if (saveSeqRef.current !== seq) return;
					// A conflict must keep the draft: the edit is the user's work, and the
					// freshly loaded list is what they compare it against before retrying.
					if (err instanceof ApiError && err.code === "revision-conflict") {
						if (typeof err.revision === "number") setRevision(err.revision);
						void load(true);
						setSavingError(t("conflictKeep"));
					} else {
						setSavingError(describe(err));
					}
				} finally {
					if (saveSeqRef.current === seq) setSaving(false);
				}
			}, [draft, load, describe, items, revision, sessionId, t]);

			const remove = react.useCallback(
				/** @param {any} item */
				async (item) => {
					try {
						const body = await api.remove(item.id, revision, sessionId);
						if (typeof body?.revision === "number") setRevision(body.revision);
						const refreshed = await load(true);
						setItems(Array.isArray(refreshed) ? refreshed : items);
						// Compare against the row selected *now*, not the one at click time.
						if (selectedIdRef.current === item.id) {
							setSelectedId(null);
							setDraft(null);
						}
					} catch (err) {
						// Adopt the host's revision on a conflict, otherwise every later
						// mutation would keep failing against the same stale number.
						if (err instanceof ApiError && err.code === "revision-conflict") {
							if (typeof err.revision === "number") setRevision(err.revision);
							void load(true);
							setSavingError(t("conflictKeep"));
						} else {
							setSavingError(describe(err));
						}
					}
				},
				[load, selectedId, describe, items, revision, sessionId, t]
			);

			const togglePin = react.useCallback(
				/** @param {any} item */
				async (item) => {
					if (saving || loading || reorderRef.current) return;
					setSaving(true);
					setSavingError(null);
					try {
						const body = await api.save(fromDraft({ ...toDraft(item), pinned: !item.pinned }), revision, sessionId);
						if (body?.item) setDraft((current) => syncDraftPin(current, body.item, item));
						if (typeof body?.revision === "number") setRevision(body.revision);
						const refreshed = await load(true);
						setItems(Array.isArray(refreshed) ? refreshed : items);
					} catch (err) {
						setSavingError(describe(err));
					} finally {
						setSaving(false);
					}
				},
				[load, describe, items, revision, sessionId, saving, loading]
			);

			const reorder = react.useCallback(
				/** @param {string[]} ids Full permutation, including hidden rows. */
				async (ids) => {
					if (reorderRef.current || saving || loading || sameList(ids, items.map((entry) => entry.id))) return;
					if (ids.length !== items.length || new Set(ids).size !== ids.length || ids.some((id) => !items.some((item) => item.id === id))) return;
					reorderRef.current = true;
					setReordering(true);
					setSavingError(null);
					try {
						// Commit only after Host accepts this revision. No list reload is
						// needed: it would unmount handles and break keyboard focus.
						const body = await api.reorder(ids, revision, sessionId);
						if (typeof body?.revision === "number") setRevision(body.revision);
						const byId = new Map(items.map((item) => [item.id, item]));
						setItems(Array.isArray(body?.items) ? body.items : ids.map((id) => byId.get(id)));
					} catch (err) {
						// Keep both the visible order and any editor draft on conflict.
						// The user explicitly refreshes before retrying stale data.
						setSavingError(describe(err));
					} finally {
						reorderRef.current = false;
						setReordering(false);
					}
				},
				[items, saving, loading, describe, revision, sessionId]
			);

			const onTriggerClick = () => {
				if (open) {
					closePicker(false);
					return;
				}
				openPicker();
			};

			const popStyle = (() => {
				const margin = 8;
				const width = Math.min(POPOVER_WIDTH, Math.max(0, window.innerWidth - margin * 2));
				const style = { width };
				if (rect === null) {
					style.left = margin;
					style.bottom = margin;
					style.maxHeight = Math.min(POPOVER_MAX_HEIGHT, Math.max(0, window.innerHeight - margin * 2));
					return style;
				}
				const spaceAbove = Math.max(0, rect.top - POPOVER_GAP - margin);
				const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - POPOVER_GAP - margin);
				style.left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
				if (spaceAbove >= Math.min(POPOVER_MAX_HEIGHT, spaceBelow)) {
					style.bottom = Math.max(margin, window.innerHeight - rect.top + POPOVER_GAP);
					style.maxHeight = Math.min(POPOVER_MAX_HEIGHT, spaceAbove);
				} else {
					style.top = Math.max(margin, rect.bottom + POPOVER_GAP);
					style.maxHeight = Math.min(POPOVER_MAX_HEIGHT, spaceBelow);
				}
				return style;
			})();

			const picker =
				open && !managing
					? react_dom.createPortal(
							h(Picker, {
								t,
								lang,
								items,
								workspace,
								query,
								loading,
								error,
								activeIndex,
								style: popStyle,
								searchRef,
								listRef: popRef,
								rootRef: popRootRef,
								onQuery: (value) => {
									setQuery(value);
									setActiveIndex(0);
								},
								onActive: setActiveIndex,
								onChoose: insert,
								onManage: () => openManage(),
								onCreate: () => openManage("new"),
								onRetry: () => void load(false),
								onClose: () => closePicker(true),
							}),
							document.body
						)
					: null;

			const modal = managing
				? react_dom.createPortal(
						h(ManagePanel, {
							t,
							lang,
							items,
							projects,
							projectLabels,
							workspace,
							loading,
							error,
							draft,
							selectedId,
							saving: saving || reordering,
							reordering,
							savingError,
							revision,
							describeError: describe,
							reload: () => load(true),
							onImported: () => setSavingError(null),
							onClose: closeManage,
							onBack: () => { setSelectedId(null); setDraft(null); setSavingError(null); },
							onSelect: (item) => {
								setSelectedId(item.id);
								setDraft(toDraft(item));
								setSavingError(null);
							},
							onCreate: () => {
								setSelectedId(null);
								setDraft({
									id: null,
									title: "",
									body: "",
									tags: [],
									tagInput: "",
									scopeKind: "global",
									paths: [],
									pinned: false,
								});
							},
							onDraft: (patch) => setDraft((current) => (current === null ? current : { ...current, ...patch })),
							onSave: () => void save(),
							onDelete: (item) => void remove(item),
							onPin: (item) => void togglePin(item),
							onReorder: (ids) => void reorder(ids),
							onRetry: () => { setSavingError(null); void load(true); },
						}),
						document.body
					)
				: null;

			return h(
				react.Fragment,
				null,
				h(
					"button",
					{
						ref: triggerRef,
						type: "button",
						className: "dpt-trigger",
						"data-lang": lang,
						"data-open": open || managing ? "true" : "false",
						title: t("triggerTitle"),
						"aria-label": t("triggerTitle"),
						"aria-haspopup": "dialog",
						"aria-expanded": open || managing,
						onClick: onTriggerClick,
					},
					h("span", { className: "dpt-icon" }, icons.trigger()),
					h("span", { className: "dpt-trigger-label" }, t("trigger"))
				),
				picker,
				modal
			);
		}
		// #endregion

		/** Services this half needs. */
		const inject = ["slots", "locale"];

		/**
		 * Register the composer trigger and the dictionaries.
		 * @param {any} ctx - browser Cordis context
		 */
		function apply(ctx) {
			ctx.effect(() => installStyle(), "dsh-prompt-template: stylesheet");

			localeService = ctx.locale ?? null;
			if (localeService !== null && typeof localeService.register === "function") {
				ctx.effect(() => localeService.register(NS, { zh, en }), "dsh-prompt-template: dictionaries");
			}

			ctx.slots.inject("conversation.input.left", () =>
				ctx.slots.register(
					{
						name: "conversation.input.left",
						id: "prompt-template-trigger",
						order: 10,
						locale: NS,
					},
					PromptTemplateButton
				)
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		/**
		 * Pure helpers for offline checks. Nothing in DSH reads them.
		 */
		exports.__testing = {
			LIMITS,
			makeT,
			filterTemplates,
			templateTags,
			draftTags,
			collectTemplateChoices,
			filterManageTemplates,
			reorderVisibleIds,
			moveVisibleIds,
			toggleTagChoice,
			toggleDraftTag,
			groupTemplates,
			sortTemplates,
			toDraft,
			syncDraftPin,
			fromDraft,
			draftErrors,
			draftIsValid,
			parseTags,
			pathKey,
			scopeKind,
			scopePaths,
			matchesWorkspace,
			shortPath,
			decodeUtf8,
			precheckImportFiles,
			importPickTransition,
			importResolution,
			importResolutions,
			defaultImportResolutions,
			importSummary,
			importWarningKey,
			importResolutionMap,
			importDiffFields,
			exportMenuItems,
			exportIds,
			exportRequest,
			importReasonKey,
			importElementId,
			formatBytes,
			IMPORT_LIMITS,
			dict: DICT,
		};
		return module.exports;
	}
});
