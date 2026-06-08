# 启动项目看这里

项目根目录：`D:\workspace-v2`

## 最常用启动方式

先进入项目目录：

```powershell
Set-Location D:\workspace-v2
```

然后一键启动全部服务：

```powershell
npm run dev
```

这个命令会同时启动：

- 主前端 Vite：`http://localhost:3000/`
- 后端 API：`http://localhost:5555`
- Next 文案工作台子应用：`http://localhost:3100`
- 主项目里的工作台入口：`http://localhost:3000/style-workbench`

## 分开启动

如果只想单独启动某一块：

```powershell
npm run dev:api
npm run dev:front
npm run dev:style
```

对应关系：

- `npm run dev:api`：后端 API，端口 `5555`
- `npm run dev:front`：主 Vue/Vite 前端，端口 `3000`
- `npm run dev:style`：Next 账号风格库，端口 `3100`，主项目里通过 `/style-workbench` 访问

## 常用访问地址

- 主项目：`http://localhost:3000/`
- 文案工作台入口：`http://localhost:3000/style-workbench`
- 文案工作台子应用直连：`http://localhost:3100/style-workbench`
- API 健康检查：`http://localhost:5555/api/health`
- Next 健康检查：`http://localhost:3100/style-workbench/api/health`

## 如果提示找不到 package.json

说明当前终端不在项目目录里。先切到项目根目录：

```powershell
Set-Location D:\workspace-v2
```

再运行：

```powershell
npm run dev
```

## 如果端口被占用

检查 `3000`、`3100`、`5555` 有没有旧进程占用：

```powershell
netstat -ano | Select-String -Pattern ':3000|:3100|:5555'
```

看到最后一列 PID 后，结束对应进程：

```powershell
Stop-Process -Id <PID> -Force
```

然后重新启动：

```powershell
npm run dev
```

## 日志位置

如果页面打不开或某个服务没起来，优先看这些日志：

- `codex-api.log`
- `codex-api.err.log`
- `codex-front.log`
- `codex-front.err.log`
- `codex-style.log`
- `codex-style.err.log`

## 备注

- 正常开发优先用 `npm run dev`。
- 文案工作台的 Next 子应用固定跑在 `3100`。
- 主项目访问 `/style-workbench` 时会代理到 Next 子应用。
