# workspace-v2 架构文档

> 整理日期：2026-04-27
> 维护者：乌萨奇

---

## 一、项目结构

```
workspace-v2/
├── src/
│   ├── App.vue              # 主入口，侧边栏导航
│   ├── main.js              # Vue 初始化
│   ├── style.css           # 全局样式
│   ├── modules/            # 各功能模块（按侧边栏顺序）
│   │   ├── ToolsModule.vue       # 1. 文案工具（转写/AI处理）
│   │   ├── WorkflowModule.vue    # 2. 文案工作流
│   │   ├── VectorModule.vue      # 3. 向量库
│   │   ├── MaterialModule.vue     # 4. 素材库
│   │   ├── ScheduleModule.vue     # 5. 排期看板
│   │   ├── OpsModule.vue         # 6. 流水看板
│   │   ├── IdeaBoardModule.vue   # 7. 创意看板
│   │   └── ImagegenModule.vue     # 8. AI生图
│   ├── components/
│   ├── ScheduleBoard.vue      # 旧版排期组件，当前未挂载，仅保留迁移参考
│   └── VectorGraph.vue        # 旧版向量可视化组件，当前未挂载，仅保留迁移参考
├── server/                 # Node.js API 服务（端口 5555）
│   ├── index.cjs           # 主路由入口，36KB
│   ├── video_store.cjs    # 素材库 CRUD
│   ├── idea_board.cjs      # 创意看板 CRUD
│   ├── chroma_combined.py  # 向量库（ChromaDB）
│   ├── feishu_profit.py   # 飞书利润读写
│   ├── profit_db.py        # 本地利润数据库
│   ├── migrate_profit.py   # 飞书→本地迁移脚本
│   ├── feishu_writer.py    # 写飞书文档
│   ├── feishu_reader.py   # 读飞书文档
│   ├── transcribe_*.py    # 抖音/B站转写
│   ├── hot_search_worker.py # 热点搜索
│   └── lib/logger.cjs       # 后端统一日志
├── data/                  # 本地数据库（SQLite）
│   ├── materials.db        # 素材库（视频+缩略图）
│   ├── ideas.db            # 创意看板
│   └── profit.db           # 流水毛利（2026-04-27新建）
├── public/
│   └── uploads/
│       ├── videos/         # 上传的视频文件
│       └── thumbs/          # 视频缩略图
└── vite.config.js         # 代理配置

端口说明：
- 3000: Vite 前端（workspace-v2）
- 5555: Node.js API 服务
- 8000: ChromaDB 向量数据库
```

---

## 二、侧边栏顺序（2026-04-27 更新）

```
1. 文案工具   → ToolsModule.vue
2. 文案工作流 → WorkflowModule.vue
3. 向量库     → VectorModule.vue
4. 素材库     → MaterialModule.vue
5. 排期看板   → ScheduleModule.vue
6. 流水看板   → OpsModule.vue
7. 创意看板   → IdeaBoardModule.vue
8. AI生图     → ImagegenModule.vue
```

修改位置：`src/App.vue` → `navItems` 数组

---

### 9. Dreamina / MiniMax 图生图 (ImagegenModule)

| 功能 | 前端 | 后端 |
|------|------|------|
| 文生图 | `POST /api/dreamina/text2image` | `dreamina_api.py` |
| 图生图 | `POST /api/dreamina/image2image` | `dreamina_api.py` |
| MiniMax | `POST /api/minimax/image` | `index.cjs` → MiniMax API |

---

## 四、模块前后端对应

### 1. 素材库 (MaterialModule)

| 功能 | 前端 | 后端 | 数据存储 |
|------|------|------|---------|
| 列表 | `GET /api/materials/list` | `video_store.cjs` | SQLite `materials.db` |
| 上传 | `POST /api/materials/upload` | `video_store.cjs` | 文件存 `public/uploads/videos/` |
| 删除 | `POST /api/materials/delete` | `video_store.cjs` | SQLite |
| 统计 | `POST /api/materials/stats` | `video_store.cjs` | SQLite |

**文件存储**：`C:\Users\Administrator\.openclaw\workspace\workspace-v2\data\materials.db`
**上传文件路径**：`public/uploads/videos/` + `public/uploads/thumbs/`

