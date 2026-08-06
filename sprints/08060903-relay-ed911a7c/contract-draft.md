# 合同草案 — [F6加厚] WS2 Notion事件采集器MVP: 个人Inbox→capture_atoms（双token幂等）

**Task ID**: ed911a7c-d975-4986-bfe5-24d8318838a2  
**Sprint Dir**: sprints/08060903-relay-ed911a7c  
**Date**: 2026-08-06  
**Base Repo**: perfectuser21/cecelia  
**Target Environment**: local_api  
**Contract Version**: v1（首轮，无 reviewer feedback）

---

## 问题陈述

PR #4661 已合并后，`capture-inbox.js` 的 `pushCapture` 函数存在幂等漏洞：
- `captures` 表有 `ON CONFLICT (dedupe_key) DO UPDATE` → 幂等 ✅
- `capture_atoms` 表无冲突处理 → 每次采集都插新 atom ❌

当同一 Notion 页面被二次采集时，`captureId` 复用但 `atomId` 重复新增，违反系统幂等不变式。

---

## 合同承诺（Commitments）

本次 Sprint 交付以下可验证承诺：

### C1 — capture_atoms 幂等
`pushCapture` 对 `capture_atoms` 的 INSERT 增加 `ON CONFLICT (capture_id, target_type) DO NOTHING`。同一 `(capture_id, target_type)` 组合已存在时，INSERT 跳过（不产生新行），返回 `atomId = null`，调用方容忍此空值。

### C2 — 数据库唯一约束
Migration 390 为 `capture_atoms(capture_id, target_type)` 添加 `UNIQUE` 约束（`uq_capture_atoms_capture_target`），配合代码层 `ON CONFLICT` 形成双重防护。

### C3 — 幂等回归测试永久入库
`capture-inbox.test.js` 追加幂等回归测试用例：mock pool 断言同一 `dedupeKey` 二次调用 `pushCapture` 后，`capture_atoms` INSERT 调用计数不超过首次（第二次 DO NOTHING 路径），测试永久保留在 CI。

### C4 — DEFINITION.md 凭据来源修正
`DEFINITION.md` 中所有 "CCAPI2026（AI Hub workspace）" 引用改为 "Notion-juke（bot=cc20260728, workspace=Zenithjoy-July）"，与 1Password CS 实际条目名称一致。

### C5 — notion-capture-ingest.js 注释同步
`notion-capture-ingest.js` 顶部注释凭据来源从 `~/.credentials/notion-ccapi2026.env` 更新为 `1Password CS "Notion-juke"，bot=cc20260728`。

### C6 — docker-compose.yml 生产凭据占位符
Brain 容器 `environment` 段增加 `NOTION_INBOX_TOKEN=${NOTION_INBOX_TOKEN:-}` 和 `NOTION_INBOX_DB_ID=${NOTION_INBOX_DB_ID:-b45ca2cb-9c90-83f1-bc41-81ad0b86c1b1}`，使用 `:-` 占位符不强制要求运行时值。

---

## 变更范围（Files in Scope）

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/brain/migrations/390_capture_atoms_dedup_constraint.sql` | 新建 | UNIQUE 约束 migration |
| `packages/brain/src/capture-inbox.js` | 修改 | capture_atoms INSERT 加 ON CONFLICT DO NOTHING |
| `packages/brain/src/__tests__/capture-inbox.test.js` | 修改 | 追加幂等回归测试（永久 regression） |
| `DEFINITION.md` | 修改 | 凭据来源 CCAPI2026 → Notion-juke |
| `packages/brain/src/notion-capture-ingest.js` | 修改 | 注释同步凭据来源 |
| `docker-compose.yml` | 修改 | 添加 NOTION_INBOX_TOKEN / NOTION_INBOX_DB_ID env 占位符 |

---

## E2E 验收

### L1 — 单元测试（自动，CI 强制）

**测试文件**: `packages/brain/src/__tests__/capture-inbox.test.js`

**断言**：
1. 同一 `dedupeKey` 二次调用 `pushCapture`，`capture_atoms` INSERT 的 mock 调用次数在第二次之后不增加（首次 count=1，二次后 count 仍=1）
2. 首次调用返回 `{ captureId: 'cap-1', atomId: 'atom-1' }`
3. 二次调用返回 `{ captureId: 'cap-1', atomId: null }`（DO NOTHING 路径，RETURNING 空数组）
4. 现有 `pushCaptureAtom` 测试（两次 query 断言）全部通过，不回归

**运行命令**：
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/capture-inbox.test.js
```

**通过标准**：所有用例 PASS，无 FAIL。

### L2 — 代码静态验证（manual:bash）

验证 migration 文件存在且包含正确 SQL：
```bash
grep -q "ADD CONSTRAINT uq_capture_atoms_capture_target" /workspace/packages/brain/migrations/390_capture_atoms_dedup_constraint.sql && echo "PASS: migration 约束存在" || echo "FAIL: migration 缺失约束"
```

验证 capture-inbox.js 已加幂等：
```bash
grep -q "ON CONFLICT (capture_id, target_type) DO NOTHING" /workspace/packages/brain/src/capture-inbox.js && echo "PASS: ON CONFLICT 已加" || echo "FAIL: ON CONFLICT 未加"
```

验证 DEFINITION.md 凭据来源：
```bash
grep -q "Notion-juke" /workspace/DEFINITION.md && echo "PASS: Notion-juke 存在" || echo "FAIL: 未更新"; grep -q "CCAPI2026" /workspace/DEFINITION.md && echo "WARN: CCAPI2026 仍存在" || echo "PASS: CCAPI2026 已清除"
```

验证 docker-compose.yml 包含 Notion env 占位符：
```bash
grep -q "NOTION_INBOX_TOKEN" /workspace/docker-compose.yml && grep -q "NOTION_INBOX_DB_ID" /workspace/docker-compose.yml && echo "PASS: docker-compose 含 Notion env" || echo "FAIL: docker-compose 缺 Notion env"
```

验证 notion-capture-ingest.js 注释已更新：
```bash
grep -q "Notion-juke" /workspace/packages/brain/src/notion-capture-ingest.js && echo "PASS: 注释已更新" || echo "FAIL: 注释未更新"; grep -q "notion-ccapi2026.env" /workspace/packages/brain/src/notion-capture-ingest.js && echo "WARN: 旧路径仍存在" || echo "PASS: 旧路径已清除"
```

---

## 排除范围

- L3 smoke（真实 Notion Inbox 10分钟验证）在 `local_api` 环境由 evaluator 执行，不属于本合同自动化范围
- capture_atoms 中已存在的重复数据去重（pre-migration 清理）由执行体在 migration 前检查，不列入本合同

---

## 不变式约束

| 不变式 | 合同验证方式 |
|--------|------------|
| INV-1：capture_atoms 幂等 | L1 单元测试断言 + L2 grep ON CONFLICT |
| INV-2：回归测试永久入库 | L1 测试存在且 CI 绿色 |
| INV-3：DEFINITION.md 凭据一致 | L2 grep Notion-juke |
| INV-4：已有 Golden Path 不回归 | L1 全套用例 PASS |
| INV-5：注释不再引用旧路径 | L2 grep 验证无 notion-ccapi2026.env |
