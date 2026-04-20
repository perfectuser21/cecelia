# cp-0420151819-cp-04201518-phase82-proxy-remaining-10 — Learning

### 背景

Phase 8.2：把 Superpowers 32 个交互点中剩余 10 个深度化（writing-plans / executing-plans / TDD / finishing / systematic-debugging / requesting-code-review / dispatching-parallel-agents / using-git-worktrees）。与 Phase 8.1（13 点，brainstorming/SDD/RCR）拼合后，proxy 覆盖 23/32，达到"0 人为 gate"目标。

### 根本原因

Phase 8.1 收敛了 brainstorming/SDD/RCR 三个 skill 的交互点，但 writing-plans / executing-plans / TDD / finishing / SD / DPA / UGW 几个 skill 还留着"问用户"的默认行为。若不深度化，主 agent 在这些 skill 下仍会停下等用户，违反"完全自主"。10 点中 6 点是硬规则判断（按 commit type / 硬默认 Option / 硬阈值 / 固定路径），不需要 Research Subagent prompt；4 点（WP-1 / EP-1 / DPA-1 / DPA-2）是策略性决策，需要在 Appendix A 补 prompt 模板让主 agent 派 subagent 去研究后回答。

### 下次预防

- [ ] 新增 Superpowers skill 纳入 /dev 接力链前 → proxy.md 必须先审过所有交互点并分档（硬规则 / Research Subagent / Tier 3 丢弃）
- [ ] EP-1 落的 `.concerns-<branch>.md` 要加进 worktree 清理清单（合并后被 `worktree remove --force` 一并删）
- [ ] SD-1 的 `ci_fix_count` 读路径在 `.dev-mode.<branch>` — Stop Hook 每次 CI 失败 + 修复 commit 自增 1；Phase 8.3+ 若 dev-mode 迁移到 Brain DB 要同步改
- [ ] TDD-1 的 commit type 白名单未来扩展（如 `perf:` / `style:`）要同步更新 proxy.md
- [ ] DPA-2 的"merge 冲突 → 按 spec DoD 文字"仍依赖 subagent 的 DoD 理解准确度；若出现集成失败案例要补到 Appendix A.DPA-2 的 examples
