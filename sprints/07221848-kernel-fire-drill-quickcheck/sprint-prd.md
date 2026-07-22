# Sprint PRD — fire-drill: 修复 QuickCheck 将真实失败误判为 OOM 后退出 0

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（当前 82%）
- **当前进度**：`scripts/quickcheck.sh` 在 Vitest 同时出现 worker 异常退出/OOM 文案与明确的测试失败计数时，误判为"仅 OOM，无测试失败"，输出继续提示并以退出码 0 结束，push 前预检失去拦截真实失败的能力
- **本次推进预期**：TDD 修复分类优先级——明确失败计数永远优先于 OOM 宽免；正常 PASS 场景保持退出码 0 不变；新增永久 shell 回归测试锁定该行为

## 背景

TDD 修复 scripts/quickcheck.sh：明确测试失败不能被 worker OOM/异常退出宽免吞掉。先红后绿，永久 shell fixture；PASS=0，failed count>0 必须非零；不碰 Brain 核心。

这是一次真实 provider-neutral kernel 验火任务，范围仅限非 Brain 核心的机械修复。`scripts/quickcheck.sh` 是开发者 push 前本地预检脚本（被 `packages/engine/hooks/pre-push.sh` 调用，回归测试位于 `packages/engine/tests/scripts/`），当前对每个改动包运行 vitest 并用退出码/输出文本分类结果：若 vitest 退出码非 0 但输出中不含明确的失败标记，脚本当前会把它当作"worker OOM 崩溃，非真实测试失败"直接放行（继续下一个包，最终整体退出码 0）。当 vitest 输出同时包含 worker 异常退出/OOM 文案和明确的失败计数时，这个宽免逻辑会错误地压制住真实失败，导致坏代码被放行 push。

## Golden Path（核心场景）

开发者从 [执行 `bash scripts/quickcheck.sh`（或 push 前 hook 自动触发）] → 经过 [脚本对改动包运行 vitest，读取本次运行的完整输出与退出码，判断是否存在明确的测试失败计数] → 到达 [无论输出中是否同时夹带 worker 异常退出/OOM 文案，只要存在明确失败计数就判定为失败、以非零退出码终止并阻止 push；只有在真正没有任何测试失败（含"仅 OOM 无失败"的场景）时才保持退出码 0]

具体：

1. 开发者本地执行 quickcheck（或 pre-push hook 触发），脚本对每个改动包运行一次 vitest
2. vitest 本次运行的合并输出（stdout+stderr）与退出码被脚本捕获，用于分类判断
3. 若输出中存在明确的测试失败计数（不论是否同时出现 worker unexpected exit / OOM 相关文案），quickcheck 判定该包为失败
4. 若输出中不存在明确的测试失败计数，即使出现 worker 异常退出/OOM 文案，quickcheck 判定为"预存在环境问题，非代码问题"，不阻塞
5. 若所有改动包均通过（含判定为"仅 OOM 无失败"的包），quickcheck 整体退出码为 0；只要有一个包被判定为失败，整体退出码非 0，并给出明确提示阻止 push
6. 该分类逻辑由永久 shell 回归测试锁定：模拟"明确测试失败计数 + worker OOM 文案同时出现"的 vitest 输出场景，断言 quickcheck 整体退出码非零；同时保留"真正只有 OOM、无失败计数"与"正常全部 PASS"两个场景的断言，确保两者退出码仍为 0（不引入误报）

## 边界情况

- vitest 输出中 worker 异常退出/OOM 文案与失败计数文案的相对顺序、出现次数（如多次 OOM 提示混杂一次失败计数）不应影响判定结果
- 一次 quickcheck 运行覆盖多个改动包时，其中一个包"仅 OOM 无失败"、另一个包"明确失败"，整体结果必须以失败为准（不能被先跑到的 OOM 包影响后续判定）
- vitest 因非 OOM 原因非零退出（如配置错误、语法错误）且输出中也不含明确失败计数的场景，维持现状行为（本次 sprint 不改变对该场景的处理，只聚焦"失败计数 vs OOM 宽免"优先级本身）
- 正常全绿 PASS（vitest 退出码 0）必须继续保持 quickcheck 整体退出码 0，不允许本次修复引入新的误报

