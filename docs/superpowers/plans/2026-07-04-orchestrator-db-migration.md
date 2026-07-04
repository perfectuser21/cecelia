# Migration 312: orchestrator DB 结构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为去 LangGraph 化的独立 orchestrator 提供 DB 结构（initiative_runs 增列 + phase 扩枚举 + append-only 决策日志表 + selfcheck bump）。

**Architecture:** 单个 additive migration（312）扩展 initiative_runs（编排单位），新表 orchestrator_decision_log 带 UNIQUE(run_id,hop) 和禁 UPDATE/DELETE trigger。CI 层测试 = 文件内容断言（仓库惯例，CI 无真 Postgres，参照 staging-e2e-migration305.test.js）；真库行为验证 = 本地 dev DB（localhost:5432/cecelia）proven-to-fire，证据进 PR body。

**Tech Stack:** PostgreSQL / plpgsql trigger / vitest（文件断言）/ migrate.js（按文件名记 schema_version，310+ 惯例不手写 INSERT INTO schema_version）

**Spec:** docs/superpowers/specs/2026-07-04-orchestrator-db-migration-design.md

**Global Constraints:**
- 全 additive + 幂等（IF NOT EXISTS / DROP…IF EXISTS），重复执行安全
- phase 新 CHECK 必含存量值 `A_planning`（漏掉→有存量行的生产库 ADD CONSTRAINT 全表校验失败）
- 不加 contract_branch 列（initiative_contracts.propose_branch 唯一存储）
- TDD：commit-1 = failing tests (Red)，commit-2 = 实现 (Green)
- DoD.md 的 [BEHAVIOR] Test 必须 CI 兼容（manual: node -e readFileSync 白名单格式）

---

### Task 1: DoD.md + CI 层测试（Red commit）

**Files:**
- Create: `DoD.md`（worktree 根）
- Test: `packages/brain/src/__tests__/migration-312-orchestrator.test.js`

- [ ] **Step 1: 写 DoD.md**

```markdown
# DoD: migration 312 orchestrator DB 结构

sprint_dir: sprints/07041024-orchestrator-db-migration

- [x] [ARTIFACT] packages/brain/migrations/312_orchestrator_runs_state.sql 存在且含 initiative_runs 增列 + phase 扩枚举 + orchestrator_decision_log 表
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/312_orchestrator_runs_state.sql','utf8');if(!/orchestrator_decision_log/.test(c)||!/orchestrator_version/.test(c))process.exit(1)"
- [x] [BEHAVIOR] phase CHECK 扩枚举包含存量值 A_planning 与新值 planning/gan/generate/evaluate（存量库不被打爆）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/312_orchestrator_runs_state.sql','utf8');for(const p of ['A_planning','planning','gan','generate','evaluate'])if(!c.includes(\"'\"+p+\"'\"))process.exit(1)"
- [x] [BEHAVIOR] orchestrator_decision_log 为 append-only（存在禁 UPDATE/DELETE 的 trigger 完整 SQL）且 UNIQUE(run_id,hop)
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/312_orchestrator_runs_state.sql','utf8');if(!/BEFORE UPDATE OR DELETE ON orchestrator_decision_log/.test(c)||!/UNIQUE\s*\(run_id,\s*hop\)/.test(c))process.exit(1)"
- [x] [BEHAVIOR] selfcheck EXPECTED_SCHEMA_VERSION 已 bump 到 312
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8');if(!/EXPECTED_SCHEMA_VERSION = '312'/.test(c))process.exit(1)"
- [x] [ARTIFACT] CI 测试 packages/brain/src/__tests__/migration-312-orchestrator.test.js 存在
  Test: tests/migration-312-orchestrator.test.js → manual:node -e "if(!require('fs').existsSync('packages/brain/src/__tests__/migration-312-orchestrator.test.js'))process.exit(1)"
```

（push 前所有条目已勾 [x]——本 plan 完成时它们为真）

