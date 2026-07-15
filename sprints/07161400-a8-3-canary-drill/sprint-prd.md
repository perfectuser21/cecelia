# Sprint PRD — A8-3：金丝雀故障注入演习

- task_id: 56d677a8-65e8-485c-9ec3-1ade28716ae9
- sprint_dir: sprints/07161400-a8-3-canary-drill
- 挂靠 PRD: docs/prd/2026-07-15-self-healing-golden-path.prd.md §3 L2 / §6 切分第③刀
- 日期: 2026-07-16
- 依赖: A8-1（分类器+路由骨架）、A8-2（新处置器+S0）全部 merge 后解锁

---

## Invariant 约束

继承 PRD §5 铁律（INV-01～05）+ A8-1/A8-2 累积不变量（INV-06～14），本件新增：

| ID | 约束 |
|----|------|
| INV-01 | 不改 attempt cap 数值与全局并发闸 |
| INV-02 | OOM 升档最多一级（oom_upgraded 防二次）|
| INV-03 | 分类器判不出 → 保守走 unknown 现行路径 |
| INV-04 | 禁 mock 真实外部命令行为；mock 只包外层（docker/gh/tmux）|
| INV-05 | 新增死因场景先补 L1 用例再写处置器 |
| INV-06 | 每次收尸打审计日志 cause/action/initiative |
| INV-07 | classifyDeath 纯函数，无副作用，无 DB 调用 |
| INV-08 | cause 枚举固定 7 种，金丝雀注入不新增 cause 字符串 |
| INV-09 | classifyDeath 优先级顺序不变（exit 137 最高，fallback 兜底）|
| INV-10 | oom_upgraded=true + exit=137 → 禁二次升档，走 oom_wall |
| INV-11 | rate_limit defer 不计入 attempt；blocked 不重点火 |
| INV-12 | rate_limit defer 不调用 spawnFn |
| INV-13 | auth 换号须复用 resolveAccount()，不自研选号 |
| INV-14 | green_waiting_merge 须复用 spawnSkillRelaySession()，加 resume_stage='finish' |
| **INV-15** | **金丝雀任务只打 staging（5222），严禁调用生产 brain（5221）的真实任务队列** |
| **INV-16** | **canary:true 任务禁入回归池 / dev-records / 统计口径（各查询加 WHERE payload->>'canary' IS NULL 或等价过滤）** |
| **INV-17** | **演习注入的死法必须可重现：OOM=128MB 硬上限容器 / kill -9 容器 / 卡交互脚本三种，不得随机发明新注入方式** |
| **INV-18** | **演习脚本 canary-death-drill.mjs 禁止直接执行真实 harness 任务逻辑，只注册任务 + 轮询断言** |

---

## 累积 FR

**A8-1 已有（不重新实现）：**
- FR-01：classifyDeath() 三源取证（exitCode / stdoutTail / tmuxPane），7 种 cause
- FR-02：watchdog 路由表骨架（oom/ci_red 接既有处置器）
- FR-03：L1 串链测试框架（oom / ci_red / unknown 三条）

**A8-2 已有（不重新实现）：**
- FR-04：auth / rate_limit / green_waiting_merge / interactive_stuck 四条处置器
- FR-05：S0 宿主团灭恢复（scanOrphanedRelayTasks）
- FR-06：L1 串链 7 条 + S0 共 9 条用例