## 范围限定

**在范围内**：
- `scripts/quickcheck.sh` 中 vitest 输出分类判断逻辑的优先级修复（明确失败计数优先于 OOM 宽免）
- 新增永久 shell 回归测试（先红后绿，TDD），固化"失败计数 + OOM 同现 → 非零退出"、"仅 OOM 无失败 → 退出 0"、"正常 PASS → 退出 0"三类场景断言，测试永久留在仓库、进 CI 常跑（regression test，不得后续删除）

**不在范围内**：
- 不修改 `packages/brain/src` 任何文件
- 不涉及数据库 migration
- 不做架构调整
- 不改变 quickcheck 的互斥锁、DoD 守卫等其他既有逻辑
- PR 生成后必须停在人审门，不得自动合并（`review_required=true`）

## 假设

- [ASSUMPTION: 永久回归测试的落点遵循仓库既有约定，与 `packages/engine/tests/scripts/quickcheck-mutex.test.ts` 同级目录（`packages/engine/tests/scripts/`），具体测试框架/文件名由 Proposer 在合同阶段确定]
- [ASSUMPTION: "明确的测试失败计数"以 vitest 标准输出中的失败标记（如逐文件 `FAIL` 标记或汇总行的失败数）为判断依据，具体匹配规则由 Proposer/Generator 在实现阶段设计，Planner 不锁定具体字符串]

## 预期受影响文件

