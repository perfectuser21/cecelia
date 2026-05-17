# 本地 cecelia_test DB + db-config guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防测试污染生产 DB——本地建 `cecelia_test` + `db-config.js` 加 NODE_ENV=test guard。

**Architecture:** 三件事合一 PR：setup-test-db.sh 幂等脚本 + db-config isTest 分支 + 4 场景单测。无需改 CI（已走对路径）。

**Tech Stack:** bash + Node.js + pg + vitest

---

## File Structure

| 文件 | 动作 |
|---|---|
| `packages/brain/scripts/setup-test-db.sh` | Create（幂等 create DB + migrate）|
| `packages/brain/src/db-config.js` | Modify（加 isTest + guard）|
| `packages/brain/src/__tests__/db-config-guard.test.js` | Create（4 场景）|
| `.dod` + `docs/learnings/cp-*-test-db-isolation.md` | Create |

---

## Task 1: db-config guard + setup 脚本 + 单测（TDD 一轮）

**Files:**
- Create: `packages/brain/src/__tests__/db-config-guard.test.js`
- Modify: `packages/brain/src/db-config.js`
- Create: `packages/brain/scripts/setup-test-db.sh`

- [ ] **Step 1.1: 写单测（TDD Red）**

新建 `packages/brain/src/__tests__/db-config-guard.test.js`（照抄）：

```javascript
/**
 * db-config-guard.test.js
 * 验证 NODE_ENV=test 时：
 * - 自动 cecelia_test fallback
 * - DB_NAME=cecelia 显式 throw（禁止污染生产）
 * - 生产环境不受影响
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('db-config NODE_ENV=test guard', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('场景 1: NODE_ENV=test + VITEST="" + DB_NAME="" → database=cecelia_test', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('DB_NAME', '');
    const mod = await import('../db-config.js');
    expect(mod.DB_DEFAULTS.database).toBe('cecelia_test');
  });

  it('场景 2: NODE_ENV=test + DB_NAME=cecelia → throw', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DB_NAME', 'cecelia');
    await expect(import('../db-config.js')).rejects.toThrow(/生产 DB/);
  });

  it('场景 3: NODE_ENV=test + DB_NAME=cecelia_test → OK', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DB_NAME', 'cecelia_test');
    const mod = await import('../db-config.js');
    expect(mod.DB_DEFAULTS.database).toBe('cecelia_test');
  });

  it('场景 4: NODE_ENV=production + VITEST="" + DB_NAME=cecelia → OK（生产不受影响）', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('DB_NAME', 'cecelia');
    const mod = await import('../db-config.js');
    expect(mod.DB_DEFAULTS.database).toBe('cecelia');
  });
});
```

- [ ] **Step 1.2: 跑测试确认红**

```bash
cd /Users/administrator/worktrees/cecelia/test-db-isolation/packages/brain
npx vitest run src/__tests__/db-config-guard.test.js --no-coverage 2>&1 | tail -10
```

**预期**：场景 1 fail（现在默认 `cecelia`，不是 `cecelia_test`），场景 2 fail（不 throw），场景 3/4 绿。

- [ ] **Step 1.3: 改 db-config.js**

Read `packages/brain/src/db-config.js` 确认当前结构（28 行）。

用 Edit 改：

**old_string**：
```javascript
export const DB_DEFAULTS = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'cecelia',
  user: process.env.DB_USER || 'cecelia',
```

**new_string**：
```javascript
// isTest 优先判断，用于 DB_NAME fallback 和 guard
const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const dbName = process.env.DB_NAME || (isTest ? 'cecelia_test' : 'cecelia');

// Guard: 禁止测试环境连生产 DB
if (isTest && dbName === 'cecelia') {
  throw new Error(
    '禁止在测试环境连接 cecelia 生产 DB。\n' +
    '解决方式：\n' +
    '  1. 显式设置 DB_NAME=cecelia_test\n' +
    '  2. 或运行 bash packages/brain/scripts/setup-test-db.sh 首次创建本地测试 DB'
  );
}

export const DB_DEFAULTS = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: dbName,
  user: process.env.DB_USER || 'cecelia',
```

