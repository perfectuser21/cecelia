## B39 Harness 协议重构：Brain 注入确定性值 + .brain-result.json（2026-05-14）

### 根本原因

当前 harness pipeline 让 LLM 自己计算确定性值（分支名）并在 stdout 输出 JSON，Brain 用正则解析。LLM 会偏离模板，导致 `extractProposeBranch`/`extractVerdict` 等 5 个 extract* 函数不稳定。这是 B34-B38 整条 bug 链的底层根因。

### 下次预防

- [ ] 确定性值（分支名、轮次号）必须由 Brain 计算并通过 env var 注入，LLM 不计算这类值
- [ ] 容器写固定路径文件（`.brain-result.json`），Brain 读文件替代 stdout 解析
- [ ] `readBrainResult` 应作为所有 harness 节点读取容器输出的 SSOT
- [ ] 修改 SKILL 时必须同步更新依赖旧行为的 smoke 脚本（`propose-branch-protocol-smoke.sh`, `harness-protocol-v2-smoke.sh`）
- [ ] 版本 bump 要覆盖所有 5+2 个版本文件：`VERSION`, `.hook-core-version`, `package.json`, `package-lock.json`, `regression-contract.yaml`, `hooks/VERSION`, `hooks/.hook-core-version`，以及各 SKILL.md frontmatter
- [ ] 同一文件存在两条测试路径时（`src/__tests__/*.test.js` 和 `src/workflows/__tests__/*.test.js`），重构时两个都要更新
- [ ] Rebase 冲突解决：Protocol v2（`readVerdictFile`）和 B39（`readBrainResult`）是正交的，应该共存；initiative.graph 迁移到 `readBrainResult` 后需更新对应的 Protocol v2 smoke 断言
