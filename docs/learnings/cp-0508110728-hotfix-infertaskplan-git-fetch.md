# cp-0508110728 — Hotfix inferTaskPlanNode 加 git fetch

**日期**: 2026-05-08
**Branch**: cp-0508110728-hotfix-infertaskplan-git-fetch
**触发**: W8 v4 task 5eb2718b fail at inferTaskPlan，origin 上有 cp-harness-propose-r3-XXX 但 brain git show 找不到

## 现象

PR #2837 已修 fallback 名 `cp-harness-propose-r{N}-{taskIdSlice}` 跟 SKILL push 同格式。W8 v4 实证 fallback 名 r3 完全匹配 origin 实际分支。但 brain 容器 git show 仍然 invalid object name。

```
$ git ls-remote origin cp-harness-propose-r3-5eb2718b
5b035a5abcd48b54  refs/heads/cp-harness-propose-r3-5eb2718b ✓

[infer_task_plan] git show origin/cp-harness-propose-r3-5eb2718b:... failed
fatal: invalid object name
```

### 根本原因

proposer 在 task container（`cecelia/runner` image）内 `git push origin <branch>`。这个 push 直接到 GitHub origin。但 brain 容器（`cecelia/brain` image）自己的本地 git 库 origin tracking **不会自动更新** — 必须显式 `git fetch origin <branch>` 才能在 brain 容器内 `git show origin/<branch>` 拿到。

`inferTaskPlanNode` 直接 git show 没 fetch → 拿不到刚 push 的分支。

## 下次预防

- [ ] **brain 跨进程读 git 状态前必须 fetch** — proposer/generator 等节点都跑在 task container（独立 docker），brain 节点要读它们 push 的内容前必须 fetch
- [ ] **git 操作 helper 封装** — 长治 sprint Cecelia Harness Pipeline 应该做 `gitShowOriginBranch(worktreePath, branch, file)` helper 强制 fetch+show
- [ ] **跨进程行为必须 smoke E2E** — 单元测试 mock execSync 看不出真实 git 跨进程行为，必须真 git push + 真 fetch 跑 smoke
- [ ] **每个节点改 fetch 时同样自检** — generator / fanout / dbUpsert 等节点可能也读 origin/X 路径，本 PR 不修但要登记到长治 sprint backlog

## 修复

- inferTaskPlanNode line 826-848 在 git show 之前加 git fetch
- fetch 失败 graceful warn 不阻塞，让原 show catch 报具体错（show 错最直观）
- unit test 3 个（fetch 在 show 之前 / fetch 失败 graceful / fetch cwd 正确）
- smoke.sh 真跨 worktree E2E（mock origin + proposer push + brain fetch 全跑）
- brain version 1.228.4 → 1.228.5

## 长治依赖

[Cecelia Harness Pipeline Journey](https://www.notion.so/Cecelia-Harness-Pipeline-35ac40c2ba6381dba6fbf0c3cb4f1ad4) 6 个 thin feature 实现，从根本避免一个一个节点修：
- S4 thin feature 就是 "brain git fetch origin 后 git show 看到分支"
- 本 hotfix 是 S4 的最小满足证据，待长治 sprint thicken
