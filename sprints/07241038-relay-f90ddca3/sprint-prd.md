# Sprint PRD — headed relay 派发链路自测（claude-headed, task f90ddca3）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：headed relay 链路（planner→GAN→generator→evaluator→judge→merge→毕业→report）已有 a85e0582(#3827)、4bb31ef5(#3829)、049ebf93(#3970)、57e25e92(#4109)、7630f4fb(#4184) 五条同类先例毕业
- **本次推进预期**：为本次 task_id=f90ddca3 生成锚定该 task 的独立回归证据，巩固 executor=claude + mode=headed + orchestrator=skill-relay 链路可信度

## 背景

本任务由 Brain headed relay 派发链路自测机制创建（task_type=harness_initiative，journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963「Cecelia Harness Pipeline」，即 harness 流水线自身的开发基础设施 Journey），与已合并的 a85e0582「codex-headed-dispatch-smoke」、4bb31ef5「claude-headed-smoke」、049ebf93/57e25e92/7630f4fb「headed relay 回归证据」同源，用于再次验证 `executor=claude + mode=headed + orchestrator=skill-relay` 的 harness_initiative 全链路能被 Brain 正确接收、派发、跑通并留下可回归证据。不是新业务功能需求。

`payload` 中无 `prep_prd_body`/`thin_prd` 字段（headed-smoke-test 类任务已知情况，非缺陷）；本 PRD 依据 task title「headed-smoke-test」+ payload 三元组（mode=headed/executor=claude/orchestrator=skill-relay）+ 历史同类先例（PR #4109、#4184）锚定范围。

`packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 已是通用脚本（不绑定具体 task id，已在 `packages/quality/smoke-allowlist.txt` 第 24 行登记），本次不改动它、不重复登记，只复用。每次 headed-smoke-test 任务的产出是一份**锚定本次 task id** 的 e2e 薄封装。

**落点铁律（先例 7630f4fb learning 强制）**：测试产物与 e2e wrapper 必须从第一次 commit 起就用**永久池路径**——`tests/regression/relay-f90ddca3/`（contract 测试）+ `scripts/smoke/e2e/relay-f90ddca3.sh`（e2e wrapper），**禁止放 `sprints/` 临时路径**，从源头避开 test-pyramid-guard 孤儿棘轮拦截，避免 generator 被诱导越权改 `scripts/test-pyramid-baseline.json`（共享 CI 文件默认禁区）。

## Golden Path（核心场景）

Brain 派发 headed relay 任务 → 本次 e2e 回归脚本校验 → 证据留痕

具体：
1. [触发条件] task_id=f90ddca3-396d-45b2-ad13-2dfbd9e15080 已由 Brain 以 task_type=harness_initiative、payload.mode=headed / executor=claude / orchestrator=skill-relay / journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963 派发
2. [系统处理] e2e 回归脚本依次：调用既有 `claude-headed-dispatch-smoke.sh`（不重实现，只校验其全绿执行与 allowlist 登记）→ 查 `GET /api/brain/tasks/f90ddca3...` 核对 task payload 关键字段齐全并对敏感字段脱敏断言 → 查 DB `initiative_runs` 核对本次 initiative_id 的 orchestrator_host/phase
3. [可观测结果] 全部断言通过则脚本 exit 0 并打印 PASS；任一断言失败则 exit 1 并打印具体 FAIL 原因

## 边界情况

- Brain task 记录不存在（未派发成功）→ e2e 脚本必须 FAIL，不得静默跳过
- `initiative_runs` 无该 initiative_id 记录 → FAIL
- **本 initiative 的 run 有一条历史 failed 前科后被 controller 复活为 planning**：phase 合法性断言必须设计为"存在至少一条 phase 落在合法枚举且非 `failed`/`unknown` 的记录"，容忍历史 failed 行存在，不得因历史前科误判 FAIL（参考先例 7630f4fb 同款处理）
- 全部记录的 phase 都是 `failed` 或 `unknown`/非法枚举值 → FAIL
- task payload 意外携带 `token`/`github_token`/`anthropic_token`/`thin_prd` 明文字段 → FAIL（敏感字段泄漏）
- `claude-headed-dispatch-smoke.sh` 未在 `packages/quality/smoke-allowlist.txt` 精确登记 → FAIL

## 范围限定

**在范围内**：
- 新增 `tests/regression/relay-f90ddca3/` 下的 contract 测试 + `scripts/smoke/e2e/relay-f90ddca3.sh` e2e wrapper（永久池路径，第一次 commit 即落此处），锚定 TASK_ID=f90ddca3-396d-45b2-ad13-2dfbd9e15080、SPRINT_DIR=sprints/07241038-relay-f90ddca3，结构镜像 7630f4fb 最终版（#4184）
- 调用既有 `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh`（已在 allowlist 第 24 行登记，仅校验存在，不重复登记）
- 校验本次 task 的 Brain API 记录（含敏感字段脱敏检查）与 initiative_runs 记录

**不在范围内**：
- 不新增/修改 `claude-headed-dispatch-smoke.sh` 本体
- 不把测试产物/e2e wrapper 放 `sprints/` 临时路径
- 不修改 `scripts/test-pyramid-baseline.json` 等共享 CI 基础设施文件
- 不扩展业务功能，不改 dashboard/UI
- 不改 migrations
- 不跨 repo 生产 promote
- 不改 `.github/workflows/ci.yml`
- 不重复登记 `packages/quality/smoke-allowlist.txt`（已登记过则只校验存在）

## 假设

- [ASSUMPTION: 本次 task 派发已由 Brain 完成，initiative_runs 中存在 initiative_id=f90ddca3-396d-45b2-ad13-2dfbd9e15080 至少一条 run 记录，orchestrator_host=skill-relay-claude-headed（实测已存在，含一条历史 failed 前科后被复活为 planning）]
- [ASSUMPTION: 复用 packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh 现有通用行为，本次不校验其内部实现细节]

## 预期受影响文件

- `tests/regression/relay-f90ddca3/`：新增，锚定本次 task_id 的 contract 回归测试（永久池）
- `scripts/smoke/e2e/relay-f90ddca3.sh`：新增，本次 e2e wrapper（永久池）

## E2E 验收

期望验收点（自然语言）：
1. `GET /api/brain/tasks/f90ddca3-396d-45b2-ad13-2dfbd9e15080` 返回 task，`payload.mode=headed` / `payload.executor=claude` / `payload.orchestrator=skill-relay` / `payload.journey_id` 均非空，且断言输出中不含 token/github_token/anthropic_token/thin_prd 明文字段
2. DB `initiative_runs` 中 `initiative_id=f90ddca3-396d-45b2-ad13-2dfbd9e15080` 至少一条记录，`orchestrator_host` 含 `skill-relay-claude-headed`，且**存在至少一条** `phase` 落在合法枚举且非 `failed`/`unknown` 的记录（历史 failed 行允许存在，不作为 FAIL 依据）
3. 复用调用 `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 全绿，且该脚本已在 `packages/quality/smoke-allowlist.txt` 精确登记