- [ ] **Step 2: 写 failing 测试**

`packages/brain/src/__tests__/migration-312-orchestrator.test.js`：

```javascript
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migPath = resolve(__dirname, '../../migrations/312_orchestrator_runs_state.sql');
const selfcheckPath = resolve(__dirname, '../selfcheck.js');

// T1 of harness-orchestration-redesign（architecture.md §2.2）：
// orchestrator 状态字段 + append-only 决策日志 + 心跳 + 双轨 flag。
// 仓库惯例：migration 测试做文件内容断言（CI 无真 Postgres，参照 305 测试）；
// 真库行为（trigger 报错/UNIQUE 拒绝/存量兼容）在本地 dev DB 验证，证据进 PR body。
describe('migration 312：orchestrator runs state', () => {
  it('312 文件存在', () => {
    expect(existsSync(migPath)).toBe(true);
  });

  it('initiative_runs 增列全部 additive（IF NOT EXISTS），含 8 个新列', () => {
    const c = readFileSync(migPath, 'utf8');
    for (const col of ['round', 'pr_url', 'evaluate_verdict', 'judge_verdict',
      'orchestrator_version', 'orchestrator_heartbeat_at', 'orchestrator_host', 'orchestrator_pid']) {
      expect(c, `缺列 ${col}`).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
  });

  it('不加 contract_branch 列（initiative_contracts.propose_branch 唯一存储，消灭双账本）', () => {
    const c = readFileSync(migPath, 'utf8');
    expect(c).not.toMatch(/ADD COLUMN IF NOT EXISTS contract_branch/);
  });

  it('phase CHECK 扩枚举：必含存量值 A_planning + 全部旧值 + 新值', () => {
    const c = readFileSync(migPath, 'utf8');
    expect(c).toMatch(/DROP CONSTRAINT IF EXISTS initiative_runs_phase_check/);
    for (const p of ['A_planning', 'A_contract', 'B_task_loop', 'C_final_e2e',
      'done', 'failed', 'planning', 'gan', 'generate', 'evaluate']) {
      expect(c, `phase 枚举缺 ${p}`).toContain(`'${p}'`);
    }
  });

  it('verdict 列带 CHECK（含 evaluator 前科值 FIXED）', () => {
    const c = readFileSync(migPath, 'utf8');
    expect(c).toMatch(/evaluate_verdict IN \('PASS','FAIL','FIXED'\)/);
    expect(c).toMatch(/judge_verdict IN \('PASS','FAIL'\)/);
  });

  it('orchestrator_version 双轨 flag：默认 v1 + CHECK', () => {
    const c = readFileSync(migPath, 'utf8');
    expect(c).toMatch(/orchestrator_version TEXT NOT NULL DEFAULT 'v1'/);
    expect(c).toMatch(/orchestrator_version IN \('v1','v2'\)/);
  });

  it('orchestrator_decision_log：UNIQUE(run_id,hop) + FK + 惯例索引名', () => {
    const c = readFileSync(migPath, 'utf8');
    expect(c).toMatch(/CREATE TABLE IF NOT EXISTS orchestrator_decision_log/);
    expect(c).toMatch(/REFERENCES initiative_runs\(id\)/);
    expect(c).toMatch(/UNIQUE\s*\(run_id,\s*hop\)/);
    expect(c).toMatch(/CREATE INDEX IF NOT EXISTS idx_orchestrator_decision_log_run/);
  });

  it('append-only trigger：完整 CREATE FUNCTION + BEFORE UPDATE OR DELETE trigger', () => {
    const c = readFileSync(migPath, 'utf8');
    expect(c).toMatch(/CREATE OR REPLACE FUNCTION orchestrator_decision_log_append_only/);
    expect(c).toMatch(/RAISE EXCEPTION/);
    expect(c).toMatch(/BEFORE UPDATE OR DELETE ON orchestrator_decision_log/);
  });

  it('migration 幂等：不手写 INSERT INTO schema_version（310+ 惯例，migrate.js 按文件名记账）', () => {
    const c = readFileSync(migPath, 'utf8');
    expect(c).not.toMatch(/INSERT INTO schema_version/);
  });

  it('selfcheck EXPECTED_SCHEMA_VERSION bump 到 312', () => {
    const c = readFileSync(selfcheckPath, 'utf8');
    expect(c).toMatch(/EXPECTED_SCHEMA_VERSION = '312'/);
  });
});
```

