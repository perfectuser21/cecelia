# Initiative DoD: Harness Pipeline 编排层去 LangGraph 化

> 对应 `architecture.md`。Mode 3（/architect verify）将逐条对照本文件验收。

## 功能验收条件

- [ ] F1: 存在一个独立于Brain容器生命周期的orchestrator实现，能完整走完 planning→gan→generate→evaluate→(judge)→done/failed 全流程，产出一个真实merge的PR — 验证方式：Brain容器在orchestrator运行期间被手动kill一次，orchestrator不受影响继续跑完
- [ ] F2: 路由/门禁判断（下一步做什么、能不能merge）全部是可单元测试的纯代码函数，不依赖LLM做判断 — 验证方式：对应单测覆盖所有路由分支 + merge gate分支
- [ ] F3: 独立裁判（DeepSeek judge）逻辑原样复用，语义不变（agent PASS + judge PASS 才允许merge） — 验证方式：`harness-judge.js`未改动或改动不影响其对外接口/行为，有对应回归测试
- [ ] F4: orchestrator中途被kill重启后，能正确从外部真相（git分支/PR状态/DB任务行）重新推导出当前该做什么，不需要精确的内部checkpoint — 验证方式：至少一个集成测试覆盖"kill后resume"场景
- [ ] F5: 同一份orchestrator逻辑，既能被Brain无头拉起跑，也能被人在交互式session里前台直接触发跑，行为一致 — 验证方式：手动各跑一次，对比行为
- [ ] F6: CI通用auto-merge通道不再能绕过orchestrator自己的merge gate（`should-auto-merge.sh`双保险继续生效） — 验证方式：现有回归测试`lint-auto-merge-decision`继续通过
- [ ] F7: 每一跳写 append-only 决策日志（观测到什么/门禁判了什么/派了谁），事后可回放整条 sprint 的决策链 — 验证方式：跑完 I1 后查决策日志表，逐跳记录完整
- [ ] F8: subagent 出口统一为四态协议（DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED），orchestrator 对每态有确定性处置分支，BLOCKED 分路含"升级模型/拆task/报人"，绝不同模型无变化重试 — 验证方式：处置分支单测覆盖四态全部路径
- [ ] F9: orchestrator 心跳写入 DB，Brain watchdog 检测 stale 心跳后能重拉进程且重拉后从外部真相续跑不重复已完成工作 — 验证方式：集成测试模拟心跳超时

## 集成测试通过条件

- [ ] I1: 至少一次真实端到端sprint跑通（同一个简单需求，用新orchestrator跑一遍，产出真实merge的PR）
- [ ] I2: 对照测试（2026-07-04 修订口径）：新orchestrator跑 3 次同类需求，记录成功率/耗时/是否需要人工排查；与旧LangGraph版 30 天历史基线（126次、13.5%）对比（不要求新版本一定赢，但要有真实数据支撑后续决策）

## 架构对齐条件

- [ ] A1: 状态存储字段按 architecture.md §2.2 实现（phase扩枚举/round/pr_url/evaluate_verdict/judge_verdict/orchestrator_version/orchestrator_heartbeat_at+host+pid；contract 分支唯一存储在 initiative_contracts.propose_branch，不重复存）
- [ ] A2: Brain侧改动符合 architecture.md §2.3（tick/dispatcher变成"资源守门"判断+拉起独立进程，不再直接invoke图）
- [ ] A3: 关键决策 D1-D10 均已在实现中体现，无偏离（尤其D1门禁必须代码强制、D4裁判架构原样保留、D6 orchestrator纯node进程、D7双轨迁移、D9执行层原样复用）

## 非功能条件

- [ ] N1: 无新增L1 bug（code_review无BLOCK）
- [ ] N2: Brain CI全通过
- [ ] N3: 原LangGraph相关文件（harness-initiative.graph.js等）的退休/改造不破坏现有依赖它们的其他模块（如harness-report、harness-promote-regression.js等下游消费方）