- `scripts/quickcheck.sh`: 修复 vitest 输出分类优先级，使明确失败计数优先于 OOM 宽免判断
- `packages/engine/tests/scripts/`: 新增永久 shell 回归测试文件，覆盖"失败+OOM 同现""仅 OOM""正常 PASS"三类场景

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step 级 + journey_feature 级），PrepPRD 显式值优先；本次两源均为空，PrepPRD 亦未显式给出下列参数 -->
- 超时/延迟: 待定（PrepPRD 未指定；沿用 quickcheck 现有互斥锁 2s/mkdir-lock 超时行为，不在本次修改范围）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: quickcheck 判定为失败时必须保留明确的失败提示输出（沿用现有 `❌ 失败` 文案风格），失败原因需可从终端输出直接判断

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；本次 task/ability 均未挂 step/feature 级 invariant，仅 area 级全局铁律 -->
- [capture-triage] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置"的集成测试（来源: area）
- [capture-triage] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用，必须同时设计"是否已处理过"的前置检查（来源: area）
- [capture-triage] 跨模块的"时间常数"如果彼此之间有隐含大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（来源: area）
- [agent-offline-alert] theater_mismatch 检查——contract 中 android 关键词即使在排除列表也会触发，可用 windows_cloud 环境绕过（来源: area）
- [agent-offline-alert] target_environment 从 DB tasks.payload 读取，不从文件读，任务注册时必须正确设置（来源: area）
- [agent-offline-alert] Brain judge .brain-result.json 必须有顶层 exit_code + log_tail + behavior_tests[]（来源: area）
- [capture-triage] DB 表字段长度约束在写入前若来源数据没有天然长度保证，必须显式截断（来源: area）
- [capture-triage] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` 核查历史（来源: area）
- [capture-triage] 调用"失败不抛异常、返回 null/false 表示失败"契约的函数时，必须显式写 else 分支处理失败（来源: area）
- [capture-triage] journey_features 表 updated_at 长期停滞可作为 report 阶段漏跑的兜底探测信号（来源: area）
- [capture-triage] harness-controller relay 容器可能在 merge 后异常退出而跳过 report 步骤（来源: area）
- [capture-triage] contract-proposer 起草 host/环境白名单类断言时须核对 headed 人工接管场景（来源: area）
- [capture-triage] headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload（来源: area）
- [capture-triage] 退役判断依据数据不靠记忆，需查生产库实锤（cursor 状态分布/表行数/消费方 grep）（来源: area）
- [capture-triage] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（来源: area）
- [capture-triage] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [capture-triage] 新增后台 job 必须同时声明消费方，无下游读方的落库 job 不允许上线（来源: area）
- [通用] 多设备类型(os_type/device_platform) UI 区分必须在设计/审查阶段强制检查（来源: area）
- [capture-triage] 同一语义在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [capture-triage] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`（来源: area）
- [capture-triage] smoke/测试用真实 worktree 当部署根目录时，必须核对被测脚本不会向上触碰生产资源（来源: area）
- [capture-triage] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + 告警 + exit 非零（来源: area）
- [capture-triage] 判变基准永远用"生产实体自报"对账 origin/main，禁用间接推断（来源: area）
- [capture-triage] lint-test-quality 要求 `await fn()` ≥ 1：读源码必须包装 async function（来源: area）
- [capture-triage] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹（来源: area）
- [capture-triage] Red commit 必须只 git add 精确路径（如 `*.test.ts`），禁止 `git add .`（来源: area）
- [capture-triage] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [capture-triage] 新增 cron 功能首先检查 scheduler-jobs.js JOBS 与 tick-runner.js 的关系（来源: area）
- [capture-triage] harness-generator 铁律：禁止 generator 自行 merge PR，merge 权归 controller（来源: area）
- [capture-triage] headed relay 的 tmux innerCmd 子 shell 不自动继承父进程环境变量（来源: area）
- [capture-triage] Proposer 复用历史合同模板（尤其 E2E 验收断言）时必须先核对本次任务真实派发/执行历史，不能假设与先例相同（来源: area）
- [capture-triage] harness-generator skill 对共享 CI 基础设施文件（`.github/workflows/*.yml` 等）设默认禁区规则（来源: area）
- [capture-triage] PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时需专门处理（来源: area）
- [capture-triage] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记（来源: area）
- [capture-triage] 新 task_type 接线用七点清单核对（CHECK 约束 / task-router 四表 / EXECUTOR_KIND 等）（来源: area）
- [capture-triage] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（来源: area）
- [capture-triage] 本机（美国 Mac mini）禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务（来源: area）
- [capture-triage] 新增常驻宿主服务时必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（来源: area）
- [系统] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [系统] 禁止写死环境假设值（来源: area）
- [系统] 真环境验证才算 done（来源: area）
- [系统] 测试默认多租户（来源: area）
- [系统] 凭据安全（来源: area）
- [系统] 日志脱敏（来源: area）
- [系统] 端点鉴权（来源: area）
- [系统] 租户隔离（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journeys/:id/golden-paths 查询返回空数组 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留空占位，最终可执行 E2E 脚本由 Proposer 在 GAN 阶段按 target_environment（local_api）产出，写入 contract-draft.md 的 `## E2E 验收` 区块。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（构造 vitest 输出 fixture + 调用 scripts/quickcheck.sh + 断言退出码）
# 期望验收点（自然语言）：
# 1. 构造一个模拟 vitest 输出：同时包含 worker unexpected exit/OOM 文案 + 明确的测试失败计数 → 运行 quickcheck 分类逻辑 → 断言整体退出码非 0
# 2. 构造一个模拟 vitest 输出：仅含 worker unexpected exit/OOM 文案、无任何测试失败计数 → 断言整体退出码为 0
# 3. 构造一个模拟 vitest 输出：正常全部 PASS，无 OOM 无失败 → 断言整体退出码为 0
# 4. 以上三个断言以永久 shell 回归测试形式提交进仓库并可重复执行，先红后绿（TDD）
# 5. 修复后的 quickcheck.sh 不触碰 packages/brain/src、不含 DB migration、不含架构变更
```

## journey_type: dev_pipeline
## journey_type_reason: quickcheck.sh 的回归测试位于 packages/engine/tests/scripts/，被 packages/engine/hooks/pre-push.sh 调用，属于 DevGate/开发工作流引擎范畴（Step 0.5 if-elif 链第三条命中）
## target_environment: local_api
## target_environment_reason: quickcheck.sh 是本地 shell 脚本 + vitest 测试，不涉及浏览器/Windows App/微信 RPA/远端服务器，按 if-elif 链默认落在 local_api（本地终端执行 bash + vitest 断言退出码）
## journey_id: 5f94aa5b-516b-4a87-97aa-8aa820616793
## step_id: none（PrepPRD 未锚定；task.ability_id 为空，无可用 golden_path step 锚点）
