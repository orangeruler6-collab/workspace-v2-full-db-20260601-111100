# 功能模块接口映射

## 前端 API 封装

- `src/api/client.js`：统一请求、JSON 解析和错误处理。
- `src/api/auth.js`：登录、注册、恢复会话和退出登录。
- `src/api/admin.js`：管理员账号、权限和操作日志。
- `src/api/dailyHot.js`：每日热点列表、刷新、分析、状态和手动新增。
- `src/api/profit.js`：流水看板。
- `src/api/vector.js`：向量库、BF库、案例库。
- `src/api/materials.js`：素材库。
- `src/api/ideas.js`：创意看板。
- `src/api/schedule.js`：排期看板。
- `src/api/tools.js`：抖音采集、转写、评论、热点、向量搜索、飞书、聊天等通用工具接口。
- `src/api/imagegen.js`：AI 生图接口和图片 URL 兼容处理。

## 前端功能逻辑拆分

- `src/components/BaseToast.vue`：全局 Toast 展示组件，用于成功、失败和普通提示。
- `src/composables/useToast.js`：Toast 的 provide/inject 调用入口，模块内通过 `showToast(...)` 触发统一提示。
- `src/composables/useClipboard.js`：统一复制到剪贴板。
- `src/modules/tools/useDouyinTool.js`：文案工具里的抖音下载、热榜、搜索、转写入口状态。
- `src/modules/tools/useBilibiliTranscription.js`：B站转写和本地清洗分段状态。
- `src/modules/tools/useCommentTool.js`：评论生成和写入飞书状态。
- `src/modules/tools/useSearchTools.js`：热点搜索和向量搜索状态。
- `src/modules/schedule/constants.js`：排期组、成员、账号、状态映射和初始数据。
- `src/modules/schedule/useScheduleBoard.js`：排期看板的数据加载、保存、拖拽、周视图、弹窗编辑状态。
- `src/modules/materials/useMaterialLibrary.js`：素材库列表、统计、上传、编辑、预览、下载状态。
- `src/modules/ops/constants.js`：流水看板组配置、利润比例、组目标。
- `src/modules/ops/utils.js`：流水毛利计算、Excel 文件 base64 转换、后端记录映射。
- `src/modules/imagegen/constants.js`：AI 生图模型、比例、分辨率选项。
- `src/modules/imagegen/fileUtils.js`：图片文件 DataURL 读取和 base64 清洗。
- `src/modules/ideas/useIdeaBoard.js`：创意看板列表、解析、筛选、删除、定时刷新状态。
- `src/components/BaseConfirmDialog.vue`：全局确认弹窗，用于删除/清空等高风险操作。
- `src/composables/useConfirm.js`：确认弹窗的 provide/inject 调用入口，模块内通过 `await confirmAction(...)` 获取用户确认结果。
- `src/permissions.js`：模块定义、成员可见模块和管理员权限判断。
- `src/ScheduleBoard.vue`、`src/VectorGraph.vue`：旧版排期/向量可视化组件，目前不在 `App.vue` 导航中挂载；已移除 `alert/console` 调试输出，保留作迁移参考。
- `src/modules/daily-hot/useDailyHot.js`：每日热点列表、筛选、更新、跳转到文案生成的状态。
- `src/modules/AccountStyleModule.vue`：账号风格库，当前主要使用本地 `localStorage` 存储风格卡和样本。
- `src/modules/CopyGenModule.vue`：文案生成工作台，当前主要基于账号风格库和本地状态生成切角、大纲、正文示意。

## 模块对应接口

