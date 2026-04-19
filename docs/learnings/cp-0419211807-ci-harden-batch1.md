# ci-harden-batch1（2026-04-19）

### 根本原因

Repo-audit 发现 CI 有多处"静态检查很细、真门禁很少"的虚假绿：

1. **PR size check** 写成 `echo ::warning` 而不是 `exit 1`。效果：PR 超标只是日志多一行，不拦合并。历史上有 6247 / 1449 / 1107 / 1022 行的 PR 都合并了。
2. **无 npm audit**：根目录 12 个漏洞（6 moderate + 6 high），CI 完全没检查。依赖安全完全靠运气。

本 PR 做"起步门槛"两件事：
- PR size >1500 行硬失败（harness label 绕过，因为 harness 合同 PR 天生大）
- 新增 `dep-audit` job，`--audit-level=critical`，只拦 critical（先过日子，后续逐步收紧）

### 下次预防

- [ ] 新加 CI 门槛时必须明确 "先起步，后收紧" 的路径（critical → high → moderate → low），在 PRD 写清楚每档对应什么时机升级
- [ ] warning-only 的 CI 检查要定期审查：如果 6 个月都没人修，说明 warning 是白写的，要么升级成硬拦，要么删除
- [ ] 每月跑一次 `npm audit` 对账当前漏洞等级分布，决定下一档收紧时机