- [ ] **Step 1.4: 跑测试确认绿**

```bash
cd /Users/administrator/worktrees/cecelia/test-db-isolation/packages/brain
npx vitest run src/__tests__/db-config-guard.test.js --no-coverage 2>&1 | tail -10
```

**预期**：4 passed。

**若场景 1 报 error "生产 DB"**：说明 VITEST 的 stub 没生效——vitest runner 自动把 VITEST='true' 注入，`vi.stubEnv('VITEST', '')` 应该覆盖，但可能 Node 不把空串当 undefined。若仍失败，把判断改成 `process.env.VITEST === 'true'`（严格相等，空串不算 truthy）—— 我们的实现是严格比较 `=== 'true'`，应该 OK。

- [ ] **Step 1.5: 建 setup-test-db.sh**

新建 `packages/brain/scripts/setup-test-db.sh`：

```bash
#!/bin/bash
# 幂等创建本地 cecelia_test DB + 跑全套 migrations
# 防测试污染生产。详见 docs/superpowers/specs/2026-04-22-test-db-isolation-design.md

set -e

# unset NODE_ENV/VITEST 避免父/子 env 污染（guard 误触发）
unset NODE_ENV VITEST

DB=cecelia_test

# 幂等 create
if ! psql postgres -lqt | cut -d\| -f1 | grep -qw "$DB"; then
  echo "创建 $DB"
  createdb -O cecelia "$DB"
else
  echo "$DB 已存在，跳过 create"
fi

# 跑 migrations（migrate.js 自己幂等）
DB_NAME="$DB" node "$(dirname "$0")/../src/migrate.js"
echo "✅ $DB 准备就绪"
```

- [ ] **Step 1.6: 赋执行权限 + 跑一次建 DB**

```bash
cd /Users/administrator/worktrees/cecelia/test-db-isolation
chmod +x packages/brain/scripts/setup-test-db.sh
bash packages/brain/scripts/setup-test-db.sh 2>&1 | tail -10
```

**预期**：
- 首次：`创建 cecelia_test` + migrations 跑完 → `cecelia_test 准备就绪`
- 幂等：第二次跑显示 `cecelia_test 已存在，跳过 create`

**若 migration 报错**（某条 SQL 引用 cecelia 独有表）：
- 先记录哪条报错
- 可能要跳过 / 改 SQL
- 不阻塞本 task，手工处理单条 migration

- [ ] **Step 1.7: smoke：muted-toggle-e2e 应连 cecelia_test**

```bash
cd /Users/administrator/worktrees/cecelia/test-db-isolation/packages/brain
# 查 cecelia.brain_muted 当前值（记下）
PROD_BEFORE=$(psql cecelia -tAc "SELECT value_json FROM working_memory WHERE key='brain_muted';" 2>&1)
echo "跑前 cecelia.brain_muted: $PROD_BEFORE"

# 跑 muted 集成 test
npx vitest run src/__tests__/integration/muted-toggle-e2e.integration.test.js --no-coverage 2>&1 | tail -5

# 查 cecelia.brain_muted 是否被改（应该没变）
PROD_AFTER=$(psql cecelia -tAc "SELECT value_json FROM working_memory WHERE key='brain_muted';" 2>&1)
echo "跑后 cecelia.brain_muted: $PROD_AFTER"

# 查 cecelia_test.brain_muted（应该被测试写入）
TEST_AFTER=$(psql cecelia_test -tAc "SELECT value_json FROM working_memory WHERE key='brain_muted';" 2>&1)
echo "跑后 cecelia_test.brain_muted: $TEST_AFTER"

[[ "$PROD_BEFORE" == "$PROD_AFTER" ]] && echo "✅ 生产未受污染" || echo "❌ 生产被污染了！"
```

**预期**：生产前后一致 + test DB 有状态 + `✅ 生产未受污染`。

- [ ] **Step 1.8: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/test-db-isolation
git add packages/brain/src/db-config.js \
  packages/brain/scripts/setup-test-db.sh \
  packages/brain/src/__tests__/db-config-guard.test.js
