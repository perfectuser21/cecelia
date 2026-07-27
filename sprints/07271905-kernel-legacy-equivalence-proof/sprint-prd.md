# Sprint PRD — Legacy P0/P1 全量行为等价证明矩阵

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：建立可复验的 P0/P1 等价证明基线，不预设虚假进度增量

## 背景

生产反例 PR #4372（head `4dc3b69a`）虽列出 129 条 P0/P1 行为，但当前证据为 unknown=100、drifted=5、missing assertion=129，13 stage × 11 element 的 143 格中 green=0。建立 Legacy P0/P1 全量行为证明矩阵与 fail-closed equivalence gate；#4372 当前 129 项清单作为必须失败的反例。

## Golden Path（核心场景）

验证者从 legacy P0/P1 inventory 入口 → 为每条行为建立 unified platform 等价映射与三态 oracle → 在 current SHA 运行 provider、Engine、GitHub 真实验证 → 由 fail-closed equivalence gate 产出可信矩阵出口。

具体：
1. 系统载入 inventory 全部 129 条 P0/P1 行为，为每条保留稳定 `behavior_id`、severity、legacy source、unified owner/construct、current SHA、非空 assertion_ref、证据时间/保质期与 fail semantics；F01/F06 不得为空，F08 不得作为 110 项 catch-all。
2. 每条行为分别执行 positive、violation、recovery oracle；Claude、Codex、Grok 的支持项覆盖正常/违规/恢复矩阵，不支持项必须关联已批准 retirement/supersession decision。
3. 覆盖 branch-protect、credential-guard、bash-guard、branch/push guard、main-repo-write-guard、pre-push、worktree-checkout-guard、全部 stop hooks、DevGate/TDD/DoD、Evaluator/Judge、GitHub branch protection、staging/promote/rollback 及 inventory 全部 P0/P1 项。
4. 系统按 current SHA 重算真实状态；Engine shell/stop hook 测试不得 skipped，GitHub protection 通过真实只读 API 验 required checks、admin、linear history、force-push、delete 与 review policy。
5. gate 仅在 unknown=0、drifted=0、missing assertion=0、owner mismatch=0 时 PASS；`proven_status_count` 只计真实 proven active，只有全量真实矩阵通过的 11-element cells 才可标 green。

## 边界情况

- #4372 fixture 必须 FAIL，并明确报告 100 unknown、5 drifted、129 missing refs、0 green。
- 移除 credential guard、任一 stop hook 或 branch guard 必须 FAIL。
- manual oracle 填入 auto 行、硬编码 mismatch=0、伪造 match_count 均必须 FAIL。
- 外部 GitHub protection 漂移、证据过期、current SHA 不一致或 assertion_ref 为空均 fail-closed。
- oracle 执行异常、provider 不支持但无批准 decision、Engine 测试 skipped 均不得降级为 unknown 或 PASS。

## 范围限定

**在范围内**：129 条 P0/P1 全量映射；8 个行为族的 provider 正常/违规/恢复证明；13 stage × 11 element 矩阵；current-SHA、证据保质期、assertion_ref、owner 与 fail semantics 校验；真实只读 GitHub protection 验证；TDD Red→Green。

**不在范围内**：修改、复用或合并 PR #4372；修改生产 DB；仅做 inventory/文件存在性检查；新增 P2 行为；用 manual 证据冒充自动 oracle；硬编码或伪造计数。

## 假设

