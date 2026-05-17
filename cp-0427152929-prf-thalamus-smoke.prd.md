# PRD: PR-F — thalamus 真路径 smoke（100% 路线最后 1 步）

## 背景

100% foundation 路线最后 1 个 PR。thalamus.js 1654 行决策层 0 真 smoke。

processEvent / routeEvent 主入口需 LLM 不在 CI 范围，但纯函数（危险检测 / 快速路由 / fallback / LLM 错误分类 / cost 计算）可 docker exec node -e 直调。

## 范围

### `packages/brain/scripts/smoke/thalamus-pure-functions.sh`（130 行，5 case）

- **A**: hasDangerousActions 4 类输入不抛
- **B**: createFallbackDecision 返对象
- **C**: classifyLLMError 4 类错误不抛 + LLM_ERROR_TYPE 常量存在
- **D**: calculateCost 返非负数
- **E**: validateDecision 3 类输入不抛

### Engine 18.14.0 → 18.15.0

## 100% 路线收官

| PR | 内容 |
|---|---|
| Tier 0 #2664 | CI 真硬门 + 闭环回写 |
| Tier 1 #2665 | worktree race fix + 4 lint 加内容校验 |
| Tier 2-A #2666 | lint-test-quality 拦"假测试 stub" |
| Tier 2-B #2667 | dispatcher 真 smoke (3 case) |
| Hotfix #2668 | brain-deploy.sh cp identical 不再中止 Phase 9-11 |
| PR-C #2669 | lint-no-mock-only-test 拦"全 mock 测试" |
| PR-D #2670 | executor 真 smoke (5 case) |
| PR-E #2671 | cortex 真 smoke (5 case) |
| **PR-F (本 PR)** | **thalamus 真 smoke (5 case)** |

**brain 4 大核心模块（dispatcher / executor / cortex / thalamus）全部接入真 smoke。**
