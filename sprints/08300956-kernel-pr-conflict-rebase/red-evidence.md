# Red 证据 — pr-conflict-rebase-route (frozen contract test)

命令: node_modules/.bin/vitest run sprints/08300956-kernel-pr-conflict-rebase/tests/pr-conflict-rebase-route.test.js
结果: 7 failed | 8 passed | 15 total（符合合同预期 RED：新路由 7 红，负向 8 绿）

失败用例（实现前，DIRTY/CONFLICTING 仍走 merge_pr/poll_ci/human_review）：
 - DIRTY 双PASS 路由 generator-fix rebase pr_conflict_rebase
 - CONFLICTING 双PASS 路由 generator-fix rebase pr_conflict_rebase
 - DIRTY ci_pending 优先于 poll_ci 路由 generator-fix
 - DIRTY reviewRequired 优先于 human_review 路由 generator-fix
 - DIRTY 已有2条rebase意图 第3次仍派 generator-fix
 - DIRTY 已有3条rebase意图 第4次升 human_review pr_conflict_unresolved
 - 计数只认 pr_conflict_rebase reason 其它reason的generator-fix不计入本界