**A8-3 新增：**
- **FR-07**：`scripts/canary-death-drill.mjs`——向 staging brain（5222）注册金丝雀 harness 任务，payload 含 canary:true 标记；随机选注入死法（oom / kill9 / interactive_stuck），触发注入机制，轮询断言 15 分钟内 watchdog 分类正确且处置到位（或正确快速失败）
- **FR-08**：OOM 注入实现——docker run --memory 128m 运行内存大户脚本（tail /dev/zero 或 python3 -c 'bytearray(200*1024*1024)'），容器退出码 137；断言：watchdog 分类 cause=oom，若首次触发 oom_upgrade 重点火，若 oom_upgraded=true 则触发 oom_wall
- **FR-09**：kill-9 注入实现——注册任务后 docker kill <container_id>；断言：watchdog 分类 cause=oom（exit 137）或 unknown，并触发重点火（attempt 递增）
- **FR-10**：卡交互注入实现——tmux 窗格内启动 `bash -c "echo 'Press enter to continue'; read"` 挂起；断言：watchdog 分类 cause=interactive_stuck，触发 tmux kill-session + 重点火
- **FR-11**：演习结果写档——调用 Brain API 落档：优先写 incidents 表（POST /api/brain/incidents，TODO 接口留待刀5a 就绪）；若 incidents 表不存在则写 design_docs（type=drill_report），代码留 TODO 注释标明正式接口
- **FR-12**：nightly 定时——brain tick job 配置 03:30 CST 定时任务，调用 canary-death-drill.mjs；或写 launchd plist（cecelia.canary-drill.plist），错开 03:00 刀A nightly
- **FR-13**：演习失败 Bark 告警——演习结束若任意断言失败，调用 BARK_URL 发推送（复用现有 alerting.js 或 Bark 通道），消息含死法类型、失败断言、任务 ID
- **FR-14**：canary:true 隔离过滤——在所有统计接口（dev-records 查询、回归池、任务统计 dashboard API）加 `payload->>'canary' IS DISTINCT FROM 'true'` 过滤；行为测试锁死（断言 canary 任务不出现在统计返回值中）

---

## NFR

| ID | 非功能需求 |
|----|-----------|
| NFR-01 | 演习脚本单次运行超时上限 20 分钟（默认轮询 15 分钟 + 5 分钟余量）|
| NFR-02 | 演习只访问 staging（5222），不得对生产 5221 发任何写请求 |
| NFR-03 | nightly 定时注册成功率 ≥ 99%（launchd plist 或 tick job 写库验证）|
| NFR-04 | Bark 告警延迟 ≤ 60s（演习断言失败后）|
| NFR-05 | canary 任务隔离过滤的 SQL 变更有迁移文件（或在现有查询处加注释说明无 schema 改动原因）|

---

## 实现范围

| 文件 | 动作 | 说明 |
|------|------|------|
| `scripts/canary-death-drill.mjs` | 新建 | 金丝雀注入器主脚本；注册任务 + 注入死法 + 轮询断言 + 写档 + Bark 失败告警 |
| `packages/brain/src/canary-drill-scheduler.js` | 新建 | nightly 定时触发逻辑（tick job 接入 / launchd plist 生成命令）|
| `packages/brain/src/__tests__/canary-isolation.test.js` | 新建 | 行为测试：canary 任务不污染 dev-records / 回归池 / 统计 API（先写 failing test）|
| `packages/brain/src/cecelia-routes.js` | 修改 | dev-records / stats 相关查询加 canary 过滤条件 |
| `packages/brain/src/task-router.js` 或统计模块 | 修改 | 回归池入池逻辑加 canary 过滤 |
| `launchd/cecelia.canary-drill.plist`（可选）| 新建 | macOS launchd 定时，03:30 CST，失败退出码触发 Bark |

---

## 验收标准（behavior_tests）

演习脚本本地手跑，三种死法各 1 次，全部断言通过：

1. **OOM 断言**：watchdog 在 15 分钟内将任务 cause 标记为 oom；若首次 → attempt 递增 + oom_upgrade 参数；若 oom_upgraded=true → oom_wall 状态；canary 任务不出现在 dev-records
2. **kill-9 断言**：watchdog 在 15 分钟内检测容器消失，触发分类 + 重点火（attempt 递增）；canary 任务不污染统计
3. **卡交互断言**：watchdog 在 15 分钟内检测 interactive_stuck，tmux kill-session 调用，重点火（attempt 递增）

nightly 定时验收：launchd / tick job 注册成功（可用 `launchctl list cecelia.canary-drill` 或 tick job 查询 Brain API 验证）

必须先写 failing test（canary-isolation.test.js），再实现 canary 隔离过滤代码。

---

journey_type: self-healing-chain
target_environment: local_api
