# Learning — harness 子图 fix loop 必须感知任务终态

**分支**: cp-06120955-fixloop-terminal-abort
**日期**: 2026-06-12
**关联 run**: cf4f596c（08:28-08:34 实证）

## 根本原因

harness-task 子图的 fix loop 是一个进程内 LangGraph 实例，它的循环条件只看**自己内部的
verdict**（evaluate FAIL → fix_dispatch → spawn → … ），从不回查它所属的 initiative 任务在 DB 里
是否已经被外层 / Serial gate 判了终态。

实证：initiative cf4f596c 已被标 `failed` 后，这个在飞图实例的 fix loop 仍每 ~2 分钟 spawn 一个
generator（r5、r6…烧账号、占 slot），直到手动重启 Brain 才停。终态信号停在 DB 层，在飞执行体完全
不感知——"任务已死，执行体还在跑"。

这是「在飞执行不感知任务终态」类 bug 的通式：**异步长生命周期执行体的循环边，没有把"我所服务的
任务是否还该被服务"作为循环的前置条件**。

## 下次预防

- [ ] 任何长生命周期 / 带循环（fix loop、retry loop、poll loop）的在飞执行体，循环边在做下一次昂贵
      动作（spawn 容器 / 派 agent / 起 job）前，必须回查"我服务的任务/initiative 是否仍是活态"。
      终态（failed/completed/cancelled）→ 立即走终止路径，写明确终态。
- [ ] 把终态查询放在所有 spawn 入口（不只 fix 路由边，generator/evaluator 入口都加），单点遗漏就会
      留下一条绕过路径。
- [ ] 终态门 fail-open：查不到/DB 失败 → 当作"未终态"继续（不误杀在飞 run），只 warn；终态门的职责是
      "确认已死才停手"，不是"查不到就停手"。
- [ ] 设计在飞执行体时先问："如果外面把这个任务杀了，正在跑的这个实例怎么知道、多久知道？"——
      答案不能是"等它自己跑完"或"等人重启进程"。
