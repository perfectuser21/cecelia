# Sprint PRD — Codex 池激活：每日测试补齐生成器（codex_test_gen）

## OKR 对齐

- **对应 KR**：KR-agent_ops（Codex 池利用率提升）
- **当前进度**：0%（30 天零 codex_* 任务）
- **本次推进预期**：Codex 池每天有 1-3 个真实任务消费，pool running>0 可观测

## 背景

slot-allocator codex 池 max=5、available 正常，但 30 天无一 codex_*/crystallize_* 任务派发，5 个账号额度空转。task-router 已有 codex→xian 路由，executor 有 budget-downgrade provider=codex override 机制（需考古核实）。本 sprint 为刀2 选择系 600295fe 的先行小刀——建每日 codex_test_gen 生成器，让 Codex 池消费真实测试补齐任务，禁做成选择系本体。

## Golden Path（核心场景）

系统从 [每日 scheduler-jobs 触发生成器] → 经过 [扫描缺测试文件→入队 codex 池→派发→PR+CI] → 到达 [/api/brain/slots 可见 codex pool running>0，日报计数+1]

具体：
1. scheduler-jobs 每日触发 `codex_test_gen` 生成器作业
2. 生成器扫 `packages/brain/src/` 下缺配套测试的文件（复用 lint-test-pairing 判据），去重后（同文件已有 open PR 或近 7 天已试过则跳过），挑 1-3 个创建 `task_type=codex_test_gen` 任务入 codex 池
3. slot-allocator 将任务派发给 codex worker（xian bridge），worker 生成测试文件并开 PR
4. CI 闸通过后（禁 --admin bypass），PR merge，Brain 日报 admission 段显示 codex 任务计数

## 边界情况

- xian bridge 不可用时：任务 requeue（指数 backoff），不堆积
- 同文件已有 open PR 或近 7 天内已生成过：跳过，不重复入队
- 生成器禁止挑 dispatcher/slot-allocator/迁移类核心文件（feedback_no_core_tasks_to_codex 铁律）
- codex 产出 PR 必须过全部 CI 闸，禁 --admin merge

## 范围限定

**在范围内**：
- codex_test_gen 任务类型接线（task-router、executor dispatch、slot-allocator cap 确认）
- scheduler-jobs 每日生成器（复用现有 JOBS 结构，新增 codex_test_gen 条目）
- 去重机制（open PR 检查 + 7 天历史检查）
- 日报 admission 段 codex 任务计数（最小可观测）

**不在范围内**：
- 选择系本体（600295fe 刀2）
- budget-downgrade/provider override 机制重构（考古确认现状即可，不动）
- crystallize_* 工作流（非本刀范围）
- Codex 生成测试内容的质量门控（属后续 sprint）

## 假设

- [ASSUMPTION: task-router 已有 codex→xian 路由，无需新增路由条目，只需确认 codex_test_gen 类型映射正确]
- [ASSUMPTION: scheduler-jobs.js 是新增 cron 作业的正确入口（tick-runner.js deprecated，见 area 铁律）]
- [ASSUMPTION: lint-test-pairing 判据脚本可复用，无需重写扫描逻辑]
- [ASSUMPTION: 日报 admission 段已有结构性接入点，codex 计数以最小改动注入]

## 预期受影响文件

- `packages/brain/src/scheduler-jobs.js`：新增 codex_test_gen 每日生成器条目
- `packages/brain/src/task-router.js`：确认/补充 codex_test_gen 类型路由
- `packages/brain/src/codex-test-gen.js`（新建）：生成器逻辑（扫描+去重+入队）
- `packages/brain/src/diary-writer.js` 或日报相关：admission 段 codex 计数注入

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟：codex worker 任务超时跟随现有 executor 超时配置，不单独设置
- 频控：每日最多入队 3 个 codex_test_gen 任务（生成器内部限频）
- 版本要求：无特殊版本要求
- 可观测：失败必须写 Brain log；xian bridge 不可用时任务状态可在 /api/brain/tasks 查询

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [新增 cron] 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [禁自行 merge] harness-generator 禁止自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready（来源: area）
- [新 task_type 七点清单] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / relay loadSkill 映射 / dispatcher cap+lock+bridge 三防线（来源: area）
- [lint-test 写法] lint-test-quality 要求 await fn() ≥ 1：读源码必须包装 async function，不能直接 readFileSync（来源: area）
- [CI 禁区] .github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等共享 CI 文件未经合同显式授权不可修改（来源: area）
- [smoke 随 PR] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [单 slot 串行] 一个 slot 内严格串行执行任务（来源: area）
- [真环境验证] 依赖真机/生产 env 的断言必须在真目标验证过才算 done（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史——journey_id 为 null，无已验收 golden path）

## E2E 验收

> 端到端验收点（自然语言）：生成器触发→codex 池收到任务→/api/brain/slots 显示 codex pool running>0→PR 开出→CI 绿→merge 成功→日报 admission 段 codex 计数 ≥ 1。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl+psql）
# 期望验收点：
# 1. POST /api/brain/tasks 手动触发一个 codex_test_gen 任务（跳过 scheduler 触发等待）
# 2. curl localhost:5221/api/brain/slots → codex pool 有 running 条目
# 3. 对应 PR 在 GitHub 开出，branch 含 codex_test_gen 命名
# 4. CI checks 全绿（brain-ci.yml）
# 5. PR merge 后 curl localhost:5221/api/brain/context → 日报含 codex 任务计数 ≥ 1
```

## journey_type: autonomous
## journey_type_reason: 纯后端 Brain 内部调度任务（scheduler-jobs + task-router + codex worker），无 UI/Dashboard 涉及
## target_environment: local_api
## target_environment_reason: 验收用 curl localhost:5221 + psql 查任务状态，Brain 本地 API 即可（payload 已显式指定 local_api）
## journey_id: none
## step_id: none（PrepPRD 未锚定）
