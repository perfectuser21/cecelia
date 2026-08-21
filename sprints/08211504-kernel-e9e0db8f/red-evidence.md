# Red 证据 — Diff Impact Gate 透传 reason_code + 确定性终态 fail-closed（r19/r38）

冻结测试在实现前的执行结果（先红）：

```
Test Files  1 failed (1)
     Tests  6 failed | 5 passed (11)
```

6 个 FAIL（终态 projection/manifest/revision digest mismatch、透传、未知、structure-gate 终态 revision_mismatch）为待修复的红；
5 个 PASS（瞬态 mapper_unavailable/mapper_stale/revision_evidence_missing、structure-gate 瞬态两条）为分流基线（不得回退）。

命令：npx vitest run sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js --reporter=basic
退出码：1（红）