| 模块 | 前端文件 | 主要接口 | 能力 |
| --- | --- | --- | --- |
| 每日热点 | `src/modules/DailyHotModule.vue` | `/api/daily-hot/list`, `/api/daily-hot/refresh`, `/api/daily-hot/analyze`, `/api/daily-hot/update-status`, `/api/daily-hot/manual-add` | 每日热点聚合、筛选、刷新、AI分析、跳转文案生成 |
| 账号风格库 | `src/modules/AccountStyleModule.vue` | 当前本地 `localStorage`，后续可接 `/api/account-styles/*` | 账号风格卡、样本、标签、分析和启用状态 |
| 文案生成 | `src/modules/CopyGenModule.vue` | 当前本地编排，后续可接 `/api/copygen/*` 或 `/api/chat-minimax` | 基于账号风格和热点/素材生成切角、大纲、正文 |
| 文案工具 | `src/modules/ToolsModule.vue` | `/api/douyin/downloader`, `/api/transcribe/bilibili`, `/api/comment/generate`, `/api/hot/search`, `/api/vector/search`, `/api/to-feishu` | 抖音下载/热榜/搜索、评论采集、下载后转写、B站转写、评论生成、热点、向量搜索、写飞书 |
| 文案工作流 | `src/modules/WorkflowModule.vue` | `/api/feishu/read`, `/api/transcribe/*`, `/api/chat-minimax`, `/api/hot/search`, `/api/vector/search`, `/api/to-feishu` | 资料读取、拆解、热点补充、成稿 |
| 素材库 | `src/modules/MaterialModule.vue` | `/api/materials/list`, `/api/materials/upload`, `/api/materials/update`, `/api/materials/delete`, `/api/materials/stats`, `/api/materials/download/:id` | 视频素材管理、自动分类 |
| 排期看板 | `src/modules/ScheduleModule.vue` | `/api/schedule/load`, `/api/schedule/save` | 本地排期读取和保存 |
| 流水看板 | `src/modules/OpsModule.vue` | `/api/profits`, `/api/profits/:id`, `/api/profits/parse`, `/api/feishu/profit` | 流水查询、录入、解析、修改、删除 |
| 创意看板 | `src/modules/IdeaBoardModule.vue` | `/api/ideas/list`, `/api/ideas/add`, `/api/ideas/delete`, `/api/transcribe/*`, `/api/chat-minimax` | 视频创意便签、转写和AI总结 |
| AI生图 | `src/modules/ImagegenModule.vue` | `/api/gpt-image2/*`, `/api/minimax/image`, `/api/dreamina/*` | 文生图、图生图 |
| 聊天气泡 | `src/components/ChatBubble.vue` | `/api/chat-minimax` | 本地助手对话 |
| 权限管理 | `src/modules/AdminUsersModule.vue` | `/api/admin/users`, `/api/admin/users/create`, `/api/admin/users/update`, `/api/admin/users/reset-password` | 管理员创建账号、分配模块权限、启停用户、重置密码 |
| 操作日志 | `src/modules/OperationLogModule.vue` | `/api/admin/logs` | 按用户、模块、动作、日期筛选审计日志 |

> `src/permissions.js` 是前端导航可见性的来源；真正的接口权限由 `server/index.cjs` 根据登录 token、角色和模块权限再校验一次。未配置模块归属的 `/api/*` 会默认拒绝，新增接口时必须同步补 `moduleForRoute(...)`。

## 后端路由归属

