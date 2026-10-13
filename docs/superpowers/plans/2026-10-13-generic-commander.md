# 通用 Commander 实施计划

> 执行方法：当前 Codex 会话监督，按 superpowers:subagent-driven-development 分工实施和独立评审；任务状态仍只记 Brain。

**目标：** 通用 Commander 接管从合同输入到独立验收的闭环，失败可在同一任务恢复。
**架构：** 正式 workflow_dispatch 入口接现有冻结定义/运行账，Commander 外壳执行，核验回流通用控制器。采用 commander-v2 握手保护分阶段部署。
**技术：** Node.js/PostgreSQL，现有 OpenClaw、Python/Bash 外壳。
**合同：** docs/superpowers/specs/2026-10-13-generic-commander.md

## 共同约束

不改主仓脏文件；独立 cp-* 分支。所有 Brain 代码前先过 facts/version/DoD 门禁。先失败测试再实现，CI/独立评审后 PR 合并。无生产 schema 直改、无凭据入库或日志。任务 b1b9d813-cf34-46ac-a294-5d1f5df50a88 下关联实施任务。

## 评审重点

- 起跑及重复派发之间崩溃：固定 run 已落账，业务未获许可不得执行。
- 回执到达但独立核验失联：原目标不完成，不重复外部动作。
- 子进程仍活或状态未知：续接/阻塞，不能只凭 pid 文件重跑。
- 部署版本与冻结版本不一致：拒绝新执行，旧记录不变。
- 非手机输入及长中文文本：无损往返，不要求伪造手机参数。

## 任务一：Brain 通用合同与状态控制

文件：packages/brain/src/lib/workflow-commander-dispatch.js；新增同目录 commander-v2 合同、控制与反馈模块；routes 对应内部接口；task-lease/task-terminal/factory-judge 接线；现有 task-run 单写入口。
接口：请求沿用 payload.workflow_key，加 workflow_input、workflow_definition；result.workflow_control 管阶段/当前 run/核验与恢复条件；事实仍入既有运行表。
- [ ] 写并运行失败测试：绑定先于 SSH、非手机无锁、核验前不得完成、旧租约不误收、重复反馈/派发 fencing。
- [ ] 实现 commander-v2 正式入口、状态机、独立核验与回流；旧恢复条件使用冻结合同，不从自由提示词推断。
- [ ] 运行针对性单测和真实数据库事务集成测试，更新 DoD 映射、版本碎片与 DEFINITION。
- [ ] 独立代码评审，提交 PR，全部必需 CI 通过。

## 任务二：Commander 运行端

仓库：perfectuser21/zenithjoy-workspace；文件 services/phone-adb-controller/commander/wf-launch.sh、wf-status.sh、wf-agent-run.sh、wf-agent-handoff.py、wf-agent-lib.py、skills/workflow-commander/SKILL.md；合同生成器及现有 product-map 合同。
接口：消费 Brain commander-v2 JSON 信封，保留全部输入/版本/身份；按资源选择手机外壳或非手机执行。输出反馈与 delivery 完整可追溯。
- [ ] 写并运行失败测试：输入遗漏、已有 state 拒绝恢复、child 仍活重复 spawn、非手机被手机预检拦住。
- [ ] 实现幂等启动/官方等待重入、持久 deadline/attempt、反馈断网重放、输出和收尾。
- [ ] 通用 skill 写清执行、恢复、核验回流的同一角色；合同生成保留 IO/恢复/版本约束。
- [ ] 独立评审和 CI 通过，部署版本读回；生产在途任务完成前不覆盖外壳。

## 任务三：登记与整链验收

复用现有 workflow-authoring、定义、release 与部署 observation 接口；不直接改投影表。
- [ ] 注册通用 Commander 流程和非手机报告实例，关联所属树节点、源码 commit、skill、版本。
- [ ] 两端 ready 后从 Brain 入口执行非手机报告，验证输入输出/独立核验/版本绑定。
- [ ] 注入一次可恢复节点错误及一次核验失败，确认原 task 不变且历史 attempts 保留。
- [ ] 在已授权账号执行私密发布，核实真实作品、隐私、无重复、收尾释放。
- [ ] 独立核验五个维度读回，更新知识说明和主任务事实、证据、actor、交接。
