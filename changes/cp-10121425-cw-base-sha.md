## Brain {VERSION} — coding workflow 固定任务登记的基线提交

- 带 base_sha 的任务从对应真实 commit 创建独立工作树；远端 main 后续前进不会悄悄替换基线。
- 非法 SHA、缺失对象或非 commit 对象明确失败；旧任务没有 base_sha 时保持 origin/main 行为。
