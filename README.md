# 开发规范（非常重要 - 请务必阅读）

## 可迁移交接

项目通过 Git submodule 管理第三方采集工具：

- `tools/douyin-downloader/`：用于文案工具里的抖音下载、热榜、搜索、评论采集和下载后转写。
- `tools/bilibili-cli/`：用于 B站视频信息、字幕、音频下载和转写兜底。

换电脑或交给另一个 AI 时，先看：

- `docs/portable-handoff.md`
- `.env.example`
- `tools/douyin-downloader/config.local.example.yml`

第一次 clone 请用：

```bash
git clone --recurse-submodules <repo-url>
```

已经 clone 过但缺少下载器目录时，运行：

```bash
git submodule update --init --recursive
```

每台电脑本地准备：

```bash
cp .env.example .env
cp tools/douyin-downloader/config.example.yml tools/douyin-downloader/config.local.yml
python3 -m venv tools/douyin-downloader/.venv
tools/douyin-downloader/.venv/bin/python -m pip install -r tools/douyin-downloader/requirements.txt
cd tools/bilibili-cli && uv sync --extra audio && cd ../..
```

不要提交或打包 `.env`、`config.local.yml`、`.cookies.json`、cookies、下载视频、数据库、`node_modules`、`.venv`。

## ⚠️ 文件写入规则

### 规则1：编辑已有文件时，必须使用「替换」而非「追加」
- ✅ 正确做法：读取文件 → 找到目标段落 → 用新内容替换旧内容 → 写入同一文件
- ❌ 错误做法：直接用 `>>` 或 `append` 往文件末尾追加内容（会导致重复内容）

### 规则2：修改 Vue 组件前，必须先读取完整文件内容
- 禁止只读部分内容就假设知道文件结构
- 文件可能被之前的修改弄得不一致

### 规则3：PowerShell 的 UTF-8 文件写入
- 使用 Python 的 `open(path, 'w', encoding='utf-8')` 写入含中文的文件
- 禁止用 PowerShell 的 `>` 重定向写入中文内容（会触发 GBK/UTF-8 混合损坏）

---

## 📁 项目结构

```
workspace-v2/
├── src/
│   ├── App.vue                 # 主入口，不要改布局结构
│   ├── style.css               # 全局样式，所有颜色/CSS变量在这里
│   ├── modules/                # 功能模块（每个对应侧边栏一个入口）
│   │   ├── ToolsModule.vue     # 文案工具（转写/评论/搜索/热点）
│   │   ├── WorkflowModule.vue  # 文案工作流（拖拽画布）
│   │   ├── VectorModule.vue    # 向量库可视化
│   │   ├── OpsModule.vue       # 运营工具（CPM/审计）
│   │   ├── ScheduleModule.vue  # 排期看板
│   │   └── ImagegenModule.vue  # AI生图（即梦/MiniMax）
│   └── components/
│       └── ChatBubble.vue      # 兔子气泡AI对话（右下角悬浮）
├── server/
│   └── index.js               # 后端API（端口5555）
├── vite.config.js             # Vite配置
└── CHANGELOG.md               # 每次改动必须记录
```

---

## 🎨 CSS 变量说明（style.css）

修改颜色/风格时，只改这里的 CSS 变量即可全局生效：

```css
--bg:          #080812   /* 页面背景 */
--bg-card:     #0f0f1e   /* 卡片背景 */
--surface:     #13132a   /* 次级背景/侧边栏 */
--surface2:    #1a1a35   /* 悬停/激活态 */
--primary:     #00f5d4   /* 青色（成功/主要） */
--secondary:   #7c3aed   /* 紫色（品牌/按钮） */
--text:        #e2e8f0   /* 主文字 */
--text-dim:    #94a3b8   /* 次级文字 */
--border:      rgba(124, 58, 237, 0.22)  /* 边框 */
--border-bright: rgba(0, 245, 212, 0.35) /* 聚焦边框 */
```

---

## 🔧 修改代码的标准流程

### 1. 改动前：备份
```bash
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item -Recurse "workspace-v2" "workspace-v2_backup_$ts"
```

### 2. 改动前：读取完整文件
- 必须先 `read` 完整文件，确认内容正确后再修改

### 3. 修改时：使用精确的 oldText → newText 替换
- oldText 必须与文件中的原文**完全一致**（包括空格、换行）
- 禁止假设文件内容正确，必须先 read 验证

