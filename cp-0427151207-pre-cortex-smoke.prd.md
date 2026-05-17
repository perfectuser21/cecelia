# PRD: PR-E — cortex 真路径 smoke

## 背景

100% foundation 路线 PR-E。cortex.js 1580 行 RCA 引擎 0 真 smoke 覆盖。

performRCA / analyzeDeep 主入口需 LLM 调用不在 CI 范围，但纯函数（错误分类 / token 估算 / 哈希 / 去重 / validation / fallback / 信号检测）可 docker exec node -e 直调验证契约。

## 范围

### `packages/brain/scripts/smoke/cortex-pure-functions.sh`（130 行，5 case）

- **A**: `classifyTimeoutReason` 3 类错误（timeout/rate/context）全分类不抛
- **B**: `estimateTokens` 返合理值（>0 且 <50 for 10 词）
- **C**: `_computeObservationKey` + `_deduplicateObservations` 折叠契约（相同 obs → 同 key + 重复项被折叠为 `_folded` 占位符）
- **D**: `createCortexFallback` 返对象 + `validateCortexDecision` 不抛
- **E**: `hasCodeFixSignal` 稳定不抛

container 自动检测 cecelia-brain-smoke / cecelia-node-brain。

### Engine 18.13.0 → 18.14.0

## 验收

- 本地 5/5 pass
- CI real-env-smoke 自动跑
- 后续 cortex.js 改动如果破坏分类 / 估算 / 去重契约，CI 立刻拒
