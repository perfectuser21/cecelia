## Brain {VERSION} — 飞书交办入账修两处静默错判

- **证据覆盖窗口**：OpenClaw 会清理老 `task_runs`（实测只保 7 天），而归集回溯 14 天。早于最早一条 run 的消息「查不到执行记录」只说明记录被清了，不代表没人干——原实现照判 `dropped`，会往主理人账本灌一批假的「派了没人管」。新增 `resolveEvidenceFloor()` 取 run 最早时间戳为下界，早于下界一律判 `unknown` 不入账；回溯默认收敛到 7 天与 run 保留期对齐。
- **blocked 必带 blocked_at**：`tasks` 表有 `chk_blocked_at_not_null` 约束，status=blocked 不带 blocked_at 会让整批入账在 INSERT 处报错、`created` 恒为 0（2026-09-16 E2E 实证，两个群同时失败）。
- smoke 补两道闸并均 proven-to-fire（注入缺陷各自报红，还原恢复绿）。
