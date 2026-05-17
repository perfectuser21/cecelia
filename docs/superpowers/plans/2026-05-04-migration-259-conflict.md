# Brain Migration 259 冲突修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **TDD IRON LAW（无例外）：**
> - NO PRODUCTION CODE WITHOUT FAILING TEST FIRST
> - 每 task git commit 顺序：commit-1 红灯 / commit-2 绿灯
> - controller 会 verify commit 顺序，不符合让你重做

**Goal:** 将 `259_license_system.sql` 重命名为 `260_license_system.sql` 并更新所有版本号引用，使 `licenses` 和 `license_machines` 表在下次 Brain 启动时被正确创建。

**Architecture:** 纯字符串替换 + git mv。migrate.js 无需改动（按文件名排序、取前缀作版本号的逻辑已正确）。测试文件更新期望值，CI brain-integration 起真 postgres 验证实际执行。

**Tech Stack:** Node.js / PostgreSQL / vitest

---

## 文件结构

| 操作 | 文件 | 说明 |
|------|------|------|
| git mv | `packages/brain/migrations/259_license_system.sql` → `260_license_system.sql` | 重命名使其获得新版本号 |
| Modify | `packages/brain/migrations/260_license_system.sql` 第 1 行 | 注释由 `Migration 248` 改为 `Migration 260` |
| Modify | `packages/brain/src/selfcheck.js` 第 23 行 | `'259'` → `'260'` |
| Modify | `DEFINITION.md` 第 444 行 | `Schema 版本: 259` → `Schema 版本: 260` |
| Modify | `packages/brain/src/__tests__/selfcheck.test.js` 第 150、151 行 | `'259'` → `'260'`（2 处）|
| Modify | `packages/brain/src/__tests__/learnings-vectorize.test.js` 第 434 行 | `'259'` → `'260'`（1 处）|
| Create | `DoD.md` | PR 验收条目 |

工作目录：`/Users/administrator/worktrees/cecelia/brain-migration-259-conflict`

---

### Task 1：写 DoD.md + 红灯 commit

**Files:**
- Create: `DoD.md`

- [ ] **Step 1：确认红灯（3 个测试当前失败）**

```bash
cd /Users/administrator/worktrees/cecelia/brain-migration-259-conflict/packages/brain
npm ci --silent 2>/dev/null || true
npx vitest run src/__tests__/selfcheck.test.js --reporter=verbose 2>&1 | grep -E "PASS|FAIL|259|260" | head -10
```

预期：`EXPECTED_SCHEMA_VERSION should be 259` 那条 PASS（当前值是 259，测试期望 259 → 暂时通过）。

> **注意**：本 fix 是"更新测试期望值 + 同步改实现"，测试在改之前是 PASS（测试期望 '259'，代码也是 '259'）。真正的红灯是：先把测试改为期望 '260'（红灯），再改代码（绿灯）。

- [ ] **Step 2：创建 DoD.md**

在 `/Users/administrator/worktrees/cecelia/brain-migration-259-conflict/DoD.md` 写入：

```markdown
# DoD — Brain Migration 259 冲突修复

task_id: c8638840-0989-41c0-a502-ecea32c4e49b

## 验收条目

- [ ] [ARTIFACT] `packages/brain/migrations/260_license_system.sql` 存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/migrations/260_license_system.sql')"

- [ ] [ARTIFACT] `packages/brain/migrations/259_license_system.sql` 已删除
  Test: manual:node -e "try{require('fs').accessSync('packages/brain/migrations/259_license_system.sql');process.exit(1)}catch(e){}"

- [ ] [BEHAVIOR] selfcheck.js EXPECTED_SCHEMA_VERSION 为 260
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8'); if(!c.includes(\"'260'\")) process.exit(1)"

- [ ] [BEHAVIOR] DEFINITION.md schema_version 更新为 260
  Test: manual:node -e "const c=require('fs').readFileSync('DEFINITION.md','utf8'); if(!c.includes('Schema 版本: 260')) process.exit(1)"
```

- [ ] **Step 3：commit（红灯 commit）**

```bash
cd /Users/administrator/worktrees/cecelia/brain-migration-259-conflict
git add DoD.md
git commit -m "test(brain): DoD — migration 259 冲突修复红灯"
```

---

### Task 2：更新测试为期望 '260'（建立真正红灯）

**Files:**
- Modify: `packages/brain/src/__tests__/selfcheck.test.js`（第 150、151 行）
- Modify: `packages/brain/src/__tests__/learnings-vectorize.test.js`（第 434 行）

- [ ] **Step 1：更新 selfcheck.test.js**

找到第 150-151 行（当前内容）：
```javascript
  it('EXPECTED_SCHEMA_VERSION should be 259', () => {
    expect(EXPECTED_SCHEMA_VERSION).toBe('259');
```
替换为：
```javascript
  it('EXPECTED_SCHEMA_VERSION should be 260', () => {
    expect(EXPECTED_SCHEMA_VERSION).toBe('260');
```

- [ ] **Step 2：更新 learnings-vectorize.test.js**

找到第 434 行（当前内容）：
```javascript
    expect(EXPECTED_SCHEMA_VERSION).toBe('259');
```
替换为：
```javascript
    expect(EXPECTED_SCHEMA_VERSION).toBe('260');
```