- [ASSUMPTION: “全部 P0/P1”以 #4372 head `4dc3b69a` 的 129 项清单为固定反例集合，并以当前 unified inventory 的同一稳定 behavior_id 集合核对增删。]
- [ASSUMPTION: 证据保质期的具体时长由既有 platform decision 决定；若无既有值，Proposer 必须在合同中显式定值，过期一律不计 proven。]
- [ASSUMPTION: GitHub 只读 API 凭据可在 local_api 验收环境安全提供；不可用时 gate 应 BLOCK/FAIL，不得假绿。]

## 预期受影响文件

- `packages/engine/`：legacy guard、hook、DevGate/TDD/DoD 与 unified construct 的行为证明及门禁归属。
- `.github/`：CI 与 GitHub branch protection 的只读验证入口及证明产物约束。
- `sprints/07271905-kernel-legacy-equivalence-proof/`：129 项证明矩阵、三态 oracle 结果与 fail-closed 汇总产物。

## 完成定义

- 129/129 行均具备稳定字段、非空 assertion_ref、current SHA、证据时间/保质期和 fail semantics。
- unknown=0、drifted=0、missing assertion=0、owner mismatch=0，且计数来自逐行重算。
- 8 个行为族与支持的 Claude/Codex/Grok 均有 positive/violation/recovery 真实证据。
- F01/F06 非空，F08 无 catch-all；13×11 矩阵只对真实 proven active 标 green。
- #4372 与全部指定 mutation 反例逐一 FAIL，并报告精确原因。
- Engine shell/stop hook 测试无 skipped；GitHub protection 由真实只读 API 验全策略。
- 不修改生产 DB，不修改/复用/合并 PR #4372，且 TDD Red→Green 证据完整。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；不得以超时跳过行为或降级为 PASS）
- 频控: 遵循 GitHub 只读 API 限额；限流导致证据缺失时 fail-closed
- 版本要求: current SHA 必须与每条证明记录一致；PR #4372 fixture 固定为 `4dc3b69a`
- 可观测: 每条 oracle 保留 assertion_ref、证据时间、保质期、真实状态与失败语义；汇总计数须可由逐行记录重算
- 安全: 不写生产 DB；凭据不进入代码、git、产物或日志

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源按 id 合并去重；本任务仅 area 源非空 -->
- [铁律1] [ ] 本机（美国 Mac mini）禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务；用系统域 LaunchDaemon + `UserName=administrator`。（来源: area）
- [铁律2] harness-generator 默认不得修改共享 CI 基础设施文件；未经合同显式授权须另开 sprint 走 GAN。（来源: area）
- [铁律3] 同一语义在判变端与终验端必须采用同一处理策略，禁止跨脚本语义分叉开假绿面。（来源: area）
- [铁律4] Test Contract 表格固定 4 列，testFile 用反引号包裹，checker 从第 3 列解析路径。（来源: area）
- [铁律5] 建新表或复用表前先核对全部写入方，多个模块写同表必须完成 schema 对齐评审。（来源: area）
- [铁律6] 新增后台 job 必须声明真实消费方，无下游读方的落库 job 不允许上线。（来源: area）
- [铁律7] CI 兜底在 evaluator/judge 前提前合并时，必须核对 verdict SHA 与实际合并 SHA 一致后才能报告流程完整。（来源: area）
- [铁律8] `git rev-parse` 判 ref 存在必须使用 `--verify "<ref>^{commit}"`。（来源: area）
- [铁律9] smoke 铁律。（来源: area）
- [铁律10] 服务存活判定使用 launchctl 状态与端口监听双信号。（来源: area）
- [铁律11] headed relay 点火必须在 payload 写 base_repo 或 pr_url，且分支名带 task short id。（来源: area）
- [铁律12] 跨模块时间常数存在大小关系时，必须显式写不变量断言或注释。（来源: area）
- [铁律13] 依赖真机、生产环境或真实调用方的接缝断言，未在真目标验证只能标 logic-done-pending。（来源: area）
- [铁律14] feat+brain/src PR 开 PR 前须带齐 smoke.sh 与 smoke-allowlist 登记。（来源: area）
- [铁律15] headed relay 长 CI 等待须周期性更新心跳，防 Brain reaper 误标 failed。（来源: area）
- [铁律16] catch 吞错的后台 job 必须有失败计数指标，连续失败超阈值须告警。（来源: area）
- [铁律17] dep-audit 因新 advisory 翻红时先检查 fixAvailable；可兼容修复时先修复而非加白名单。（来源: area）
- [铁律18] 客户隐私、PII 与聊天内容不得明文进入日志。（来源: area）
- [铁律19] 测试入册 rename 后须先本地运行 lint-tdd-commit-order 与 check-test-coverage 再 push。（来源: area）
- [铁律20] smoke 铁律。（来源: area）
- [铁律21] 每个 API 端点必须鉴权，无鉴权端点不准 ship。（来源: area）
- [铁律22] smoke 铁律。（来源: area）
- [铁律23] 单元与 E2E 测试默认种至少两个租户并断言互不串。（来源: area）
- [铁律24] 新增 cron 功能先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径。（来源: area）
- [铁律25] secrets 不硬编码、不进 git、不进日志。（来源: area）
- [铁律26] 判变基准使用生产实体自报 SHA 对账 origin/main，禁止以工作区 diff 代替。（来源: area）
- [铁律27] 通知与写库接口成功须验证 sent/accepted 等语义字段，不得只检查 ok:true。（来源: area）
- [铁律28] journey_features.updated_at 长期停滞可作为 report 漏跑的兜底探针。（来源: area）
- [铁律29] 新 task_type 接线须覆盖 CHECK、router、executor、relay 与 dispatcher 的完整七点清单。（来源: area）
- [铁律30] 环境假设值不得写死，必须从环境推导或在真机校准。（来源: area）
- [铁律31] smoke 铁律。（来源: area）
- [铁律32] watchdog_overdue 误标 failed 后，须经 orphan requeue、外部真相核查再从头重跑。（来源: area）
- [铁律33] lint-test-quality 要求 await fn()；读取源码须包装 async function，不能直接 readFileSync。（来源: area）
- [铁律34] smoke 使用真实 worktree 作部署根时，须核对是否触碰生产资源并显式列出 SKIP 钩子。（来源: area）
- [铁律35] 租户数据查询与写入必须 scope 到当前租户，禁止跨租户混读混写。（来源: area）
- [铁律36] 复活退役功能前须从 git 历史读取退役前真实代码并核对 death cause。（来源: area）
- [铁律37] headed relay 的 tmux innerCmd 必须显式 export 所需 harness 上下文变量。（来源: area）
- [铁律38] Red commit 只允许精确 add 测试路径，禁止 `git add .` 或加入 `.harness/`。（来源: area）
- [铁律39] 单 slot 内任务严格串行；任务内部只读工种可扇出，但同一时刻仅一个写代码实现者。（来源: area）
- [铁律40] Proposer 复用历史合同前必须核对本次真实派发与执行历史。（来源: area）
- [铁律41] 新字段与既有字段语义重叠须在本 sprint 消解或建立正式 decision 与后续任务；多端行为须有完整验收。（来源: area）
- [铁律42] 部署链失败路径不得 warning 降级，必须显式 FAIL、告警并非零退出。（来源: area）
- [铁律43] host/环境白名单断言必须核对 headed 人工接管场景。（来源: area）
- [铁律44] smoke 铁律。（来源: area）
- [铁律45] 新增常驻宿主服务须同步登记 launchd-patrol manifest。（来源: area）
- [铁律46] 跨扫描周期测试至少有一条真实多轮、状态不重置且时间真实流逝的集成用例。（来源: area）
- [铁律47] theater_mismatch 的环境选择必须与真实功能目标一致，不得用环境枚举绕过检查。（来源: area）
- [铁律48] 调度接线回归优先使用 source-code inspection 验证真实接线。（来源: area）
- [铁律49] DB 字段来源无天然长度保证时，写入前必须显式处理长度约束。（来源: area）
- [铁律50] manual `node -e` 中的 JavaScript 模板表达式须在 GAN 批准前逐条真跑，bash -n 不足以证明。（来源: area）
- [铁律51] Brain judge API 必须有顶层 exit_code、log_tail 与 behavior_tests，且每条测试有 exit_code 与 log_tail。（来源: area）
- [铁律52] 周期性重扫涉及外部付费调用时，必须先检查是否已处理，防止重复调用。（来源: area）
- [铁律53] generator 禁止自行 merge PR；merge 权归 controller，generator 只推分支并报告 ready。（来源: area）
- [铁律54] controller 完成判定须校验 pr_merged_at、notion_synced_at 等 report 产物，不得只信容器 exit code 0。（来源: area）
- [铁律55] 调用以 null/false 表示失败的函数时，必须显式处理失败分支，不能只依赖 try/catch。（来源: area）
- [铁律56] 退役判断必须查询生产数据与真实消费方，不凭记忆。（来源: area）
- [铁律57] 合同批准前必须记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [铁律58] target_environment 必须由 Brain orchestrator 从 task payload 读取并正确路由。（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本。
# 期望验收点：先以 #4372 head 4dc3b69a 产物运行，必须 FAIL 且精确报告 unknown=100、drifted=5、missing refs=129、green=0。
# 期望验收点：分别移除 credential guard、stop hook、branch guard，均必须 FAIL；manual→auto、hardcoded zero、伪造 match_count 均必须 FAIL。
# 期望验收点：通过 GitHub 真实只读 API 制造或读取 protection 漂移时必须 FAIL；Engine shell/stop hook 测试不得 skipped。
# 期望验收点：全量 current-SHA 真实矩阵通过后，逐行重算为 unknown=0、drifted=0、missing assertion=0、owner mismatch=0，才允许 PASS 与对应 cells=green。
```

## journey_type: dev_pipeline
## journey_type_reason: 任务覆盖 Engine hooks、guards、DevGate/TDD/DoD 与 CI 质量流水线，按优先级归类为 dev_pipeline。
## target_environment: local_api
## target_environment_reason: task.payload 显式指定 local_api；本地 evaluator 执行 Engine 与矩阵门禁，并调用 GitHub 真实只读 API。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 1a738e05-99a7-421c-a52d-c2bb80bf19be
