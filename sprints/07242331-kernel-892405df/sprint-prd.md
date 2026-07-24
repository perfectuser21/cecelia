# Sprint PRD — Kernel v1 mixed provider 最终主链验收 R7 Fire Drill

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（当前 82%）
- **当前进度**：82%
- **本次推进预期**：验证 harness kernel-v1 mixed-provider 全链路（planner→proposer→独立reviewer→generator→独立evaluator→independent judge→authenticated human review）在真实多 provider/account 分工下可稳定跑通并留痕，不直接推进百分比，但为该能力"可信赖"提供演练证据。

## 背景

R6 因使用过期时间型 oracle（要求生产 version 永远等于历史值 1.267.67）被诚实终局判定失败；本轮 R7 是修正版：oracle 改为"当前 git_sha 是否以 19887912bbb581597f12c714a9ed187f051e2850（#4294 merge commit）与 2a96f975ecf1ce1ddfb818030f7642a08e2860b8（远端批准 SHA 读取热修 merge commit）为祖先"的谱系判据，而非硬编码版本号相等。近期 harness 历史 run（8c48781b failed: no_progress_same_sha；09ecc837 failed: approved_but_contract_artifacts_missing）表明该链路曾在"无进展重复提交"与"批准后合同产物缺失"两处失败，本次验收 checks 需显式覆盖两者不再复现。

## Golden Path（核心场景）

新增 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md` 文档，作为 kernel-v1 mixed-provider 主链一次真实演练的验收记录。

具体：
1. [触发条件] Generator 角色读取并核对 `HARNESS_TASK_ID`=`CECELIA_TASK_ID`=当前 task_id，在从 `origin/main` 新建的独立 delivery worktree 中创建分支 `cp-MMDDHHMM-<task-short-id>`（禁止在 controller 共享 worktree 上 checkout 该分支）。
2. [系统处理] Generator 只新增 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md`，文件内必须含标记 `KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7`、历史上线版本 `1.267.67`、merge commit `19887912bbb581597f12c714a9ed187f051e2850`（#4294）、远端批准 SHA 读取热修 merge commit `2a96f975ecf1ce1ddfb818030f7642a08e2860b8`，以及 planner/proposer/独立reviewer/generator/独立evaluator 各角色 provider/account（见下方角色分配）的实际运行证据摘要。不修改 `packages/brain`、现有合同测试、迁移或产品逻辑。
3. [系统处理] 生产健康验收读取**同一次** `/api/brain/health` 响应，记录响应中的实际 `version` 与 `git_sha`；判定标准为 `git_sha` 是 40 位小写十六进制 SHA，且 `19887912bbb581597f12c714a9ed187f051e2850` 与 `2a96f975ecf1ce1ddfb818030f7642a08e2860b8` 均是该 `git_sha` 的祖先提交（用 `git merge-base --is-ancestor` 类判据，而非硬编码 version 永远等于某历史值）。
4. [系统处理] 验收 checks 逐条记录 `command` / `exit_code` / `log_tail`，覆盖范围：
   - 目标文件存在且含上述标记
   - `origin/main...HEAD` diff 中恰好一行改动指向该目标文档（无其它文件改动）
   - PR 处于 head 状态、`OPEN`、未 merge、CI 全绿
   - Brain task API 返回的 kernel-v1 任务记录含五角色分配（planner/proposer/reviewer/evaluator/generator）
   - relay-runs 记录归属正确（run_id 对应本次点火）
   - 批准远端合同 SHA 能被实际物化读取，不得出现 `approved_but_contract_artifacts_missing` 状态
5. [系统处理] 全链路依次经过 planner → proposer → 独立 reviewer → generator → 独立 evaluator → independent judge → authenticated human review；其中 writer（generator）/ reviewer / evaluator 必须是相互独立的 session。independent judge 是人审之前的 pre-human gate：judge 执行时刻，人工批准尚不存在、PR 尚未 merge，这是 judge PASS 的前置条件（禁止 judge 要求"未来才会产生的批准"或"judge 自己此刻还没产生的输出"作为通过依据）。judge PASS 之后才创建 human review request；human review 认证批准之后才允许 merge / 上报最终结果。
6. [可观测结果] `docs/fire-drills/kernel-v1-mixed-20260724-r7.md` 落盘在一个仅含该文档改动的 PR 中，PR 处于 OPEN 且 CI 全绿等待人审；文档内的 checks 记录可回放复核，Brain 侧 relay-runs / task 记录与该 PR 一一对应。

