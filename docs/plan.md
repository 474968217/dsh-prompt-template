# 实现计划与实现边界

目标：在 DSH 输入框旁选择常用提示词并插入光标位置，支持模板管理、搜索、置顶、手动排序以及全局或多项目范围。需求与 B1 入口已由用户确认；实际验证状态见 [验证记录](verification.md)。

## 交付结构

- `lib/index.js`：Cordis 宿主插件、已认证 HTTP 路由、会话工作目录解析、storageDomain 生命周期。
- `lib/store.js`：纯数据模型、校验、作用域匹配、串行写队列与版本冲突。
- `lib/client.js`：单文件 ModuleLoader 客户端产物，React 入口、浮层与管理界面、双语文案与主题样式。
- `test/`：数据层、路由与持久化验证。
- `icon.svg`、`locale/{zh,en}.json`：插件管理器元数据；省略可选详情图，使用 README 回退。
- `README.md`、`README.zh-CN.md`：安装、使用、升级、已知限制。
- `docs/mockup/`：历史设计参考，不能用作实际运行证据。

包名 `dsh-prompt-template`，版本 `0.1.0`，MIT，兼容 `>=0.2.3-alpha.2 <0.3.0-0`。原生 ESM 宿主与手写 ModuleLoader 客户端不引入构建链。客户端仅从平台模块表加载 React 与 react-dom，不加载宿主 Client UI 包。

## 数据模型

```ts
type Scope = { kind: "global" } | { kind: "projects"; paths: string[] };
interface PromptTemplate {
  id: string;
  title: string;
  body: string;
  category: string;
  tags: string[];
  scope: Scope;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
}
interface State {
  revision: number;
  seeded: boolean;
  items: PromptTemplate[];
}
```

同名模板允许存在，以 id 区分。名称最多 60 字符，正文 20000 字符，分类 20 字符，标签最多 5 个、单个最多 12 字符；指定项目最多 20 条绝对路径。正文保留原有空白与换行，但不可全空白。

唯一持久顺序是 `items` 数组顺序，置顶组优先、组内保持手动顺序。最近使用时间只记录，不覆盖手动排序。首次使用写入 4 条中文示例；`seeded` 标志使删空后不会再次填充。

宿主调用 `storageDomain.open({name:"prompt_templates",version:1,layout:"single",global:{schema,initial},tables:{}})`。单元名使用下划线，符合介质命名约束。数据位于宿主存储根下的 `prompt_templates.json`。队列遵循「复制状态 → 校验 → 持久化 → 更新内存」，失败不提前改变可见状态。

项目范围比较会话真实工作目录，由宿主 `sessions.get(sessionId)` 与 `workingDirectory.get(session)` 获取，回退到会话头的 cwd；不信任客户端传来的目录。规范化分隔符和末尾分隔符，Windows 大小写不敏感，精确相等才匹配，不继承子目录。无有效会话目录时只显示全局模板。

## HTTP 契约

前缀 `/dsh-prompt-template` 不带末尾斜线，注册 `auth:"required"`。写操作要求 JSON 与同源请求，正文上限 256 KiB。作用域是显示过滤，不是权限隔离。

| 路由 | 参数 | 返回 |
| --- | --- | --- |
| GET `/ping` | 无 | ok、version |
| GET `/list` | sessionId、all=0 或 1 | items、revision、workspace、projects、projectLabels、seeded |
| POST `/save` | template、revision | item、revision |
| POST `/delete` | id、revision | revision |
| POST `/touch` | id | item、revision |
| POST `/reorder` | 完整 ids、revision | items、revision |

保存、删除、排序携带当前库版本。旧版本返回 409，客户端保留编辑内容，明确提示刷新。touch 不受旧版本阻止，不改变 updatedAt。错误使用稳定 error 码与 message；存储故障不静默转为内存库。

## 客户端交互

入口注册 `conversation.input.left`，id `prompt-template-trigger`，order 10。B1 描边文字按钮：中文最小宽 76、高 28，英文最小宽 84。依赖主题 token，样式与监听器随插件卸载清理。

打开前捕获 `captureInsertion()`，随后聚焦搜索。项目、全局分组；标题、正文、分类、标签可搜索。↑↓ 到边界停止，Enter 插入，IME 期间不拦截确认键，Esc 关闭。所有插入均使用一次 `insertText(body, capturedSpan)`，不调用 setDraft 或 submit。草稿版本失效时拒绝插入，保留当前草稿并显示原因。

浮层和管理面板 portal 到 body，避免吸底 composer 裁切。管理面板提供列表与编辑表单、项目多选、置顶、组内上下移、行内删除确认。切换条目和关闭时保护未保存修改；保存失败时保留表单。项目范围为空不得自动扩大为全局。

## 里程碑

1. M1 最小插件：按钮、光标插入、一步撤销。已由用户确认。
2. M2 数据层：持久化、校验、项目过滤、写入失败与并发测试。
3. M3 浮层：搜索、分组、键盘与插入冲突反馈。
4. M4 管理：CRUD、项目多选、置顶、手动排序、未保存内容保护。
5. M5 安装联调与真机验收，区分工具可证实结果和待人工交互项。
6. M6 双语文档、图标、元数据、打包清单与兼容范围。
7. M7 提交并推送 GitHub main，核对远端提交哈希。

所有阶段的证据与剩余限制写入验证记录。不将未认证 HTTP 401 当作功能成功，也不将静态稿或模拟渲染当作真机截图。
