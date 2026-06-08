# 在线共同维护流程

推荐用 GitHub 或 Gitee 的私有仓库维护代码。仓库只放代码、示例配置和文档；每台电脑单独保存 `.env`、`config.local.yml`、数据库、下载文件和 cookies。

## 1. 创建私有仓库

在 GitHub 或 Gitee 新建仓库：

- 仓库名建议：`workspace-v2`
- 可见性选择：Private / 私有
- 不要勾选自动创建 README、`.gitignore`、License，避免和本地项目冲突

创建后平台会给出一个远程地址，格式类似：

```bash
git@github.com:你的账号/workspace-v2.git
```

或：

```bash
https://github.com/你的账号/workspace-v2.git
```

## 2. 首次上传当前电脑代码

进入项目目录：

```bash
cd workspace-v2
```

先检查不要提交敏感文件：

```bash
git status --short
```

确认 `.env`、`config.local.yml`、`node_modules/`、`data/*.db`、下载视频、cookies 没有出现在待提交列表里。

绑定远程仓库：

```bash
git remote add origin git@github.com:你的账号/workspace-v2.git
```

如果已经有 origin，则改用：

```bash
git remote set-url origin git@github.com:你的账号/workspace-v2.git
```

提交并推送：

```bash
git add .
git commit -m "chore: initial workspace handoff"
git branch -M main
git push -u origin main
```

## 3. 另一台电脑拉代码

```bash
git clone git@github.com:你的账号/workspace-v2.git
cd workspace-v2
npm install
cp .env.example .env
```

初始化抖音工具：

```bash
cd tools/douyin-downloader
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp config.local.example.yml config.local.yml
```

然后在本机填写：

- `workspace-v2/.env`
- `workspace-v2/tools/douyin-downloader/config.local.yml`

## 4. 日常协作规则

每次开始改代码前先拉最新：

```bash
git pull --rebase
```

改完后本地验证：

```bash
npm run build
```

提交并推送：

```bash
git status --short
git add .
git commit -m "feat: 简短说明本次改动"
git push
```

另一台电脑同步：

```bash
git pull --rebase
npm install
```

只有 `package.json` 或 `package-lock.json` 变了才需要重新 `npm install`。

## 5. 给另一个 AI 维护

给它这几份信息即可：

- 仓库地址
- 启动方式：`server/index.cjs` 后端端口 5555，Vite 前端端口 3000
- 交接文档：`docs/portable-handoff.md`
- API 映射：`docs/module-api-map.md`
- 说明：不要提交 `.env`、cookies、数据库、下载文件

## 6. 敏感信息原则

永远不要提交这些内容：

- `.env`
- `tools/douyin-downloader/config.local.yml`
- cookies
- API Key
- `data/*.db`
- `node_modules/`
- `dist/`
- 下载的视频、图片、评论报告

如果不小心提交过密钥，不能只删文件，需要立刻更换对应密钥，并清理 Git 历史。