**坑**：前端 `MaterialModule.vue` 曾经写死 `const API = 'http://localhost:5555'`（已修复为 `''`，走 Vite 代理）

---

### 2. 创意看板 (IdeaBoardModule)

| 功能 | 前端 | 后端 | 数据存储 |
|------|------|------|---------|
| 列表 | `GET /api/ideas/list` | `idea_board.cjs` | SQLite `ideas.db` |
| 添加 | `POST /api/ideas/add` | `idea_board.cjs` | SQLite |
| 删除 | `POST /api/ideas/delete` | `idea_board.cjs` | SQLite |

**文件存储**：`C:\Users\Administrator\.openclaw\workspace\workspace-v2\data\ideas.db`

---

### 3. 流水看板 (OpsModule) ⭐ 已改造

| 功能 | 前端 | 后端 | 数据存储 |
|------|------|------|---------|
| 列表 | `POST /api/profit/list` | `profit_db.py` | SQLite `profit.db` |
| 统计 | `POST /api/profit/stats` | `profit_db.py` | SQLite |
| 新增 | `POST /api/profit/add` | `profit_db.py` | SQLite |
| 修改 | `POST /api/profit/update` | `profit_db.py` | SQLite |
| 删除 | `POST /api/profit/delete` | `profit_db.py` | SQLite |

**文件存储**：`C:\Users\Administrator\.openclaw\workspace\workspace-v2\data\profit.db`

**迁移**：
- 历史数据通过 `migrate_profit.py` 从飞书迁入
- 数据默认进入「内容四组」（2026-04-27 完成，15条记录）

**毛利规则**：
- 代做/素材：100%
- B站商单：60%
- 其他平台（抖音/快手）：50%

**分组账号对应**（与 ScheduleModule.vue 同步）：

| 组 | 账号 |
|----|------|
| 内容一组 | 花无缺、葵仔不想肝、最翁说游、薛定谔的机、团子好贵、跑腿的包子、李野王SG、游电工厂、硬件侠、素材 |
| 内容二组 | 痞仔伯爵、暴走星号键、雷鸭Fist、报告砖家、沙雕101、灵梦小师妹、网瘾少女一条、素材 |
| 内容三组 | 苏大强、饭十七、皮皮说游戏、中二探长、素材 |
| 内容四组 | 天机妹、麦晓花、花蛮楼、有事找学姐、夏天丶cat、素材 |
| 内容五组 | 游小妹、游热娃子、超玩教授、Lee小强、尼大木、麦冬冬、素材 |
| 内容六组 | 不玩就分手、游点慌、游戏永动机、畅玩百晓生、夏洛、游侠蹦蹦、王路飞cp、上官北丶、情风师兄 |

**重要**：AI 解析录入时，非本组账号应被阻断（功能待加）

---

### 4. 排期看板 (ScheduleModule)

| 功能 | 前端 | 后端 | 数据存储 |
|------|------|------|---------|
| 加载 | `GET /api/schedule/load` | `index.cjs` | localStorage + `data/schedule.json` |
| 保存 | `POST /api/schedule/save` | `index.cjs` | localStorage + `data/schedule.json` |

**数据存储**：浏览器 localStorage（key: `usagi_schedule_g{groupId}`）+ 落地文件 `data/schedule.json`

**分组账号**：与 OpsModule.vue 中的 GROUPS 一一对应，修改时需同步。

---

### 5. 向量库 (VectorModule)

| 功能 | 前端 | 后端 | 数据存储 |
|------|------|------|---------|
| 搜索 | `POST /api/vector/search` | `chroma_combined.py` | ChromaDB（端口8000） |
| 列表 | `GET /api/vector/list` | `chroma_combined.py` | ChromaDB |
| 添加 | `POST /api/vector/add` | `chroma_combined.py` | ChromaDB |
| 删除 | `POST /api/vector/delete` | `chroma_combined.py` | ChromaDB |

**依赖**：ChromaDB 服务（端口 8000）必须单独启动
**Collection**：`anythingllm_md_v2`（embedding：BAAI/bge-large-zh-v1.5，1024维）
**查询脚本**：`scripts/test_anythingllm_chroma.py`

---

### 6. 文案工具 (ToolsModule)