git commit -m "fix(brain)[CONFIG]: db-config NODE_ENV=test guard + setup-test-db.sh

根治昨晚事故（muted-toggle-e2e 本地跑污染 cecelia.brain_muted 状态）：

1. scripts/setup-test-db.sh：幂等建 cecelia_test DB + 跑 migrations
2. db-config.js：NODE_ENV=test 或 VITEST=true 时自动用 cecelia_test，
   显式设 DB_NAME=cecelia 直接 throw（禁止污染生产）
3. 4 场景单测（vi.stubEnv + vi.resetModules 避免 flaky）

smoke 验证：跑 muted-toggle-e2e 后 cecelia.brain_muted 状态不变，
cecelia_test.brain_muted 被写入。生产安全。

CI 不受影响（brain-integration job 已用 DB_NAME=cecelia_test）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: DoD + Learning

**Files:**
- Create: `.dod`
- Create: `docs/learnings/cp-0422111326-test-db-isolation.md`

- [ ] **Step 2.1: 写 .dod + Learning（Bash heredoc）**

```bash
cd /Users/administrator/worktrees/cecelia/test-db-isolation
cat > .dod <<'DOD_EOF'
# DoD — test DB isolation

- [x] [ARTIFACT] setup-test-db.sh 新文件（可执行 + unset NODE_ENV）
      Test: manual:node -e "const fs=require('fs');const s=fs.statSync('packages/brain/scripts/setup-test-db.sh');if(!(s.mode & 0o100))process.exit(1);const c=fs.readFileSync('packages/brain/scripts/setup-test-db.sh','utf8');if(!c.includes('unset NODE_ENV'))process.exit(1);console.log('OK')"
- [x] [ARTIFACT] db-config.js 含 isTest guard
      Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/db-config.js','utf8');if(!c.includes('isTest')||!c.includes('禁止在测试环境'))process.exit(1)"
- [x] [BEHAVIOR] db-config-guard.test.js 4 场景全绿
      Test: tests/brain/db-config-guard.test.js
- [x] [BEHAVIOR] 本地 cecelia_test DB 存在
      Test: manual:bash -c "psql postgres -lqt | cut -d\| -f1 | grep -qw cecelia_test"
- [x] [BEHAVIOR] smoke：muted-toggle-e2e 本地跑不污染 cecelia.brain_muted
      Test: manual:bash -c "B=\$(psql cecelia -tAc \"SELECT value_json FROM working_memory WHERE key='brain_muted';\"); cd packages/brain && npx vitest run src/__tests__/integration/muted-toggle-e2e.integration.test.js --no-coverage > /dev/null 2>&1; A=\$(psql cecelia -tAc \"SELECT value_json FROM working_memory WHERE key='brain_muted';\"); [[ \"\$B\" == \"\$A\" ]]"
- [x] [ARTIFACT] 设计 + Learning 文档已提交
      Test: manual:node -e "require('fs').accessSync('docs/superpowers/specs/2026-04-22-test-db-isolation-design.md');require('fs').accessSync('docs/learnings/cp-0422111326-test-db-isolation.md')"
DOD_EOF
cat .dod | head -3

mkdir -p docs/learnings
cat > docs/learnings/cp-0422111326-test-db-isolation.md <<'LEARN_EOF'
# Learning — test DB 隔离根治

分支：cp-0422111326-test-db-isolation
日期：2026-04-22
Task：2302a40f-7ce0-4f12-8969-7634e8ed94d8

## 真实事故

昨晚（2026-04-22 00:42 UTC）合并 #2517 时 subagent 本地跑
muted-toggle-e2e.integration.test.js。本地无 cecelia_test DB，
DB_DEFAULTS 解析到 cecelia（生产 DB）。test beforeEach
DELETE + INSERT + 最后一个 subtest 的 PATCH {enabled:false} 留状态。

Brain 今早 10:01 左右重启，initMutedGuard(pool) 从 cecelia DB 读到
brain_muted.enabled=false → 飞书恢复发送。Alex 以为自己切错了，
查 brain.log 才发现没有 Mute toggled → false 的记录——是 DB 层
直接被测试改的。

## 根本原因

两个缺失叠加：

1. **本地缺 cecelia_test DB** —— 本应和 CI 一样的 test DB，本地机器没建
2. **db-config.js 无 guard** —— NODE_ENV=test 时仍默认 'cecelia'，不校验

任何 integration test 本地跑都会踩。昨晚是 muted 开关被 reset，下次
可能是 task 表、决策表被动。

## 本次解法

### 1. setup-test-db.sh
幂等脚本：检查 cecelia_test DB 是否存在，不存在则 createdb，然后跑
migrations。unset NODE_ENV/VITEST 防子进程继承。

### 2. db-config.js guard
- isTest = NODE_ENV==='test' || VITEST==='true'
- isTest + DB_NAME 未设 → 默认 cecelia_test（不是 cecelia）
- isTest + DB_NAME=cecelia 显式 throw（禁止污染生产）
- 非 test → 保持原行为（production 连 cecelia 不受影响）

### 3. 4 场景单测
vi.stubEnv + vi.resetModules 避免 flaky。覆盖 true×true/false×空/null
组合。

## 下次预防

- [ ] 任何 integration test 本地跑之前**检查是否有测试 DB 隔离**，没有就先做这个
- [ ] 新 env 开关（NODE_ENV 类）必须有 guard 防止误用生产配置
- [ ] DB 级 fallback 默认值要区分 "生产安全默认" vs "测试安全默认"
- [ ] setup-test-db.sh 加进新人 onboarding 文档（README）

## 下一步（本 PR 合并后）

- 每次切新分支 + 本机首次跑 integration → 运行 setup-test-db.sh
- 未来有新 integration test 必须保证连 cecelia_test（而非 cecelia）
LEARN_EOF
ls -la docs/learnings/cp-0422111326-test-db-isolation.md
```

