# Sprint PRD — G2：部署漂移哨兵（Deploy Drift Sentinel）

- task_id: dfa89a0b-3cb9-4bdc-8d41-7b4ed80d997d
- sprint_dir: sprints/07161600-deploy-drift-sentinel
- 挂靠 PRD: docs/prd/2026-07-16-deploy-golden-path.prd.md §S0
- 日期: 2026-07-16
- 依赖: G1（sprints/07161500-gate3-sha-truth）已 merge，/health 返回 git_sha，brain-deploy.sh 支持 SHA 对账

---

## Invariant 约束

继承 G1 + PRD 铁律 + Brain 架构不变量（三源：DEFINITION.md / decisions 表 / learnings 表）：

| ID | 来源 | 约束 |
|----|------|------|
| INV-01 | PRD §铁律 | SHA 对账是唯一判变真相；禁再引入任何"文件列表/路径过滤"类判据 |
| INV-02 | PRD §铁律 | S0 自动补部署沿用 brain-deploy.sh 全闸路径，禁旁路直切蓝绿 |
| INV-03 | PRD §铁律 | 蓝绿/pre-swap/post-deploy 现有机制一律不动 |
| INV-04 | G1 继承 | 测试禁 mock 判定函数与部署调用之间的边（不得跳过 30min 判定逻辑直接 stub 部署） |
| INV-05 | DEFINITION.md §L0 | 常驻 job 必须挂入既有 tick-runner 调度注册表（同 launchd-patrol 模式，不得另起进程） |
| INV-06 | DEFINITION.md §保护 | 告警通道走既有 sendBark + raise；禁自建告警通道 |
| INV-07 | decisions:145014a4 | 验证层级须声明 PASS@L 等级；哨兵自愈行为承诺 L2（服务端真验，含一次真实弹） |
| INV-08 | decisions:5b0690ca | golden path 组织：S0 是 S1 感知层的深度防御兜底，不替代 S1 |
| INV-09 | learnings:6d2adec8 | Gate3 假跳过根因（--changed 为空）已由 G1 修复；S0 不得重新引入路径判据 |
| INV-10 | learnings:1bf349c0 | 补部署触发前须用 SHA 二次核验，防止部署中误报（首见记时间戳防抖） |

---

## 累积 FR

**G1 已交付（不重新实现，本件依赖）：**
- FR-01 镜像构建注入 GIT_SHA（Dockerfile ARG → ENV）
- FR-02 /health 端点返回 git_sha 字段
- FR-03 S2 SHA 对账判变（brain-ci-deploy.yml）
- FR-04 /api/brain/deploy 去除 changed_paths 路由判据
- FR-05 S6 post-deploy SHA 回读断言（brain-deploy.sh）
- FR-06 L1 串链测试（squash merge 场景 SHA 不等 → 必须触发）
- FR-07 smoke 升级（SHA 回读断言场景）

**本件新增（G2）：**

| ID | 描述 | 涉及文件 |
|----|------|---------|
| FR-08 | Brain 常驻 job 注册（drift-sentinel.js）：挂入 tick-runner.js 调度表，每 30min 触发一次对账逻辑（同 launchd-patrol 模式，INTERVAL_MS 可由 env 覆盖） | packages/brain/src/cron/drift-sentinel.js，packages/brain/src/tick-runner.js |
| FR-09 | origin/main HEAD SHA 拉取：优先 `gh api repos/{owner}/{repo}/commits/main --jq .sha`，失败降级 `git ls-remote origin HEAD`；网络失败（exit non-0 或超时）→ 保守 skip 本轮，打 drift_check verdict=network_error | packages/brain/src/cron/drift-sentinel.js |
| FR-10 | 生产 SHA 读取：调用 G1 已有 /health git_sha 端点（BRAIN_PROD_URL 可配）；失败 → 保守 skip，打 verdict=prod_unreachable | packages/brain/src/cron/drift-sentinel.js |
| FR-11 | 防抖判定（30min 持续窗口）：SHA 不一致首见时记 `driftFirstSeenAt` 到 DB（scheduler_jobs 表或专用 KV）；下次检查若仍不一致且 `now - driftFirstSeenAt >= 30min` → 触发补部署；部署期间或首见不足 30min → verdict=drifting（记录但不触发） | packages/brain/src/cron/drift-sentinel.js |
| FR-12 | 自动补部署调用：exec `bash scripts/brain-deploy.sh` 全闸路径；禁止 direct docker / bluegreen bypass；调用前记 `redeployCount++`（存 KV） | packages/brain/src/cron/drift-sentinel.js |
| FR-13 | 连续 2 次补部署后仍漂移 → 上报：调 sendBark（dedupeKey=drift-escalated，TTL 6h）+ 调 notion-create-issue（priority P1，sub-area brain）；verdict=escalated | packages/brain/src/cron/drift-sentinel.js |
| FR-14 | 审计日志：每轮打标准格式 `[drift_check] sha_main=<X> sha_prod=<Y> verdict=<ok\|drifting\|redeploying\|escalated\|network_error\|prod_unreachable>` 到 console.log（被 Brain Docker 日志捕获） | packages/brain/src/cron/drift-sentinel.js |
| FR-15 | L1 failing test（先写）：mock 两端 SHA 不等且 driftFirstSeenAt 已过 30min → 断言部署函数被调（现版本无此 job，测试 failing）；SHA 相等 → 不调；首见未满 30min → 不调（防抖回归）；连续 2 次仍漂移 → 断言 sendBark 被调 | packages/brain/src/cron/drift-sentinel.test.js（或 sprints/07161600-deploy-drift-sentinel/tests/） |
| FR-16 | 实弹验证（L2）：立项后手动关 webhook → 等 30min → 观测 Brain 日志 verdict=redeploying + deploy record 写库 + /health SHA 回归一致；通过后在 sprint 目录写 live-fire-report.md | sprints/07161600-deploy-drift-sentinel/live-fire-report.md（交付物，不提交代码） |

