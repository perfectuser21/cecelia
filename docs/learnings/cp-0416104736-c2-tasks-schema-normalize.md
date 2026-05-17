# Learning: C2 — POST /tasks 入口 schema 收敛

## 根本原因
27 个 autonomous dev 任务被 pre-flight 误 cancel 的**深层根因**不是 pre-flight 逻辑有问题（PR #2370 已修），而是 POST /tasks 入口不做 schema 归一化。上游创建者把 PRD 散写在 description / payload.prd_summary / prd_content 三个字段，priority 写 normal/high/low。入口不管，把脏数据直接存 DB，下游全部消费者都要做 fallback。

## 修复
task-tasks.js POST handler INSERT 前加两步 normalize。`const` 解构改 `let` 以允许字段重写。

## 下次预防
- [ ] **入口归一化 > 下游 fallback**：schema 收敛应在数据进入 DB 的那一刻。pre-flight 是 double-check 不是正门。
- [ ] **解构用 let 而不是 const**：凡是 handler 里可能需要 normalize/transform 的字段，解构时就用 let，避免后续加 normalize 时还得回来改
