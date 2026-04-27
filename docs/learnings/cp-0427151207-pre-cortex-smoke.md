# Learning: PR-E cortex 真路径 smoke（2026-04-27）

- 影响：brain RCA 引擎 cortex.js 1580 行 0 真覆盖
- 触发：100% foundation 路线 PR-E

---

### 根本原因

cortex.js 是 brain 的 RCA（root cause analysis）引擎，所有"任务失败 → 自动诊断 → dispatchAutoFixes"链路都过它。但 src/__tests__/cortex*.test.js 全部 vi.mock 掉 LLM 和 db，0 真路径覆盖。

跟 executor.js 一样：performRCA 主入口需 LLM 不在 CI 范围，但纯函数（错误分类 / token 估算 / 哈希 / 去重 / fallback）可独立验证契约。

---

### 修复

`packages/brain/scripts/smoke/cortex-pure-functions.sh` 5 case：
- classifyTimeoutReason 错误分类
- estimateTokens 合理值
- 去重折叠契约（**注意**：dedup 不是简单去重，而是"首项 + 折叠占位符"）
- validate + fallback
- hasCodeFixSignal 信号检测

### 设计教训

**契约 ≠ 想当然**：我最初写 `dedup.length === 2`，以为是简单去重。实际看代码发现是"首项 + `{_folded:true, count}` 占位符"。**写 smoke 前必须 grep 函数实现**，不要凭直觉。

---

### 下次预防

- [ ] 写 smoke 前必 `grep -A 15 functionName src/`，看真返回值是什么。直觉容易错（dedup 折叠 vs 简单去重）
- [ ] cortex / executor 模式可推广到 ops / brain-meta（PR-G/H 候选）
- [ ] 100% 路线还剩 PR-F (thalamus)
