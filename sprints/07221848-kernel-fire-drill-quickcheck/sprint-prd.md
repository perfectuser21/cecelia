# Sprint PRD — QuickCheck 失败分类优先级修复（fire-drill）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（进度 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（DevGate 本地预检机械可信度修复，非新功能）

## 背景

Fire-drill 验火 provider-neutral kernel：`scripts/quickcheck.sh` 在 Vitest 同时出现 worker unexpected exit/OOM 文案和明确的 Tests failed 计数时，会误判为"仅 OOM"，输出"继续"并返回退出码 0，把真实测试失败吞掉，push 前的最后一道本地闸失效。范围仅限该脚本自身的机械分类修复，不碰 packages/brain/src、DB migration 或架构。

## Golden Path（核心场景）

用户/系统从 [git push 前跑 quickcheck.sh] → 经过 [vitest 输出同时含 worker OOM/异常退出文案 + 明确 Tests failed 计数] → 到达 [quickcheck.sh 判定该 PKG 为失败，整体退出码非零，阻止 push]

具体：
1. [触发条件] 开发者 push 前执行 `bash scripts/quickcheck.sh`；某个改动包（packages/engine|packages/brain|apps/api|apps/dashboard）的 `vitest run` 输出中同时出现 worker unexpected exit/OOM 相关文案与明确的 "Tests  X failed" 计数
2. [系统处理] quickcheck.sh 的判定优先级必须改为：只要 vitest 输出中出现明确的 failed count（非 0），一律判定该 PKG 失败（`PASS=false`），不再因同时命中 OOM/worker 异常退出文案而被"继续/宽免"逻辑覆盖；仅当输出中**没有**明确 failed count、只有 worker OOM/异常退出时，才保留现有"预存在问题，不阻塞"的宽免路径
3. [可观测结果] 正常全 PASS 场景（无 failed、无 OOM 文案）quickcheck.sh 退出码必须保持 0；"明确测试失败 + worker OOM 混合出现"场景退出码必须非零，且终端输出仍打印"❌ 失败"提示，不再打印"无测试失败 — 继续"

## 边界情况

- vitest 输出只含 worker OOM/异常退出、不含任何 failed count → 维持现状（不阻塞，视为预存在环境问题）
- vitest 输出同时含 failed count=0 与 OOM 文案 → 视为 PASS=0（无失败即通过）
- 多个 PKG 同时改动，其中一个命中"明确失败+OOM混合"、其他正常 PASS → 整体退出码非零（任一 PKG 失败即整体失败，沿用现有 for 循环累积 PASS 变量的逻辑）
- vitest 未安装（`$ROOT_NM/.bin/vitest` 不存在）→ 维持现状，跳过并打印警告，不在本 sprint 范围内改动

## 范围限定

**在范围内**：
- `scripts/quickcheck.sh` 中 vitest 输出分类判定逻辑（失败 vs OOM 宽免的优先级顺序）
- 新增永久 shell 回归测试，固定复现"明确测试失败 + worker error 混合输出"场景，断言 quickcheck.sh 对该场景返回非零
- 保证正常 PASS 场景退出码仍为 0（不产生回归）

**不在范围内**：
- `packages/brain/src` 任何文件
- 任何 DB migration / schema 变更
- 架构层改动（互斥锁机制、worktree 兼容逻辑等 quickcheck.sh 中与本次分类判定无关的部分保持不变）
- PR 自动合并（生成 PR 后必须停在人审门）

## 假设

- [ASSUMPTION: "明确的 Tests failed 计数" 指 vitest 输出中形如 "Tests  N failed" 或包含 " FAIL " 标记且 N>0 的文本模式，沿用 quickcheck.sh 现有 `grep -q " FAIL "` 检测口径，不引入新的 vitest 输出格式假设]
- [ASSUMPTION: 回归测试以 shell/fixture 形式驱动 quickcheck.sh 中的分类判定分支（构造模拟 vitest 输出文本），不需要真实起一个会 OOM 的 vitest 进程]
- [ASSUMPTION: "永久" 回归测试落地位置沿用现有 `packages/engine/tests/scripts/` 目录组织方式（参照 `quickcheck-mutex.test.ts` 先例），随 CI 常态运行，不删除]

## 预期受影响文件

- `scripts/quickcheck.sh`: 修改 vitest 输出分类判定优先级（failed count 优先于 OOM 宽免）
- `packages/engine/tests/scripts/quickcheck-*.test.ts`（新增）: 永久回归测试，覆盖"明确失败+OOM混合"必须非零、"正常 PASS"必须为 0 两种场景

## NFR 约束

