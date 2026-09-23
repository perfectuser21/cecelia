## Brain {VERSION} — 秋米手机活改走 OpenClaw agent：device_job 派生封存为开关（默认关）

- 主理人 0923 拍板：Notion → Brain → OpenClaw agent 一条链，手机活也走 agent。此前 Jev 判手机活即派生 `device_job` 交西安领单器，而领单器（zenithjoy `device-job-claimer.sh`）只认 `harvest_keyword/outreach_round/dm_one` 三种结构化单、Brain 又不填 `params`，自由文本手机活必失败（9/21 EXEC_RC_1/2 同源）。
- 新增 `QIUMI_DEVICE_DELEGATION_ENABLED`（只认字面 `'true'`，默认关）：关时 `routeQiumiTask` 三道 device 闸不生效，一律 agent 分支并留痕 `qiumi_route.device_hint = {is_device, verdict, p, serial, host, matchedBy}`；开时行为逐字保留（排程看板直接建的 `device_job` 不经此路径，不受影响；`qiumi-device-reconcile` job 保留）。
- `promptOf` 在 `device_hint.is_device` 时追加设备提示段：序列号、宿主、OpenClaw 节点名（`QIUMI_PHONE_NODE_MAP` 覆盖，缺省 `<HOST>-PHONE` 派生，xian-m4 → XIAN-M4-PHONE）、`douyin-phone-adb --profile <profile>`、`lock-acquire/lock-release`、每次 exec timeout 300000。agent 侧前提（运维已核实）：media 部门 agent 已加载 `douyin-phone-runtime` skill；XIAN-M4-PHONE / XIAN-M1-PHONE 节点 exec 白名单已放行控制器。
- 守卫：`qiumi-router.test.js` 开关三态 + 开关关五条（含 `persistDecision` 不派生子任务）；`openclaw-agent-executor.test.js` 设备提示三条；变异（闸 1 去掉开关判断 / 删提示拼接）均验红。