- [ ] **Step 3: 跑测试验证全红**

Run: `cd packages/brain && npx vitest run src/__tests__/migration-312-orchestrator.test.js --reporter=verbose 2>&1 | tail -20`
Expected: FAIL——"312 文件存在" 失败（文件不存在），selfcheck 断言失败（现值 '293'）。存量兼容等文件断言全部 FAIL。

- [ ] **Step 4: Red commit**

```bash
git add DoD.md packages/brain/src/__tests__/migration-312-orchestrator.test.js
git commit -m "test(brain): migration 312 orchestrator DB 结构 failing tests (Red)"
```

---

### Task 2: Migration SQL + selfcheck bump（Green commit）

**Files:**
- Create: `packages/brain/migrations/312_orchestrator_runs_state.sql`
- Modify: `packages/brain/src/selfcheck.js:23`

- [ ] **Step 1: 写 migration 312**

`packages/brain/migrations/312_orchestrator_runs_state.sql` 全文：

```sql
-- Migration 312: harness orchestrator 状态字段 + append-only 决策日志
-- Initiative: harness-orchestration-redesign（docs/current/harness-orchestration-redesign/architecture.md §2.2）
-- 设计: docs/superpowers/specs/2026-07-04-orchestrator-db-migration-design.md
-- 全部 additive + 幂等。双轨期（D7）：orchestrator_version 默认 'v1'（LangGraph 存量），
-- 新 orchestrator 创建的 run 写 'v2'。

-- A. initiative_runs 增列
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS round INT NOT NULL DEFAULT 0;
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS pr_url TEXT;  -- 仅 orchestrator_version='v2' 语义：一 run 一 sprint 一 PR
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS evaluate_verdict TEXT
    CHECK (evaluate_verdict IS NULL OR evaluate_verdict IN ('PASS','FAIL','FIXED'));
    -- FIXED = evaluator 历史前科值（memory: harness-evaluator-verdict-bug），语义归一由代码层做
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS judge_verdict TEXT
    CHECK (judge_verdict IS NULL OR judge_verdict IN ('PASS','FAIL'));
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS orchestrator_version TEXT NOT NULL DEFAULT 'v1'
    CHECK (orchestrator_version IN ('v1','v2'));
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS orchestrator_heartbeat_at TIMESTAMPTZ;
    -- D8 心跳；命名刻意避开 292 的 tasks.driver_heartbeat_at（另一套机制，watchdog 消费）
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS orchestrator_host TEXT;
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS orchestrator_pid INT;
    -- host+pid 一起才可用于 watchdog 重拉判断（跨主机裸 pid 无意义）
-- 刻意不加 contract_branch：initiative_contracts.propose_branch 是唯一存储（消灭双账本）

-- B. phase CHECK 扩枚举（保留全部存量值；A_planning 是 watchdog/patrol 认可的存量合法值，
--    漏掉会让有存量行的生产库在 ADD CONSTRAINT 全表校验时直接失败）
ALTER TABLE initiative_runs DROP CONSTRAINT IF EXISTS initiative_runs_phase_check;
ALTER TABLE initiative_runs ADD CONSTRAINT initiative_runs_phase_check
  CHECK (phase IN ('A_planning','A_contract','B_task_loop','C_final_e2e',
                   'done','failed',
                   'planning','gan','generate','evaluate'));

-- C. append-only 决策日志（DoD F7）：每跳一行，可回放整条 sprint 决策链。
--    留存策略：run 完成 90 天后可由 janitor 清理（TRUNCATE/分区不受 row trigger 限制），
--    清理实现不在本 migration。
CREATE TABLE IF NOT EXISTS orchestrator_decision_log (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  hop INT NOT NULL,
  observed JSONB NOT NULL,        -- 观测快照（git分支/PR状态/DB行 摘要）
  derived_phase TEXT NOT NULL,    -- 纯函数推导出的 phase
  gate_verdict TEXT,              -- 门禁判定（如有）
  action TEXT NOT NULL,           -- 派了谁/干了什么
  detail JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_orchestrator_decision_log_run_hop UNIQUE (run_id, hop)
    -- orchestrator 崩溃重拉后重算同 hop 不双写
);

CREATE INDEX IF NOT EXISTS idx_orchestrator_decision_log_run
  ON orchestrator_decision_log(run_id);

-- append-only 硬约束：禁 UPDATE/DELETE（门禁在代码，不是注释承诺）
CREATE OR REPLACE FUNCTION orchestrator_decision_log_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'orchestrator_decision_log is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orchestrator_decision_log_append_only ON orchestrator_decision_log;
CREATE TRIGGER trg_orchestrator_decision_log_append_only
  BEFORE UPDATE OR DELETE ON orchestrator_decision_log
  FOR EACH ROW EXECUTE FUNCTION orchestrator_decision_log_append_only();
```

