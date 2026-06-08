# 临时文件清理清单

这份清单用于记录临时文件清理范围和执行状态。

## 执行记录

- 2026-04-29：已按确认执行第一轮清理。
- `server/test_*` 和 `server/debug_*` 已移动到本地 `archive/debug-scripts/server/`。
- 根目录 `find_*`、`fix_*`、`debug_*`、`test_*`、`tmp_*` 以及同批一次性脚本已删除。
- `archive/` 已加入 `.gitignore`，归档调试脚本默认不参与提交。
- 2026-04-29：已执行第二轮清理。
- 后端业务日志已统一到 `server/lib/logger.cjs`。
- `src/ScheduleBoard.vue`、`src/VectorGraph.vue` 仍保留为旧组件参考，但已移除 `alert/console` 调试输出。

## 建议保留

这些是正式维护入口或仍有明确用途：

- `scripts/smoke-api.cjs`：主接口冒烟测试。
- `scripts/make_handoff_archive.sh`：生成交接压缩包。
- `docs/*.md`：交接、协作、接口和清理说明。
- `server/routes/*`、`server/lib/*`、`server/materials/*`：后端正式模块。
- `src/api/*`、`src/composables/*`、`src/modules/*`：前端正式模块。

## 建议删除

这些基本是一次性排查、定位或旧修复脚本，文件体积不大，但会让目录很乱：

| 文件 | 大小 | 理由 |
| --- | ---: | --- |
| `check_modal.py` | 487 B | 一次性弹窗检查脚本 |
| `debug_emb.py` | 996 B | 嵌入/向量调试脚本 |
| `debug_transcribe.py` | 523 B | 转写调试脚本 |
| `find_analyze.py` | 300 B | 一次性定位脚本 |
| `find_close.py` | 246 B | 一次性定位脚本 |
| `find_funcs.py` | 191 B | 一次性定位脚本 |
| `find_keys.py` | 277 B | 一次性定位脚本 |
| `find_ops.py` | 381 B | 一次性定位脚本 |
| `find_parse.py` | 511 B | 一次性定位脚本 |
| `find_routes.py` | 529 B | 一次性定位脚本 |
| `find_submit.py` | 243 B | 一次性定位脚本 |
| `find_wpr.py` | 567 B | 一次性定位脚本 |
| `find_wpr2.py` | 278 B | 一次性定位脚本 |
| `fix_login.py` | 460 B | 旧修复脚本，代码已并入项目 |
| `fix_ops.py` | 1.0 KB | 旧修复脚本，代码已并入项目 |
| `fix_pass.py` | 695 B | 旧修复脚本，代码已并入项目 |
| `fix_vector.py` | 813 B | 旧修复脚本，代码已并入项目 |
| `grep_indices.py` | 319 B | 一次性定位脚本 |
| `replace_modal.py` | 3.0 KB | 旧批量替换脚本 |
| `rewrite_modal.py` | 6.4 KB | 旧批量改写脚本 |
| `tmp_pub.txt` | 498 B | 临时文本 |
| `verify_vec.js` | 515 B | 旧向量验证脚本 |

## 建议归档或删除

这些在 `server/` 下，可能记录了某些接口调试方式；如果担心以后还要参考，可以先移动到 `archive/debug-scripts/`，稳定后再删：

| 文件 | 大小 | 理由 |
| --- | ---: | --- |
| `server/debug_dy.py` | 1.0 KB | 抖音链路调试 |
| `server/debug_gpt.py` | 1.2 KB | GPT 生图/接口调试 |
| `server/test_api.cjs` | 898 B | 旧接口测试，已被 `scripts/smoke-api.cjs` 覆盖一部分 |
| `server/test_backend.py` | 847 B | 后端临时测试 |
| `server/test_base64.py` | 1.4 KB | base64 临时测试 |
| `server/test_combined.cjs` | 1.1 KB | 向量兼容测试 |
| `server/test_direct.py` | 493 B | 直接调用临时测试 |
| `server/test_geekai.py` | 843 B | 第三方接口临时测试 |
| `server/test_geekai_conn.py` | 968 B | 第三方接口连接测试 |
| `server/test_gen.ps1` | 1.7 KB | Windows 临时测试 |
| `server/test_gen.py` | 403 B | 生图临时测试 |
| `server/test_gpt_img.json` | 60 B | 生图测试 payload |
| `server/test_hot_exec.ps1` | 273 B | Windows 热点测试 |
| `server/test_hot_inline.cjs` | 137 B | 旧热点测试 |
| `server/test_hot_inline.js` | 184 B | 旧热点测试 |
| `server/test_hot_node.ps1` | 307 B | Windows 热点测试 |
| `server/test_hot_ps.ps1` | 374 B | Windows 热点测试 |
| `server/test_hot_stdin.ps1` | 1.0 KB | Windows 热点测试 |
| `server/test_mcporter_*.py` | 8.3 KB | mcporter 调试系列 |
| `server/test_minilm.py` | 1.2 KB | embedding/模型临时测试 |
| `server/test_mm_api.py` | 418 B | MiniMax 接口临时测试 |
| `server/test_parse.py` | 1.3 KB | 解析临时测试 |
| `server/test_rp.cjs` | 1.2 KB | 子进程/输出临时测试 |
| `server/test_rp.js` | 1.2 KB | 子进程/输出临时测试 |
| `server/test_runpython.py` | 2.1 KB | Python runtime 临时测试 |
| `server/test_search.py` | 512 B | 搜索临时测试 |
| `server/test_stdin.py` | 610 B | stdin 临时测试 |
| `server/test_video_info.py` | 500 B | 视频信息临时测试 |
| `server/test_vite_proxy.py` | 486 B | Vite 代理临时测试 |
| `server/test_vs.py` | 464 B | 向量/视频临时测试 |
| `server/test_worker.ps1` | 287 B | Windows worker 临时测试 |

## 根目录旧测试

这些也建议删除；如果需要保留样例，可把关键用法补进正式文档后再删：

- `test_api.py`
- `test_bili_direct.py`
- `test_chroma_search.py`
- `test_hot.py`
- `test_hot2.py`
- `test_probe.cjs`
- `test_probe.js`
- `test_transcribe.py`
- `test_vec.py`

## 下一步建议

1. 先归档 `server/test_*` 和 `server/debug_*` 到 `archive/debug-scripts/`，观察一段时间。
2. 直接删除根目录 `find_*`、`fix_*`、`debug_*`、`test_*`、`tmp_*` 这一批一次性脚本。
3. 清理后运行：

```bash
npm run build
npm run smoke:api
```

删除或移动本地文件会改变你的电脑文件结构，执行前需要再次确认具体清单。
