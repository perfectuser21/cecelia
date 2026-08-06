# Contract DoD — [F6加厚] capture_atoms 幂等修复

**Task ID**: ed911a7c-d975-4986-bfe5-24d8318838a2  
**Sprint Dir**: sprints/08060903-relay-ed911a7c  
**Date**: 2026-08-06

---

## [BEHAVIOR] 断言（≥4条）

### [BEHAVIOR-1] capture_atoms 幂等：同一 (capture_id, target_type) 二次采集不产生新行

**描述**：当同一 Notion 页面被二次采集时（相同 `dedupeKey`），`captures` 表通过 `ON CONFLICT (dedupe_key) DO UPDATE` 返回同一 `captureId`，`capture_atoms` 表通过 `ON CONFLICT (capture_id, target_type) DO NOTHING` 跳过第二次插入，数据库中该 `(capture_id, target_type)` 组合仍只有一条记录。

**可验证断言**：
- mock pool 中 `INSERT INTO capture_atoms` 的调用次数在第一次后不随重复调用增加
- 第二次 `pushCapture` 返回值中 `atomId === null`（RETURNING 空数组，`rows[0]?.id ?? null`）

**测试覆盖**：`capture-inbox.test.js` → `pushCapture 幂等（F6加厚回归）` describe block

---

### [BEHAVIOR-2] 幂等不影响首次正常写入路径

**描述**：首次调用 `pushCapture`（全新 `dedupeKey`），`captures` 和 `capture_atoms` 各产生一条记录，返回 `{ captureId, atomId }` 均非 null。

**可验证断言**：
- 首次 `pushCapture` 调用后，mock pool 的 `capture_atoms` INSERT 被调用恰好一次
- 返回值 `captureId === 'cap-1'`，`atomId === 'atom-1'`（或等效非空值）

**测试覆盖**：`capture-inbox.test.js` → `pushCapture 幂等（F6加厚回归）` it block 第一段断言

---

### [BEHAVIOR-3] ON CONFLICT DO NOTHING 时返回值不抛异常，调用方容忍 atomId=null

**描述**：`capture_atoms` INSERT 命中 `ON CONFLICT DO NOTHING` 时，PostgreSQL RETURNING 返回空数组，`rows[0]?.id ?? null` 取得 `null`。函数正常返回 `{ captureId, atomId: null }`，不抛错，不触发 catch 分支的 `console.warn`。

**可验证断言**：
- 二次调用 `pushCapture` 返回对象非 null（不进入最外层 catch 路径）
- 返回对象结构为 `{ captureId: <string>, atomId: null }`

**测试覆盖**：`capture-inbox.test.js` → 二次调用结果断言（r2.captureId 有值，atomId 为 null 或 undefined）

---

### [BEHAVIOR-4] DEFINITION.md 凭据来源与实际 1Password 条目一致（Notion-juke）

**描述**：`DEFINITION.md` 中 Notion 相关段落的凭据来源描述为 "Notion-juke（bot=cc20260728, workspace=Zenithjoy-July）"，不再引用已废弃的 "CCAPI2026（AI Hub workspace）"。

**可验证断言**：
- `grep "Notion-juke" DEFINITION.md` 有输出
- `grep "CCAPI2026" DEFINITION.md` 在 Notion 相关段落无输出（或整文件无输出）

**测试覆盖**：manual:bash 静态验证

---

### [BEHAVIOR-5] docker-compose.yml Brain 容器环境含 Notion 凭据占位符

**描述**：`docker-compose.yml` 的 Brain 容器 `environment` 段包含 `NOTION_INBOX_TOKEN` 和 `NOTION_INBOX_DB_ID` 两个环境变量，使用 `${VAR:-}` / `${VAR:-default}` 形式，不强制要求运行时值，凭据不提交 git。

**可验证断言**：
- `grep "NOTION_INBOX_TOKEN" docker-compose.yml` 有输出
- `grep "NOTION_INBOX_DB_ID" docker-compose.yml` 有输出
- 值形式为 `${NOTION_INBOX_TOKEN:-}` 和 `${NOTION_INBOX_DB_ID:-b45ca2cb-9c90-83f1-bc41-81ad0b86c1b1}`（非明文 token）

**测试覆盖**：manual:bash 静态验证

---