### 4. 修改后：验证
- 重启 Vite：`Stop-Process -Name node; npm run dev`
- 浏览器访问 http://localhost:3001 检查

### 5. 改动后：记录 CHANGELOG
同步更新 `CHANGELOG.md`，写清楚「新增/修改/修复/删除」

---

## 🐛 已知问题 & 避免方法

### Vue 文件损坏
- **原因**：PowerShell 写入中文导致 GBK/UTF-8 混合
- **避免**：用 Python 写入文件，或用 Vite 的 HMR 局部刷新

### WorkflowCanvas.vue 重复内容
- **原因**：多次用 append 方式写入而不是替换
- **避免**：永远用替换（replace）方式修改，不要追加

### Vite 缓存不刷新
- **原因**：esbuild 缓存了旧版本文件
- **解决**：`Remove-Item -Recurse node_modules\.vite` 删除缓存

---

## 📡 API 调用（后端 server/index.js）

| 接口 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/api/transcribe` | POST | `{url}` | 视频转写 |
| `/api/comment/batch` | POST | `{account, prompt, style, count}` | 评论生成 |
| `/api/write` | POST | `{account, prompt}` | 文案创作 |
| `/api/vector/search` | POST | `{query, account, scene}` | 向量搜索 |
| `/api/hot/search` | POST | `{query}` | 热点搜索（智谱API）|
| `/api/image2text` | POST | FormData(image) | 图生文 |
| `/api/dreamina/text2image` | POST | `{prompt, model, ratio, resolution}` | 文生图 |
| `/api/dreamina/image2image` | POST | FormData(image, prompt, model) | 图生图 |
| `/api/audit/zhixing` | POST | FormData(url/file) | 执锝表单审计 |
| `/api/douyin/export-comments` | POST | `{cookie}` | 评论导出 |
| `/api/chat` | POST | `{message, history}` | AI对话（硅基流动）|

---

## 🔑 密钥配置

- 不要把 API Key、Cookie、账号密码写进 README 或代码。
- 每台电脑复制 `.env.example` 为 `.env`，再在 `.env` 里填写自己的密钥。
- 管理员账号通过 `.env` 初始化：`USAGI_ADMIN_USER` + `USAGI_ADMIN_PASSWORD`。如果没有单独配置管理员密码，后端会在首次初始化时尝试用 `GATEWAY_TOKEN` 作为管理员初始密码。
- 登录页支持自助注册：账号名必须是 2-12 个中文字符的真名，邀请码由 `USAGI_REGISTER_INVITE_CODE` 配置，默认是 `畅玩集团`。对外开放或多人共用时请务必在 `.env` 改成私有邀请码。注册账号默认为成员，并拥有全部业务模块权限，不包含管理员后台权限。
- 首次启动会生成 `data/auth.db`，里面保存用户、会话和操作日志；不要提交数据库文件。
- 抖音 Cookie 放在 `tools/douyin-downloader/config.local.yml`，不要提交到 Git。
- B站登录凭证由 `bilibili-cli` 管理在本机 `~/.bilibili-cli/credential.json`，不要复制到仓库。B站视频无字幕时会下载音频并用 `SILICONFLOW_API_KEY`/`SF_KEY` 转写。
- 向量库：ChromaDB 本地 `vector_db/anythingllm`，Collection `anythingllm_md`。

## 🔐 权限与操作日志

- 前端登录使用 `/api/auth/login`，后续请求统一携带 `Authorization: Bearer <token>`。
- 普通成员只能看到并访问被授予的模块；管理员默认拥有全部模块，并可进入「权限管理」和「操作日志」。
- 后端会按接口前缀校验模块权限，未映射的 `/api/*` 默认返回 `403 Forbidden`。
- 管理员不能把当前登录账号降为成员或停用；重置密码会吊销目标用户的现有会话。
- 操作日志记录登录成功/失败以及关键写操作，包括流水增删改、排期保存、素材上传/修改/删除、创意新增/删除、每日热点更新和权限变更。
- 日志会自动脱敏密码、token、API key、Cookie、base64 文件内容等敏感字段。

---

## ✅ 提交检查清单（每次改动前必查）

- [ ] 改动前是否已备份？
- [ ] 是否用「替换」而非「追加」？
- [ ] 是否用 Python 或 write 工具写入（避免 PowerShell 编码问题）？
- [ ] 写入后是否重启 Vite 验证？
- [ ] 是否已更新 CHANGELOG.md？
