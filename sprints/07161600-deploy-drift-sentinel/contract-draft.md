# Contract Draft — G2：部署漂移哨兵（Deploy Drift Sentinel）

- task_id: dfa89a0b-3cb9-4bdc-8d41-7b4ed80d997d
- sprint_dir: sprints/07161600-deploy-drift-sentinel
- 日期: 2026-07-16
- 合同轮次: 2（Round 2，reviewer feedback 修订版）
- 状态: PROPOSED

---

## 功能概述

在 Brain 的 tick-runner.js 中注册新常驻 job `drift-sentinel`，每 30 分钟对账 origin/main HEAD SHA 与生产环境 /health 返回的 git_sha。若漂移持续超过 30 分钟，自动触发 `bash scripts/brain-deploy.sh` 全闸补部署；连续 2 次补部署后仍漂移，上报 Bark 告警 + Notion P1 issue。

---

## 系统约束（来自 PRD Invariants）

| ID | 约束 |
|----|------|
| INV-01 | SHA 对账是唯一判变真相；禁止引入文件列表/路径过滤类判据 |
| INV-02 | 补部署沿用 brain-deploy.sh 全闸路径，禁止旁路 |
| INV-03 | 蓝绿/pre-swap/post-deploy 现有机制一律不动 |
| INV-04 | 测试禁 mock isDrifted() 判定函数与 runDeploy() 调用之间的边 |
| INV-05 | 常驻 job 必须挂入既有 tick-runner 调度注册表（同 launchd-patrol 模式，不得另起进程） |
| INV-06 | 告警通道走既有 sendBark + raise；禁自建告警通道 |
| INV-07 | 验证等级 PASS@L2（服务端真验，含一次真实弹） |
| INV-08 | S0 是 S1 感知层的深度防御兜底，不替代 S1 |
| INV-09 | 不得重新引入路径判据（G1 已修复） |
| INV-10 | 补部署触发前须用 SHA 二次核验，防抖首见记时间戳 |

---

## 功能需求

### FR-08：Brain 常驻 job 注册

**描述**：新建 `packages/brain/src/cron/drift-sentinel.js`，挂入 `tick-runner.js` 调度表，每 30min 触发一次对账（DRIFT_SENTINEL_INTERVAL_MS 可由环境变量覆盖，默认 30 * 60 * 1000）。

**验收**：
- `grep -r "drift-sentinel" packages/brain/src/tick-runner.js` 可见 import 语句
- `grep -r "runDriftSentinel\|drift.sentinel" packages/brain/src/tick-runner.js` 可见调用

### FR-09：origin/main HEAD SHA 拉取

**描述**：优先 `gh api repos/{owner}/{repo}/commits/main --jq .sha`，失败降级 `git ls-remote origin HEAD`；网络失败（exit non-0 或超时）→ 保守 skip 本轮，打 `verdict=network_error`。

**验收**：
- 网络失败时测试断言 verdict=network_error，deploy 函数未被调用
- 日志含 `[drift_check] ... verdict=network_error`

### FR-10：生产 SHA 读取

**描述**：调用 G1 已有 `/health` git_sha 端点（BRAIN_PROD_URL 可配）；失败 → 保守 skip，打 `verdict=prod_unreachable`。

**验收**：
- /health 不可达时测试断言 verdict=prod_unreachable，deploy 函数未被调用

### FR-11：防抖判定（30min 持续窗口）

**描述**：SHA 不一致首见时记 `driftFirstSeenAt` 到 KV；下次检查若仍不一致且 `now - driftFirstSeenAt >= 30min` → 触发补部署；部署期间或首见不足 30min → `verdict=drifting`（记录但不触发）。

**验收**：
- 29min59s 不触发（verdict=drifting）
- 30min01s 触发（verdict=redeploying）
- SHA 一致时清除 driftFirstSeenAt，verdict=ok

### FR-12：自动补部署调用

**描述**：exec `bash scripts/brain-deploy.sh` 全闸路径；调用前记 `redeployCount++`（存 KV）。

**验收**：
- 触发条件满足时，deploy 函数被调用一次（测试断言）
- 禁止直接调用 docker / bluegreen API

### FR-13：连续 2 次后上报

**描述**：连续 2 次补部署后仍漂移 → 调 sendBark（dedupeKey=drift-escalated，TTL 6h）+ 调 notion-create-issue（priority P1，sub-area brain）；`verdict=escalated`；不再重试部署。

**验收**：
- redeployCount >= 2 且仍漂移时，sendBark 被调，deploy 函数不再被调
- 测试断言 verdict=escalated

### FR-14：审计日志

**描述**：每轮打标准格式 `[drift_check] sha_main=<X> sha_prod=<Y> verdict=<ok|drifting|redeploying|escalated|network_error|prod_unreachable>` 到 console.log。

**验收**：
- smoke 可 grep：`docker logs cecelia-brain 2>&1 | grep -q 'drift_check'`

### FR-15：L1 failing test（先写）

