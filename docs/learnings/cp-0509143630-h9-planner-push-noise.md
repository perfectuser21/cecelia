# Learning: H9 — harness-planner SKILL push noise 静默

**PR**: cp-0509143630-h9-planner-push-noise
**Sprint**: langgraph-contract-enforcement / Stage 1

## 现象

W8 acceptance 5 次连跑（v6 → v10），planner 节点 5 次都报 `fatal: could not read Username for 'https://github.com'` 然后整个容器 exit 128。Brain 误判 planner 节点失败，14 小时诊断方向被这条假错误带跑偏。

## 根本原因

planner 容器是 detached docker spawn 的 cecelia-runner，没挂 GitHub OAuth creds。SKILL.md:151 `git push origin HEAD` 失败 → `set -e` 整脚本 abort → 容器 exit 非 0 → Brain 视为节点 fail。但实际上 sprint-prd.md 已 commit 到**共享 worktree**，proposer 节点起来后能直接读文件，**远端 branch 不是必需**。

哲学层根因：SKILL（LLM prompt）当作可执行 spec 时，每条 shell 命令的失败都会被 `set -e` 放大成节点级失败。无副作用必要的命令必须显式带 fallback；否则 SKILL 编辑者隐含赋予 brain "把这条 shell 命令的成功/失败等同于节点的成功/失败"，这往往不是真意图。

## 下次预防

- [ ] 任何 harness SKILL 里的 git push / npm publish / 远端写操作命令，必须带 || echo fallback 或 || true 兜底
- [ ] PR review 时 grep `git push` / `gh pr create` / `npm publish` 在 SKILL.md 里的出现，问"无 creds 该怎样"
- [ ] 长期：harness 节点契约应明确"必须 push 才算节点完成"还是"commit 到共享 worktree 即可"