## DoD 清单

- [ ] [BEHAVIOR] capture_atoms 幂等（B-1）：单元测试 PASS（同 dedupeKey 二次调用 capture_atoms INSERT 调用计数不增）
- [ ] [BEHAVIOR] 首次写入路径正常（B-2）：单元测试 PASS（captureId + atomId 均非 null）
- [ ] [BEHAVIOR] DO NOTHING 返回容忍（B-3）：单元测试 PASS（atomId=null，不抛错）
- [ ] [BEHAVIOR] DEFINITION.md 凭据来源正确（B-4）：manual:bash grep 验证通过
- [ ] [BEHAVIOR] docker-compose.yml 含 Notion env 占位符（B-5）：manual:bash grep 验证通过
- [ ] migration 390 文件存在，含 `ADD CONSTRAINT uq_capture_atoms_capture_target UNIQUE (capture_id, target_type)`
- [ ] `capture-inbox.js` 含 `ON CONFLICT (capture_id, target_type) DO NOTHING`
- [ ] `notion-capture-ingest.js` 注释不再引用 `notion-ccapi2026.env`，改为 `Notion-juke`
- [ ] 现有 `pushCaptureAtom` 两次 query 断言测试通过（INV-4 不回归）
- [ ] CI（brain-ci.yml）绿色

---

## manual:bash 验收命令集

```bash
#!/usr/bin/env bash
# Contract DoD manual:bash 验收命令
# 用法：在 /workspace 目录下执行

set -e
PASS=0
FAIL=0

check() {
  local desc="$1"
  local cmd="$2"
  if eval "$cmd" > /dev/null 2>&1; then
    echo "PASS: $desc"
    PASS=$((PASS+1))
  else
    echo "FAIL: $desc"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Contract DoD 验收 ==="

# [BEHAVIOR-1][BEHAVIOR-2][BEHAVIOR-3] 单元测试
check "[BEHAVIOR-1,2,3] 幂等单元测试" \
  "npx vitest run packages/brain/src/__tests__/capture-inbox.test.js --reporter=verbose 2>&1 | grep -q 'passed'"

# migration 文件存在
check "migration 390 文件存在" \
  "test -f packages/brain/migrations/390_capture_atoms_dedup_constraint.sql"

# migration 含正确约束
check "migration 390 含 UNIQUE 约束" \
  "grep -q 'ADD CONSTRAINT uq_capture_atoms_capture_target' packages/brain/migrations/390_capture_atoms_dedup_constraint.sql"

# capture-inbox.js 幂等修复
check "[BEHAVIOR-1] capture-inbox.js 含 ON CONFLICT DO NOTHING" \
  "grep -q 'ON CONFLICT (capture_id, target_type) DO NOTHING' packages/brain/src/capture-inbox.js"

# [BEHAVIOR-4] DEFINITION.md
check "[BEHAVIOR-4] DEFINITION.md 含 Notion-juke" \
  "grep -q 'Notion-juke' DEFINITION.md"

check "[BEHAVIOR-4] DEFINITION.md Notion 段落无 CCAPI2026" \
  "! grep -q 'CCAPI2026' DEFINITION.md"

# notion-capture-ingest.js 注释更新（INV-5）
check "[INV-5] notion-capture-ingest.js 注释含 Notion-juke" \
  "grep -q 'Notion-juke' packages/brain/src/notion-capture-ingest.js"

check "[INV-5] notion-capture-ingest.js 注释无旧路径" \
  "! grep -q 'notion-ccapi2026.env' packages/brain/src/notion-capture-ingest.js"

# [BEHAVIOR-5] docker-compose.yml
check "[BEHAVIOR-5] docker-compose.yml 含 NOTION_INBOX_TOKEN" \
  "grep -q 'NOTION_INBOX_TOKEN' docker-compose.yml"

check "[BEHAVIOR-5] docker-compose.yml 含 NOTION_INBOX_DB_ID" \
  "grep -q 'NOTION_INBOX_DB_ID' docker-compose.yml"

echo ""
echo "=== 结果: PASS=$PASS FAIL=$FAIL ==="
if [ "$FAIL" -gt 0 ]; then
  echo "FAIL: 存在 $FAIL 项未通过"
  exit 1
else
  echo "PASS: 全部通过"
fi
```
