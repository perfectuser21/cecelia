## Brain {VERSION} — 修 ENOBUFS：host-exec 大输出静默失败

- `host-exec.js` 的 `execSync` 未设 maxBuffer（Node 默认仅 1MB），而采集命令早已超限：n8n 画布导出 2.1MB、执行历史 JSON 数 MB。超限抛 `spawnSync /bin/sh ENOBUFS`，**报错不含真实原因**，第 4 腿（n8n workflow 采集）因此静默转 parse_error 停摆（2026-09-06 生产实证）。
- 修法：新增 `EXEC_MAX_BUFFER = 128MB` 并传入 execSync。回归守卫：`host-exec.test.js` 真跑 2MB 输出断言不抛（proven-to-fire——修前该用例确实红）。
