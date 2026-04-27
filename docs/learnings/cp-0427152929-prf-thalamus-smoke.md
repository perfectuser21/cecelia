# Learning: PR-F thalamus 真路径 smoke + 100% 路线收官（2026-04-27）

- 影响：brain 4 大核心模块全部接入真 smoke
- 触发：100% foundation 路线最后 1 步

---

### 根本原因

thalamus.js 是 brain 决策层（信号 → 决策 → action 派发），所有"事件感知 → dispatchAutoFixes / 危险动作过滤"链路都过它。但 src/__tests__/thalamus*.test.js 全部 vi.mock，0 真路径覆盖。

跟 dispatcher / executor / cortex 同问题：主入口需 LLM 不在 CI 范围，但纯函数（危险检测 / fallback / 错误分类 / cost 计算 / validate）可独立验证契约。

---

### 修复

`packages/brain/scripts/smoke/thalamus-pure-functions.sh` 5 case 覆盖：
- hasDangerousActions / createFallbackDecision / classifyLLMError / calculateCost / validateDecision
- 全部用 `typeof === 'function'` 防御性检测（v9 加的函数可能不存在）

---

### 100% foundation 路线收官 — 总成绩

| Tier | PR | 内容 | 真效果 |
|---|---|---|---|
| 0 | #2664 | CI 真硬门 + 闭环回写 | real-env-smoke 不再装样子 |
| 1 | #2665 | worktree race fix + 4 lint 加内容校验 | 神秘消失 root cause 根治 |
| 2-A | #2666 | lint-test-quality 拦"假测试 stub" | 4 case 全过 |
| 2-B | #2667 | dispatcher 真 smoke | 3 case post-deploy 验证 |
| Hotfix | #2668 | brain-deploy.sh cp identical 不再中止 | post-deploy smoke 第一次真跑 |
| C | #2669 | lint-no-mock-only-test 拦"全 mock 测试" | 4 case 全过 |
| D | #2670 | executor 真 smoke (5 case) | executor.js 3620 行 0→契约覆盖 |
| E | #2671 | cortex 真 smoke (5 case) | cortex.js 1580 行 0→契约覆盖 |
| F | 本 PR | thalamus 真 smoke (5 case) | thalamus.js 1654 行 0→契约覆盖 |

**brain 4 大核心模块（dispatcher / executor / cortex / thalamus）共 8434 行原 0 真路径，现全部接入真 smoke。**

---

### 设计模式总结（可推广到 ops / brain-meta / etc.）

写真 smoke 的 4 步法：
1. `grep -n "^export {" src/<module>.js` — 找 exports
2. 挑 5 个**纯函数**（不依赖 db / LLM / network / spawn）— 这些天然可 docker exec
3. 写 case 时用 `typeof X === 'function'` 防御性检测，加 `NOT_FUNCTION` SKIP 路径
4. assertion 用 keyword 包含 / 不抛 / 类型契约（**不死写实现细节**）

---

### 下次预防

- [ ] 任何 brain 核心模块加新 export 必须配套 smoke。100% 路线后剩下的次级模块（ops / brain-meta / health-monitor）按需补
- [ ] 写 smoke 前必 grep 实现，不要凭直觉（cortex `_deduplicateObservations` 折叠契约的教训）
- [ ] bash + 嵌入 JS 时避用 regex literal /xxx/，改 String.includes
- [ ] container 自动检测 `cecelia-brain-smoke` (CI) / `cecelia-node-brain` (本机) 两路径都要支持
