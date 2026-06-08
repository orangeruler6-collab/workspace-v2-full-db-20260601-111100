# 可迁移交接说明

这份项目现在把第三方采集工具作为项目内 Git submodule 放在：

```text
tools/douyin-downloader/
tools/bilibili-cli/
```

代码可以一起交给另一台电脑或另一个 AI，但本地敏感配置不要提交或打包。

## 不要交付的内容

- `node_modules/`
- `dist/`
- `.env`
- `data/*.db`
- `public/uploads/`
- `server.log`
- `tools/douyin-downloader/.venv*/`
- `tools/douyin-downloader/Downloaded/`
- `tools/douyin-downloader/config.yml`
- `tools/douyin-downloader/config.local.yml`
- `tools/douyin-downloader/.cookies.json`
- `tools/douyin-downloader/config/cookies.json`
- `tools/douyin-downloader/dy_downloader.db`
- `tools/bilibili-cli/.venv*/`

## 新电脑初始化

```bash
cd workspace-v2
npm install
cp .env.example .env
cd tools/douyin-downloader
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp config.local.example.yml config.local.yml
cd ../bilibili-cli
uv sync --extra audio
cd ../..
```

然后在 `tools/douyin-downloader/config.local.yml` 填抖音 cookie。需要自动转写时，在 `workspace-v2/.env` 填 `SILICONFLOW_API_KEY` 或 `SF_KEY`。

## 启动

一个终端启动后端：

```bash
cd workspace-v2/server
node index.cjs
```

另一个终端启动前端：

```bash
cd workspace-v2
npm run dev
```

访问：

```text
http://localhost:3000
```

## 路径规则

后端会按这个顺序找 `douyin-downloader`：

1. `.env` 里的 `DOUYIN_DOWNLOADER_ROOT`
2. `workspace-v2/tools/douyin-downloader`
3. 旧电脑上的历史路径

配置文件会按这个顺序找：

1. `.env` 里的 `DOUYIN_DOWNLOADER_CONFIG`
2. `tools/douyin-downloader/config.local.yml`
3. `tools/douyin-downloader/config.yml`
4. `tools/douyin-downloader/config.example.yml`

后端会按这个顺序找 `bilibili-cli`：

1. `.env` 里的 `BILIBILI_CLI_BIN`
2. `tools/bilibili-cli/.venv/bin/bili`
3. 全局 `bili`
4. 能导入 `tools/bilibili-cli` 源码和依赖的 Python 环境

## 推荐共同维护方式

用私有 Git 仓库维护代码。每台电脑只保留自己的 `.env` 和 `config.local.yml`，不要把 cookies、API key、下载的视频和数据库传上去。

具体流程见：

```text
docs/online-collaboration.md
```

## 生成交接压缩包

如果暂时不用 Git，可以运行：

```bash
cd workspace-v2
./scripts/make_handoff_archive.sh
```

压缩包会生成在 `release/`，并自动排除本地依赖、下载文件、cookies、API key、数据库和日志。
