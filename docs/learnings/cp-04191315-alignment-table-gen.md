# Learning: Alignment Table Generator 固化

**Branch**: cp-0419131519-alignment-table-gen
**Date**: 2026-04-19
**Task ID**: 693c255f-ca08-4c26-9c75-0dd8ddc72ff7

## 做了什么

1. 新增 `packages/engine/scripts/generate-alignment-table.sh` — 扫 upstream + local prompts + alignment.yaml，生成 Markdown 对照表
2. 生成 `docs/superpowers-alignment-table.md`（85 行）— 当前 5.0.7 对齐快照
3. bump Engine 14.17.9 → 14.17.10 + feature-registry 条目

表内容：
- 图例（🟢🟡🔴⚫ / ✅❌⚠️）
- Skill 全景 14 行（每行：upstream 文件数 + 本地副本 + coverage_level + 对齐 + 决策理由）
- 统计（当前 11 full / 1 rejected / 2 N/A / 0 drifted）
- 文件级详情 21 行（sha256 对比）
- 升级 workflow 7 步

## 根本原因

Alex 要"一张表，以后 Superpowers 升级就按表对照"。之前有 3 个工具：
- `sync-from-upstream.sh` — 机器检测 drift（返 exit 1）
- `check-superpowers-alignment.cjs` — CI gate 防退化
- `alignment.yaml` 契约 — 单一真相源

**缺的是一张"给人看"的表**：快速看懂现状、快速对比升级前后。本 PR 补上。

## 下次预防

- [ ] **Superpowers 升级流程固化**：
  1. 下载新版到 cache
  2. `bash sync-from-upstream.sh` 看机器报告
  3. `bash generate-alignment-table.sh` 刷新可读表
  4. 对每个 DRIFT 在表里标记，人工决策
  5. 更新 alignment.yaml
  6. `check-superpowers-alignment.cjs` 验证
  7. PR
- [ ] **任何给 alignment.yaml 加字段的修改**：同步更新 `generate-alignment-table.sh` 解析逻辑
- [ ] **不要让表变成 yaml**：表是 yaml 的**可读视图**，yaml 才是 SSOT

## 涉及的文件

新增：
- `packages/engine/scripts/generate-alignment-table.sh`（126 行）
- `docs/superpowers-alignment-table.md`（85 行）
- `docs/learnings/cp-04191315-alignment-table-gen.md`（本文件）

修改：
- `packages/engine/VERSION` / `package.json` / `package-lock.json` / `.hook-core-version` / `hooks/VERSION` / `SKILL.md` frontmatter / `regression-contract.yaml`（bump 14.17.10）
- `packages/engine/feature-registry.yml`（14.17.10 条目）

## 完整升级工具链（现在形成闭环）

| 工具 | 作用 | 使用时机 |
|---|---|---|
| `sync-from-upstream.sh` | 机器检测 drift（exit 1） | CI 或人工任何时候 |
| `generate-alignment-table.sh` | 人可读表 | 升级前后对比 / 向他人展示 |
| `check-superpowers-alignment.cjs` | CI 强制 gate | 每个 PR |
| `alignment.yaml` | SSOT 契约 | 永远 |
| `docs/superpowers-alignment-table.md` | 当前状态快照 | 升级决策参考 |
