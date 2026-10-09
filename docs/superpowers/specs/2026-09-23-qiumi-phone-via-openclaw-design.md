# 秋米手机活改走 OpenClaw agent（device 派生封存为开关）设计说明书

日期：2026-09-23　任务：Brain 9dfd873a　类型：small-change（主理人拍板，不得推翻）

## 0. 现状与问题

- `routing/qiumi-router.js` `routeQiumiTask`：便宜闸命中序列号（闸 1）、或 Jev `is_device=true`（闸 2）→ `outcome='device'` → `persistDecision` → `delegateDeviceJob` 派生 `device_job` 子任务、父任务挂 `blocked/delegated_device_job`；`verdict` 含糊 → `fail('device_uncertain')`。
- 子任务由西安工作机的领单器（zenithjoy `services/phone-adb-controller/device-job-claimer.sh`）认领。它不是 AI，只认 `params.action ∈ {harvest_keyword, outreach_round, dm_one}` 三种结构化单；Brain 派生时不填 `params` → 领单器回「不认识的活」。自由文本手机活（「在 X 手机上截个屏」）在这条路上必失败。
- OpenClaw 侧已经具备执行手机活的全部条件：XIAN-M4-PHONE / XIAN-M1-PHONE 节点已配对且 `system.run` 可用；节点 exec 白名单已放行 `/Users/jinnuoshengyuan/.local/bin/douyin-phone-adb`（agents `*`）；skill `douyin-phone-runtime` 已存在。

主理人 0923 拍板：Notion → Brain → OpenClaw agent 一条链，手机活也走 agent。

## 1. 目标

| # | 改动 | 落点 |
|---|---|---|
| ① | 新增开关 `QIUMI_DEVICE_DELEGATION_ENABLED`（`'true'` 才开，默认关），导出为 `env.deviceDelegationEnabled` | `routing/env.js` |
| ② | 开关关时 `routeQiumiTask` 不再产出 `device`/`device_uncertain`/`device_serial_unresolved`：闸 1 不短路、闸 2 与含糊闸不生效，一律走 agent 分支；开关开时三道闸逐字保持现行为 | `routing/qiumi-router.js` |
| ③ | agent 分支的 `qiumi_route` 新增 `device_hint = { is_device, verdict, p, serial, host, matchedBy }` 留痕（开关开关都写；开关开时 device 分支不需要它） | `routing/qiumi-router.js` |
| ④ | `promptOf` 在 `payload.qiumi_route.device_hint.is_device === true` 时追加「设备提示」段：序列号、宿主、节点名（由宿主派生：`<host 大写>-PHONE`，可用 `QIUMI_PHONE_NODE_MAP` JSON 覆盖）、控制器 `douyin-phone-adb --profile <profile>`（profile 由 agent 在节点上按序列号查 registry）、先 `lock-acquire` 后 `lock-release`、每次 exec `timeout: 300000` | `openclaw-agent-executor.js` |

不做：不删 device 分支代码与 `qiumi-device-reconcile` job（开关开时仍要用）；不改领单器；不改 OpenClaw 配置（给部门 agent 挂 `douyin-phone-runtime` skill 是 PR 外的运维动作）；不手抄手机/节点名单（序列号与宿主全部来自 `device_locks` 注册表）。

## 2. 方案比较

- A（选）**开关封存 device 派生，默认走 agent**：一处判断、旧行为完整保留、可一键回退；agent 拿到 device_hint 后按 skill 去节点跑控制器。
- B 删掉 device 分支：改动面大（persistDecision / holdParent / reconcile / 三张测试文件），且 PR3 补充五设计与 runbook 第 4 节全部作废。否。
- C Brain 派生 device_job 时自己把自由文本翻译成 `params.action`：等于让 Brain 再养一个小 AI，和 OpenClaw agent 重复。否。

## 3. 数据流（开关关，默认）

