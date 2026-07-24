# Sprint PRD — 完整 Codex Slot 安全硬切换

## OKR 对齐

- **对应 KR**：安全与可靠性交付（任务上下文未提供编号）
- **当前进度**：任务进行中
- **本次推进预期**：在进入 `main` 前将公司账号 token 的发放、主机出口校验、租约生命周期收敛为可验证的单一安全链路。

## 背景

本次从 `main` 重新实现，不依赖或合并旧草稿 PR。现有直接 token 分发入口会绕过统一租约与主机校验；本 sprint 要一次性硬切换为 broker 唯一发放，并以真实主机的专用假 auth fixture 验证安全生命周期。

## Golden Path（核心场景）

需求主题（原样）：从 main 实现完整 Codex Slot：设备身份映射、自动 slot、公司账号租约、xian-m1/xian-m4 agent、固定美国 mmv exit node、broker 唯一 token issuer、硬切换旧入口、reaper 与真实主机假 token smoke。

用户从受控设备登录后，由服务端身份映射取得当前 actor → broker 在硬切换已开放且账号未被活动、隔离或阻塞租约占用时创建持久租约 → client 只选择身份、`mmv` 出口、容量均明确健康的 xian-m1/xian-m4 agent → broker 经受保护通道投递 auth snapshot → agent 写入及启动前两次校验固定 `mmv` stable node ID → 用户得到可读 session handle，并能停止、清理、释放。

具体：

1. 登录或 acquire 时，客户端不能指定 actor、team 或 agent 主机；服务端只接受有效 UID 或受控 SSH key 映射的身份，并在旧会话盘点完成前拒绝新租约。
2. broker 创建并持久化账号租约、session 与不含秘密的审计事件；同一公司账号同时至多一个活动、隔离或阻塞租约，未知或不可达状态一律隔离而不释放。
3. agent 以 root 管理的自身身份、容量和固定美国 `mmv` stable node ID/IP 为准；名称或 DNS 别名不能作为信任依据，任何采样错误、身份错误或容量不明均不可用。
4. broker 仅向目标 agent 的受保护接收入口投递有限 auth snapshot；agent 在读取或落盘前重验 `mmv`，以私有权限持久化，响应只返回摘要与会话元数据。
5. launch 前 agent 再次重验 `mmv`；失败时删除暂存 auth 并拒绝启动。reaper 只依据 broker registry 与精确 agent 状态更新 heartbeat、释放已确认停止会话或隔离不确定会话。
6. 真实 xian-m1 与 xian-m4 各用专用假 auth fixture 完成生命周期 smoke，确认停止与清理后无 auth、tmux、临时目录或租约残留；绝不使用真实公司 token。

## 边界情况

- `mmv` 在 prepare 与投递之间变化：不得读取或写入 token；在投递与启动之间变化：必须删除 auth 并失败关闭。
- SSH 失败、响应丢失、agent 不可达、tmux/session 元数据不匹配或容量采样异常：不得猜测成功或自动释放账号。
- durable write 任一故障点或重启后：不得产生同一账号的并发租约；审计、日志与错误不得含 token、prompt、完整 auth JSON 或完整环境变量。
- 旧入口切换任一步失败：保持 `frozen`，不得部分开放；旧 `codex-request` 只能给迁移提示，不能生成或覆盖 auth。

## 范围限定

**在范围内**：设备/服务端 actor 映射、broker 唯一 token 发放、账号租约与 session registry、xian-m1/xian-m4 agent 身份/容量/固定 `mmv` 校验、旧入口硬切换、reaper、耐久性与真实主机假 token smoke。

**不在范围内**：旧草稿 PR #4237-#4242 的直接合并；broker 与旧直连 token 入口长期并存；从主机名自动学习 `mmv` stable node ID；真实公司 token 的 CI、fixture、日志或 smoke；账号用量选择算法之外的计费策略变更。

## 假设

- [ASSUMPTION: 美国 `mmv` 的 stable node ID 与允许 IP 集已由可信管理面核验，并可写入每台 agent 的 root 管理配置。]
- [ASSUMPTION: 真实主机 smoke 在受控环境可使用专用假 auth fixture，且其结果不会被表述为真实凭据验证。]

## 预期受影响文件

- Codex Slot 的 broker、agent、client、reaper、安装与测试资产：由后续 proposer 基于当前 `main` 的实际归属确定；不得从旧草稿 PR 复制实现路径。

## NFR 约束

