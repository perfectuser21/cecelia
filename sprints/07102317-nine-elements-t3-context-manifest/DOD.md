# DoD：九要素T3 注入扩容+蒸馏接线

- [x] [BEHAVIOR] formatLineContextForPrompt 总长上限 12000、FR 上限 50、有 ledger 时注入蒸馏摘要段
  - Test: tests/ packages/brain/src/__tests__/harness-line-context.test.js
- [x] [BEHAVIOR] buildLineDreamData 支持 since 参数，缺省行为与 24h 窗口一致
  - Test: tests/ packages/brain/src/__tests__/line-dreaming.test.js
- [x] [BEHAVIOR] GET /api/brain/warroom/line/:id/context-manifest 返回 ledger+delta+invariants+cumulative_fr+prompt_block；journey 不存在 404；delta 失败降级空段
  - Test: tests/ packages/brain/src/routes/__tests__/warroom-context-manifest.test.js
- [x] 版本 bump 1.248.0 四处同步（check-version-sync.sh 通过）
- [x] CI 全绿