- [ ] **Step 2: selfcheck bump**

`packages/brain/src/selfcheck.js` 第 23 行：

```javascript
export const EXPECTED_SCHEMA_VERSION = '312';
```

- [ ] **Step 3: 跑测试验证全绿**

Run: `cd packages/brain && npx vitest run src/__tests__/migration-312-orchestrator.test.js --reporter=verbose 2>&1 | tail -20`
Expected: PASS（10 个测试全绿）

- [ ] **Step 4: 跑 brain 全量测试确认无新增红**

Run: `cd packages/brain && npx vitest run 2>&1 | tail -10`
Expected: 与 main 基线一致，无新增 FAIL（selfcheck bump 可能触及 selfcheck 相关旧测试，若有硬编码 '293' 的断言一并更新——那是本改动的合法伴随）

- [ ] **Step 5: Green commit**

```bash
git add packages/brain/migrations/312_orchestrator_runs_state.sql packages/brain/src/selfcheck.js
git commit -m "feat(brain): migration 312 orchestrator 状态字段 + append-only 决策日志 (Green)"
```

---

### Task 3: 本地真库 proven-to-fire 验证（哨兵死规矩：亲眼看它报红）

**Files:** 无代码变更；产出 `/tmp/mig312-evidence.txt` 进 PR body

- [ ] **Step 1: 对本地 dev DB 实跑 migration**

Run: `PGPASSWORD=postgres psql -h localhost -p 5432 -U postgres -d cecelia -f packages/brain/migrations/312_orchestrator_runs_state.sql 2>&1 | tee /tmp/mig312-evidence.txt`
Expected: ALTER TABLE / CREATE TABLE / CREATE FUNCTION / CREATE TRIGGER 全部成功，无 ERROR

- [ ] **Step 2: 幂等验证——再跑一遍**

Run: `PGPASSWORD=postgres psql -h localhost -p 5432 -U postgres -d cecelia -f packages/brain/migrations/312_orchestrator_runs_state.sql 2>&1 | tee -a /tmp/mig312-evidence.txt`
Expected: 依然无 ERROR（NOTICE skipping 属正常）

- [ ] **Step 3: 行为验证（事务内跑完 ROLLBACK，不留测试数据；注意 append-only 行也随 ROLLBACK 消失）**

