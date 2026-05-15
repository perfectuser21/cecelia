## B39 Evaluator Verdict Fix — 三个 Harness Bug（2026-05-15）

### 根本原因

2026-05-15 E2E 测试中发现 harness pipeline 存在三个结构性缺陷：

1. **Verdict 协议不一致**：evaluator SKILL.md 允许输出 `"FIXED"` 作为合法 PASS，但 Brain 的 `evaluateContractNode` 只接受 `"PASS"` 或 `"FAIL"`，`"FIXED"` 被硬判为 FAIL，触发 fix_dispatch → 新一轮 Generator/Evaluator → 又输出 `"FIXED"` → 无限循环。

2. **`gh pr merge --auto` 在 perfectuser21/cecelia 永远失败**：该仓库未开启 GitHub auto-merge 功能，`mergePrNode` 捕获错误后仅写 `merge_error`，不设 `status:'merged'`，initiative 永久卡在 B_task_loop 阶段。CI 在 `poll_ci` 节点已验绿，`--auto` 本来就是多余的。

3. **LLM_RETRY 对 evaluate_contract 节点是结构性缺陷**：该节点调用 `spawnDockerDetached()` + `interrupt()` 等待异步回调。LangGraph 重试时从节点头重新执行，spawn 新容器，INSERT 新 thread_lookup，再次 interrupt。前一个容器仍在运行并会触发回调，但 graph 已在新 interrupt 等待，旧回调报错（500）。E2E 实测出现 3 个 r8 evaluator 并发运行。

### 下次预防

- [ ] 新增 evaluator SKILL 或更新 verdict 格式时，同步更新 `evaluateContractNode` 的 `normalizeVerdict` 白名单（现在是 PASS/FIXED/APPROVED）
- [ ] 任何调用 `spawnDockerDetached()` + `interrupt()` 的节点禁止加 `retryPolicy: LLM_RETRY`——spawn 类节点的重试必须在上层 graph 或人工干预层处理，不能在节点内自动重试
- [ ] merge 前检查目标仓库是否开启 auto-merge 功能；Brain 统一策略：CI 验绿后用 `gh pr merge --squash`，不用 `--auto`
- [ ] Protocol v1/v2 两条 verdict 路径都必须用同一个 `normalizeVerdict()` 函数，避免行为分叉
- [ ] `readVerdictFile` 目前过滤掉非 PASS/FAIL 的 verdict（返回 null）——若 evaluator 写 "FIXED" 到文件，会 fallthrough 到 Protocol v1 stdout 路径才被 normalizeVerdict 处理；考虑后续让 `readVerdictFile` 也接受 FIXED/APPROVED，保持两路一致
