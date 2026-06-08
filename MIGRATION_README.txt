workspace-v2 migration package
created: 2026-05-19 15:01:56
source: D:\workspace-v2

Included:
- .env and .env.example
- package.json / package-lock.json / vite config / launch scripts
- src / server / data / server/data / public / docs / scripts / tools / apps source
- dist build output

Excluded:
- .git
- node_modules
- apps/account-style-library/.next-dev and other generated Next caches
- temp / tmp / __pycache__
- logs and pid files

Restore notes:
1. Extract this archive on the server.
2. Run npm install in the extracted root.
3. If using the Next style library, run npm install inside apps/account-style-library if needed.
4. Check .env values for server IP, ports, storage paths, and API keys before starting.
5. Start with 一键启动.bat or the scripts in package.json.