<!-- 来源: decisions 表 category=nfr（golden-path-decisions + abilities decisions 双源均为空），PrepPRD 未显式给出 timeout/频控/版本类参数 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 正常 PASS 场景退出码必须保持 0；failed count>0 场景退出码必须非零且终端打印失败提示（来源: PrepPRD 显式）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step 级（空）+ journey_feature 级（无 ability_id，跳过）+ area 级（49 条）三源合并去重；本 sprint 的 ability_id 为空，故 journey_feature 层暂无数据 -->
- [capture-triage] learning: [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至（来源: area）
- [capture-triage] learning: [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假（来源: area）
- [capture-triage] learning: [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注（来源: area）
- [agent-offline-alert] learning: theater_mismatch 检查——contract 中 android 关键词即使在排除列表也会触发，可用 windows_cloud 环境绕过（来源: area）
- [agent-offline-alert] learning: target_environment 从 DB tasks.payload 读取，不从文件读，任务注册时必须正确设置（来源: area）
- [agent-offline-alert] learning: Brain judge .brain-result.json 必须有顶层 exit_code + log_tail + behavior_tests[]，每条需…（来源: area）
- [capture-triage] learning: [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，（来源: area）
- [capture-triage] learning: [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:（来源: area）
- [capture-triage] learning: [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else`（来源: area）
- [系统] smoke-invariant-1784543934-2387（来源: area）
- [capture-triage] learning: journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探（来源: area）
- [capture-triage] learning: harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因（来源: area）
- [capture-triage] learning: contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 j（来源: area）
- [capture-triage] learning: headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task shor（来源: area）
- [capture-triage] learning: [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（convers（来源: area）
- [系统] [capture-triage] learning: [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖） [ ] c…（来源: area）
- [系统] [capture-triage] learning: [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审 [ ] 表名认…（来源: area）
- [capture-triage] learning: [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消（来源: area）
- [系统] 多设备类型(os_type/device_platform)UI区分必须在设计/审查阶段强制检查（来源: area）
- [系统] [capture-triage] learning: [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面 [ ] 同一…（来源: area）
- [capture-triage] learning: [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-pars（来源: area）
- [capture-triage] learning: [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（b（来源: area）
- [capture-triage] learning: [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚（来源: area）
- [capture-triage] learning: [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用（来源: area）
- [capture-triage] learning: lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFi（来源: area）
- [系统] [capture-triage] learning: Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解…（来源: area）
- [capture-triage] learning: Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness（来源: area）
- [系统] [capture-triage] learning: 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效 回归测试用 source-…（来源: area）
- [系统] [capture-triage] learning: 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecat…（来源: area）
- [capture-triage] learning: harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，g（来源: area）
- [capture-triage] learning: headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude sessi（来源: area）
- [capture-triage] learning: Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 6（来源: area）
- [capture-triage] learning: 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml（来源: area）
- [capture-triage] learning: PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR（来源: area）
- [系统] smoke-invariant-1783850042-79911（来源: area）
- [capture-triage] learning: [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI（来源: area）
- [capture-triage] learning: [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR（来源: area）
- [capture-triage] learning: [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d（来源: area）
- [capture-triage] learning: [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存（来源: area）
- [capture-triage] learning: [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（来源: area）
- [系统] smoke-invariant-1783693282-93097（来源: area）
- [系统] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [系统] 禁止写死环境假设值（来源: area）
- [系统] 真环境验证才算done（来源: area）
- [系统] 测试默认多租户（来源: area）
- [系统] 凭据安全（来源: area）
- [系统] 日志脱敏（来源: area）
- [系统] 端点鉴权（来源: area）
- [系统] 租户隔离（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journeys/:id/golden-paths 查询返回空数组（本 journey 尚无已完成/进行中 ability 的 golden_path 记录） -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留空占位；最终可执行的 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl/bash + vitest 组合，不涉及浏览器/Windows/远端部署）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. 构造一个"明确 Tests X failed 计数 + worker unexpected exit/OOM 文案同时出现"的模拟 vitest 输出（永久 fixture），
#    喂给 quickcheck.sh 的分类判定逻辑，断言最终退出码非零、且不打印"无测试失败 — 继续"。
# 2. 构造一个"全部 PASS、无 failed、无 OOM 文案"的模拟输出，断言退出码仍为 0（无回归）。
# 3. 新增的回归测试文件本身可被 vitest/CI 正常发现并常态运行（非一次性脚本）。
```

## journey_type: dev_pipeline
## journey_type_reason: scripts/quickcheck.sh 是 packages/engine 测试覆盖的 DevGate 本地预检脚本（见 packages/engine/tests/scripts/quickcheck-mutex.test.ts、packages/engine/feature-registry.yml 对其登记），属于开发工具链范畴，按 if-elif 链归为 dev_pipeline
## target_environment: local_api
## target_environment_reason: 本次改动是本地 shell 脚本 + vitest 回归测试，非 UI/Windows/微信RPA/生产部署场景，按默认规则在本机执行 bash + vitest，归为 local_api
## journey_id: 5f94aa5b-516b-4a87-97aa-8aa820616793
## step_id: none（PrepPRD 未锚定）
