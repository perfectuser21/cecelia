# bump-archive-workflow（2026-04-20）

### 根本原因

PR #2450 合并后，GHA 无限报 `422: Workflow does not have 'workflow_dispatch' trigger`，尽管 main 上 archive-learnings.yml 明显含 `workflow_dispatch:`。典型 GHA workflow 元数据缓存 bug。

试过无效路径：
- 用 workflow id vs file path 都 422
- `--ref main` / `--ref <sha>` 都 422
- disable → enable workflow 也无用

唯一可靠 unstick：**push 一个 trivial change 到 workflow 文件**（哪怕只改一行注释），GHA 会在下次 parse 时刷新内存缓存。

### 下次预防

- [ ] 新加 workflow 第一次 dispatch 前，先确认 main 上文件内容已稳定（不会再被 follow-up PR 改）；否则 GHA metadata 容易卡住
- [ ] 遇到 `422: Workflow does not have 'X' trigger` 错误，别 hack ruleset / token / API 路径 — 直接在 workflow 头部加一行无害注释 push 一下就行
- [ ] 所有 bot workflow 默认走"push branch + create PR"而不是"push main"（见 PR #2450 的 learning）