```bash
# 占位：proposer 按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql）
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重（step/feature 均为空数组，area 53 条全量，较先例 7630f4fb 新增 4 条：f200769d/d9e4f4c1/6041333c/a3989e96） -->
- [manual oracle真实exit code] 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动（来源: area, id=f200769d）
- [node -e表达式须真跑] manual:node -e 双引号中的 JavaScript ${} 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure（来源: area, id=d9e4f4c1）
- [smoke-invariant-58494] smoke 铁律（来源: area, id=6041333c）
- [smoke-invariant-5054] smoke 铁律（来源: area, id=a3989e96）
- [测试冷启动重置掩盖跨周期bug] 测试若只依赖"重置状态=冷启动"写法（afterEach 清空 sentinel、sinceMs=0），需补至少一条真实多轮扫描、状态不重置的集成测试（来源: area, id=b9e7a730）
- [周期重扫防重复调用] 周期性重扫同一批数据若引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查（来源: area, id=e06d4aa2）
- [跨模块时间常数依赖] 跨模块时间常数（扫描间隔/闲置阈值/缓存TTL）有隐含大小关系依赖时必须显式写不变量断言或注释（来源: area, id=394a904a）
- [theater_mismatch android误判] contract 文本含 android 关键词即使在排除列表也会触发 theater_mismatch，可用 windows_cloud 环境绕过（来源: area, id=be2b7dfe）
- [target_environment来源DB] target_environment 从 DB tasks.payload 读取，不从文件读，任务注册时必须正确设置（来源: area, id=f91cbfc7）
- [judge结果JSON格式] Brain judge .brain-result.json 必须有顶层 exit_code + log_tail + behavior_tests[]，每条需含 exit_code + log_tail（来源: area, id=de6a2ee1）
- [DB字段长度截断] DB 表字段长度约束（如 varchar(100)）写入前若来源数据无天然长度保证，必须显式截断（来源: area, id=d976752e）
- [复活功能先查死因] 复活/重做曾死过的功能前，先用 git log --diff-filter=D + git show 读退役前真实代码核对死因，不能只信 commit message（来源: area, id=6ede438b）
- [错误码契约需显式else] 调用"失败返回 null/false"契约函数时，写完成功分支必须显式写 else 处理失败分支，不能只靠外层 try/catch（来源: area, id=e9c7752f）
- [smoke-invariant-2387] smoke 铁律（来源: area, id=33ede9f1）
- [updated_at停滞探针] journey_features 表 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号（来源: area, id=5abda98e）
- [relay跳过report兜底校验] harness-controller relay 容器可能在 Step 6(merge) 后异常退出跳过 Step 7(report)，Brain 侧不应仅凭容器 exit code 0 判定任务完成（来源: area, id=e83b2f0d）
- [host白名单核对headed] contract-proposer 起草 host/环境白名单类断言时必须核对 headed 人工接管场景（来源: area, id=9f14c074）
- [headed点火需base_repo/pr_url] headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则收账守卫与 watchdog 反查失明（来源: area, id=37e0d7c9）
- [退役判断查生产库实锤] 退役判断依据数据不靠记忆，须查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板（来源: area, id=ea7d9c3e）
- [吞错job需失败计数告警] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（来源: area, id=42a4d7c3）
- [建表前grep写入方] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表须 schema 对齐评审（来源: area, id=1676385f）
- [后台job须声明消费方] 新增后台 job 必须同时声明消费方，无下游读方的落库 job 不允许上线（来源: area, id=1bd4e034）
- [多设备类型UI区分] 多设备类型(os_type/device_platform) UI 区分必须在设计/审查阶段强制检查（来源: area, id=8dbe91ee）
- [git_sha语义跨脚本一致] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area, id=113a9330）
- [git rev-parse需--verify] git rev-parse 判 ref 存在必须带 --verify "<ref>^{commit}"，裸 rev-parse 失败回显字面量（来源: area, id=26a1d06e）
- [smoke真实worktree防触碰生产] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（来源: area, id=66f41f70）
- [部署链失败禁warning降级] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（来源: area, id=9202c14e）
- [判变基准用生产自报] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"（来源: area, id=5775d866）
- [lint要求await包装async] lint-test-quality 要求 await fn() ≥ 1：读源码必须包装 async function，不能直接 readFileSync（来源: area, id=6414193b）
- [Test Contract表格4列格式] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 从第 3 列解析路径（来源: area, id=14ed5336）
- [Red commit精确add路径] Red commit 必须只 git add 精确路径（*.test.ts），禁止 git add . 或 git add .harness/（来源: area, id=755fb846）
- [回归测试用源码检查] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area, id=c674ab49）
- [cron功能查scheduler-jobs.js] 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area, id=55cb4cb7）
- [generator禁止自merge] harness-generator 禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready（来源: area, id=e8230eb5）
- [tmux子shell需显式export] headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量，需要的变量须在 innerCmd 中显式 export（来源: area, id=72890f7c）
- [复用模板需核对真实历史] Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同（来源: area, id=8d92f7b1）
- [共享CI文件默认禁区] harness-generator 对共享 CI 基础设施文件（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等）默认禁区，未经合同显式授权不可修改（来源: area, id=1100cb8f）
- [提前合并需核对headSHA] PR 被 CI 侧兜底机制提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合并 sha 一致（来源: area, id=26886b60）
- [smoke-invariant-79911] smoke 铁律（来源: area, id=552520d0）
- [PR需一次带齐smoke+allowlist] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area, id=3efefc23）
- [新task_type七点清单] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / relay loadSkill 映射 / dispatcher 三防线（来源: area, id=5b91a042）
- [服务存活双信号判定] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听，单看 launchd 会漏 nohup 孤儿宕机（来源: area, id=365d645a）
- [美国Mac禁用LaunchAgents] 美国 Mac mini 禁止再往 ~/Library/LaunchAgents 放需要常驻的服务，gui 域不存在永不加载，须用系统域 LaunchDaemon（来源: area, id=02e74e46）
- [常驻服务须入launchd-patrol] 新增常驻宿主服务时，必须同步加进 packages/brain/src/launchd-patrol.js 的 manifest（来源: area, id=b145c74a）
- [smoke-invariant-93097] smoke 铁律（来源: area, id=4b73376c）
- [单slot串行任务] 一个 slot/会话内严格串行执行任务，同一 slot 同时只允许一个任务在跑，需要并行时用多个 slot/独立 session（来源: area, id=7ccfa168）
- [禁止写死环境假设值] 屏幕外坐标/UIA气泡阈值/环境假设值禁止写死，要么从环境推导要么真机校准（来源: area, id=5e125909）
- [真环境验证才算done] 依赖真机/生产env/真实调用方的接缝断言必须在真目标上验证过才算done，未真验只能标 logic-done-pending（来源: area, id=3c30394c）
- [测试默认多租户] 单元/E2E 测试默认种≥2个租户并断言互不串，让隔离漏洞当场暴露（来源: area, id=55b8eb46）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area, id=564802ee）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area, id=459b6ff9）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area, id=50954d28）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户，跨租户数据绝不混读/混写（来源: area, id=68976b17）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journeys/bb8cc561-b3ee-4fec-b74d-2255694bd963/golden-paths 查询结果为空数组（journey 尚无已验收 ability） -->
- （本 line 暂无历史）

## NFR 约束

<!-- 来源: PrepPRD 无 thin_prd/NFR 显式值（已知情况）；golden-path-decisions?category=nfr 查询为空数组，无副源补充 -->
NFR: N/A（本 sprint 为纯只读回归校验脚本，无新增性能/频控/版本要求；可观测性要求见下）
- 超时/延迟: 待定（PrepPRD 未指定具体数值，e2e 脚本走同步一次性校验，无长耗时依赖）
- 频控: 无（只读校验，不产生新写入）
- 版本要求: 无
- 可观测: 必须能通过 Brain API/DB 看到本次 task_id 与 initiative_runs 状态；e2e 脚本断言失败必须打印明确 FAIL 原因

## journey_type: autonomous
## journey_type_reason: 纯 Brain/harness 后端派发链路 smoke，无用户可见 UI 交互（与 049ebf93/57e25e92/7630f4fb 同类先例一致）
## target_environment: local_api
## target_environment_reason: 验收信号来自本地 Brain API localhost:5221 与本地 PostgreSQL 查询，无需浏览器或远端 runner
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: none（PrepPRD 未锚定）
