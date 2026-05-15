# B41 — Phase C finalEvaluateDispatchNode 未同步 playground/ 到 origin/main（2026-05-15）

## 任务描述

Harness pipeline Phase C (Final E2E evaluation) 系统性 FAIL，表面原因是 evaluator 报 "E2E failed"，根因是 initiative worktree 里的 playground/ 代码是旧版本。

### 根本原因

initiative worktree 的 HEAD 始终停在 GAN 合同分支（Phase A proposer push 的分支）。Phase B sub-task generator 把修复代码通过 PR 合并进了 `origin/main`。Phase C evaluator（Mode B，IS_FINAL_E2E=true）在 initiative worktree 里跑 E2E bash 脚本——测试的是该 worktree 里的 playground/ 代码，也就是旧代码，从未被更新过。

结果：91 条 pipeline 运行记录，仅 13 条完成（14%），全部失败发生在 Phase C。

### 修复方案

在 `finalEvaluateDispatchNode` 调用 `executor()` 前，先做：
```
git fetch origin main
git checkout origin/main -- playground/
```

只 checkout `playground/` 目录（不 checkout 整个分支），保留 initiative worktree 上的合同文件等其他文件不变。操作 wrap 在 try/catch 里，失败时 warn 但不崩溃。

### 下次预防

- [ ] 新增 multi-worktree 设计时，必须明确标注每个 worktree 的 "HEAD 状态生命周期"：在哪个阶段由谁写入、在哪个阶段由谁消费
- [ ] Phase X → Phase Y 交接处如果有跨 worktree 数据流，必须在设计文档里画出数据流向图
- [ ] finalEvaluateDispatchNode 的集成测试应覆盖"Phase B 合并后 Phase C 能读到新代码"场景（需 real git repo fixture）
- [ ] 14% 完成率这类"系统性"失败，优先查 Phase 交接点的数据同步，而非单点 bug
