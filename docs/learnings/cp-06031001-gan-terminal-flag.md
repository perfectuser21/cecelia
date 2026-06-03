# Learning：GAN 熔断要带 terminal:true 才能让 B58 第一次中止即停

分支: cp-06031001-gan-terminal-flag
Brain task: 0285439b-0b79-493f-8218-ce961fe2077b
日期: 2026-06-03

## 现象

B58 给 harness_initiative 加了全局 fresh-start 上限（MAX=3），并在 resume 端留了
`error?.terminal===true` 钩子。但钩子是死的——没有任何熔断点 set `terminal`，所以即便是
proposer 连续不 push、reviewer 连续无 verdict、预算烧穿这种**永远不可能靠重启恢复**的硬停，
系统也要白白 fresh-start 满 3 次才认输，浪费 2 次无谓重启 + 多起若干 planner 容器。

## 根本原因

terminal vs transient 两类失败在 error 通道上**没有区分标记**：
- 熔断（硬停，重启也没用）：proposer no-push streak / reviewer no-verdict streak / GAN budget 超限
  / serial gate / terminalFail —— 这些 error 对象只有 `{node, message}`，没有 terminal 标记。
- transient infra（瞬时，重启可能恢复）：proposer_failed / reviewer_failed（容器 exit≠0）——
  这些是裸 throw，本就该让 cap 兜底重试。

B58 的 resume 钩子只能读 `error.terminal`，而上游从没 set 过它 → 钩子永远不触发 → 熔断退化成
"重启 3 次再停"。本质是**"知道这是 terminal 的那一层（熔断点）没把信息传给需要它的那一层（resume 钩子）"**。

另外 budget 超限是 `throw`（不经 finalState.error），与 streak 的 `return error` 路径不一致，
导致它即便想标 terminal 也没有统一的 error 对象可标。

## 修复

沿 熔断点 → runGanContractGraph → runGanLoopNode → checkpoint 透传 terminal：
1. proposer/reviewer streak 的 error 对象加 `terminal:true`。
2. budget 超限由裸 `throw` 改为 `return { error:{ node:'reviewer', message, terminal:true } }`，
   走和 streak 一样的 finalState.error→ganAborted 统一路径。
3. `runGanContractGraph` re-throw 时 `e.terminal = finalState.error.terminal === true`。
4. `runGanLoopNode` catch：`terminal: err.terminal===true || err.ganAborted===true` 写进返回的
   error（进 checkpoint）。ganAborted（熔断）→ terminal；裸 transient throw（proposer_failed）→ falsy。
5. serial gate（advanceTaskIndexNode）+ terminalFailNode 本就是 terminal，顺手标上保持一致。

未碰 Wave 2b：interrupt() 节点不改 throw（见 memory harness-langgraph-interrupt-throw，会引发重新挂起死循环+容器泄漏），
节点 catch→error→END 范式不动，嵌套子图 resume 不动。

## 下次预防

- "分类标记"和"消费标记"必须配套上线：加了一个 `error.terminal` 的消费方（B58 钩子），
  同一波里就要把所有生产方（熔断点）的标记补齐，否则消费方是死代码、给人"已防护"的假象。
- 同一语义的中止路径要走同一种控制流：streak 用 return error、budget 用 throw，会让"给 error 加字段"
  这种统一改动漏掉 throw 分支。先归一控制流，再加字段。
- 区分 terminal/transient 时，默认值要安全：transient（裸 throw）必须落到 falsy，让 cap 兜底，
  宁可多重试一次也不要把可恢复的瞬时失败误标 terminal 直接弄死任务。

### checklist

- [ ] 新增 error 字段的消费方时，同步补齐所有生产方（别留死钩子）
- [ ] 同语义中止路径控制流归一（都 return error 或都 throw），再加字段
- [ ] terminal 判定默认值安全：transient → falsy 让 cap 兜底
- [ ] 未碰 interrupt()/throw 改造（Wave 2b 已确认放弃）