```bash
PGPASSWORD=postgres psql -h localhost -p 5432 -U postgres -d cecelia 2>&1 <<'SQL' | tee -a /tmp/mig312-evidence.txt
BEGIN;
-- 1) 新旧 phase 枚举均可写
INSERT INTO initiative_runs (initiative_id, phase, orchestrator_version)
  VALUES (gen_random_uuid(), 'planning', 'v2');
INSERT INTO initiative_runs (initiative_id, phase)
  VALUES (gen_random_uuid(), 'A_planning');
-- 2) 枚举外值被拒（期望 ERROR）
SAVEPOINT sp1;
INSERT INTO initiative_runs (initiative_id, phase) VALUES (gen_random_uuid(), 'bogus');
ROLLBACK TO sp1;
-- 3) 决策日志 INSERT 成功
INSERT INTO initiative_runs (id, initiative_id, phase, orchestrator_version)
  VALUES ('00000000-0000-0000-0000-000000000312', gen_random_uuid(), 'planning', 'v2');
INSERT INTO orchestrator_decision_log (run_id, hop, observed, derived_phase, action)
  VALUES ('00000000-0000-0000-0000-000000000312', 1, '{"pr":"none"}', 'planning', 'spawn:planner');
-- 4) UPDATE 被 trigger 拒（期望 ERROR: append-only）
SAVEPOINT sp2;
UPDATE orchestrator_decision_log SET action='tampered' WHERE hop=1;
ROLLBACK TO sp2;
-- 5) DELETE 被 trigger 拒（期望 ERROR: append-only）
SAVEPOINT sp3;
DELETE FROM orchestrator_decision_log WHERE hop=1;
ROLLBACK TO sp3;
-- 6) 同 (run_id,hop) 二次 INSERT 被拒（期望 ERROR: unique）
SAVEPOINT sp4;
INSERT INTO orchestrator_decision_log (run_id, hop, observed, derived_phase, action)
  VALUES ('00000000-0000-0000-0000-000000000312', 1, '{}', 'planning', 'dup');
ROLLBACK TO sp4;
-- 7) verdict CHECK
SAVEPOINT sp5;
UPDATE initiative_runs SET evaluate_verdict='MAYBE'
  WHERE id='00000000-0000-0000-0000-000000000312';
ROLLBACK TO sp5;
UPDATE initiative_runs SET evaluate_verdict='FIXED'
  WHERE id='00000000-0000-0000-0000-000000000312';
ROLLBACK;
SQL
```

Expected（逐条核对 /tmp/mig312-evidence.txt）：
- 步骤 1/3 成功 INSERT
- 步骤 2 报 `violates check constraint "initiative_runs_phase_check"`
- 步骤 4/5 报 `orchestrator_decision_log is append-only (UPDATE blocked)` / `(DELETE blocked)` ← **proven-to-fire 证据**
- 步骤 6 报 `duplicate key value violates unique constraint "uq_orchestrator_decision_log_run_hop"`
- 步骤 7 前半报 check violation，后半 FIXED 成功
- 最后 ROLLBACK，`SELECT COUNT(*) FROM orchestrator_decision_log` 应为 0

- [ ] **Step 4: 确认无残留**

Run: `PGPASSWORD=postgres psql -h localhost -p 5432 -U postgres -d cecelia -t -c "SELECT COUNT(*) FROM orchestrator_decision_log; SELECT COUNT(*) FROM initiative_runs WHERE orchestrator_version='v2';"`
Expected: 两个 0

---

### Task 4: DevGate + Learning + push + PR

**Files:**
- Create: `docs/learnings/cp-07041024-orchestrator-db-migration.md`

- [ ] **Step 1: DevGate 三件套**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全部通过（migration additive 不动 DEFINITION.md 事实；版本由 auto-version 在 merge 后处理，本地只验同步）。任一失败 → 按输出修复后重跑，禁止跳过。

- [ ] **Step 2: 写 Learning（第一次 push 前进 commit）**

`docs/learnings/cp-07041024-orchestrator-db-migration.md`：