```
tick → qiumi_task → dispatchQiumiTask → routeQiumiTask
  cheapGates（isDevice / serial / department / hardEngine 照常算）
  → 问 Jev（is_device / engine / department / kind / account / workflow_ref）
  → agent 分支：engine/department/kind/workflowRef 照常解析
     payloadPatch.qiumi_route.device_hint = {
       is_device: cheap.isDevice || verdict === true,
       verdict, p: answers.is_device.p ?? null,
       serial: cheap.serial ?? pickSerial(cheap, answers, registry) ?? null,
       host: registry.phones.find(serial)?.host ?? null,
       matchedBy: cheap.matchedBy }
  → persistDecision(agent) → spawn openclaw agent
     promptOf：标题/补充说明/正文 + （device_hint.is_device 时）设备提示段
```

开关开：与 f22739641 行为逐字一致（闸 1/2/含糊闸、device 派生、fail-closed）。

## 4. 错误处理

- Jev 与 terra 都不可用：仍 `fail('qiumi_router_unavailable')`（与开关无关）。
- 开关关 + 序列号解析不到：不再 fail，`device_hint.serial = null`，agent 自行按 prompt 里的手机描述在节点 registry 查；查不到由 agent 明报失败。
- `device_hint.host` 为空（注册表无宿主）：设备提示段只列序列号，节点名写「未知，先 `openclaw nodes list`」。
- 环境变量非 `'true'`（含缺失、`1`、`yes`）一律视为关，与 `QIUMI_DISPATCH_ENABLED` 同款语义。

## 5. 测试策略

- **unit（vitest，先红后绿）**
  - `routing/__tests__/qiumi-router.test.js`：
    1. 既有 device/fail 用例改用 `qiumiEnv({ JEV_API_KEY:'k', QIUMI_DEVICE_DELEGATION_ENABLED:'true' })`，全部保持绿（旧行为封存证据）。
    2. 新 describe「开关关（默认）」：便宜闸命中序列号 → `outcome='agent'`、一次 Jev 仍问（engine 要用）、`device_hint.serial` 等于该序列号、`device_hint.host` 来自注册表、`recordTaskEventSafe` 记 `qiumi_route_decided` 且 `outcome:'agent'`；变异：删掉开关判断 → 红。
    3. Jev `noul=0.85`（verdict=true）+ 账号在池 → `outcome='agent'`，`device_hint.is_device=true`。
    4. `noul=0.5`（ambiguous）→ `outcome='agent'` 不 fail，`device_hint.verdict='ambiguous'`。
    5. `persistDecision(agent)` 不调 `createRoutedTaskFn`，UPDATE payload 含 `device_hint`。
  - `__tests__/openclaw-agent-executor.test.js`：
    6. `promptOf`（经 `triggerOpenclawAgent` 的 stdin 正文断言）：`device_hint.is_device=true, serial='S1', host='xian-m4'` → 正文含 `S1`、`XIAN-M4-PHONE`、`douyin-phone-adb`、`lock-acquire`；`is_device=false` → 不含「设备提示」。变异：删掉拼接 → 红。
  - `routing/__tests__/env.test.js`（若不存在则在 qiumi-router.test.js 内）：`QIUMI_DEVICE_DELEGATION_ENABLED` 缺失 / `'1'` / `'true'` 三态。
- **integration**：无（无迁移、无新表）。
- **E2E / 生产复验**：合并部署后，中文表建一行「在 jinoshengyuan-work 手机上截个屏，把节点上的截图路径写进结果」（优先级极度），断言 `task_events` 有 `qiumi_route_decided(outcome=agent)` 与 `openclaw_agent_spawned`，agent 日志含 `douyin-phone-adb --profile jinoshengyuan-work`，任务 `completed_no_pr`。前置运维动作：给目标部门 agent 挂 `douyin-phone-runtime` skill。

## 6. 影响范围

- 排程看板「派一件活」直接建 `device_job`，不经 `qiumi-router`，不受影响；夜批 cron 不受影响。
- 秋米链默认不再产生 `device_job` 子任务与 `blocked/delegated_device_job` 父任务。
- 派发统计/事件：`qiumi_route_decided.outcome` 对手机活变为 `agent`；新增字段 `device_hint`，无迁移。
- 版本：`changes/cp-0923152540-qiumi-phone-via-openclaw.md` 碎片，不碰版本五件套。