| 功能 | 前端 | 后端 |
|------|------|------|
| 抖音转写 | `POST /api/transcribe/douyin` | `transcribe_douyin.py` |
| B站转写 | `POST /api/transcribe/bilibili` | `transcribe_bilibili.py` |
| 评论生成 | `POST /api/comment/generate` | `index.cjs` |
| 热点搜索 | `POST /api/hot/search` | `hot_search_worker.py` |
| AI改写 | `POST /api/ai-fix` | `index.cjs` → MiniMax |

---

### 7. 工作流 (WorkflowModule)

| 功能 | 前端 | 后端 |
|------|------|------|
| 飞书写入 | `POST /api/to-feishu` | `feishu_writer.py` |
| 飞书读取 | `POST /api/feishu/read` | `feishu_reader.py` |
| Chat | `POST /api/chat-minimax` | `index.cjs` → MiniMax |

---

### 8. AI生图 (ImagegenModule)

| 功能 | 前端 | 后端 |
|------|------|------|
| Dreamina | `POST /api/dreamina/*` | `index.cjs` → Dreamina CLI |
| MiniMax | `POST /api/minimax/image` | `index.cjs` → MiniMax API |

---

## 四、已知坑点

### 🔴 必须注意

1. **后端必须用 `workspace-v2/server/index.cjs`**
   - 5555 端口可能跑的是旧版 `workspace-dashboard/server/index.js`（15KB）
   - 新版 `index.cjs`（36KB，2026-04-26）包含所有新接口
   - 区分方法：检查文件大小，或看有没有 `profit_db.py` 相关的路由

2. **ChromaDB 需单独启动**
   - `ChromaDB` 服务端口 8000，关机/重启后需重开
   - 影响向量库所有功能

3. **素材库 `localhost:5555` 问题（已修复）**
   - `MaterialModule.vue` 曾经写死 API 地址
   - 已改为空字符串，走 Vite 代理

### 🟡 注意

4. **流水数据存 localStorage（旧的 OpsModule）**
   - 重启浏览器会丢数据
   - 改造后（2026-04-27）已改为 SQLite本地存储

5. **排期数据存 localStorage + schedule.json**
   - 不受后端重启影响，但换浏览器/设备会丢

6. **飞书 API 返回字段乱码**
   - `feishu_profit.py` 读取飞书数据时字段名乱码
   - 解决：直接用 `values()` 索引取值，不依赖 key 名

7. **Python 3.14 UTF-8 输出问题**
   - PowerShell 编码问题，print 中文会显示乱码
   - 不影响数据正确性，写文件时指定 UTF-8 即可

8. **`runPython` 传参必须有 `.py` 后缀**
   - `runPython('profit_db', ...)` 会报文件找不到
   - 必须用 `runPython('profit_db.py', ...)`

---

## 五、数据流向图

```
飞书多维表格（毛利表）
       ↓  (migrate_profit.py，一次性迁移)
SQLite profit.db
       ↓  (profit_db.py CRUD)
Node.js index.cjs (:5555)
       ↓  (Vite proxy /api)
Vue OpsModule.vue (:3000)
```

```
用户上传视频
       ↓
MaterialModule.vue
       ↓  (base64 或 FormData)
video_store.cjs (:5555)
       ↓  (ffmpeg 截图 + 元数据)
SQLite materials.db + public/uploads/videos/ + thumbs/
```

---

## 六、启动/重启流程

```bash
# 1. 启动前端（Vite，端口3000）
cd workspace-v2
npm run dev

# 2. 启动后端（Node.js，端口5555）
cd workspace-v2/server
node index.cjs

# 3. 启动 ChromaDB（向量库，端口8000）— 如需向量功能
chromadb --port 8000
# 或用 Python 启动：
python -c "import chromadb; chromadb.Client()"
```

---

## 七、相关人员

| 角色 | 账号 |
|------|------|
| 负责人 | 陈健伊 |
| 文案+后期 | 林宇辰 |
| 纯后期 | 姚希、宋丽佳 |

---

## 八、飞书数据源

| 表格 | URL | 用途 |
|------|-----|------|
| 毛利表 | `WKOmbG4ubaqYqUsH5ErcvwqSnMh` | 流水看板原始数据 |
| 排期表 | `ESPEbmoRpabWt7s0OCFcdYGmnlh/tblwcvhyZANhlDtI` | 排期看板原始数据 |

---

*最后更新：2026-04-27 00:45 by 乌萨奇*
