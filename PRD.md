# PRD: 修 archive-learnings workflow 走 PR 而不是直推 main

## 背景

PR #2448 合并后手动 dispatch archive-learnings 跑失败：

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
- Required status check "ci-passed" is expected.
! [remote rejected] main -> main (push declined due to repository rule violations)
```

main 受 `required_status_checks` ruleset 保护，bot 直接 push 被拒。workflow 归档了 297 个文件，commit 成功但 push 失败。

尝试给 `github-actions` Integration 加 bypass_actors 也被拒：`Actor GitHub Actions integration must be part of the ruleset source or owner organization`。

## 成功标准

1. workflow 的最后一步从"直推 main"改成"push feature branch + 开 PR"
2. PR 打 `harness` 标签 → 跳过 `pr-size-check`（297 deletions 超 1500 行硬门禁）
3. PR 走正常 CI → `ci-passed` 绿时 `auto-merge` job 自动 squash merge
4. 分支名 `cp-archive-YYYYMMDD-HHMM-learnings`（符合 branch-naming 规则）
5. 本 PR 自带一次触发验证：合并后手动 dispatch workflow，验证开 PR 流程工作

## 非目标（YAGNI）

- 不改 ruleset bypass（技术不允许 + 影响所有 bot workflow）
- 不改 auto-merge 逻辑
- 不改 pr-size-check 逻辑
- 不改归档本身的逻辑（cutoff、分桶、tar.gz 都不变）
