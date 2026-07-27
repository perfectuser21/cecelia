# Sprint PRD — Durable Fleet Worker bootstrap 与 Kernel 恢复闭环

## OKR 对齐

- **对应 KR**：未解析（Brain context 未返回活跃 KR）
- **当前进度**：未解析
- **本次推进预期**：交付首个可由精确 Draft PR head、真实生产证据和 owner gate 共同判定的 P0 闭环

## 背景

当前 Fleet Worker 启动、Mac-compatible single-use secret delivery、Docker-visible roots、Runner/profile/Worker/schema compatibility、Brain image 自包含、Kernel launch/watchdog readiness 之间存在分裂合同。已观察到镜像缺配置、PID 假就绪、非共享目录与 ACL/UID 不兼容、FIFO 跨 OrbStack 不相遇、超时覆盖错误阶段、Runner digest 不支持 Worker 协议、回执枚举无法持久化等失败。本 sprint 将这些接缝收敛为一个 fail-closed、可回滚、Worker-first 的 durable recovery 发布边界。

## Golden Path（核心场景）

范围锚点：Durable Fleet Worker bootstrap, Mac-compatible single-use secret delivery, protected Docker-visible roots, atomic Runner/profile/Worker/schema compatibility, self-contained Brain image, truthful Kernel launch/watchdog, Worker-first staged production proof.

运维者从基于 `dd424a61926009ac85a915b31187124b85f0ca98` 的 Draft PR → 经过不可变构件验证、Worker-first 上线、Brain 发布及无会话 Kernel 恢复 → 到达 owner 明确批准后才可合并且生产真实派发恢复的出口。

具体：
1. CI 构建 Brain image，并在该镜像内直接导入 orchestrator、加载 `/app/config/fleet-node-profiles.json` 中三个不可变 profile；任何 worktree 补件均不得使检查变绿。
2. CI 对同一不可变 Runner digest、profile、Worker 协议及数据库 transport 枚举做原子兼容验证；缺 single-use secret 能力、UID/GID/tmpfs 所有权错误、digest/ref 不一致或缺 `fleet-worker` 枚举时 fail closed。
3. 安装/升级事务在真实 macOS + OrbStack 身份边界上建立受保护且 Docker 可见的数据根、最小只读/遍历 ACL、确定性 TMPDIR 与可回滚的 Worker plist/scripts/toolchain/credential-envelope；每个变更都有独立反事实与精确回滚。
4. Worker 先以候选 generation 上线并通过鉴权 `/health`、`base_admitted`、`dispatch_ready`；health 使用与真实 Attempt 完全相同的数据根、挂载、ACL、UID/GID、secret channel 和 cleanup 合同。
5. Brain 仅在 Worker admission 成功后发布；remote-enabled、callback、Xian URL 可解析/可达和 immutable profile 均须预检，失败阻断远端派发与 Brain publication。
6. Controller 以 idempotency key 和分阶段有界预算获得 accepted/startup lease，再等待 ready receipt；慢 mirror、慢 image start、慢 secret handoff、取消或超时均只产生一个 Attempt，且不留孤儿。
7. Runner 在无关初始化前完成 Docker-mediated、Mac-compatible 的单次 secret 消费，在自有 tmpfs 中生成 mode 0600 凭据并返回认证回执；secret 不进入 env、argv、layer、日志、payload、callback、worktree 或 git，所有终态清除源文件及运行痕迹。
8. Kernel 启动先拒绝缺失、相对、非 Git、未挂载或不存在 worktree，再捕获有界脱敏诊断；只有 ready/ownership handshake 与初始 heartbeat 已持久化才返回成功，异步 spawn error、早退、无 ready frame 和超时均失败。
9. Watchdog 与初次启动复用同一 readiness 合同；失败保持可恢复并写结构化错误，成功后才 `resumed=1` 和 `reconcile-restarted`，Brain 重启后恰有一个 replacement、无重复 Kernel/provider Attempt，并能正常完成下一次 dispatch。
10. 候选先在真实 US Worker staging 验证，再做 production canary；Xian macOS 15.6.1 对所需 15.7.4 以及 M1 Tailscale CLI 暴露问题只输出 blocked evidence，不降低 profile、不加绕过。
11. 回滚恢复旧 Worker plist/scripts/toolchain/ACL 与 Brain image；鉴于旧 Brain 仍有 packaging defect，回滚态必须 drain Kernel dispatch 直至 roll-forward。
12. CI、Evaluator 与 Judge 全部锚定同一个 Draft PR head；CI Green 不授权 merge，auto-merge 始终关闭，owner 明确批准后才可合并。