- 凭据与日志：不得写入或记录真实 token、prompt、完整 auth JSON、完整环境变量；真实主机验证必须使用专用假 auth fixture。
- 安全关闭：身份、容量、`mmv` stable node ID/IP、SSH 结果或 session 状态任一不明确即拒绝、隔离或清理，不得推断成功。
- 持久性：租约、session、rollout state 与审计确认前必须完成 durable write；崩溃恢复不得破坏单租约约束。
- 兼容性：安装器在 macOS Bash 3.2 与现代 Bash 均可运行；所有人工 Bash/ARTIFACT 命令须在真实解释器启动后逐条执行，`bash -n` 不能替代。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [真实执行] 合同批准前必须记录 manual oracle 的真实退出码，并确认目标解释器确已启动（来源: area）
- [真实执行] 含 JavaScript 模板插值的 `manual:node -e` 命令必须在 GAN 批准前逐条真实运行，不能只做 `bash -n`（来源: area）
- [冒烟验证] smoke 铁律（来源: area）
- [冒烟验证] smoke 铁律（来源: area）
- [跨轮测试] 不能只测重置状态的冷启动；周期性扫描须有状态不重置、时间流逝的集成验证（来源: area）
- [重扫幂等] 周期重扫触发外部付费调用时必须有已处理前置检查（来源: area）
- [时间关系] 跨模块时间常数的大小关系必须显式断言或说明（来源: area）
- [环境路由] 合同中的环境关键词不得造成 theater 误判；选择环境必须符合实际被测服务（来源: area）
- [环境来源] `target_environment` 以任务 payload 为准，不以本地文件为准（来源: area）
- [判定结果] Brain judge 结果必须含顶层与每项行为测试的退出码和日志尾部（来源: area）
- [字段长度] 无天然长度保证的数据写入受限字段前必须显式截断（来源: area）
- [复活核验] 重做已退役功能前必须核对退役前真实代码与死因（来源: area）
- [失败分支] 返回 null/false 的失败契约必须显式处理失败分支（来源: area）
- [冒烟验证] smoke 铁律（来源: area）
- [报告探针] journey feature 的长期未更新时间须作为 report 漏跑探针巡检（来源: area）
- [报告收口] merge 后必须有机械闸确保 report 阶段实际完成（来源: area）
- [接管场景] host/环境白名单断言必须核对 headed 人工接管场景（来源: area）
- [中继上下文] headed relay 点火的 payload 必须含 base repo 或 PR URL，分支含任务短 ID（来源: area）
- [退役证据] 退役判断必须以生产数据与消费者核对为证，不凭记忆（来源: area）
- [后台告警] 吞错后台任务必须有失败计数与连续失败告警（来源: area）
- [表归属] 建表或复用表前核对全部写入方；多模块写同表须做 schema 对齐评审（来源: area）
- [消费闭环] 新增后台落库任务必须声明真实下游消费者（来源: area）
- [多端完整] 涉及多设备类型时，设计、审查和验收必须检查对应 UI 区分（来源: area）
- [语义一致] 同一语义在判变端与终验端必须采用同一处理策略（来源: area）
- [引用核验] 判断 git ref 存在必须使用 `git rev-parse --verify "<ref>^{commit}"`（来源: area）
- [测试隔离] 以真实 worktree 冒烟时必须确认脚本不会触碰生产资源（来源: area）
- [部署失败] 部署链失败不得降级为 warning，必须可见失败并非零退出（来源: area）
- [生产对账] 判变基准使用生产实体自报信息对账 `origin/main`，不用工作区 diff（来源: area）
- [异步质量] 读源码的异步质量测试必须经异步函数调用验证（来源: area）
- [合同表格] Test Contract 表格固定四列，测试文件路径用反引号并由第三列解析（来源: area）
- [精确暂存] Red commit 只能精确暂存测试路径，禁止 `git add .` 或 `.harness`（来源: area）
- [接线回归] 调度接线回归优先以源码检查验证，不仅依赖 mock（来源: area）
- [定时任务] 新增 cron 功能先检查 `scheduler-jobs.js` 的 JOBS，`tick-runner.js` 已弃用（来源: area）
- [合并权限] generator 不得自行合并 PR；只提交分支并由 controller 合并（来源: area）
- [环境继承] headed relay 的 tmux 子 shell 不会自动继承父环境，所需上下文必须显式传入（来源: area）
- [历史核对] 复用历史合同模板前必须核对本任务的真实派发与执行历史（来源: area）
- [共享禁区] 共享 CI 基础设施文件默认禁改，变更须有明确必要性（来源: area）
- [合并锚定] 提前合并检查必须以 PR head SHA 对齐 evaluator/judge verdict 的 SHA（来源: area）
- [冒烟验证] smoke 铁律（来源: area）
- [冒烟清单] 触及 `brain/src` 的功能 PR 在开 PR 前须带 smoke 脚本与 allowlist 登记（来源: area）
- [任务接线] 新 task type 接线必须核对约束、路由、执行器、覆盖、relay 与并发防线（来源: area）
- [服务存活] 服务存活须同时检查 launchctl 状态与端口监听（来源: area）
- [守护域] 美国 Mac mini 的常驻服务使用系统域 LaunchDaemon，不使用 GUI LaunchAgent（来源: area）
- [守护清单] 新增常驻宿主服务必须同步加入 `launchd-patrol.js` manifest（来源: area）
- [冒烟验证] smoke 铁律（来源: area）
- [单槽串行] 一个 slot/会话同时只允许一个任务；并行只能跨 slot，单任务实现者同刻仅一名（来源: area）
- [环境推导] 不得写死环境假设值；必须从环境推导或在真机校准（来源: area）
- [真实验收] 依赖真机、生产环境或真实调用方的接缝断言，未经真目标验证不得标 done（来源: area）
- [多租户测试] 单元与 E2E 默认种植至少两个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有鉴权，无鉴权端点不得发布（来源: area）
- [租户隔离] 租户数据查询和写入必须 scope 到当前租户，绝不跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

> proposer 将按 `local_api` 产出真实可执行脚本；本 sprint 的期望验收为：在本地控制面完成受控身份、租约、broker-only 与 fail-closed 验证，并在 xian-m1、xian-m4 以假 auth fixture 各完成一次真实生命周期 smoke。

```bash
# 占位：proposer 逐条真实执行所有 manual:bash 与 [ARTIFACT] 命令；预期 Red 可接受，shell 解析、坏替换、未启动验证器或未到达断言不可接受。
```

## journey_type: agent_remote
## journey_type_reason: 核心场景包含 xian-m1/xian-m4 远端 agent、受保护 SSH 投递和真实主机状态核对。
## target_environment: local_api
## target_environment_reason: 任务 payload 已明确指定 local_api；控制面合同与 broker 验证由本地 evaluator 路由，真实主机 smoke 作为受控接缝验收。
## journey_id: codex-slot-company-access
## step_id: secure-slot-lifecycle
