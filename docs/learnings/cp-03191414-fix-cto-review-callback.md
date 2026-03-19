# Learning: cto_review execution-callback 断链修复

## 分支

cp-03191414-fix-cto-review-callback

### 根本原因

execution-callback 中已有 code_review / initiative_verify / dev 等多种 task_type 的链式处理逻辑（断链 #1-#6），但新增 cto_review task_type 时遗漏了对应的 callback 处理。cto_review SKILL.md 指示 agent POST execution-callback 并传 result=PASS/FAIL，但 callback handler 无代码读取此 result 并写入 review_result 列，导致 devloop-check.sh 条件 2.5 永远阻塞。

关键发现：devloop-check.sh 查询的是 cto_review **子任务自身**的 review_result（不是父任务），因此必须同时写入子任务和父任务两处。

### 下次预防

- [ ] 新增 task_type 时，检查 execution-callback 中是否需要对应的链式处理
- [ ] 新 task_type 的 SKILL.md 回调格式必须与 execution-callback 的解析逻辑对齐
- [ ] devloop-check.sh 中对新字段的读取路径（子任务 vs 父任务）必须在 SKILL.md 和 callback 代码中明确标注
