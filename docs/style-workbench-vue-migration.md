# 文案工作台 Vue 原生化迁移台账

## 目标

- 迁移源：`/Users/xjx/.codex/worktrees/861b/New project 3`。
- 目标：删除旧 `apps/account-style-library` Next 内嵌方案，改为大工作台 Vue 原生模块 + `server/routes`/`server/lib` 原生 API。
- 数据：沿用 `STYLE_LIBRARY_DIR`/`data/style-library`，不迁移、不批量重写用户资产。

## 执行状态

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 建分支 | 完成 | `codex/vue-native-style-workbench` |
| 后端业务层镜像 | 完成 | 最新项目 `src/lib` 复制到 `server/style-workbench/lib`，通过 `tsx/cjs` 运行 |
| 后端 API 适配 | 完成 | 已新增 `server/routes/styleWorkbench.cjs` 并接入主服务 |
| Vue 原生模块 | 完成 | 已新增 Vue 原生模块并接入导航/权限 |
| 源项目视觉对齐 | 进行中 | Vue 模块已改用最新 Next 源项目的页面结构和 class 命名；迁移模块颜色已统一从宿主主题语义变量派生，侧栏统一 Lucide 图标和按钮语义；宿主顶栏/侧栏继续保留大工作台原生外壳 |
| 旧内嵌清理 | 完成 | 已删除 Next 子应用、proxy、style-dev、iframe 组件和专用样式 |
| 全量验证 | 完成 | `check:encoding`、`check:backend`、`check:library`、`build`、API smoke 已执行 |

## 模块对照

| 模块 | 最新源模块 | Vue 目标模块 | API 前缀 |
| --- | --- | --- | --- |
| 账号库 | `src/app/library` | `StyleLibraryModule.vue` | `/api/library`, `/api/accounts`, `/api/videos`, `/api/transcripts`, `/api/collect` |
| 项目工作台 | `src/app/project-workbench` | `StyleProjectWorkbenchModule.vue` | `/api/projects`, `/api/copy-sources` |
| 对话写作 | `src/app/writer` | `StyleWriterModule.vue` | `/api/write`, `/api/drafts`, `/api/style`, `/api/jobs` |
| 评论/资产 | `src/app/assets` | `StyleAssetsModule.vue` | `/api/engagement`, `/api/draft-assets` |
| 毛利维护 | `src/app/gross-margin` | `StyleGrossMarginModule.vue` | `/api/gross-margin` |
| 抖音热榜 | `src/app/douyin-hotlist` | `DouyinHotlistModule.vue` | `/api/douyin-hotlist` |
| 工具 | `src/app/tools` | `StyleToolsModule.vue` | `/api/tools/*` |

## 验证记录

- `npm run check:backend`：通过；仍有本机环境缺失提示，如 API key、douyin-downloader Python 依赖、bilibili-cli `.venv`，属于现有环境问题。
- `npm run check:encoding`：通过。
- `npm run check:library`：通过；默认根目录为 `data/style-library`，本次检查 issueCount 为 0。
- `npm run build`：通过；Vite 仅提示已有 chunk 体积警告。
- 临时主 API smoke：通过；`/api/health`、`/api/health/style-workbench`、`/api/library`、`/api/gross-margin`、`/api/douyin-hotlist` 均返回 200 JSON。
- `API_BASE=http://127.0.0.1:5566 USAGI_AUTH_DISABLED=true npm run smoke:api`：通过。
- Playwright 视觉 smoke：通过；账号库、项目工作台、对话写作、评论生成、文案工具、数据维护、抖音热榜均可打开且无控制台错误。截图在 `output/playwright/`。
- UI 复查：已修复 URL 直达子模块时左侧导航不展开/不高亮、抖音热榜管理账号面板被压扁、窄屏账号库“仅建档”按钮截断；`ui-recheck4` 桌面/窄屏 14 张截图均无横向溢出、控制台错误或 4xx/5xx 响应。
- 逐页视觉对照批次 1：项目工作台、文案工具已按源 Next 页面补齐流程条、面板结构、默认工具页、结果空态和 Lucide 线性图标；新增 `lucide-vue-next`，并补上 `/api/tools` 权限映射与 `/api/tools/single-video/download` 二进制下载路由。
- 批次 1 Playwright 复查：`desktop-target-project-workbench-lucide.png`、`desktop-target-tools-lucide.png` 均无横向溢出、控制台错误、页面错误或 4xx/5xx 响应；截图位于 `output/playwright/source-target-compare/`。
- 批次 1 API 轻测：登录后请求 `/api/tools/single-video/download` 的非法下载类型返回预期 JSON 错误 `下载类型不正确。`，确认不再被权限层 403 拦截。
- 逐页视觉对照批次 2：账号库已恢复源版单行采集工具条、平台/排序/时间筛选、账号头像与转写统计、七列视频表格、底部详情操作区、环境检查弹窗、账号/视频批量选择、单视频转写和 DOCX 转写稿下载。
- 批次 2 权限修复：`/api/health/style-workbench`、`/api/transcribe`、`/api/batch-transcribe` 映射到 `styleLibrary`；登录后环境检查接口返回 200，不再被鉴权层 403 拦截。
- 批次 2 Playwright 复查：`style-library-aligned.png`、`style-library-health-modal.png` 无横向溢出、空头像或控制台错误；环境检查两项均显示“可用”。
- `git diff --check`：通过。
- 2026-07-14 UI 收敛：修复紫夜/乌萨奇主题壳体与迁移内页断裂、1024px 数据维护结果区被压缩、助手遮挡和侧栏滚轮劫持；模块状态同步到 `?module=` 并支持浏览器返回。
- 2026-07-14 Playwright 回归：1440×900 与 1024×768 下复查三套主题及 7 个迁移模块；无横向溢出、控制台错误或警告。数据维护结果区由约 40px 恢复为 440px 以上并可正常滚动访问，截图位于 `output/playwright/ui-fix/`。
