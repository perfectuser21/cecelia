## Phase 6 stop-hook loop proof（2026-04-19）

端到端验证 /dev 接力链 + Stop Hook 自动合并循环。新增 `docs/proofs/phase6-e2e/MARKER2.md`（2 行 marker），走完 worktree → PR → CI → Stop Hook 自动合并 → cleanup 的完整路径。

### 根本原因

Phase 6 合并后未有独立 trivial 任务证明 Stop Hook 循环自动合并路径。上一次 MARKER.md 的 PR 被 probe 脚本间接合并，未覆盖 Stop Hook 主动轮询 CI → `gh pr merge --squash` 这条链路。需要一个零风险、零依赖的 2 行 docs 变更，在 non-harness 模式下走完整接力链。

### 下次预防

- [ ] 重大 pipeline 变更（Stop Hook / engine-ship / cleanup）合并后，派一个 trivial marker PR 端到端验证自动合并路径，不要只依赖 probe / regression 脚本
- [ ] Marker PR 严格不改代码 / CI / registry / version，避免污染验证信号
- [ ] PR 标题不带 `[CONFIG]` 前缀（docs-only），让 branch-protect 放行
- [ ] 验证完写 learning 时强调"验证了什么路径"，不要泛泛总结