**描述**：
- mock 两端 SHA 不等且 driftFirstSeenAt 已过 30min → 断言 deploy 函数被调
- SHA 相等 → deploy 函数不被调（verdict=ok）
- 首见未满 30min → deploy 函数不被调（verdict=drifting）
- 连续 2 次仍漂移 → sendBark 被调（escalated）
- **redeploying 场景下 fetchProdSha 调用次数 ≥2**（INV-10 二次核验）
- **连续 3 次 network_error → sendBark P2 告警被调**（B8，INV-09 保守 skip 不引入路径判据）

**验收**：
- 实现前测试 CI red（drift-sentinel.js 不存在）
- 实现后测试 CI green（全部 8 个 [BEHAVIOR] 场景）
- 测试文件在 brain-ci.yml 测试矩阵中显式列出

---

## E2E 验收

### L1 自动验收（CI）

**条件**：drift-sentinel.js 存在后，以下断言全部 PASS：

```
1. SHA 相等场景：verdict=ok，deploy 函数调用次数=0（B1，INV-09）
2. SHA 不等 + driftFirstSeenAt 未达 30min：verdict=drifting，deploy 函数调用次数=0（B2，INV-10）
3. SHA 不等 + driftFirstSeenAt 已达 30min01s：verdict=redeploying，deploy 函数调用次数=1，fetchProdSha 调用次数≥2（B3，INV-10 二次核验）
4. 网络错误：verdict=network_error，deploy 函数调用次数=0（B5）
5. 生产不可达：verdict=prod_unreachable，deploy 函数调用次数=0（B6）
6. redeployCount=2 + 仍漂移：verdict=escalated，deploy 函数调用次数=0，sendBark 调用次数=1（B4）
7. 连续 3 次 network_error：verdict=network_error，deploy 函数调用次数=0，sendBark P2 告警调用次数=1（B8，INV-09）
```

### L2 实弹验收（手动，FR-16）

**步骤**：
1. 关闭 webhook，阻止 S1 触发部署
2. 向 main 推一个 commit（改变 SHA）
3. 等待 30min
4. 观测 Brain 日志：`docker logs cecelia-brain 2>&1 | grep "drift_check.*verdict=redeploying"` 输出非空
5. 验证 deploy record 写库：`psql cecelia -c "SELECT * FROM deploy_records ORDER BY created_at DESC LIMIT 1"` 中含本次 SHA
6. 验证 /health SHA 回归：`curl http://prod:5221/health | jq .git_sha` 与 main HEAD 一致
7. 通过后写 `sprints/07161600-deploy-drift-sentinel/live-fire-report.md`

**PASS 标准**：
- Brain 日志有 `verdict=redeploying` 行（ffprobe 级：机器可查）
- deploy_records 有本次记录（DB 可查）
- /health git_sha 与 main HEAD 一致（API 可查）

---

## 非功能需求验收

| 项 | 验收命令 / 方法 |
|----|----------------|
| 对账周期 30min±1min | 单测：DRIFT_SENTINEL_INTERVAL_MS=30*60*1000 常量可查 |
| 网络容错 | 单测：网络失败 → skip，不触发部署 |
| 连续 3 次网络 skip → P2 告警 | 单测：FR-15-network-skip-x3，sendBark P2 被调（B8，INV-09）|
| 防误报窗口 | 单测：29min59s 不触发 |
| 防风暴 | 单测：redeployCount>=2 不再部署 |
| 补部署前二次核验 | 单测：redeploying 场景 fetchProdSha 调用次数≥2（INV-10）|
| 审计可查 | smoke grep：`grep '[drift_check]'` |
| CI 回归永驻 | brain-ci.yml 矩阵含 drift-sentinel.test.js |

---

## 交付边界（不含）

- G3 每日演习（deploy record 时间线对账）
- S1 感知层 webhook 修复
- ZenithJoy 的部署漂移哨兵

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| SHA一致不触发部署 | `../../packages/brain/src/cron/__tests__/drift-sentinel.test.js` | FR-15-ok | Red commit：drift-sentinel.js 不存在时 import 报 MODULE_NOT_FOUND |
| 防抖等待（<30min） | `../../packages/brain/src/cron/__tests__/drift-sentinel.test.js` | FR-15-debounce | 同上 |
| 超30min自动补部署 | `../../packages/brain/src/cron/__tests__/drift-sentinel.test.js` | FR-15-redeploy | 同上 |
| 连败2次Bark告警 | `../../packages/brain/src/cron/__tests__/drift-sentinel.test.js` | FR-15-escalate | 同上 |
| 网络失败保守跳过 | `../../packages/brain/src/cron/__tests__/drift-sentinel.test.js` | FR-15-network-err | 同上 |
| 生产不可达保守跳过 | `../../packages/brain/src/cron/__tests__/drift-sentinel.test.js` | FR-15-prod-unreach | 同上 |
| 连续3次网络skip告警 | `../../packages/brain/src/cron/__tests__/drift-sentinel.test.js` | FR-15-network-skip-x3 | 同上 |