| 后端文件 | 负责接口 | 说明 |
| --- | --- | --- |
| `server/index.cjs` | HTTP 服务启动、路由注册、请求分发 | 主入口只负责装配，不再承载具体业务能力 |
| `server/routes/auth.cjs` | `/api/auth/login`, `/api/auth/register`, `/api/auth/me`, `/api/auth/logout` | 登录注册、会话恢复和退出 |
| `server/routes/admin.cjs` | `/api/admin/users*`, `/api/admin/logs` | 权限管理和操作日志查询 |
| `server/routes/dailyHot.cjs` | `/api/daily-hot/*` | 每日热点存储、刷新、AI分析、状态更新、手动新增 |
| `server/lib/http.cjs` | HTTP 响应、OPTIONS、请求体解析、上传静态文件 | 通用 HTTP 能力 |
| `server/lib/logger.cjs` | 后端统一日志输出 | 支持 `error/warn/info/debug` 和 `LOG_LEVEL` 环境变量 |
| `server/lib/python.cjs` | Python 脚本执行 | 统一 Python 可执行文件探测、临时参数文件、超时处理 |
| `server/lib/llm.cjs` | MiniMax / SiliconFlow 对话调用 | 通用 LLM helper 和 OpenClaw MiniMax key 兼容读取 |
| `server/lib/auth.cjs` | `data/auth.db` 用户、会话、权限、操作日志 | 鉴权、邀请码注册、审计日志、默认管理员初始化 |
| `server/routes/imagegen.cjs` | `/api/dreamina/*`, `/api/gpt-image2/*`, `/api/minimax/image` | AI 生图能力 |
| `server/routes/ideas.cjs` | `/api/ideas/list`, `/api/ideas/add`, `/api/ideas/delete`, `/api/ideas/parse` | 创意看板和 `ideas.db` 初始化 |
| `server/routes/profit.cjs` | `/api/profit/*`, `/api/profits/*`, `/api/feishu/profit` | 流水看板和飞书毛利导入 |
| `server/routes/schedule.cjs` | `/api/schedule/load`, `/api/schedule/save` | 排期本地 JSON 读写 |
| `server/routes/tools.cjs` | `/api/to-feishu`, `/api/transcribe/*`, `/api/douyin/downloader`, `/api/hot/search`, `/api/comment/*`, `/api/chat-minimax`, `/api/ai-*`, `/api/audit` | 文案工具、工作流和通用 AI 工具 |
| `server/routes/vector.cjs` | `/api/vector/*`, `/api/bf/*`, `/api/cases/*` | 向量库、BF 库、案例库 |
| `server/video_store.cjs` | `/api/materials/*` | 素材库兼容入口，组装素材模块 |
| `server/materials/db.cjs` | 素材库 SQLite 访问 | `materials.db` 初始化、sqlite3/CLI fallback |
| `server/materials/media.cjs` | 素材文件处理 | 文件名、缩略图、视频元信息、文件清理 |
| `server/materials/classifier.cjs` | 素材自动分类 | 基于缩略图调用视觉模型生成分类和标签 |
| `server/materials/routes.cjs` | `/api/materials/*` | 素材上传、列表、更新、删除、下载、统计 |

## 后续优化原则

- 新模块先建 `src/api/<module>.js`，组件里只调用封装函数。
- 后端新增接口时优先拆到 `server/routes/<module>.cjs`，再挂载到 `server/index.cjs`。
- 列表接口建议同时返回 `{ data, items, total }`，兼容旧组件和新组件。
- 写入类接口统一返回 `{ ok: true }` 或 `{ success: true }`，失败统一返回 `{ error }`。
- 需要进入导航的新模块，必须同时更新 `src/permissions.js`、`src/App.vue` 的 `MODULE_MAP`、`docs/module-api-map.md` 和 `scripts/smoke-api.cjs`。
- 新增后端 `/api/*` 接口必须同步更新 `server/index.cjs` 的 `moduleForRoute(...)`；没有映射的接口会返回 `403 Forbidden`，避免绕过模块权限。
- 新增写入类接口时，同步在 `server/index.cjs` 的 `auditInfo(...)` 里记录操作日志。
- 后端输出日志统一使用 `server/lib/logger.cjs`，不要在业务路由里直接写 `console.log/warn/error`。
- 管理员不能把当前登录账号降为成员或停用；重置密码会吊销目标用户现有会话，目标用户需要重新登录。

## 本地配置

- 真实密钥只放项目根目录 `.env`，不要提交。
- `.env.example` 只维护变量名，换机器时复制为 `.env` 再填值。
- Node 后端通过 `server/env.cjs` 加载 `.env`；后端启动的主要 Python 脚本通过 `server/env.py` 读取相同配置。
- `npm run smoke:api` 会检查未登录接口返回 `401`、未映射 API 返回 `403`，再用管理员登录，对流水、素材、排期、创意、向量和操作日志做接口冒烟检查，适合改后端路由和权限后快速确认主链路可用。
- `vite.config.js` 已关闭 Vite 的 `public/` 自动复制；`/uploads` 统一由后端 5555 提供，避免构建时把本地素材再复制到 `dist/uploads`。
- `docs/cleanup-plan.md` 记录了当前调试脚本和旧测试文件的清理建议，删除或移动前需要人工确认。