- [ ] **Step 2.2: 全量 DoD 验证**

```bash
cd /Users/administrator/worktrees/cecelia/test-db-isolation && \
  node -e "const fs=require('fs');const s=fs.statSync('packages/brain/scripts/setup-test-db.sh');if(!(s.mode & 0o100))process.exit(1);const c=fs.readFileSync('packages/brain/scripts/setup-test-db.sh','utf8');if(!c.includes('unset NODE_ENV'))process.exit(1);console.log('setup-test-db OK')" && \
  node -e "const c=require('fs').readFileSync('packages/brain/src/db-config.js','utf8');if(!c.includes('isTest')||!c.includes('禁止在测试环境'))process.exit(1);console.log('db-config OK')" && \
  node -e "require('fs').accessSync('docs/superpowers/specs/2026-04-22-test-db-isolation-design.md');require('fs').accessSync('docs/learnings/cp-0422111326-test-db-isolation.md');console.log('docs OK')" && \
  psql postgres -lqt | cut -d\| -f1 | grep -qw cecelia_test && echo "cecelia_test 存在 ✓" && \
  cd packages/brain && \
  npx vitest run src/__tests__/db-config-guard.test.js --no-coverage 2>&1 | tail -5
```

**预期**：all OK + 4 passed。

- [ ] **Step 2.3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/test-db-isolation
git add .dod docs/learnings/cp-0422111326-test-db-isolation.md
git commit -m "docs[CONFIG]: DoD + Learning for test DB isolation

6 条 DoD 全勾选。Learning 记录真实事故根因（本地缺 cecelia_test +
db-config 无 guard 叠加）+ 4 条下次预防规则。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- [x] **Spec 覆盖**：setup 脚本（T1.5）+ db-config guard（T1.3）+ 4 单测（T1.1-1.4）+ smoke（T1.7）+ docs（T2）
- [x] **Placeholder 扫描**：无
- [x] **Type 一致性**：`cecelia_test` 全文一致；`isTest` 命名全文一致；场景 1-4 编号对齐
- [x] **防 flaky**：vi.stubEnv + vi.resetModules + beforeEach/afterEach 清理
- [x] **生产安全**：guard 不影响 production 环境（场景 4 验证）
- [x] **CI 无影响**：`brain-integration` job 已有 DB_NAME=cecelia_test env，不改