## 边界情况

- 缺镜像配置、坏 worktree、child 早退、无 ready frame、诊断含 secret、bundle ref 不一致、遗漏模块或 schema 枚举不一致均必须给出非敏感机器错误码并 fail closed。
- 缺中间 ACL、私有/non-shared root、错误 host/container UID、tmpfs 所有权错误、secret reader 缺失或被取消时，不得假成功、重复 Attempt 或残留 workspace/admin/runtime/secret/state。
- slow mirror、slow image start、slow secret handoff 分别使用独立预算；总预算必须小于 Attempt lease/deadline，超时会取消仍在运行的 launch。
- rollback 中任一步失败不得留下混合 generation；恢复旧版本后保持 Kernel dispatch drained。

## 范围限定

**在范围内**：Brain image 自包含；Kernel readiness/watchdog；Fleet Worker、Runner、profile、transport schema 原子兼容；Mac/OrbStack 数据根、ACL、UID/GID、secret channel；分阶段 transport；Worker-first CD；真实 US staging、production canary、回滚与 owner gate。

**不在范围内**：降低 immutable profile；把 operator `/tmp` copy、手工 plist、wrapper shim、手工 Worker module 或临时 60 秒超时固化为发布方案；修复 Xian 外部 OS/Tailscale 维护项；自动合并。

## 假设

- [ASSUMPTION: 当前活跃 KR 与进度未由 Brain context 返回，controller 需在收账时补齐对齐关系。]
- [ASSUMPTION: profile 中登记的 release Runner digest 是唯一发货依据；`sha256:9fc98f...` 仅为 operator canary evidence。]
- [ASSUMPTION: PR 可按构件/安装事务、transport/Kernel、Worker-first rollout 三组提交组织，但必须作为一个 Draft PR 的闭合 fail-safe 合同验收，不得分组宣称 Golden Path 完成。]

## 预期受影响文件

- `packages/brain/config/fleet-node-profiles.json`: 三个 immutable profile 与 Runner/Worker 原子发布锚点
- `packages/brain/Dockerfile`: Brain image 配置自包含
- `packages/brain/src/orchestrator/run.js`: Kernel readiness、初始 heartbeat 与 watchdog 共用合同
- `packages/brain/src/`: remote bridge、receipt persistence、版本与发布门
- `packages/brain/migrations/`: execution transport CHECK 的向前/回滚兼容
- `packages/engine/`: Fleet Worker、Runner 协议与安装/回滚事务
- `scripts/`: rollout、health、canary、mutation 与 rollback 验证
- `packages/brain/DEFINITION.md`: Brain 行为与版本更新

## 完成定义

