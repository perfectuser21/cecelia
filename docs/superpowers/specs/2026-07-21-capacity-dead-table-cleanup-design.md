# 设计:删除 capacity.js 死代码估算表

## 背景
`MEM_PER_TASK_MB_BY_TYPE` 按任务类型估内存的链路(表 → `estimateMemPerTask()` → `getMaxStreams(taskType)`)是 LangGraph 编排时代(每 phase 一个 Brain task)的遗物。现架构为 harness_initiative 单 session skill-relay,planner/generator 等作为容器内接力棒不落 tasks 表;表中键名在 30 天 task_type 分布中零出现。已两次误导资源决策(2026-07-21:诱导"降 VM 砍产能"误判 + 无效优化提案),decision 4186b574 判死。

## 调查结论(Research Subagent,2026-07-21)
- `estimateMemPerTask`:仅 capacity.js:56 定义 + :71 内部调用,零外部引用
- `MEM_PER_TASK_MB_BY_TYPE`:模块私有 const(未 export),零外部引用
- `getMaxStreams` 全部 4 个调用点(computeCapacity 内部/nightly-orchestrator:137/capacity-budget:85/capacity.test.js)均不传 taskType → 恒走 400 默认
- facts-check.mjs 不锚定 capacity.js 任何符号;DEFINITION.md 无精确符号引用(仅 7.1 段散文伪代码,且已与代码失配:写 500MB/cap10,代码 400MB/cap20)
- 现有测试(capacity.test.js/decomp-capacity-gate/dual-capacity)零依赖被删符号

## 改动清单
1. `packages/brain/src/capacity.js`:删除 MEM_PER_TASK_MB_BY_TYPE 表、estimateMemPerTask()、getMaxStreams 的 taskType 参数与分支;保留 MEM_PER_TASK_MB_DEFAULT=400 直用;加注释说明现架构内存由 relay 容器 cgroup 硬顶(1G,OOM 自动升 4G,刀A7)执行时兜底
2. `packages/brain/src/__tests__/capacity.test.js`:加回归断言——模块不再导出 estimateMemPerTask;getMaxStreams() 数值行为不变
3. `DEFINITION.md` 7.1 伪代码对齐代码事实(MEM_PER_TASK 400MB、MAX_PHYSICAL_CAP 20)——修既有失配,非本次引入
4. Brain 版本 patch bump,三处同步(package-lock.json/.brain-versions/DEFINITION.md Brain 版本行)

## 行为影响
getMaxStreams() 返回值不变(before/after 恒走 400 默认分支);computeCapacity() 不变;执行时内存保护与本表无关。纯减法,零行为变更。

## 测试策略(unit 档)
- TDD commit-1(红):capacity.test.js 新增断言 `estimateMemPerTask` 不再被导出——在删码前该断言失败
- TDD commit-2(绿):删码后全绿
- 不需要 integration/E2E:无 DB、无网络、无环境接缝;逻辑接缝 CI test 即够(哨兵死规矩:纯逻辑=CI test,别画蛇添足)

## 不做
- 不接线 taskType(行为变更,超范围)
- 不动 content_* 相关逻辑(表删除后自然消失,调用方本就不传)
- 不动 CPU 估算(CPU_PER_TASK=0.5 与 relay 实际 1core limit 的失配另行立项)
