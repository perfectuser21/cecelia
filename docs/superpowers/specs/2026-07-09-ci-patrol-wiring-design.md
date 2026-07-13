# ci-patrol Brain 接线设计（每日调度 + 派发执行）

日期：2026-07-09 · Brain task：fd0881dd · decision：db1b393b · skill 本体已存在（~/.claude-account1/skills/ci-patrol/SKILL.md）

## 问题

ci-patrol skill（CI/CD 巡检员，按 line 日报 4 硬伤 + 棘轮 guard）已建，但 Brain 没有 `ci_patrol` task_type 的定时创建与派发通路。

## 方案（调研定稿）

照 repo 内两个活模式接线，**不走已废弃的 tick-runner**（Wave 2 起 executeTick 死路，daily-review 的 code_review 挂在那条死路上——本次不照抄它，照抄 arch-review 的活路）：

1. **调度**：`daily-review-scheduler.js` 内新增 ci_patrol 段（与 arch_review 并排）——`isInCiPatrolWindow`（UTC 00:00-00:05 = 北京 08:00，等 03:00 刀A + 04:30 刀B nightly 跑完）+ `hasTodayCiPatrol`（当日去重）+ `triggerCiPatrol(pool, now)`（窗口→去重→INSERT tasks）。注册进 `scheduler-jobs.js` 的 JOBS 数组（60s 轮询 + 模块自 gate，自动获得错误隔离/timeout/哨兵）。
2. **任务字段**：task_type='ci_patrol'，priority='P2'，created_by='cecelia-brain'，trigger_source='brain_auto'，location='us'，payload 带 `prd_summary`（≥20 字符，过 pre-flight 描述检查，不动 SYSTEM_TASK_TYPES）。
3. **路由登记（task-router.js 4 张表全登）**：VALID_TASK_TYPES + SKILL_WHITELIST（'/ci-patrol'）+ LOCATION_MAP（'us'）+ TASK_REQUIREMENTS（['has_git']）。
4. **executor skillMap** 加 `'ci_patrol': '/ci-patrol'`——吸取 strategist_decision 接线漏改 skillMap 导致 prompt 头降级 `/dev` 的教训（PR#3674 遗留，本次不修它，只保证 ci_patrol 不重蹈）。走 `_prepareDefaultPrompt` 默认路径（prompt 头挂 /ci-patrol slash command，同 code_review 模式），不进 _TASK_ROUTES。
5. **不碰**：dispatch-helpers 黑名单（ci_patrol 天然可领取）、model_map（用默认账户）、pre-flight SYSTEM_TASK_TYPES。

执行路已验证现成：任务建出 → dispatcher 领取 → executor triggerCeceliaRun → US cecelia-run spawn headless claude（prompt 头 /ci-patrol）→ skill 从 ~/.claude-account1/skills 加载。

## 错误路径

- 窗口误差：scheduler-jobs 60s 轮询，5 分钟窗口必然命中；job 超时/异常被注册表隔离+哨兵记录。
- 重复创建：hasTodayCiPatrol 当日去重；查询失败时 warn 后继续（同 arch 模式，宁重不漏）。
- skill 文件丢失：executor 默认路径只挂 slash command，headless claude 找不到 skill 会以普通 prompt 跑——skill 的 Step 5 回写缺失会让任务卡 in_progress，由现有 watchdog 兜底（可接受，thin 不加专门守卫）。

## 测试策略（档位：unit，vitest；TDD 强制 commit-1 红 → commit-2 绿）

- `__tests__/daily-review-scheduler.test.js` 追加 `triggerCiPatrol` describe：窗口内/外、当日去重跳过、INSERT 字段断言（照 triggerArchReview describe 的 mock pool 风格）。
- 新建 `__tests__/task-router-ci-patrol.test.js`：克隆 strategist 测试断 4 张表 + routeTaskCreate + `executor.getSkillForTaskType('ci_patrol')==='/ci-patrol'` + `JOBS` 含 'ci-patrol'。
- 同步改 `__tests__/scheduler-jobs.test.js` 的「JOBS 注册了 6 个 job」→ 7 个（列表加 ci-patrol）。
- proven to work（merge 后）：手动 INSERT 一条 ci_patrol 任务或等次日 08:00，确认 cecelia-run 真跑出日报 note。

## 不做

- 不修 strategist_decision 的 skillMap 遗留（另立 issue 级别，不混本 PR）。
- 不给 ci-patrol 巡检结果建独立表（日报走 AI Notes，棘轮状态走 scheduler_state，都是现成表）。
