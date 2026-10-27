---
task_id: 5f8029c7-6f55-441a-b7d0-70688ac0cfb9
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5", "02-spec.md#S-6"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 7
可验证: 6
场景覆盖: 6
回归风险: 7
可执行: 6

## 上轮问题
- R-1: 关闭 —— S-1 现要求交付代码预先固定索引路径和 Git SHA；Q-1/Q-2 改用 `repos.json` 已登记的 `cecelia` 隔离克隆，且先只读核对锚点。原先临时仓库无登记、临时索引自我授权的路径已删除。

### R-2
针对: S-1, S-2, Q-2, I-2
严重度: 阻断
场景: QA 按 Q-2 声明一个外部权威 URL，计划结构没有来源字段，只能把 URL 塞进 `path`；活动将它当非法或未登记 Git 路径拒绝，QA 看不到 I-2 要求的“未支持外部权威来源”独立缺口。
依据: S-2 将引用字段封闭为 `ref_id/kind/path/revision/digest/required`，S-1 则要求四类引用的 `path/kind` 匹配固定 Git 索引；现有 `new-task.mjs` 的任务体没有权威来源字段，`activities/intent.mjs` 也只从任务 payload 取资料。Q-2 没给出可构造外部来源的实际请求形状。
说明: 明确外部来源如何在计划和任务 payload 中表达、活动怎样返回可区分的 unsupported 原因，并让 Q-2 用该真实形状走一次建单和 intent；若本批不支持外部来源，仍须让用户声明该来源后得到明确缺口。

### R-3
针对: S-5, Q-6, I-9
严重度: 重要
场景: QA 在预览环境按 Q-6 启动 runner 后尝试提交伪造登记和重复 PID，找不到可向 runner 提交这些登记的入口；只能运行测试文件里的辅助代码，无法按场景观察预览 runner 对这些输入的反应。
依据: S-5 把 owned 枚举和登记限定在 `runner/__tests__/helpers/owned-process-enum.mjs` 等测试辅助层，并明确不改生产 runner；现有 `runner/run-once.mjs`、`runner/__tests__/helpers/sandbox.mjs` 的真实启动入口是 runner 环境变量和受控任务服务，没有接收 nonce/PID 登记的产品请求。Q-6 未给测试辅助命令、登记载体或可观察回执。
说明: 将 Q-6 当前产品 QA 的操作限定为可实际启动并观察的超时、终止及进程消失路径；伪造登记、重复 PID 和 Native owned 枚举交给发布前 verify 的原生命令与独立来源门核验，保留 I-9 的全部条件，不把测试辅助内部断言写成当前 QA 的黑盒步骤。