- [ ] 内建镜像 smoke 在精确 image 内导入真实模块并加载三个 profile，缺配置反事实稳定失败。
- [ ] 精确 pinned Runner digest 完成 single-use secret、UID/GID、tmpfs、cleanup 正反验证，旧/缺能力 digest 被拒。
- [ ] 安装事务的 root、ACL、identity、OrbStack context、bundle ref、credential-envelope、TMPDIR 每项均有 mutation 与精确 rollback。
- [ ] 真实 Attempt 与 health 共享相同 root/mount/ACL/secret 合同，并返回有界非敏感错误码。
- [ ] Kernel 初启与 watchdog 只在 handshake + heartbeat 后成功，恢复严格一次且无重复 Attempt。
- [ ] Worker-first ordering 的反事实能阻断 Brain publication，真实 US Worker canary 证明 admission、digests、cleanup 与正常 dispatch。
- [ ] rollback 恢复全部旧构件并 drain Kernel dispatch；Xian 外部差距作为 blocked evidence。
- [ ] Draft PR、auto-merge off、exact-head evidence 与 owner 明确批准门均可审计。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 分阶段有界预算；总启动预算必须小于 Attempt lease/deadline，具体生产值待合同 GAN 基于实测确定
- 频控: 同一 idempotency key 最多一个活跃 Kernel/Attempt/provider 尝试
- 版本要求: Xian macOS 必须达到 immutable profile 要求 15.7.4；Runner/Worker/profile 使用同一精确 digest/generation；Brain 必须 bump 版本
- 可观测: 失败写结构化、可界定、脱敏机器错误码；成功仅在明确 receipt/heartbeat 后记录，所有证据锚定 exact Draft PR head

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [恢复真相] watchdog_overdue 后仅可经 orphan requeue、外部 PR/产物真相核查后安全重跑（来源: area）
- [语义成功] 通知/写库成功必须验证 sent/accepted 等语义字段，不得只看 ok=true（来源: area）
- [依赖修复] dep-audit 新 advisory 先检查 fixAvailable，兼容修复不得先加白名单（来源: area）
- [Relay 心跳] 长 CI 等待须持续更新 relay 心跳，禁止 reaper 将存活 session 误标失败（来源: area）
- [毕业门禁] 测试毕业 rename 后 push 前运行 lint-tdd-commit-order 与 check-test-coverage（来源: area）
- [Oracle 实跑] 合同批准前记录 manual oracle 真实 exit code 并确认目标解释器启动（来源: area）
- [Shell 展开] manual node 命令须逐条真跑，bash -n 不足以证明模板字符串安全（来源: area）
- [Smoke 1784808160] smoke 铁律（来源: area）
- [Smoke 1784806023] smoke 铁律（来源: area）
- [多轮扫描] 测试须覆盖不重置状态且时间真实流逝的多轮扫描（来源: area）
- [重扫幂等] 周期重扫触发外部付费调用前必须检查是否已处理（来源: area）
- [时间关系] 跨模块时间常数的大小关系必须有显式 invariant 断言（来源: area）
- [环境路由] contract 环境语义必须与真实执行环境一致，不得用环境文本绕过 theater 检查（来源: area）
- [Payload 环境] target_environment 必须在任务 payload 正确登记（来源: area）
- [Judge 证据] Brain judge 结果须含顶层及逐行为 exit_code、log_tail 和 behavior_tests（来源: area）
- [字段长度] 非天然有界的数据写入受限 DB 字段前必须显式约束长度（来源: area）
- [复活核查] 恢复退役功能前须读取删除历史与旧实现核对 death cause（来源: area）
- [失败分支] 返回 null/false 的失败合同必须显式处理，不能依赖 catch（来源: area）
- [Smoke 1784543934] smoke 铁律（来源: area）
- [收账探针] journey feature 更新时间异常可作为 report 漏跑探针（来源: area）
- [外部完成] controller 不能仅凭进程 exit code 判定 report 完成，须核验外部产物（来源: area）
- [人工接管] host/环境白名单断言必须覆盖 headed 人工接管（来源: area）
- [点火锚点] headed relay payload 须携带 base_repo/pr_url 且分支可关联 task（来源: area）
- [退役实证] 退役判断必须基于生产数据和真实消费方，不靠记忆（来源: area）
- [后台告警] catch 吞错的后台 job 须有失败计数和连续失败告警（来源: area）
- [表名认领] 建表或复用表前须核对全部写入方并做 schema 对齐（来源: area）
- [消费方] 新后台 job 必须声明真实消费方（来源: area）
- [多端完整] 多设备/OS 数据模型必须有对应展示与验收区分（来源: area）
- [跨脚本语义] 判变端与终验端对同一未知值必须采取一致策略（来源: area）
- [Git Ref] ref 存在性须以 git rev-parse --verify ref^{commit} 判定（来源: area）
- [测试隔离] smoke 使用真实 worktree 时不得触碰生产资源（来源: area）
- [部署失败] 部署链失败不得 warning 降级，须告警并非零退出（来源: area）
- [生产自报] 部署判变基准使用生产实体自报对账，不得使用工作区 diff（来源: area）
- [测试质量] 异步测试须真实 await 被测函数（来源: area）
- [合同表格] Test Contract 路径格式必须符合 checker 解析合同（来源: area）
- [Red 提交] Red commit 只暂存精确测试路径，不得广泛 git add（来源: area）
- [调度真验] 调度接线回归须验证真实模块行为，源码检查不能替代 P0 行为证明（来源: area）
- [Scheduler] 新 cron 接入 scheduler-jobs，禁用 deprecated tick-runner 路径（来源: area）
- [Merge 权限] generator 禁止自行 merge，merge 权仅属 controller 且受人工门控制（来源: area）
- [环境继承] headed relay 子 shell 所需 harness 变量必须显式注入（来源: area）
- [历史合同] 复用历史 E2E 断言前须核对本次真实派发和执行路径（来源: area）
- [共享 CI] 共享 CI 基础设施文件默认禁区，变更须有明确合同授权（来源: area）
- [Exact Head] PR 被提前合并时仍须用 head SHA 核对 evaluator/judge 证据（来源: area）
- [Smoke 1783850042] smoke 铁律（来源: area）
- [Brain Smoke] feat 且改 Brain 源码时须同步 smoke 与 allowlist 登记（来源: area）
- [Task Type] 新 task_type 须完整覆盖路由、执行器、relay 与 dispatcher 接线（来源: area）
- [服务存活] 常驻服务存活须同时验证 launchctl 状态与端口监听（来源: area）
- [Mac 常驻] 美国 Mac mini 常驻服务使用系统 LaunchDaemon，不得依赖不存在的 GUI LaunchAgent 域（来源: area）
- [Daemon 清单] 新常驻宿主服务须登记 launchd-patrol manifest（来源: area）
- [Smoke 1783693282] smoke 铁律（来源: area）
- [单 Slot 串行] 单 slot 只推进一个任务，任务内只允许一个写代码实现者（来源: area）
- [环境假设] 环境接缝值不得写死，必须推导或真机校准（来源: area）
- [真环境] 依赖生产/真机的接缝未在目标环境验证只能标 logic-done-pending（来源: area）
- [多租户测试] 涉及租户数据的测试默认至少两个租户并断言隔离（来源: area）
- [凭据安全] secret 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文入日志（来源: area）
- [端点鉴权] 每个 API 端点必须鉴权，无鉴权不得发货（来源: area）
- [租户隔离] 租户数据读写必须绑定当前租户，禁止混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 linux_server 模板产出可执行的真实 US Worker + Brain staging/production 脚本
# 期望验收点（自然语言）：从 immutable 构件发布，经 Worker-first admission、Brain 重启和无会话 Kernel 恢复，到唯一 replacement heartbeat、resumed=1、正常下一次 dispatch；全过程 exact-head、无 secret、可回滚且 owner gate 未被绕过
```

## journey_type: agent_remote
## journey_type_reason: 核心路径涉及 Fleet Worker、Runner、remote bridge 与 Kernel 远端执行协议。
## target_environment: linux_server
## target_environment_reason: 最终 E2E 必须在真实 US Worker staging 与生产 Brain/Worker 上完成，不能用本地或合成 loopback 代替。
## journey_id: 7ea65cd0-a27a-47d3-8058-a93aa369428c
## step_id: 2c1bdcc9-6892-44a9-81bd-e513f7c894c2