```markdown
# Learning: migration 312 orchestrator DB 结构

### 根本原因
LangGraph checkpoint 把"Brain 进程内状态"和"git/PR/DB 外部真相"变成两份账本，desync 是 resume 三陷阱根因。T1 用"外部真相可重推导的轻量字段 + append-only 决策日志"替代 checkpoint 存储。

### 踩过的坑（schema challenger 审查抓出的 P0）
- phase 扩枚举漏 `A_planning` 存量值 → 有存量行的生产库 ADD CONSTRAINT 全表校验直接失败，两台生产 schema 分叉
- 新 phase 值在 watchdog 白名单之外 → v2 run 超时无人看管（T4 修，硬顺序依赖：T4 合并前生产不得出现 v2 run）
- 决策日志表无 UNIQUE(run_id,hop) → orchestrator 崩溃重拉同 hop 双写，对照测试无法对账

### 下次预防
- [ ] 任何 CHECK 枚举收紧/替换类 migration，先 grep 代码里该字段的全部合法值消费方（watchdog/patrol/graph），再查生产存量 DISTINCT 值
- [ ] append-only 承诺必须落 trigger SQL，不落=假承诺
- [ ] migration 测试跟 305 惯例走文件断言（CI 无真 Postgres），真库行为验证在本地 dev DB proven-to-fire，证据进 PR body
```

- [ ] **Step 3: commit + push**

```bash
git add docs/learnings/cp-07041024-orchestrator-db-migration.md
git commit -m "docs(learnings): migration 312 schema 设计审查教训"
git push -u origin cp-0704102413-orchestrator-db-migration
```

- [ ] **Step 4: 创建 PR（body 含 Red/Green/proven-to-fire 三段证据）**

```bash
gh pr create --title "feat(brain): migration 312 orchestrator 状态字段 + append-only 决策日志 [T1/7 harness-orchestration-redesign]" --body "$(cat <<'PRBODY'
## Summary
harness-orchestration-redesign T1（Brain task 3a9d18f6）：为去 LangGraph 化的独立 orchestrator 提供 DB 结构。
- initiative_runs 增 8 列（round/pr_url/verdicts+CHECK/orchestrator_version 双轨 flag/心跳 host+pid）
- phase CHECK 扩枚举（必含存量值 A_planning，challenger P0）
- orchestrator_decision_log append-only 表（UNIQUE(run_id,hop) + 禁 UPDATE/DELETE trigger）
- selfcheck EXPECTED_SCHEMA_VERSION → 312
- initiative 设计文档入库（architecture.md D1-D10 + DoD + spec + plan）

## 硬顺序依赖
新 phase 值（planning/gan/generate/evaluate）在 T4（watchdog 覆盖 v2）合并前不得在生产出现——orchestrator_version 默认 'v1'，v2 run 只能由后续 orchestrator 创建，天然满足。

## Test Evidence
### Red (commit 1)
<贴 vitest Red 输出摘要>
### Green (commit 2)
<贴 vitest Green 输出摘要>
### 真库 proven-to-fire（本地 dev DB，事务内验证后 ROLLBACK）
<贴 /tmp/mig312-evidence.txt 关键行：append-only UPDATE/DELETE 报错、UNIQUE 拒绝、A_planning/新枚举可写、幂等两跑>

## 部署提醒
生产 hk-vps + mmv 两台各跑 brain-deploy.sh（additive，任意顺序安全）。

## Learning
docs/learnings/cp-07041024-orchestrator-db-migration.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)"
```

- [ ] **Step 5: 等 CI（foreground 阻塞轮询，禁 background）→ merge 后回写 Brain task**

```bash
# CI 全绿后（若有 CI 则 --auto squash 轮询；PR 卡 BEHIND 用 gh pr update-branch）
gh pr merge --squash --auto <PR号>
# merge 后回写：
curl -X PATCH localhost:5221/api/brain/tasks/3a9d18f6-b514-4fe8-99ce-8fc02146ca16 \
  -H "Content-Type: application/json" \
  -d '{"status":"completed","result":{"pr_url":"<PR_URL>","merged":true}}'
```
