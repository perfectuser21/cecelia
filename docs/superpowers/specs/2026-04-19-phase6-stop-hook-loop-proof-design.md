# Phase 6 Stop Hook Loop Proof — 设计

## 目的

以一个 trivial 2 行 marker 文件，端到端验证 /dev 完整接力链（含 engine-ship + Stop Hook 自动合并循环）真的跑通。
上一次 MARKER.md 被 probe 脚本间接合并，未验证 Stop Hook 循环自动合并路径。本次 MARKER2 补这条路径。

## 范围

- **做**：在 `docs/proofs/phase6-e2e/` 新增 `MARKER2.md`
- **不做**：不碰任何代码、CI、registry、version、changelog

## 文件内容

`docs/proofs/phase6-e2e/MARKER2.md`：

```
# Phase 6 stop-hook loop proof

2026-04-19T21:26:00+08:00 — Stop Hook auto-merge verified
```

两行：

1. `# Phase 6 stop-hook loop proof` —— 一级标题
2. 一行含 ISO 日期 + 验证说明

## 成功标准

1. 新文件 `docs/proofs/phase6-e2e/MARKER2.md` 存在于 main 分支
2. 文件至少两行：`# Phase 6 stop-hook loop proof` + 含 ISO 日期行
3. PR 标题 `docs: add phase6 stop-hook loop proof`（无 `[CONFIG]` 前缀）
4. PR 通过 CI 自动合并（Stop Hook 循环，非人工 `--admin`）
5. 工作树 cleanup 完成（`.dev-mode.<branch>` 被删）

## 不改清单

- 不改 `packages/`、`apps/`、`scripts/`
- 不改 `feature-registry.yml` / `regression-contract.yaml` / `VERSION`
- 不改 `.github/workflows/`
- 不写 `*.test.ts`
- 不改 `docs/learnings/changelog.md`

## 假设

- main 无 breaking 变更
- Brain `localhost:5221` 可达
- Superpowers plugin 已注册
- 分支可自动合并