---

## NFR

| 项 | 要求 |
|----|------|
| 对账周期 | 30min ± 1min（tick-runner 调度误差可接受） |
| 网络容错 | origin/main SHA 拉取失败 → 保守 skip，不触发误部署；连续 3 次 skip 打 P2 告警 |
| 防误报窗口 | 首见不一致到触发补部署最短 30min（防部署中窗口误报） |
| 防风暴 | 单次哨兵触发至多 1 次部署；连续 2 次后进 Bark + issue 升级，不继续重试 |
| 审计可查 | 每轮 verdict 写 console.log，格式固定便于 grep；deploy record 由 brain-deploy.sh 自带落库 |
| CI 回归永驻 | FR-15 测试必须进 brain-ci.yml L1 矩阵，不可删除（同 FR-06 约束） |
| 验证等级 | 自愈行为 PASS@L2（服务端真验）；实弹 FR-16 完成后标记 |

---

## 交付边界（不含）

- G3 每日演习（deploy record 时间线对账，G3 sprint 负责）
- S1 感知层 webhook 修复（不在本件范围）
- ZenithJoy 的部署漂移哨兵（本件仅覆盖 Cecelia Brain）

---

## 测试约束

- **禁 mock 边界**：不得 mock `isDrifted()` 判定函数与 `runDeploy()` 调用之间的边；两端 SHA 差值和时间差必须由测试逻辑内部构造，不得绕过
- **先写 failing test**：FR-15 测试在编写实现代码前必须已 commit 且 CI red
- **回归永驻**：FR-15 test 文件路径需在 brain-ci.yml 测试矩阵中显式列出

---

## Golden Path

（L1 单元测试覆盖，预合并可验；L2 实弹 FR-16 为 post-merge 手动交付物）

1. drift-sentinel.js 可正确 import，无模块报错（`import { runDriftCheck } from './cron/drift-sentinel.js'` 成功）
2. SHA 相等场景：runDriftCheck() 返回 verdict=ok，deploy 函数调用次数=0（FR-15-ok 单测 PASS）
3. SHA 不等 + <30min 防抖窗口：verdict=drifting，deploy 函数调用次数=0（FR-15-debounce 单测 PASS）
4. SHA 不等 + ≥30min01s：verdict=redeploying，brain-deploy.sh exec 调用次数=1，fetchProdSha 调用≥2（FR-15-redeploy + INV-10 二次核验，单测 PASS）
5. redeployCount≥2 且仍漂移：verdict=escalated，sendBark P1 调用次数=1，deploy 函数=0（FR-15-escalate 单测 PASS）
6. main SHA 拉取失败（网络错误）：verdict=network_error，deploy 函数=0（FR-15-network-err 单测 PASS）
7. 生产 /health 不可达：verdict=prod_unreachable，deploy 函数=0（FR-15-prod-unreach 单测 PASS）
8. 连续 3 次 network_error：sendBark P2 告警被调 1 次（FR-15-network-skip-x3 单测 PASS，B8/INV-09）
9. tick-runner.js 已 import runDriftSentinel 且注册到调度表（grep: `runDriftSentinel` 可见，FR-08/INV-05）

> **L2 实弹验收（FR-16）**：post-merge 手动步骤，预期在代码部署生产后执行；产物为 live-fire-report.md，不在本 PR 范围内。

---

## 检查清单（DoD）

- [ ] drift-sentinel.js 注册进 tick-runner.js（grep 可见调用）
- [ ] FR-09/FR-10 网络失败路径有单测覆盖
- [ ] FR-11 防抖 30min 逻辑有 passing 单测（含边界：29min59s 不触发，30min01s 触发）
- [ ] FR-15 failing test 在 merge 前已存在且 CI 标记 fail（contract test）
- [ ] 审计日志格式 `drift_check sha_main=... sha_prod=... verdict=...` smoke 可 grep 验证
- [ ] brain-ci.yml 已添加 drift-sentinel.test.js 到测试矩阵

---

journey_type: harness_initiative
target_environment: local_api
