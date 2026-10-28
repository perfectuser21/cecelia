---
task_id: b3d6f213-3fa3-48f9-a2c1-6d7e3b68d132
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5", "02-spec.md#S-6", "02-spec.md#S-7", "02-spec.md#S-8", "02-spec.md#S-9"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 8
可验证: 6
场景覆盖: 7
回归风险: 7
可执行: 7

## 上轮问题
- R-1: 关闭 —— S-4 与 Q-1 已要求控制器只读交付本次 intent 原生 stdout、执行输入和文件归属；QA 能据此独立核对新 01 原字节摘要。

### R-2
针对: S-3, Q-1, Q-2, Q-3, Q-4, I-3
严重度: 阻断
场景: 开发方的 `new-task.mjs` 把受管声明漏出 POST payload，QA 按 Q-1 手工发送一份字段齐全的 JSON 后仍看到新 01 引用正确，于是误判“new-task 声明到 intent 全程不丢字段”通过；用户实际运行 `new-task.mjs <plan.json>` 建单时却得到 `unconfigured`。
依据: `packages/brain/scripts/coding-workflow/new-task.mjs` 的 `validatePlan()`、`body()`、`main()` 分别负责读取 plan、构造 payload 和真实 POST；Q-1 至 Q-4 只规定按其 shape 直接 POST，均未运行该入口。现有 `__tests__/new-task.test.mjs` 的子进程 POST 目标是本地 `startBrain()` 假服务，S-5 的测试不能补上真实预览服务中的这段接缝。I-3 明确要求从 new-task 声明到任务 payload 再到真实 intent 子进程全程不丢字段。
说明: 在当前合法 QA 场景中，由控制器预备场景 plan 和标准客户端传输，让 QA 实际调用固定 HEAD 的 `new-task.mjs` 建至少一个受管任务，再从真实任务 API 和新 01 核同一声明；仍保持 QA 不写来源根或业务产物。其余直接 POST 场景可继续验证输入拒绝。
