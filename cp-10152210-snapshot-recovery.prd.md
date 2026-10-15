# 固定 main 快照有界恢复

根任务：427d7e49-27c5-4612-b115-9214f03d47f9。GP-Anchor: none(infra)。

真实 e7e 自然运行中，父来源先 verified，factory 正规刷新 200 后，旧部署的定时任务把父 current 切回 dfef，最后完整 GET 出现父 scope_manifest_missing 与派生 unmapped。原发布器正确拒绝，但未来无人执行仍可能需要人工重跑。

只允许首轮各 stage 验证成功后，在最终完整 GET 发现先前已验证 scope 退化为现有严格可刷新缺口时，再规划一次父后子刷新。重新读取当前 bundle，仅刷新实际 unknown scope；所有 exact-main、身份、摘要、CAS 与历史基线规则保持。第二轮仍不完整、同目标 POST 后仍 unknown、未知冲突或不可解释缺口均失败，无正式产物。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 |
|---|---|---|
| ws1 | `scripts/ci/__tests__/implementation-main-snapshot.test.mjs` | `首轮factory成功后父scope回退，仅额外刷新父scope一次` |
| ws1 | `scripts/ci/__tests__/implementation-main-snapshot.test.mjs` | `补偿后再次回退有界失败且无正式文件` |
| ws1 | `scripts/ci/__tests__/implementation-main-snapshot.test.mjs` | `回退缺口不受支持或身份摘要非法时不追加刷新` |
| ws1 | `scripts/ci/__tests__/implementation-main-snapshot.test.mjs` | `补偿计划前或补偿POST后main漂移拒绝发布` |
| ws1 | `scripts/ci/__tests__/implementation-main-snapshot.test.mjs` | `补偿POST失败或仍UNKNOWN不可再重试` |

验收执行现有真实 HTTP、gh、ZIP 与工作流 shell 套件，不用假调用串证明业务成功。固定主 gate run、scheduler、部署编排、地图和 collector 不改。