- [ ] **Step 3：运行测试确认红灯**

```bash
cd /Users/administrator/worktrees/cecelia/brain-migration-259-conflict/packages/brain
npx vitest run src/__tests__/selfcheck.test.js src/__tests__/learnings-vectorize.test.js --reporter=verbose 2>&1 | grep -E "PASS|FAIL|259|260" | head -15
```

预期输出含：
```
FAIL  src/__tests__/selfcheck.test.js
FAIL  src/__tests__/learnings-vectorize.test.js
```
（因为测试期望 '260' 但代码还是 '259'）

- [ ] **Step 4：commit（测试红灯 commit）**

```bash
cd /Users/administrator/worktrees/cecelia/brain-migration-259-conflict
git add packages/brain/src/__tests__/selfcheck.test.js packages/brain/src/__tests__/learnings-vectorize.test.js
git commit -m "test(brain): 更新 EXPECTED_SCHEMA_VERSION 期望值 259→260（红灯）"
```

---

### Task 3：实现修复，让测试变绿

**Files:**
- git mv: `packages/brain/migrations/259_license_system.sql` → `packages/brain/migrations/260_license_system.sql`
- Modify: `packages/brain/migrations/260_license_system.sql` 第 1 行
- Modify: `packages/brain/src/selfcheck.js` 第 23 行
- Modify: `DEFINITION.md` 第 444 行

- [ ] **Step 1：重命名 migration 文件**

```bash
cd /Users/administrator/worktrees/cecelia/brain-migration-259-conflict
git mv packages/brain/migrations/259_license_system.sql packages/brain/migrations/260_license_system.sql
```

- [ ] **Step 2：更新 migration 文件内注释**

找到 `packages/brain/migrations/260_license_system.sql` 第 1 行：
```sql
-- Migration 248: License System — licenses + license_machines
```
替换为：
```sql
-- Migration 260: License System — licenses + license_machines
```

- [ ] **Step 3：更新 selfcheck.js**

找到 `packages/brain/src/selfcheck.js` 第 23 行：
```javascript
export const EXPECTED_SCHEMA_VERSION = '259';
```
替换为：
```javascript
export const EXPECTED_SCHEMA_VERSION = '260';
```

- [ ] **Step 4：更新 DEFINITION.md**

找到 `DEFINITION.md` 第 444 行，内容包含：
```
| **schema_version** | 迁移版本追踪 | Schema 版本: 259 |
```
替换为：
```
| **schema_version** | 迁移版本追踪 | Schema 版本: 260 |
```

- [ ] **Step 5：运行测试确认绿灯**

```bash
cd /Users/administrator/worktrees/cecelia/brain-migration-259-conflict/packages/brain
npx vitest run src/__tests__/selfcheck.test.js src/__tests__/learnings-vectorize.test.js --reporter=verbose 2>&1 | grep -E "PASS|FAIL|259|260" | head -15
```

预期：两个测试文件全 PASS。

- [ ] **Step 6：运行所有 DoD BEHAVIOR 验证**

```bash
cd /Users/administrator/worktrees/cecelia/brain-migration-259-conflict

node -e "require('fs').accessSync('packages/brain/migrations/260_license_system.sql'); console.log('✅ 260 存在')"

node -e "try{require('fs').accessSync('packages/brain/migrations/259_license_system.sql');process.exit(1)}catch(e){console.log('✅ 259 已删除')}"

node -e "const c=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8'); if(!c.includes(\"'260'\")) process.exit(1); console.log('✅ selfcheck 260')"

node -e "const c=require('fs').readFileSync('DEFINITION.md','utf8'); if(!c.includes('Schema 版本: 260')) process.exit(1); console.log('✅ DEFINITION 260')"
```

全部 ✅ 后继续。

- [ ] **Step 7：将 DoD.md 所有 `[ ]` 改为 `[x]`**

- [ ] **Step 8：commit（绿灯 commit）**

```bash
cd /Users/administrator/worktrees/cecelia/brain-migration-259-conflict
git add packages/brain/migrations/260_license_system.sql \
        packages/brain/src/selfcheck.js \
        DEFINITION.md \
        DoD.md
git commit -m "fix(brain): migration 259 冲突 — 259_license_system 重命名为 260

- 259_license_system.sql 因与 259_account_usage_auth_fail_count.sql 同号
  而从未被 migrate.js 执行（按字母顺序后者先跑，版本号已被占用）
- 重命名为 260_license_system.sql 使 licenses/license_machines 表得以创建
- 同步更新 selfcheck.js EXPECTED_SCHEMA_VERSION + DEFINITION.md + 测试

task-id: c8638840-0989-41c0-a502-ecea32c4e49b"
```

---

## commit 顺序检验

完成后 `git log --oneline -6` 预期：

```
<hash> fix(brain): migration 259 冲突 — 259_license_system 重命名为 260
<hash> test(brain): 更新 EXPECTED_SCHEMA_VERSION 期望值 259→260（红灯）
<hash> test(brain): DoD — migration 259 冲突修复红灯
<hash> docs: migration 259 conflict fix design spec
```

红灯 commit 必须在绿灯 commit 之前。