**角色/Provider 分配（来源: 本 task payload.role_assignments，Golden Path Step 5/6 直接引用）**：
- planner: provider=claude, account=account1
- proposer: provider=claude, account=account1
- reviewer（独立）: provider=grok, account=grok
- evaluator（独立）: provider=claude, account=account1
- generator: provider=codex, account=team3

## 边界情况

- 若 Brain `/api/brain/health` 两次调用返回不同 `git_sha`（部署过程中变更），验收必须固定读取**同一次**响应算出的 `version`/`git_sha` 组合，不得混用两次调用的字段做拼接判断。
- 若 PR diff 中除目标文档外还出现 `sprints/**`、`.harness/**` 或任何合同产物文件，视为违规，创建 PR 前必须机械核对 diff 恰一行并 fail-fast。
- 若 independent judge 阶段 PR 已被 merge，或已存在人工批准记录，视为判据污染，judge 不得判 PASS。
- 若批准远端合同 SHA 无法物化读取（网络/存储缺失），checks 必须显式记录 `approved_but_contract_artifacts_missing` 未出现，而非静默跳过该检查项。
- Generator 在 controller 共享 worktree 上误 checkout delivery 分支属于违规，视为流程失败而非允许的降级路径。

## 范围限定

**在范围内**：
- 新增单一文档 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md`
- 该文档所需的验收 checks（command/exit_code/log_tail 记录）与角色证据摘要内容
- 全链路七角色（含 independent judge、authenticated human review）的真实演练与留痕

**不在范围内**：
- `packages/brain` 任何代码改动
- 现有合同测试、迁移脚本、产品逻辑改动
- `sprints/**`、`.harness/**` 或其它合同产物进入交付 PR

## 假设

- [ASSUMPTION: `/api/brain/health` 端点已存在并返回含 `version`/`git_sha` 字段的响应；本 sprint 不新增或修改该端点]
- [ASSUMPTION: "历史上线版本 1.267.67"仅作为文档中的历史事实记录，不作为生产健康验收的实时判据（判据为 SHA 祖先关系）]
- [ASSUMPTION: role_assignments 中的 provider/account 分工由 Brain payload 既定注入，本 sprint 不改变分工，只如实记录各角色运行证据]

## 预期受影响文件

- `docs/fire-drills/kernel-v1-mixed-20260724-r7.md`：新增，本 sprint 唯一交付文档

## E2E 验收

> Planner 初稿此区块留空，仅描述期望验收点；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl + psql / git 判据）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. docs/fire-drills/kernel-v1-mixed-20260724-r7.md 存在且 grep 到 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7 / 1.267.67 / 19887912bbb581597f12c714a9ed187f051e2850 / 2a96f975ecf1ce1ddfb818030f7642a08e2860b8
# 2. git diff origin/main...HEAD --stat 恰一行，且该行是目标文档路径
# 3. curl localhost:5221/api/brain/health 一次响应中 version + git_sha 均被记录，且 git_sha 为 40 位小写 SHA，两个 commit 均为其祖先（git merge-base --is-ancestor 校验）
# 4. PR 状态为 head/OPEN/未 merge，CI 全绿（gh pr view --json state,mergeable,statusCheckRollup）
# 5. Brain task API 返回本 task 的五角色分配与 relay-runs 归属一致；批准远端合同 SHA 可物化，未出现 approved_but_contract_artifacts_missing
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature 无匹配（无 ability_id/journey_id 锚点），area 级全量注入 -->
- [dep-audit 因新披露 a] dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白…（来源: area）
- [headed relay ses] headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任…（来源: area）
- [毕业（测试入册）commit 后] 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的…（来源: area）
- [[capture-triage]] 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [manual:node -e 双] manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。（来源: area）
- [smoke-invariant-] smoke 铁律（来源: area）
- [smoke-invariant-] smoke 铁律（来源: area）
- [[ ] 测试如果全部依赖"重置状] [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真…（来源: area）
- [[ ] 涉及"周期性重新扫描同一] [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗…（来源: area）
- [[ ] 跨模块的"时间常数"（扫] [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_W…（来源: area）
- [theater_mismatch] theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明列表内，也会触发 theater 不匹配警告。可将 target_e…（来源: area）
- [target_environme] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取。务必在 POST /api/bra…（来源: area）
- [Brain judge .bra] Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tai…（来源: area）
- [[ ] DB 表字段长度约束（如] [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条…（来源: area）
- [[ ] 复活/重做一个曾经死过的] [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字…（来源: area）
- [[ ] 调用任何"失败不抛异常，] [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try…（来源: area）
- [smoke-invariant-] smoke 铁律（来源: area）
- [journey_features] journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检（来源: area）
- [harness-controll] harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机…（来源: area）
- [contract-propose] contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GA…（来源: area）
- [headed relay 点火时] headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarn…（来源: area）
- [[ ] 退役判断依据数据不靠记忆] [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同…（来源: area）
- [[capture-triage]] [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖）（来源: area）
- [[capture-triage]] [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [[ ] 新增后台 job 必须同] [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者）（来源: area）
- [多设备类型(os_type/de] 1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事…（来源: area）
- [[capture-triage]] [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [[ ] `git rev-par] [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量（来源: area）
- [[ ] smoke/测试用真实] [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag …（来源: area）
- [[ ] 部署链任何失败路径禁止] [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo "…（来源: area）
- [[ ] 判变基准永远用"生产实体] [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 rese…（来源: area）
- [lint-test-qualit] lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync（来源: area）
- [[capture-triage]] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑（来源: area）
- [Red commit 必須只 g] Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入（来源: area）
- [[capture-triage]] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [[capture-triage]] 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [harness-generato] harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并…（来源: area）
- [headed relay 的 t] headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的…（来源: area）
- [Proposer 复用历史合同模] Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spa…（来源: area）
- [给 harness-genera] 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/sm…（来源: area）
- [PR 被 should-auto] PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluato…（来源: area）
- [smoke-invariant-] smoke 铁律（来源: area）
- [[ ] feat+brain/s] [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [[ ] 新 task_type] [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch …（来源: area）
- [[ ] 服务"该活着"的判定用双] [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a）（来源: area）
- [[ ] 本机（美国 Mac mi] [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDa…（来源: area）
- [[ ] 新增常驻宿主服务时，必须] [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / …（来源: area）
- [smoke-invariant-] smoke 铁律（来源: area）
- [单 slot 串行任务，并行只许] 一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 se…（来源: area）
- [禁止写死环境假设值] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验（来源: area）
- [真环境验证才算done] 依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done。接缝清单通常1-3条，不是全…（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth;无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户;跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 task payload 无 journey_id 锚点，无法按 line 聚合累积 FR -->
（本 line 暂无历史）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（golden-path-decisions / ability decisions 均查询为空），PrepPRD（task 描述）未显式给出量化值 -->
- 超时/延迟: 待定（PrepPRD 未指定，task.payload.timeout_seconds=28800 为整个 harness 任务超时，非本文档验收环节的独立时限）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无（本 sprint 不涉及第三方 App/RPA 版本约束）
- 可观测: checks 必须记录 command/exit_code/log_tail（PrepPRD 显式要求）

## journey_type: agent_remote
## journey_type_reason: 本 sprint 核心是 harness 多角色 relay 链路（planner/proposer/reviewer/generator/evaluator/judge/human review）与 relay-runs 归属、远端批准合同 SHA 物化，命中"涉及远端 agent 协议/relay"规则，优先于 packages/brain 相关的 autonomous 判定
## target_environment: local_api
## target_environment_reason: 验收全部通过 curl localhost:5221/api/brain/* 与本地 git 判据完成，不涉及浏览器/Windows/微信 RPA/远程生产部署机器
## journey_id: none
## step_id: none（PrepPRD 未锚定）
