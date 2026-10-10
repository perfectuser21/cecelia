## Brain {VERSION} — orphan-pr-worker 不再碰 coding workflow runner 的 PR

- 金丝雀 4 的 PR #6232 在 QA 重走前，被 orphan-pr-worker 以「已被 #6139 取代」为由自动关闭。两个 PR 只是标题措辞相近，改的是不同接口。
- 根因：cw 链跑完后任务即为 completed，result 里也没有 pr_url，所以每个 cw PR 都被当成孤儿。标题相似会被关；CI 全绿时会被直接 squash 合并，绕过 QA 和独立裁判的合并门。
- 修法：与 harness 子任务 PR 一样，分支为 cp-<stamp>-cw-<task8> 的 PR 一律跳过（reason=coding_workflow_pr），不合、不关、不打标签，交给 MMV runner 的合并门自管。
- 测试：新增回归用例 case 14，用真实分支名和标题，断言跳过、不合并、不关闭、不查库。
