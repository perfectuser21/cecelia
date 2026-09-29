# Skill 台账投影 PR1a（扫描入账）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brain 每 2 小时经 ssh 到 mmv 扫一遍三平台（Claude Code / OpenClaw / Codex）的 skill，写进 `skill_registry`：机器列、在不在、原件、副本。同时修好 A6 守夜和 `/api/brain/skills` 写入时覆盖数据的问题。

**Architecture:** 远端采集是一个自包含函数，用 `toString()` 送到 mmv，交给 `node -` 执行。归并和判定是纯函数。扫描任务是 scheduler job，用 advisory lock 防重入，入库在一个事务里完成。A6 拆成独立的 lib。设计文档：`docs/superpowers/specs/2026-09-29-skill-ledger-projection-pr1-design.md`。

**Tech Stack:** Node 20+（ESM）、pg、vitest 1.6、supertest、bash smoke。

## Global Constraints

- 只改 `packages/brain/**`、`packages/quality/smoke-allowlist.txt`、`changes/`、`.dod.md`、`docs/`，不碰版本五件套（版本号靠 changes 碎片由 bot 统一 bump）。
- 迁移编号固定为 **491**，文件名 `491_skill_registry_ledger_columns.sql`，同时提供回滚文件 `migrations/rollback/491_skill_registry_ledger_columns.down.sql`。
- 单个源文件 ≤ 500 行；整个 PR 新增 ≤ 3000 行。
- `src/` 下的新文件必须被某个非测试模块 import（island-gate）。
- TDD：每个任务先提交失败的测试（commit-1），再提交实现（commit-2）。
- 远端采集函数体内**不得出现 `import(`**，一律用 `process.getBuiltinModule('node:xxx')`。
- 单测绝不真发 ssh，也不连生产库；integration 测试只连 `cecelia_test`。
- 所有注释、日志、提交信息使用简体中文。
- Conventional Commits，提交信息末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 本地跑 vitest：`cd packages/brain && VITEST_MAX_THREADS=3 npx vitest run <file>`。integration 测试需要环境变量 `DATABASE_URL=postgresql://localhost/cecelia_test`（也可用 `DB_NAME=cecelia_test`）。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/brain/migrations/491_skill_registry_ledger_columns.sql`（新） | 加列、CHECK、回填 category、固定派发命令、去掉 `openclaw/` 前缀、投影注册表改入口面 |
| `packages/brain/migrations/rollback/491_skill_registry_ledger_columns.down.sql`（新） | 回滚 |
| `packages/brain/src/lib/skill-inventory-remote.js`（新） | 自包含远端采集 `collectSkillInventory`，以及 `buildRemoteProgram` |
| `packages/brain/src/lib/skill-inventory-reconcile.js`（新） | 纯函数：名字归一、frontmatter、tier、Codex 口径、原件优先级、presence 判定、熔断 |
| `packages/brain/src/skill-inventory-sync.js`（新） | scheduler handler：锁、间隔、ssh 执行、入库事务、state |
| `packages/brain/src/lib/skill-ledger-assertion.js`（新） | A6 新口径 |
| `packages/brain/src/promise-map-nightly.js`（改） | A6 改为调用新 lib |
| `packages/brain/src/routes/skills.js`（改） | POST/PATCH 合并语义 |
| `packages/brain/src/scheduler-jobs.js`（改） | 注册 `skill-inventory-sync` |
| `packages/brain/scripts/smoke/skill-inventory-smoke.sh`（新） | CI 可跑的真库冒烟 |
| `packages/brain/scripts/smoke/skill-ledger-reconcile-smoke.sh`（改） | A6 报红段迁到新口径 |
| 测试若干 | 见各任务 |

---

### Task 1：迁移 491

**Files:**
- Create: `packages/brain/migrations/491_skill_registry_ledger_columns.sql`
- Create: `packages/brain/migrations/rollback/491_skill_registry_ledger_columns.down.sql`
- Test: `packages/brain/src/__tests__/migration-491-skill-registry-ledger.test.js`（结构断言）
- Test: `packages/brain/src/__tests__/integration/migration-491-skill-registry-ledger.integration.test.js`（真库行为）

**Interfaces:**
- Produces（后续任务依赖的列名，一字不差）：
  - 机器列：`platforms_installed TEXT[]`、`presence TEXT`（unknown/present/broken/gone）、`absent_since`、`last_seen_at`、`last_scanned_at`、`source_path`、`source_kind`、`assigned_agents TEXT[]`、`content_md`、`content_digest`、`copies JSONB`、`drift_copies INT`、`files TEXT[]`、`tier_suggested`
  - 人管列：`platforms_target TEXT[]`、`openclaw_tier`、`business_line`、`owner`、`category`、`note`
  - 系统列：`notion_baseline JSONB`、`notion_push_attempts INT`、`notion_next_retry_at`

- [ ] **Step 1：写失败的结构测试** `src/__tests__/migration-491-skill-registry-ledger.test.js`

```js
/**
 * 迁移 491 结构断言（Skill 台账投影 PR1a，任务 47def5bb，决策 19391396/4b1da4ca）。
 * 真库行为（改名/固定派发命令/注册表改面/幂等）见 integration/migration-491-skill-registry-ledger.integration.test.js。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/491_skill_registry_ledger_columns.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/491_skill_registry_ledger_columns.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';

describe('migration 491 skill_registry 台账列', () => {
  it('文件存在（含回滚）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  it('加齐机器列 / 人管列 / 系统列，一律 ADD COLUMN IF NOT EXISTS', () => {
    const cols = ['platforms_installed', 'presence', 'absent_since', 'last_seen_at', 'last_scanned_at', 'source_path',
      'source_kind', 'assigned_agents', 'content_md', 'content_digest', 'copies', 'drift_copies', 'files', 'tier_suggested',
      'platforms_target', 'openclaw_tier', 'business_line', 'owner', 'category', 'note',
      'notion_baseline', 'notion_push_attempts', 'notion_next_retry_at'];
    for (const c of cols) expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${c} `));
  });

  it('eval_score 不建数值列（生产为自由文本，转换会炸迁移）', () => {
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS eval_score/);
    expect(sql).not.toMatch(/::numeric/);
  });

  it('presence / tier 有 CHECK', () => {
    expect(sql).toMatch(/presence IN \('unknown','present','broken','gone'\)/);
    expect(sql).toMatch(/openclaw_tier IN \('A','B','C'\)/);
    expect(sql).toMatch(/tier_suggested IN \('A','B','C'\)/);
  });

  it('先固定带前缀派发行的 dispatch_command，再就地去前缀且避开撞名', () => {
    const pin = sql.indexOf("dispatch_command = '/' || name");
    const rename = sql.indexOf('substring(r.name from 10)');
    expect(pin).toBeGreaterThan(-1);
    expect(rename).toBeGreaterThan(pin);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM skill_registry x WHERE x\.name = substring\(r\.name from 10\)\)/);
    expect(sql).toMatch(/'renamed_from'/);
  });

  it('投影注册表 Skill Registry 改入口面 both', () => {
    expect(sql).toMatch(/UPDATE notion_projection_map[\s\S]*face = 'inlet'[\s\S]*direction = 'both'[\s\S]*353c40c2-ba63-81bf-ae3e-f0e6fa3753d7/);
  });

  it('登记 schema_version 491；回滚删列并还原注册表与名字', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'491'/);
    const d = existsSync(down) ? readFileSync(down, 'utf8') : '';
    expect(d).toMatch(/DROP COLUMN IF EXISTS notion_baseline/);
    expect(d).toMatch(/face = 'mirror'/);
    expect(d).toMatch(/renamed_from/);
    expect(d).toMatch(/DELETE FROM schema_version WHERE version = '491'/);
  });
});
```

- [ ] **Step 2：写失败的真库测试** `src/__tests__/integration/migration-491-skill-registry-ledger.integration.test.js`

```js
/**
 * 迁移 491 真库行为：在事务里重放 SQL（全部幂等），ROLLBACK 后不留痕。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SQL = readFileSync(fileURLToPath(new URL('../../../migrations/491_skill_registry_ledger_columns.sql', import.meta.url)), 'utf8');
let pool;
beforeAll(async () => { pool = (await import('../../db.js')).default; });

async function inTx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); return await fn(c); } finally { await c.query('ROLLBACK'); c.release(); }
}

describe('migration 491 真库', () => {
  it('去 openclaw/ 前缀、记 renamed_from、带派发绑定的行先固定命令', async () => {
    await inTx(async (c) => {
      await c.query(`INSERT INTO skill_registry (name, status, task_types, metadata) VALUES
        ('openclaw/__m491_a__','active','{}','{}'),
        ('openclaw/__m491_b__','active',ARRAY['__m491_type__'],'{"category":"运维"}')`);
      await c.query(SQL);
      const { rows } = await c.query(`SELECT name, dispatch_command, metadata, category FROM skill_registry
        WHERE name IN ('__m491_a__','__m491_b__') ORDER BY name`);
      expect(rows.map((r) => r.name)).toEqual(['__m491_a__', '__m491_b__']);
      expect(rows[0].metadata.renamed_from).toBe('openclaw/__m491_a__');
      expect(rows[0].dispatch_command).toBeNull();
      expect(rows[1].dispatch_command).toBe('/openclaw/__m491_b__');
      expect(rows[1].category).toBe('运维');
    });
  });

  it('撞名的前缀行原样保留（不合并、不报错）', async () => {
    await inTx(async (c) => {
      await c.query(`INSERT INTO skill_registry (name, status) VALUES ('__m491_c__','active'), ('openclaw/__m491_c__','active')`);
      await c.query(SQL);
      const { rows } = await c.query(`SELECT count(*)::int AS n FROM skill_registry WHERE name IN ('__m491_c__','openclaw/__m491_c__')`);
      expect(rows[0].n).toBe(2);
    });
  });

  it('presence 默认 unknown 且 CHECK 生效；注册表改入口面；重放幂等', async () => {
    await inTx(async (c) => {
      await c.query(SQL);
      await c.query(SQL);
      const { rows } = await c.query(`INSERT INTO skill_registry (name) VALUES ('__m491_d__') RETURNING presence, notion_baseline`);
      expect(rows[0].presence).toBe('unknown');
      expect(rows[0].notion_baseline).toEqual({});
      await expect(c.query(`UPDATE skill_registry SET presence='bogus' WHERE name='__m491_d__'`)).rejects.toThrow();
    });
    await inTx(async (c) => {
      await c.query(SQL);
      const { rows } = await c.query(`SELECT face, direction FROM notion_projection_map
        WHERE notion_db_id='353c40c2-ba63-81bf-ae3e-f0e6fa3753d7' AND brain_table='skill_registry'`);
      if (rows.length) expect(rows[0]).toEqual({ face: 'inlet', direction: 'both' });
    });
  });
});
```

- [ ] **Step 3：跑测试，确认两个文件都失败**

Run: `cd packages/brain && npx vitest run src/__tests__/migration-491-skill-registry-ledger.test.js`
Expected: FAIL（文件不存在）。

- [ ] **Step 4：提交失败测试**

```bash
git add packages/brain/src/__tests__/migration-491-skill-registry-ledger.test.js packages/brain/src/__tests__/integration/migration-491-skill-registry-ledger.integration.test.js
git commit -m "test(brain): 迁移 491 skill_registry 台账列结构与真库行为失败测试 (Red)"
```

- [ ] **Step 5：写迁移** `packages/brain/migrations/491_skill_registry_ledger_columns.sql`

```sql
-- Migration 491: skill_registry 台账列（Skill 台账投影 PR1a，任务 47def5bb，决策 19391396 / 4b1f4230 / 4b1da4ca）
--
-- 真身 = Brain skill_registry，Notion Skill Registry = 列级分权的可操作投影：
--   机器列：由 skill-inventory-sync 每 2h 经 ssh mmv 扫三平台写入，推 Notion 单向覆盖
--   人管列：主理人在 Notion 改，三方基线合并（PR1b 推送 / PR3 回拉），扫描永不碰
--   系统列：推送基线与失败退避
-- eval_score 刻意不建数值列：生产 48 行多为自由文本（'EVA v2'、'manual-review (...)'），::numeric 会让迁移失败、Brain 起不来。

ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS platforms_installed TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS presence TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS absent_since TIMESTAMPTZ;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS source_path TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS source_kind TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS assigned_agents TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS content_md TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS content_digest TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS copies JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS drift_copies INT NOT NULL DEFAULT 0;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS files TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS tier_suggested TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS platforms_target TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS openclaw_tier TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS business_line TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS notion_baseline JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS notion_push_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS notion_next_retry_at TIMESTAMPTZ;

ALTER TABLE skill_registry DROP CONSTRAINT IF EXISTS skill_registry_presence_check;
ALTER TABLE skill_registry ADD CONSTRAINT skill_registry_presence_check
  CHECK (presence IN ('unknown','present','broken','gone'));
ALTER TABLE skill_registry DROP CONSTRAINT IF EXISTS skill_registry_openclaw_tier_check;
ALTER TABLE skill_registry ADD CONSTRAINT skill_registry_openclaw_tier_check
  CHECK (openclaw_tier IS NULL OR openclaw_tier IN ('A','B','C'));
ALTER TABLE skill_registry DROP CONSTRAINT IF EXISTS skill_registry_tier_suggested_check;
ALTER TABLE skill_registry ADD CONSTRAINT skill_registry_tier_suggested_check
  CHECK (tier_suggested IS NULL OR tier_suggested IN ('A','B','C'));

CREATE INDEX IF NOT EXISTS idx_skill_registry_presence ON skill_registry (presence);

-- 人管列「分类」从 metadata 回填（64 行有值；只填空的，重放不覆盖人后来改的）
UPDATE skill_registry SET category = metadata->>'category'
 WHERE category IS NULL AND COALESCE(metadata->>'category', '') <> '';

-- 去 openclaw/ 前缀（判定点 11af333b：同名即同一 skill）。
-- ① 先把带派发绑定、未写命令的前缀行命令固定为原值——skill-binding-registry 默认命令是 '/' || name，改名会悄悄改派发
UPDATE skill_registry SET dispatch_command = '/' || name
 WHERE name LIKE 'openclaw/%' AND task_types <> '{}' AND dispatch_command IS NULL;
-- ② 就地改名，notion_id 不变；撞名的行原样保留（2026-09-29 生产实测零撞名）
UPDATE skill_registry r
   SET name = substring(r.name from 10),
       metadata = COALESCE(r.metadata, '{}'::jsonb) || jsonb_build_object('renamed_from', r.name),
       updated_at = NOW()
 WHERE r.name LIKE 'openclaw/%'
   AND NOT EXISTS (SELECT 1 FROM skill_registry x WHERE x.name = substring(r.name from 10));

-- 投影注册表：镜子 → 入口面 both（列级分权，同 Tasks）。A8 镜子被人改 / 镜子标签 / A10 按 mirror 筛，改面后不再误报；
-- 行数对账由 A6 接住（lib/skill-ledger-assertion.js）。
UPDATE notion_projection_map
   SET face = 'inlet',
       direction = 'both',
       vessel = 'skill-inventory-sync（扫描入账）+ skill-registry-projection（PR1b 推送）+ 回拉（PR3）',
       notes = '列级分权：机器列 Brain 单向覆盖，人管列三方基线合并（决策 19391396 / 判定点 24736022）',
       updated_at = NOW()
 WHERE notion_db_id = '353c40c2-ba63-81bf-ae3e-f0e6fa3753d7' AND brain_table = 'skill_registry';

INSERT INTO schema_version (version, description)
VALUES ('491', 'skill_registry 台账列（三平台扫描机器列/人管列/推送基线）+ 去 openclaw/ 前缀 + Skill Registry 改入口面')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 6：写回滚** `packages/brain/migrations/rollback/491_skill_registry_ledger_columns.down.sql`

```sql
-- Rollback 491：还原名字 → 还原注册表 → 删列
UPDATE skill_registry r
   SET name = r.metadata->>'renamed_from', metadata = r.metadata - 'renamed_from'
 WHERE r.metadata ? 'renamed_from' AND r.name = substring(r.metadata->>'renamed_from' from 10)
   AND NOT EXISTS (SELECT 1 FROM skill_registry x WHERE x.name = r.metadata->>'renamed_from');
UPDATE notion_projection_map SET face = 'mirror', direction = 'push', vessel = 'notion-push-sync.pushSkillRegistry', updated_at = NOW()
 WHERE notion_db_id = '353c40c2-ba63-81bf-ae3e-f0e6fa3753d7' AND brain_table = 'skill_registry';
DROP INDEX IF EXISTS idx_skill_registry_presence;
ALTER TABLE skill_registry
  DROP COLUMN IF EXISTS platforms_installed, DROP COLUMN IF EXISTS presence, DROP COLUMN IF EXISTS absent_since,
  DROP COLUMN IF EXISTS last_seen_at, DROP COLUMN IF EXISTS last_scanned_at, DROP COLUMN IF EXISTS source_path,
  DROP COLUMN IF EXISTS source_kind, DROP COLUMN IF EXISTS assigned_agents, DROP COLUMN IF EXISTS content_md,
  DROP COLUMN IF EXISTS content_digest, DROP COLUMN IF EXISTS copies, DROP COLUMN IF EXISTS drift_copies,
  DROP COLUMN IF EXISTS files, DROP COLUMN IF EXISTS tier_suggested, DROP COLUMN IF EXISTS platforms_target,
  DROP COLUMN IF EXISTS openclaw_tier, DROP COLUMN IF EXISTS business_line, DROP COLUMN IF EXISTS owner,
  DROP COLUMN IF EXISTS category, DROP COLUMN IF EXISTS note, DROP COLUMN IF EXISTS notion_baseline,
  DROP COLUMN IF EXISTS notion_push_attempts, DROP COLUMN IF EXISTS notion_next_retry_at;
DELETE FROM schema_version WHERE version = '491';
```

- [ ] **Step 7：跑结构测试确认通过；把迁移应用到 cecelia_test，再跑 integration**

Run: `cd packages/brain && npx vitest run src/__tests__/migration-491-skill-registry-ledger.test.js`
Expected: PASS
Run: `cd packages/brain && DB_NAME=cecelia_test node src/migrate.js && DB_NAME=cecelia_test npx vitest run -c vitest.integration.config.js src/__tests__/integration/migration-491-skill-registry-ledger.integration.test.js`
Expected: PASS

- [ ] **Step 8：提交**

```bash
git add packages/brain/migrations/491_skill_registry_ledger_columns.sql packages/brain/migrations/rollback/491_skill_registry_ledger_columns.down.sql
git commit -m "feat(brain): 迁移 491 skill_registry 台账列 + 去 openclaw/ 前缀 + Skill Registry 改入口面"
```

---

### Task 2：远端采集 `skill-inventory-remote.js`

**Files:**
- Create: `packages/brain/src/lib/skill-inventory-remote.js`
- Test: `packages/brain/src/lib/__tests__/skill-inventory-remote.test.js`

**Interfaces:**
- Produces:
  - `collectSkillInventory(opts) → Promise<Inventory>`
  - `buildRemoteProgram(opts) → string`
  - `buildRemoteShell(program) → string`
- `opts`：`{ home, repoRoot?, openclawBin?, budgetMs?, agentTimeoutMs?, concurrency?, maxContentBytes? }`，全部可以 JSON 化。
- `Inventory` 结构：

```
{
  ok: true, generated_at: ISO,
  contents: { [digest]: string },
  sources: {
    claude:   { status: 'ok'|'fail', error?, items: Item[], broken: string[] },
    agents:   { status, error?, items: Item[], broken: string[] },
    repo:     { status, error?, items: Item[] },
    openclaw: { status, error?, items: OcItem[] }
  }
}
Item   = { name, path, real_path, digest, lines, truncated, files: string[] }
OcItem = Item & { source: 'openclaw-workspace'|'openclaw-managed'|'openclaw-workshop'|'agents-skills-personal', agents: string[], assigned: string[] }
```

  - `real_path` 是 SKILL.md 的真实路径（已解开软链）。
  - `agents`：这份文件出现在哪些 agent 的清单里。
  - `assigned`：真正分给了哪些 agent，规则是 agent 配置的 `skills` 白名单包含该名字，或者 `source === 'openclaw-workspace'`（来自这个 agent 自己的 workspace）。

- [ ] **Step 1：写失败测试** `src/lib/__tests__/skill-inventory-remote.test.js`

```js
/**
 * 远端采集（Skill 台账投影 PR1a）：函数自包含，toString() 送 mmv 交给 node - 执行。
 * 这里用临时 HOME 造三平台 fixture 和一个假的 openclaw CLI，直接调用一次，再经 node - 真跑一次。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectSkillInventory, buildRemoteProgram, buildRemoteShell } from '../skill-inventory-remote.js';

let home;
const skill = (dir, name, body = '') => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} 描述\n---\n# ${name}\n${body}`);
};

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'skinv-'));
  const repo = join(home, 'perfect21/zenithjoy-skills');
  skill(join(repo, 'alpha'), 'alpha', 'repo 原件');
  mkdirSync(join(repo, 'alpha/scripts'), { recursive: true });
  writeFileSync(join(repo, 'alpha/scripts/run.sh'), 'echo hi');
  mkdirSync(join(home, '.claude/skills'), { recursive: true });
  symlinkSync(join(repo, 'alpha'), join(home, '.claude/skills/alpha'));
  symlinkSync(join(repo, 'gone-away'), join(home, '.claude/skills/ghost'));
  skill(join(home, '.claude/skills/local-only'), 'local-only');
  skill(join(home, '.agents/skills/superpowers/brainstorming'), 'brainstorming');
  const ws = join(home, 'openclaw-root/workspaces-root/clawd-a');
  skill(join(ws, 'skills/alpha'), 'alpha', '旧副本');
  skill(join(ws, 'skills/beta'), 'beta');
  mkdirSync(join(home, '.openclaw'), { recursive: true });
  writeFileSync(join(home, '.openclaw/openclaw.json'), JSON.stringify({ agents: { entries: {
    a: { workspace: ws, skills: ['beta'] }, b: { workspace: ws },
  } } }));
  const bin = join(home, 'fake-openclaw');
  writeFileSync(bin, `#!/bin/sh
case "$4" in
  a|b) printf '%s' '{"workspaceDir":"${ws}","managedSkillsDir":"${home}/.openclaw/skills","skills":[{"name":"alpha","source":"openclaw-workspace"},{"name":"beta","source":"openclaw-workspace"},{"name":"brainstorming","source":"agents-skills-personal"},{"name":"weather","source":"openclaw-bundled"}]}' ;;
  *) exit 3 ;;
esac
`);
  chmodSync(bin, 0o755);
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

const opts = () => ({ home, openclawBin: join(home, 'fake-openclaw'), budgetMs: 20_000, agentTimeoutMs: 5_000 });

describe('collectSkillInventory', () => {
  it('Claude Code：跟随软链收有效 skill，悬空软链单列 broken', async () => {
    const inv = await collectSkillInventory(opts());
    expect(inv.ok).toBe(true);
    const c = inv.sources.claude;
    expect(c.status).toBe('ok');
    expect(c.items.map((i) => i.name).sort()).toEqual(['alpha', 'local-only']);
    expect(c.broken).toEqual(['ghost']);
    const alpha = c.items.find((i) => i.name === 'alpha');
    expect(alpha.real_path).toContain('zenithjoy-skills/alpha/SKILL.md');
    expect(alpha.files).toEqual(expect.arrayContaining(['SKILL.md', 'scripts/run.sh']));
    expect(inv.contents[alpha.digest]).toContain('repo 原件');
  });

  it('~/.agents/skills 支持一层分组；repo 只看根目录一层', async () => {
    const inv = await collectSkillInventory(opts());
    expect(inv.sources.agents.items.map((i) => i.name)).toEqual(['brainstorming']);
    expect(inv.sources.repo.items.map((i) => i.name)).toEqual(['alpha']);
  });

  it('OpenClaw：只收自有来源、同路径合并 agents、按白名单或 workspace 记 assigned', async () => {
    const oc = (await collectSkillInventory(opts())).sources.openclaw;
    expect(oc.status).toBe('ok');
    expect(oc.items.map((i) => i.name).sort()).toEqual(['alpha', 'beta', 'brainstorming']);
    const beta = oc.items.find((i) => i.name === 'beta');
    expect(beta.agents.sort()).toEqual(['a', 'b']);
    expect(beta.assigned.sort()).toEqual(['a', 'b']);
    const bs = oc.items.find((i) => i.name === 'brainstorming');
    expect(bs.assigned).toEqual([]);
    expect(oc.items.find((i) => i.name === 'weather')).toBeUndefined();
  });

  it('任一 agent 失败 → openclaw 整体 fail，不给部分结果；claude 根目录缺失 → fail', async () => {
    writeFileSync(join(home, '.openclaw/openclaw.json'), JSON.stringify({ agents: { entries: { a: {}, zzz: {} } } }));
    const inv = await collectSkillInventory(opts());
    expect(inv.sources.openclaw.status).toBe('fail');
    expect(inv.sources.openclaw.items).toBeUndefined();
    const inv2 = await collectSkillInventory({ ...opts(), home: join(home, 'nope') });
    expect(inv2.sources.claude.status).toBe('fail');
  });
});

describe('buildRemoteProgram', () => {
  it('函数体自包含：不含 import( 与 vitest 改写痕迹', () => {
    const src = collectSkillInventory.toString();
    expect(src).not.toMatch(/\bimport\(/);
    expect(src).not.toMatch(/__vite_ssr|__vi_/);
  });

  it('base64 后 ≤ 90KB（Linux 单参数 128KB 上限留余量）', () => {
    const b64 = Buffer.from(buildRemoteProgram(opts())).toString('base64');
    expect(b64.length).toBeLessThan(90 * 1024);
  });

  it('经 node - 真跑输出合法 JSON', () => {
    const out = execFileSync('node', ['-'], { input: buildRemoteProgram(opts()), encoding: 'utf8' });
    const inv = JSON.parse(out);
    expect(inv.ok).toBe(true);
    expect(inv.sources.claude.items.length).toBeGreaterThan(0);
  });

  it('远端 shell 带 PATH 并用 base64 送达（命令行里没有单引号）', () => {
    const sh = buildRemoteShell('console.log(1)');
    expect(sh).toMatch(/^export PATH=\/opt\/homebrew\/bin:\/usr\/local\/bin:\$PATH; echo [A-Za-z0-9+/=]+ \| \(base64 -d 2>\/dev\/null \|\| base64 -D\) \| node -$/);
  });
});
```

Note: the "任一 agent 失败" test rewrites openclaw.json; put it last in its describe, or restore the file in `afterEach`. The implementer must make sure test order does not leak state: this test is last in that describe, and the `buildRemoteProgram` tests only assert on the claude source.

- [ ] **Step 2：跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/skill-inventory-remote.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3：提交失败测试**

```bash
git add packages/brain/src/lib/__tests__/skill-inventory-remote.test.js
git commit -m "test(brain): skill 远端采集（三平台 fixture + 假 openclaw + node - 实跑）失败测试 (Red)"
```

- [ ] **Step 4：实现** `packages/brain/src/lib/skill-inventory-remote.js`

```js
/**
 * skill-inventory-remote.js — 三平台 skill 远端采集（Skill 台账投影 PR1a，任务 47def5bb）
 *
 * collectSkillInventory 必须【自包含】：整个函数经 toString() 送到 mmv，交给 `node -` 执行（us-vps 零执行）。
 * 所以函数体里只能用 process.getBuiltinModule 取内置模块，不能用 import()——vitest 会把 import() 改写成
 * __vite_ssr_dynamic_import__，toString() 送到远端后会报 ReferenceError（代审实测复现）。
 * 也不能引用模块作用域里的任何东西。
 *
 * 探不到 ≠ 零个：某个来源读不到（根目录缺失 / openclaw 任一 agent 失败或超预算）→ 该来源整体 status=fail，
 * 由 Brain 侧把它排除在缺席判定之外（判定点 e22aab26）。
 */
export async function collectSkillInventory(opts = {}) {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const crypto = process.getBuiltinModule('node:crypto');
  const cp = process.getBuiltinModule('node:child_process');
  const home = opts.home || process.env.HOME;
  const repoRoot = opts.repoRoot || path.join(home, 'perfect21/zenithjoy-skills');
  const openclawBin = opts.openclawBin || 'openclaw';
  const budgetMs = opts.budgetMs ?? 150_000;
  const agentTimeoutMs = opts.agentTimeoutMs ?? 45_000;
  const concurrency = opts.concurrency ?? 4;
  const maxBytes = opts.maxContentBytes ?? 512 * 1024;
  const started = Date.now();
  const contents = {};
  const OC_KEEP = new Set(['openclaw-workspace', 'openclaw-managed', 'openclaw-workshop', 'agents-skills-personal']);

  const listFiles = (dir) => {
    const out = [];
    const walk = (d, rel, depth) => {
      if (out.length >= 200 || depth > 4) return;
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries.sort((x, y) => x.name.localeCompare(y.name))) {
        if (out.length >= 200) return;
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        let st;
        try { st = fs.statSync(path.join(d, e.name)); } catch { continue; }
        if (st.isDirectory()) walk(path.join(d, e.name), r, depth + 1); else out.push(r);
      }
    };
    walk(dir, '', 0);
    return out;
  };

  const readSkill = (name, dir) => {
    const file = path.join(dir, 'SKILL.md');
    const buf = fs.readFileSync(file);
    const truncated = buf.length > maxBytes;
    const text = (truncated ? buf.subarray(0, maxBytes) : buf).toString('utf8');
    const digest = crypto.createHash('sha256').update(buf).digest('hex');
    contents[digest] = text;
    let realPath = file;
    try { realPath = fs.realpathSync(file); } catch { /* 保持原路径 */ }
    return { name, path: file, real_path: realPath, digest, lines: text.split('\n').length, truncated, files: listFiles(dir) };
  };

  // 扫一个根目录：<root>/<skill>/SKILL.md，或一层分组 <root>/<group>/<skill>/SKILL.md
  const scanRoot = (root, { grouped = false } = {}) => {
    if (!fs.existsSync(root)) return { status: 'fail', error: `root_missing: ${root}`, items: [], broken: [] };
    const items = [];
    const broken = [];
    for (const e of fs.readdirSync(root, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(root, e.name);
      let st;
      try { st = fs.statSync(p); } catch { if (e.isSymbolicLink()) broken.push(e.name); continue; }
      if (!st.isDirectory()) continue;
      if (fs.existsSync(path.join(p, 'SKILL.md'))) {
        try { items.push(readSkill(e.name, p)); } catch { /* 读不了的单项跳过 */ }
      } else if (grouped) {
        for (const g of fs.readdirSync(p, { withFileTypes: true })) {
          const gp = path.join(p, g.name);
          try { if (fs.statSync(gp).isDirectory() && fs.existsSync(path.join(gp, 'SKILL.md'))) items.push(readSkill(g.name, gp)); } catch { /* skip */ }
        }
      }
    }
    return { status: 'ok', items, broken };
  };

  const findSkillDir = (root, name) => {
    if (!root || !fs.existsSync(root)) return null;
    const direct = path.join(root, name);
    if (fs.existsSync(path.join(direct, 'SKILL.md'))) return direct;
    for (const g of fs.readdirSync(root)) {
      const p = path.join(root, g, name);
      if (fs.existsSync(path.join(p, 'SKILL.md'))) return p;
    }
    return null;
  };

  const runAgent = (id) => new Promise((resolve, reject) => {
    cp.execFile(openclawBin, ['skills', 'list', '--agent', id, '--json'],
      { timeout: agentTimeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(new Error(`${id}: ${String(err.message || err).split('\n')[0].slice(0, 120)}`));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`${id}: invalid json`)); }
      });
  });

  const scanOpenclaw = async () => {
    let entries;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(home, '.openclaw/openclaw.json'), 'utf8'));
      entries = cfg?.agents?.entries || {};
    } catch (err) {
      return { status: 'fail', error: `config: ${String(err.message).slice(0, 120)}` };
    }
    const ids = Object.keys(entries);
    const results = {};
    const errors = [];
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        if (Date.now() - started > budgetMs) { errors.push(`${id}: budget exceeded`); continue; }
        try { results[id] = await runAgent(id); } catch (err) { errors.push(err.message); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
    if (errors.length) return { status: 'fail', error: errors.slice(0, 5).join('; ') };

    const byPath = new Map();
    for (const id of ids) {
      const r = results[id] || {};
      const allow = Array.isArray(entries[id]?.skills) ? entries[id].skills : null;
      for (const s of r.skills || []) {
        if (!OC_KEEP.has(s.source)) continue;
        let root = null;
        if (s.source === 'openclaw-workspace') root = r.workspaceDir ? path.join(r.workspaceDir, 'skills') : null;
        else if (s.source === 'openclaw-managed') root = r.managedSkillsDir;
        else if (s.source === 'openclaw-workshop') root = path.join(home, '.openclaw/agents', id, 'agent/workshop-skills');
        else root = path.join(home, '.agents/skills');
        const dir = findSkillDir(root, s.name);
        if (!dir) continue;
        const key = `${s.name}@${dir}`;
        if (!byPath.has(key)) {
          try { byPath.set(key, { ...readSkill(s.name, dir), source: s.source, agents: [], assigned: [] }); } catch { continue; }
        }
        const item = byPath.get(key);
        item.agents.push(id);
        if ((allow && allow.includes(s.name)) || s.source === 'openclaw-workspace') item.assigned.push(id);
      }
    }
    return { status: 'ok', items: [...byPath.values()] };
  };

  const repoScan = scanRoot(repoRoot);
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    sources: {
      claude: scanRoot(path.join(home, '.claude/skills')),
      agents: scanRoot(path.join(home, '.agents/skills'), { grouped: true }),
      repo: { status: repoScan.status, error: repoScan.error, items: repoScan.items },
      openclaw: await scanOpenclaw(),
    },
    contents,
  };
}

/** 拼远端程序：自包含函数 + 调用 + 输出一行 JSON。失败也输出 JSON（ok:false），退出码 2。 */
export function buildRemoteProgram(opts = {}) {
  return `(${collectSkillInventory.toString()})(${JSON.stringify(opts)})`
    + '.then((r) => process.stdout.write(JSON.stringify(r)))'
    + '.catch((e) => { process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.message) || e) })); process.exit(2); });';
}

/** mmv 上执行程序的 shell：补 PATH（ssh 非交互 shell 可能没有 homebrew），base64 送达，命令行里没有单引号。 */
export function buildRemoteShell(program) {
  const b64 = Buffer.from(program, 'utf8').toString('base64');
  return `export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; echo ${b64} | (base64 -d 2>/dev/null || base64 -D) | node -`;
}
```

- [ ] **Step 5：跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/skill-inventory-remote.test.js`
Expected: PASS（全部用例）

- [ ] **Step 6：提交**

```bash
git add packages/brain/src/lib/skill-inventory-remote.js
git commit -m "feat(brain): skill 三平台远端采集（自包含 node 程序，经 ssh mmv 执行）"
```

---

### Task 3：归并与判定 `skill-inventory-reconcile.js`

**Files:**
- Create: `packages/brain/src/lib/skill-inventory-reconcile.js`
- Test: `packages/brain/src/lib/__tests__/skill-inventory-reconcile.test.js`

**Interfaces:**
- Consumes：Task 2 的 `Inventory` 结构；working_memory `skill_manifest_drift` 的值 `{ checked_at, truth:{status}, machines:[{id, dirs:[{label:'claude'|'codex-gwremote', status, missing?, missing_total?, extra?}]}] }`
- Produces：
  - `normalizeName(name): string`
  - `frontmatterDescription(md): string|null`
  - `suggestTier(name, content, platforms): 'A'|'B'|'C'|null`
  - `buildRecords(inventory, { driftState, now }) → { records: Record[], sourcesOk: boolean, brokenNames: Set<string>, counts: {claude,agents,openclaw,repo} }`
  - `Record = { name, description, platforms_installed: string[], source_kind, source_path, content_md, content_digest, copies: Copy[], drift_copies, files, assigned_agents, tier_suggested }`
  - `Copy = { platform, path, digest, lines, agents? }`
  - `trippedSources(prevCounts, counts, ratio = 0.1): string[]`
  - `decideAbsent({ presence, absent_since }, { isBroken, canJudge, now, graceMs = 86_400_000 }) → { presence, absent_since }`

- [ ] **Step 1：写失败测试** `src/lib/__tests__/skill-inventory-reconcile.test.js`

```js
/**
 * 归并与判定（纯函数）：原件优先级 / Codex 口径 / tier 建议 / 缺席 24h / 断链 / 熔断。
 * 判定点：11af333b 同名即同一 skill、e22aab26 下线判定、bc98dda7 原件取在用那份、84972cc1 Codex 口径。
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeName, frontmatterDescription, suggestTier, buildRecords, trippedSources, decideAbsent,
} from '../skill-inventory-reconcile.js';

const item = (name, digest, extra = {}) => ({ name, path: `/p/${name}/SKILL.md`, real_path: `/p/${name}/SKILL.md`, digest, lines: 3, truncated: false, files: ['SKILL.md'], ...extra });
const inv = (over = {}) => ({
  ok: true,
  contents: { d1: '---\ndescription: 甲描述\n---\n# a', d2: '# 旧副本', d3: '---\ndescription: |\n  多行\n  描述\n---\n', d4: '# bs' },
  sources: {
    claude: { status: 'ok', items: [item('alpha', 'd1', { real_path: '/h/perfect21/zenithjoy-skills/alpha/SKILL.md' }), item('solo', 'd3')], broken: ['ghost'] },
    agents: { status: 'ok', items: [item('brainstorming', 'd4', { real_path: '/h/.claude-account1/plugins/cache/superpowers/x/brainstorming/SKILL.md' })], broken: [] },
    repo: { status: 'ok', items: [item('alpha', 'd1', { path: '/h/perfect21/zenithjoy-skills/alpha/SKILL.md' })] },
    openclaw: { status: 'ok', items: [
      { ...item('alpha', 'd2', { path: '/ws/skills/alpha/SKILL.md' }), source: 'openclaw-workspace', agents: ['a'], assigned: ['a'] },
      { ...item('openclaw/beta', 'd2', { path: '/ws/skills/beta/SKILL.md' }), source: 'openclaw-workspace', agents: ['a', 'b'], assigned: ['a'] },
      { ...item('brainstorming', 'd4'), source: 'agents-skills-personal', agents: ['a'], assigned: [] },
    ] },
    ...over,
  },
});
const drift = (over = {}) => ({
  checked_at: new Date().toISOString(), truth: { status: 'ok' },
  machines: [{ id: 'xian-m4', dirs: [
    { label: 'claude', status: 'drift', extra: ['review'], missing: [], missing_total: 0 },
    { label: 'codex-gwremote', status: 'drift', missing: ['solo'], missing_total: 1 },
  ] }],
  ...over,
});

describe('基础函数', () => {
  it('normalizeName 去 openclaw/ 前缀', () => {
    expect(normalizeName('openclaw/beta')).toBe('beta');
    expect(normalizeName('alpha')).toBe('alpha');
  });
  it('frontmatterDescription 支持单行与 | 多行', () => {
    expect(frontmatterDescription('---\ndescription: 甲描述\n---\n')).toBe('甲描述');
    expect(frontmatterDescription('---\ndescription: |\n  多行\n  描述\n---\n')).toBe('多行 描述');
    expect(frontmatterDescription('# 无 frontmatter')).toBeNull();
  });
  it('suggestTier：已在 OpenClaw → null；研发链 → C；CC 专属机制 → B；其余 A', () => {
    expect(suggestTier('beta', '', ['openclaw'])).toBeNull();
    expect(suggestTier('harness-planner', '', ['claude-code'])).toBe('C');
    expect(suggestTier('x', '然后 Skill({"skill":"dev"})', ['claude-code'])).toBe('C');
    expect(suggestTier('x', '读 ~/.claude/skills/y', ['claude-code'])).toBe('B');
    expect(suggestTier('x', '用 mcp__notion__search', ['claude-code'])).toBe('B');
    expect(suggestTier('nas', '普通说明', ['claude-code'])).toBe('A');
  });
});

describe('buildRecords', () => {
  const { records, sourcesOk, brokenNames, counts } = buildRecords(inv(), { driftState: drift(), now: Date.now() });
  const by = Object.fromEntries(records.map((r) => [r.name, r]));

  it('同名归一行，前缀去掉', () => {
    expect(Object.keys(by).sort()).toEqual(['alpha', 'beta', 'brainstorming', 'review', 'solo']);
  });
  it('原件优先 repo，OpenClaw 旧副本记漂移', () => {
    expect(by.alpha.source_kind).toBe('repo');
    expect(by.alpha.content_digest).toBe('d1');
    expect(by.alpha.drift_copies).toBe(1);
    expect(by.alpha.platforms_installed).toEqual(['claude-code', 'codex', 'openclaw']);
    expect(by.alpha.description).toBe('甲描述');
  });
  it('OpenClaw 独有 → 原件取在用那份，标 openclaw-workspace，assigned 汇总', () => {
    expect(by.beta.source_kind).toBe('openclaw-workspace');
    expect(by.beta.source_path).toBe('/ws/skills/beta/SKILL.md');
    expect(by.beta.assigned_agents).toEqual(['a']);
    expect(by.beta.platforms_installed).toEqual(['openclaw']);
  });
  it('superpowers：插件缓存路径 → 同时算 claude-code；~/.agents → codex', () => {
    expect(by.brainstorming.platforms_installed).toEqual(['claude-code', 'codex', 'openclaw']);
    expect(by.brainstorming.source_kind).toBe('agents-personal');
  });
  it('Codex：跑场机 codex-gwremote missing 清单里的不算 codex', () => {
    expect(by.solo.platforms_installed).toEqual(['claude-code']);
    expect(by.solo.description).toBe('多行 描述');
  });
  it('跑场机独有（extra）也算在，source_kind=runner-only', () => {
    expect(by.review.source_kind).toBe('runner-only');
    expect(by.review.platforms_installed).toEqual(['claude-code']);
  });
  it('断链、来源健康度、计数', () => {
    expect([...brokenNames]).toEqual(['ghost']);
    expect(sourcesOk).toBe(true);
    expect(counts).toEqual({ claude: 2, agents: 1, openclaw: 3, repo: 1 });
  });
  it('任一来源 fail 或跑场机清单过期 → sourcesOk=false', () => {
    expect(buildRecords(inv({ openclaw: { status: 'fail', error: 'x' } }), { driftState: drift(), now: Date.now() }).sourcesOk).toBe(false);
    const stale = drift({ checked_at: new Date(Date.now() - 4 * 3600e3).toISOString() });
    expect(buildRecords(inv(), { driftState: stale, now: Date.now() }).sourcesOk).toBe(false);
    expect(buildRecords(inv(), { driftState: null, now: Date.now() }).sourcesOk).toBe(false);
  });
  it('missing_total>30（清单被截断）→ 这台不给 codex', () => {
    const d = drift();
    d.machines[0].dirs[1] = { label: 'codex-gwremote', status: 'drift', missing: [], missing_total: 31 };
    const r = buildRecords(inv(), { driftState: d, now: Date.now() }).records.find((x) => x.name === 'solo');
    expect(r.platforms_installed).toEqual(['claude-code']);
  });
});

describe('熔断与缺席判定', () => {
  it('某来源比上轮少 >10% 就熔断', () => {
    expect(trippedSources({ claude: 100, openclaw: 50 }, { claude: 89, openclaw: 50 })).toEqual(['claude']);
    expect(trippedSources({ claude: 100 }, { claude: 91 })).toEqual([]);
    expect(trippedSources(null, { claude: 1 })).toEqual([]);
  });
  const now = Date.parse('2026-09-30T00:00:00Z');
  it('断链 → broken（立即）', () => {
    expect(decideAbsent({ presence: 'present', absent_since: null }, { isBroken: true, canJudge: true, now }))
      .toEqual({ presence: 'broken', absent_since: null });
  });
  it('不能判（来源不全/熔断）→ 原样不动', () => {
    const row = { presence: 'present', absent_since: null };
    expect(decideAbsent(row, { isBroken: false, canJudge: false, now })).toEqual(row);
  });
  it('首次缺席记时间；满 24h 才 gone', () => {
    const first = decideAbsent({ presence: 'present', absent_since: null }, { isBroken: false, canJudge: true, now });
    expect(first).toEqual({ presence: 'present', absent_since: new Date(now).toISOString() });
    const later = decideAbsent({ presence: 'present', absent_since: '2026-09-28T23:00:00Z' }, { isBroken: false, canJudge: true, now });
    expect(later.presence).toBe('gone');
    const early = decideAbsent({ presence: 'unknown', absent_since: '2026-09-29T12:00:00Z' }, { isBroken: false, canJudge: true, now });
    expect(early.presence).toBe('unknown');
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/skill-inventory-reconcile.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3：提交失败测试**

```bash
git add packages/brain/src/lib/__tests__/skill-inventory-reconcile.test.js
git commit -m "test(brain): skill 归并与下线判定纯函数失败测试 (Red)"
```

- [ ] **Step 4：实现** `packages/brain/src/lib/skill-inventory-reconcile.js`

```js
/**
 * skill-inventory-reconcile.js — 三平台采集结果 → skill_registry 机器列（纯函数，Skill 台账投影 PR1a）
 *
 * 判定点（decisions 表）：
 *  11af333b 同名即同一 skill：去 openclaw/ 前缀后按 name 精确相等归一行，内容差异记副本漂移
 *  bc98dda7 原件：zenithjoy-skills 仓库根目录 > OpenClaw 实际加载那份 > ~/.agents/skills > ~/.claude/skills 本地 > 仅跑场机
 *  84972cc1 Codex：复用 skill-dist-drift 的跑场机 codex-gwremote 清单 + mmv ~/.agents/skills
 *  e22aab26 下线：所有来源都成功且跑场机清单新鲜才判缺席；断链立即 broken；缺席满 24h 才 gone；来源骤降 >10% 熔断
 */
export const PLATFORMS = Object.freeze({ CC: 'claude-code', OC: 'openclaw', CODEX: 'codex' });
export const GRACE_MS = 24 * 3600 * 1000;
const DRIFT_FRESH_MS = 3 * 3600 * 1000;
const DEV_CHAIN = /^(dev|plan|code-review-gate|engine-.+|harness-.+|capability.*|decomp.*)$/;
const TIER_C_BODY = /Skill\s*\(|claude -p\b/;
const TIER_B_BODY = /~?\/\.claude\/|\bAgent\s*\(|subagent_type|\bTask\s*\(|mcp__/;
const SOURCE_KIND = {
  'openclaw-workspace': 'openclaw-workspace', 'openclaw-managed': 'openclaw-managed',
  'openclaw-workshop': 'openclaw-workshop', 'agents-skills-personal': 'agents-personal',
};

export function normalizeName(name) {
  return String(name || '').replace(/^openclaw\//, '');
}

export function frontmatterDescription(md) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(md || ''));
  if (!fm) return null;
  const lines = fm[1].split(/\r?\n/);
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i < 0) return null;
  const inline = lines[i].replace(/^description:\s*/, '').trim();
  if (inline && !/^[|>][-+]?$/.test(inline)) return inline.replace(/^["']|["']$/g, '').trim() || null;
  const block = [];
  for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) block.push(lines[j].trim());
  return block.join(' ').trim() || null;
}

export function suggestTier(name, content, platforms) {
  if (platforms.includes(PLATFORMS.OC)) return null;
  const body = String(content || '');
  if (DEV_CHAIN.test(name) || TIER_C_BODY.test(body)) return 'C';
  if (TIER_B_BODY.test(body)) return 'B';
  return 'A';
}

function codexView(driftState, now) {
  const fresh = driftState && driftState.truth?.status === 'ok'
    && Number.isFinite(Date.parse(driftState.checked_at)) && now - Date.parse(driftState.checked_at) <= DRIFT_FRESH_MS;
  if (!fresh) return { fresh: false, codexOk: () => false, runnerExtra: new Set() };
  const codexDirs = [];
  const runnerExtra = new Set();
  for (const m of driftState.machines || []) {
    for (const d of m.dirs || []) {
      if (d.label === 'codex-gwremote' && ['ok', 'drift'].includes(d.status) && (d.missing_total ?? 0) <= 30) {
        codexDirs.push(new Set(d.missing || []));
      }
      if (d.label === 'claude' && Array.isArray(d.extra)) d.extra.forEach((n) => runnerExtra.add(n));
    }
  }
  return { fresh: true, codexOk: (n) => codexDirs.some((missing) => !missing.has(n)), runnerExtra };
}

export function buildRecords(inventory, { driftState = null, now = Date.now() } = {}) {
  const src = inventory?.sources || {};
  const contents = inventory?.contents || {};
  const view = codexView(driftState, now);
  const acc = new Map();
  const get = (name) => {
    const n = normalizeName(name);
    if (!acc.has(n)) acc.set(n, { name: n, platforms: new Set(), copies: [], assigned: new Set(), cands: {} });
    return acc.get(n);
  };
  const ok = (s) => src[s]?.status === 'ok';

  const repoByName = new Map((ok('repo') ? src.repo.items : []).map((i) => [i.name, i]));
  for (const i of ok('claude') ? src.claude.items : []) {
    const r = get(i.name);
    r.platforms.add(PLATFORMS.CC);
    if (view.codexOk(i.name)) r.platforms.add(PLATFORMS.CODEX);
    r.copies.push({ platform: PLATFORMS.CC, path: i.path, digest: i.digest, lines: i.lines });
    if (/\/zenithjoy-skills\//.test(i.real_path || '')) r.cands.repo ??= repoByName.get(i.name) || i;
    else r.cands.claude ??= i;
  }
  for (const i of ok('agents') ? src.agents.items : []) {
    const r = get(i.name);
    r.platforms.add(PLATFORMS.CODEX);
    if (/\/\.claude[^/]*\/plugins\/cache\//.test(i.real_path || '')) r.platforms.add(PLATFORMS.CC);
    r.copies.push({ platform: 'agents', path: i.path, digest: i.digest, lines: i.lines });
    r.cands.agents ??= i;
  }
  for (const i of ok('openclaw') ? src.openclaw.items : []) {
    const r = get(i.name);
    r.platforms.add(PLATFORMS.OC);
    (i.assigned || []).forEach((a) => r.assigned.add(a));
    if (i.source !== 'agents-skills-personal') {
      r.copies.push({ platform: PLATFORMS.OC, path: i.path, digest: i.digest, lines: i.lines, agents: i.agents || [] });
      r.cands.openclaw ??= i;
    }
    r.ocKind ??= SOURCE_KIND[i.source];
  }
  for (const n of view.runnerExtra) {
    if (acc.has(n)) continue;
    const r = get(n);
    r.platforms.add(PLATFORMS.CC);
    r.runnerOnly = true;
  }

  const records = [...acc.values()].map((r) => {
    const [kind, canon] = r.cands.repo ? ['repo', r.cands.repo]
      : r.cands.openclaw ? [r.ocKind || 'openclaw-workspace', r.cands.openclaw]
      : r.cands.agents ? ['agents-personal', r.cands.agents]
      : r.cands.claude ? ['claude-local', r.cands.claude]
      : ['runner-only', null];
    const platforms = [...r.platforms].sort();
    const content = canon ? contents[canon.digest] ?? null : null;
    return {
      name: r.name,
      description: content ? frontmatterDescription(content) : null,
      platforms_installed: platforms,
      source_kind: kind,
      source_path: canon ? canon.path : null,
      content_md: content,
      content_digest: canon ? canon.digest : null,
      copies: r.copies,
      drift_copies: canon ? r.copies.filter((c) => c.digest !== canon.digest).length : 0,
      files: canon ? canon.files || [] : [],
      assigned_agents: [...r.assigned].sort(),
      tier_suggested: suggestTier(r.name, content, platforms),
    };
  });

  const brokenNames = new Set([...(ok('claude') ? src.claude.broken : []), ...(ok('agents') ? src.agents.broken : [])]
    .map(normalizeName).filter((n) => !acc.has(n)));
  const counts = Object.fromEntries(['claude', 'agents', 'openclaw', 'repo']
    .map((s) => [s, ok(s) ? src[s].items.length : null]));
  const sourcesOk = ['claude', 'agents', 'openclaw', 'repo'].every(ok) && view.fresh;
  return { records, sourcesOk, brokenNames, counts };
}

export function trippedSources(prevCounts, counts, ratio = 0.1) {
  if (!prevCounts) return [];
  return Object.keys(counts).filter((k) => Number.isFinite(prevCounts[k]) && prevCounts[k] > 0
    && Number.isFinite(counts[k]) && counts[k] < prevCounts[k] * (1 - ratio));
}

export function decideAbsent(row, { isBroken, canJudge, now, graceMs = GRACE_MS }) {
  if (isBroken) return { presence: 'broken', absent_since: null };
  if (!canJudge) return { presence: row.presence, absent_since: row.absent_since ?? null };
  const since = row.absent_since ? Date.parse(row.absent_since) : NaN;
  if (!Number.isFinite(since)) return { presence: row.presence, absent_since: new Date(now).toISOString() };
  if (now - since >= graceMs) return { presence: 'gone', absent_since: new Date(since).toISOString() };
  return { presence: row.presence, absent_since: new Date(since).toISOString() };
}
```

Note: the `later` case in the test passes `'2026-09-28T23:00:00Z'` and only asserts `presence`; the returned `absent_since` is a normalized ISO string. `brokenNames` only counts a broken link as broken when no copy with the same name was found anywhere else.

- [ ] **Step 5：跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/skill-inventory-reconcile.test.js`
Expected: PASS

- [ ] **Step 6：提交**

```bash
git add packages/brain/src/lib/skill-inventory-reconcile.js
git commit -m "feat(brain): skill 采集归并与下线判定（原件优先级/Codex 口径/24h 缺席/熔断）"
```

---

### Task 4：扫描任务 `skill-inventory-sync.js` + 调度注册

**Files:**
- Create: `packages/brain/src/skill-inventory-sync.js`
- Modify: `packages/brain/src/scheduler-jobs.js`（import，并在 `skill-dist-drift` 之后插入 job）
- Modify: `packages/brain/src/__tests__/scheduler-jobs.test.js`（vi.mock 新模块，加注册用例）
- Test: `packages/brain/src/__tests__/skill-inventory-sync.test.js`（假 pool 验编排）
- Test: `packages/brain/src/__tests__/integration/skill-inventory-sync.integration.test.js`（真库入库语义）

**Interfaces:**
- Consumes：
  - Task 2 的 `buildRemoteProgram`、`buildRemoteShell`
  - Task 3 的 `buildRecords`、`trippedSources`、`decideAbsent`
  - `host-exec.js` 的 `defaultExecAsync`、`buildHostCmd`
- Produces：
  - `INVENTORY_STATE_KEY = 'skill_inventory_state'`
  - `SCAN_INTERVAL_MS = 2 * 3600 * 1000`
  - `buildInventoryCmd({ program, inContainer, keyExistsFn }): string`
  - `runSkillInventorySync(pool, opts?) → Promise<{ skipped?, reason?, ok?, error?, upserted?, marked? }>`
  - `opts`：`{ exec, now, force, inContainer, keyExistsFn, programOpts }`
  - working_memory `skill_inventory_state` 的值：

```
{ started_at, finished_at, last_ok_at?, last_error?, sources: {claude,agents,openclaw,repo: {status, count, error?}},
  counts, last_ok_counts?, tripped: string[], upserted, marked }
```

    Task 5 读 `last_ok_at`。

- [ ] **Step 1：写失败测试（编排，假 pool）** `src/__tests__/skill-inventory-sync.test.js`

```js
/**
 * skill-inventory-sync 编排：锁 / 间隔 / 开跑即写 started_at / ssh 失败不动行 / 命令构造。
 * 入库语义（人管列不碰、没变化不写 updated_at、缺席 24h）见 integration/skill-inventory-sync.integration.test.js。
 */
import { describe, it, expect, vi } from 'vitest';
import { runSkillInventorySync, buildInventoryCmd, INVENTORY_STATE_KEY } from '../skill-inventory-sync.js';

function fakePool({ locked = true, state = null } = {}) {
  const calls = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked }] };
      if (/SELECT value_json FROM working_memory/.test(sql)) {
        if (params?.[0] === INVENTORY_STATE_KEY) return { rows: state ? [{ value_json: state }] : [] };
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => client), query: client.query }, calls, client };
}

describe('runSkillInventorySync', () => {
  it('拿不到 advisory lock → 跳过且释放连接', async () => {
    const { pool, client } = fakePool({ locked: false });
    const r = await runSkillInventorySync(pool, { exec: vi.fn() });
    expect(r).toEqual({ skipped: true, reason: 'locked' });
    expect(client.release).toHaveBeenCalled();
  });

  it('2h 内跑过 → interval_gate，不执行 ssh', async () => {
    const now = Date.now();
    const { pool } = fakePool({ state: { started_at: new Date(now - 30 * 60e3).toISOString() } });
    const exec = vi.fn();
    const r = await runSkillInventorySync(pool, { exec, now });
    expect(r).toEqual({ skipped: true, reason: 'interval_gate' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('开跑先写 started_at；ssh 失败只记 last_error、不碰 skill_registry、解锁', async () => {
    const { pool, calls, client } = fakePool();
    const exec = vi.fn(async () => { throw Object.assign(new Error('ssh: timeout'), { killed: true }); });
    const r = await runSkillInventorySync(pool, { exec, now: Date.now(), inContainer: false });
    expect(r.ok).toBe(false);
    const writes = calls.filter((c) => /INSERT INTO working_memory/.test(c.sql));
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(writes[0].params[1]).started_at).toBeTruthy();
    expect(JSON.parse(writes.at(-1).params[1]).last_error).toMatch(/timeout/);
    expect(calls.some((c) => /skill_registry/.test(c.sql))).toBe(false);
    expect(calls.some((c) => /pg_advisory_unlock/.test(c.sql))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it('exec 显式传 170s 超时', async () => {
    const { pool } = fakePool();
    const exec = vi.fn(async () => '{"ok":false,"error":"x"}');
    await runSkillInventorySync(pool, { exec, now: Date.now(), inContainer: false });
    expect(exec.mock.calls[0][1]).toEqual({ timeoutMs: 170_000 });
  });
});

describe('buildInventoryCmd', () => {
  it('宿主直跑：ssh mmv + 单引号包裹远端 shell', () => {
    const cmd = buildInventoryCmd({ program: 'console.log(1)', inContainer: false });
    expect(cmd).toMatch(/^ssh -o BatchMode=yes -o ConnectTimeout=10 mmv 'export PATH=/);
  });
  it('容器内：外层再包宿主逃逸 ssh', () => {
    const cmd = buildInventoryCmd({ program: 'console.log(1)', inContainer: true, keyExistsFn: () => true });
    expect(cmd).toMatch(/^ssh -i .* administrator@host\.docker\.internal /);
  });
});
```

- [ ] **Step 2：写失败测试（真库）** `src/__tests__/integration/skill-inventory-sync.integration.test.js`

```js
/**
 * skill-inventory-sync 真库入库语义（cecelia_test）：
 *  新 skill 入账；已有行只更机器列；人管列与 status 不碰；没变化不写 updated_at；
 *  断链 → broken；来源不全不判缺席；缺席满 24h → gone。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { runSkillInventorySync, INVENTORY_STATE_KEY } from '../../skill-inventory-sync.js';

let pool;
const T = '__skinv_it_';
beforeAll(async () => { pool = (await import('../../db.js')).default; });
afterEach(async () => {
  await pool.query(`DELETE FROM skill_registry WHERE name LIKE '${T}%'`);
  await pool.query(`DELETE FROM working_memory WHERE key IN ($1, 'skill_manifest_drift')`, [INVENTORY_STATE_KEY]);
  // 来源齐全时扫描会对库里所有未扫到的行判缺席（含迁移 470 回填的派发行）——复位，免得污染同库其它集成测试
  await pool.query(`UPDATE skill_registry SET presence = 'unknown', absent_since = NULL, last_scanned_at = NULL
                     WHERE presence <> 'unknown' OR absent_since IS NOT NULL`);
});

const item = (name, digest) => ({ name, path: `/h/.claude/skills/${name}/SKILL.md`, real_path: `/h/.claude/skills/${name}/SKILL.md`, digest, lines: 2, truncated: false, files: ['SKILL.md'] });
const inventory = ({ names = [`${T}a`], broken = [], ocStatus = 'ok' } = {}) => ({
  ok: true, contents: { dA: '---\ndescription: 新描述\n---\n' },
  sources: {
    claude: { status: 'ok', items: names.map((n) => item(n, 'dA')), broken },
    agents: { status: 'ok', items: [], broken: [] },
    repo: { status: 'ok', items: [] },
    openclaw: ocStatus === 'ok' ? { status: 'ok', items: [] } : { status: 'fail', error: 'x' },
  },
});
async function seedDrift(now) {
  await pool.query(`INSERT INTO working_memory (key, value_json, updated_at) VALUES ('skill_manifest_drift', $1, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $1`, [JSON.stringify({ checked_at: new Date(now).toISOString(), truth: { status: 'ok' }, machines: [] })]);
}
const run = (inv, now) => runSkillInventorySync(pool, { force: true, now, inContainer: false, exec: async () => JSON.stringify(inv) });

describe('skill-inventory-sync 真库', () => {
  it('新 skill 入账 present；已有行人管列/status 不碰；没变化不动 updated_at', async () => {
    const now = Date.now();
    await seedDrift(now);
    await pool.query(`INSERT INTO skill_registry (name, status, note, owner, description) VALUES ($1, 'deprecated', '人写的', 'alex', '旧描述')`, [`${T}a`]);
    const r = await run(inventory(), now);
    expect(r.ok).toBe(true);
    const { rows: [a] } = await pool.query(`SELECT * FROM skill_registry WHERE name=$1`, [`${T}a`]);
    expect(a.presence).toBe('present');
    expect(a.platforms_installed).toEqual(['claude-code']);
    expect(a.description).toBe('新描述');
    expect(a.status).toBe('deprecated');
    expect(a.note).toBe('人写的');
    expect(a.owner).toBe('alex');
    await run(inventory(), now + 1000);
    const { rows: [a2] } = await pool.query(`SELECT updated_at, last_seen_at FROM skill_registry WHERE name=$1`, [`${T}a`]);
    expect(a2.updated_at.getTime()).toBe(a.updated_at.getTime());
    expect(a2.last_seen_at.getTime()).toBeGreaterThan(a.last_seen_at.getTime());
  });

  it('断链 → broken；来源不全不判缺席；缺席满 24h → gone', async () => {
    const t0 = Date.parse('2026-09-30T00:00:00Z');
    await seedDrift(t0);
    await pool.query(`INSERT INTO skill_registry (name, presence) VALUES ($1,'present'), ($2,'present')`, [`${T}ghost`, `${T}old`]);
    await run(inventory({ broken: [`${T}ghost`], ocStatus: 'fail' }), t0);
    let { rows } = await pool.query(`SELECT name, presence, absent_since FROM skill_registry WHERE name IN ($1,$2) ORDER BY name`, [`${T}ghost`, `${T}old`]);
    expect(rows.find((x) => x.name === `${T}ghost`).presence).toBe('broken');
    expect(rows.find((x) => x.name === `${T}old`).absent_since).toBeNull();
    await run(inventory(), t0);
    await seedDrift(t0 + 25 * 3600e3);
    await run(inventory(), t0 + 25 * 3600e3);
    ({ rows } = await pool.query(`SELECT presence FROM skill_registry WHERE name=$1`, [`${T}old`]));
    expect(rows[0].presence).toBe('gone');
  });
});
```

- [ ] **Step 3：调度注册测试** — 在 `src/__tests__/scheduler-jobs.test.js` 里：
  - 紧挨 `vi.mock('../skill-dist-drift.js'…` 之后加 mock；
  - 在 `recurring-tasks` 注册用例之后加注册用例。

```js
// skill-inventory-sync 真实 handler 会 ssh 到 MMV 跑采集程序——单测绝不真发 ssh；行为由 skill-inventory-sync.test.js 与 integration 覆盖。
vi.mock('../skill-inventory-sync.js', () => ({
  runSkillInventorySync: vi.fn().mockResolvedValue({ skipped: true, reason: 'interval_gate' }),
}));
```

```js
  it('JOBS 注册了 skill-inventory-sync（needsPool、200s 超时、在 skill-dist-drift 之后且在 scheduler-liveness 之前、handler 真接线）', async () => {
    const names = JOBS.map((j) => j.name);
    const j = JOBS.find((x) => x.name === 'skill-inventory-sync');
    expect(j).toBeTruthy();
    expect(j.needsPool).toBe(true);
    expect(j.timeoutMs).toBe(200_000);
    expect(names.indexOf('skill-inventory-sync')).toBeGreaterThan(names.indexOf('skill-dist-drift'));
    expect(names.indexOf('skill-inventory-sync')).toBeLessThan(names.indexOf('scheduler-liveness'));
    const { runSkillInventorySync } = await import('../skill-inventory-sync.js');
    await runSchedulerJobsOnce(pool, [j]);
    expect(runSkillInventorySync).toHaveBeenCalled();
  });
```

（`pool` 用这个测试文件里已有的变量；如果文件里没有同名 pool，照 script-reaper 用例的写法取。）

- [ ] **Step 4：跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/skill-inventory-sync.test.js src/__tests__/scheduler-jobs.test.js`
Expected: FAIL（模块不存在，也没有这个 job）

- [ ] **Step 5：提交失败测试**

```bash
git add packages/brain/src/__tests__/skill-inventory-sync.test.js packages/brain/src/__tests__/integration/skill-inventory-sync.integration.test.js packages/brain/src/__tests__/scheduler-jobs.test.js
git commit -m "test(brain): skill-inventory-sync 编排/真库入库/调度注册失败测试 (Red)"
```

- [ ] **Step 6：实现** `packages/brain/src/skill-inventory-sync.js`

```js
/**
 * skill-inventory-sync.js — 三平台 skill 扫描入账（Skill 台账投影 PR1a，任务 47def5bb，F5 指挥舱 f20ec1cb）
 *
 * 每 2h：经 ssh mmv 执行自包含采集程序（lib/skill-inventory-remote.js）→ 归并判定（lib/skill-inventory-reconcile.js）
 * → 事务内写 skill_registry 机器列与 presence。人管列与 status 一律不碰（列级分权，决策 19391396）。
 *
 * 纪律：
 *  - us-vps 零执行：Brain 只送程序、读 JSON，不在本机扫任何东西。
 *  - 防重入：pg_try_advisory_lock（专用连接）+ 开跑即写 started_at（scheduler 超时不取消执行，gate 必须先落）。
 *  - 探不到 ≠ 零个：ssh 失败/输出不合法 → 只记 last_error 不动行；来源 fail / 跑场机清单过期 / 骤降熔断 → 不判缺席。
 *  - 没变化不写：upsert 带 IS DISTINCT FROM，updated_at 不动（推送按 updated_at 排序，防抖动）；last_seen_at 单独批量刷。
 */
import { existsSync } from 'fs';
import { defaultExecAsync, buildHostCmd } from './host-exec.js';
import { buildRemoteProgram, buildRemoteShell } from './lib/skill-inventory-remote.js';
import { buildRecords, trippedSources, decideAbsent } from './lib/skill-inventory-reconcile.js';

export const INVENTORY_STATE_KEY = 'skill_inventory_state';
export const SCAN_INTERVAL_MS = 2 * 3600 * 1000;
export const EXEC_TIMEOUT_MS = 170_000;
const LOCK_ID = 491001;
const SSH = 'ssh -o BatchMode=yes -o ConnectTimeout=10';
const MACHINE_COLS = ['description', 'platforms_installed', 'source_path', 'source_kind', 'assigned_agents',
  'content_md', 'content_digest', 'copies', 'drift_copies', 'files', 'tier_suggested'];

export function buildInventoryCmd({ program, inContainer, keyExistsFn }) {
  const remote = buildRemoteShell(program);
  return buildHostCmd(`${SSH} mmv '${remote}'`, inContainer, keyExistsFn);
}

async function readJson(q, key) {
  const { rows } = await q.query('SELECT value_json FROM working_memory WHERE key = $1', [key]);
  let v = rows?.[0]?.value_json;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return v && typeof v === 'object' ? v : null;
}

async function writeState(q, state) {
  await q.query(
    `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [INVENTORY_STATE_KEY, JSON.stringify(state)],
  );
}

const briefError = (err) => String(err?.stderr || err?.message || err).split('\n').find((l) => l.trim() && !l.startsWith('Command failed'))?.slice(0, 200) || 'exec failed';

async function upsertRecord(c, r, nowIso) {
  const vals = [r.name, r.description, r.platforms_installed, r.source_path, r.source_kind, r.assigned_agents,
    r.content_md, r.content_digest, JSON.stringify(r.copies), r.drift_copies, r.files, r.tier_suggested, nowIso];
  const set = MACHINE_COLS.map((col) => (col === 'description'
    ? 'description = COALESCE(EXCLUDED.description, skill_registry.description)'
    : `${col} = EXCLUDED.${col}`)).join(', ');
  const cur = MACHINE_COLS.map((col) => `skill_registry.${col}`).join(', ');
  const next = MACHINE_COLS.map((col) => (col === 'description'
    ? 'COALESCE(EXCLUDED.description, skill_registry.description)' : `EXCLUDED.${col}`)).join(', ');
  const { rowCount } = await c.query(
    `INSERT INTO skill_registry (name, description, location, status, presence, platforms_installed, source_path, source_kind,
       assigned_agents, content_md, content_digest, copies, drift_copies, files, tier_suggested, last_seen_at, last_scanned_at)
     VALUES ($1, $2, $5, 'active', 'present', $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $13)
     ON CONFLICT (name) DO UPDATE SET ${set}, presence = 'present', absent_since = NULL, updated_at = NOW()
     WHERE (${cur}, skill_registry.presence, skill_registry.absent_since)
       IS DISTINCT FROM (${next}, 'present'::text, NULL::timestamptz)`,
    vals,
  );
  return rowCount;
}

async function markAbsent(c, { brokenNames, canJudge, now, seen }) {
  const { rows } = await c.query(
    `SELECT name, presence, absent_since FROM skill_registry WHERE NOT (name = ANY($1::text[])) AND presence <> 'gone'`, [seen]);
  let marked = 0;
  for (const row of rows) {
    const next = decideAbsent(
      { presence: row.presence, absent_since: row.absent_since ? new Date(row.absent_since).toISOString() : null },
      { isBroken: brokenNames.has(row.name), canJudge, now },
    );
    const prevSince = row.absent_since ? new Date(row.absent_since).toISOString() : null;
    if (next.presence === row.presence && next.absent_since === prevSince) continue;
    const bump = next.presence !== row.presence ? ', updated_at = NOW()' : '';
    await c.query(
      `UPDATE skill_registry SET presence = $2, absent_since = $3, last_scanned_at = $4${bump} WHERE name = $1`,
      [row.name, next.presence, next.absent_since, new Date(now).toISOString()],
    );
    marked++;
  }
  return marked;
}

/**
 * scheduler-jobs handler（needsPool:true）。自 gate 2h；调度轮 60s 都会调用。
 * @param {import('pg').Pool} pool
 * @param {object} [opts] 供测试注入：exec / now / force / inContainer / keyExistsFn / programOpts
 */
export async function runSkillInventorySync(pool, opts = {}) {
  const { exec = defaultExecAsync, now = Date.now(), force = false, keyExistsFn, programOpts = {} } = opts;
  const inContainer = opts.inContainer ?? existsSync('/.dockerenv');
  const client = await pool.connect();
  let locked = false;
  try {
    locked = Boolean((await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_ID])).rows?.[0]?.locked);
    if (!locked) return { skipped: true, reason: 'locked' };
    const prev = (await readJson(client, INVENTORY_STATE_KEY)) || {};
    const last = Date.parse(prev.started_at);
    if (!force && Number.isFinite(last) && now - last < SCAN_INTERVAL_MS) return { skipped: true, reason: 'interval_gate' };
    const state = { ...prev, started_at: new Date(now).toISOString(), last_error: null };
    await writeState(client, state);

    let inventory;
    try {
      const raw = await exec(buildInventoryCmd({ program: buildRemoteProgram(programOpts), inContainer, keyExistsFn }), { timeoutMs: EXEC_TIMEOUT_MS });
      inventory = JSON.parse(raw);
      if (!inventory?.ok) throw new Error(`remote: ${inventory?.error || 'not ok'}`);
    } catch (err) {
      const error = briefError(err);
      await writeState(client, { ...state, finished_at: new Date().toISOString(), last_error: error });
      console.warn(`[skill-inventory-sync] 采集失败（未核对，不动任何行）：${error}`);
      return { ok: false, error };
    }

    const driftState = await readJson(client, 'skill_manifest_drift');
    const { records, sourcesOk, brokenNames, counts } = buildRecords(inventory, { driftState, now });
    const tripped = trippedSources(prev.last_ok_counts, counts);
    const canJudge = sourcesOk && tripped.length === 0;
    const nowIso = new Date(now).toISOString();
    let upserted = 0;
    let marked = 0;
    await client.query('BEGIN');
    try {
      for (const r of records) upserted += await upsertRecord(client, r, nowIso);
      const seen = records.map((r) => r.name);
      await client.query('UPDATE skill_registry SET last_seen_at = $2, last_scanned_at = $2 WHERE name = ANY($1::text[])', [seen, nowIso]);
      marked = await markAbsent(client, { brokenNames, canJudge, now, seen });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    const sources = Object.fromEntries(Object.entries(inventory.sources || {})
      .map(([k, v]) => [k, { status: v?.status, count: counts[k], ...(v?.error ? { error: String(v.error).slice(0, 200) } : {}) }]));
    await writeState(client, {
      ...state, finished_at: new Date().toISOString(), sources, counts, tripped, upserted, marked,
      ...(sourcesOk ? { last_ok_at: nowIso, last_ok_counts: counts } : {}),
    });
    if (!canJudge) console.warn(`[skill-inventory-sync] 本轮不判缺席：来源齐=${sourcesOk} 熔断=${tripped.join(',') || '-'}`);
    return { ok: true, upserted, marked, sourcesOk, tripped };
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}
```

- [ ] **Step 7：注册 job**，改 `packages/brain/src/scheduler-jobs.js`：
  - 在 import 区 `runSkillDistDrift` 那一行附近加：`import { runSkillInventorySync } from './skill-inventory-sync.js';`
  - 在 JOBS 里紧跟 `skill-dist-drift` 那一项之后插入：

```js
  { name: 'skill-inventory-sync', needsPool: true, timeoutMs: 200_000, livenessIntervalSec: 60, handler: (pool) => runSkillInventorySync(pool), description: 'skill 三平台扫描入账（Skill 台账投影 PR1a，任务 47def5bb，决策 19391396）：2h 自 gate + advisory lock，经 ssh mmv 送自包含 node 采集程序扫 ~/.claude/skills、OpenClaw 各 agent 实际加载、~/.agents/skills、zenithjoy-skills 仓库，归并写 skill_registry 机器列与 presence（人管列/status 不碰）；探不到≠零个：来源 fail/跑场机清单过期/骤降>10% 熔断时不判缺席，缺席满 24h 才 gone，断链即 broken' },
```

- [ ] **Step 8：跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/skill-inventory-sync.test.js src/__tests__/scheduler-jobs.test.js`
Expected: PASS
Run: `cd packages/brain && DB_NAME=cecelia_test npx vitest run -c vitest.integration.config.js src/__tests__/integration/skill-inventory-sync.integration.test.js`
Expected: PASS

- [ ] **Step 9：提交**

```bash
git add packages/brain/src/skill-inventory-sync.js packages/brain/src/scheduler-jobs.js
git commit -m "feat(brain): skill-inventory-sync 三平台扫描入账 job（2h gate + advisory lock + 探不到不判缺席）"
```

---

### Task 5：A6 改口径 `skill-ledger-assertion.js`

**Files:**
- Create: `packages/brain/src/lib/skill-ledger-assertion.js`
- Modify: `packages/brain/src/promise-map-nightly.js:201-243`（把 A6 块换成调用）
- Modify: `packages/brain/src/__tests__/promise-map-nightly.test.js`（N14/N15 迁到新口径）
- Modify: `packages/brain/src/__tests__/integration/promise-map-nightly.integration.test.js`（⑥ 迁到新口径）
- Modify: `packages/brain/scripts/smoke/skill-ledger-reconcile-smoke.sh`（第 2 段迁到新口径）
- Test: `packages/brain/src/lib/__tests__/skill-ledger-assertion.test.js`

**Interfaces:**
- Consumes：working_memory `skill_inventory_state.last_ok_at`（Task 4）
- Produces：`buildSkillLedgerAssertion(queryPool) → Promise<{ key:'skill_ledger_consistency', label, ok, degraded?, detail }>`

- [ ] **Step 1：写失败测试** `src/lib/__tests__/skill-ledger-assertion.test.js`

```js
/**
 * A6 新口径（Skill 台账投影 PR1a）：
 *  ① ops_skills(openclaw) 名字 ⊆ skill_registry presence=present
 *  ② 带 task_types 的派发绑定行不得 gone/broken
 *  扫描从未成功 → ok+degraded；红时始终 upsert 一条 __skill_ledger_count__ 汇总行
 */
import { describe, it, expect, vi } from 'vitest';
import { buildSkillLedgerAssertion } from '../skill-ledger-assertion.js';

function pool({ state = { last_ok_at: '2026-09-30T00:00:00Z' }, unregistered = [], deadBound = [] } = {}) {
  const writes = [];
  return {
    writes,
    query: vi.fn(async (sql, params) => {
      if (sql.includes("key = 'skill_inventory_state'")) return { rows: state ? [{ value_json: state }] : [] };
      if (sql.includes('FROM ops_skills')) return { rows: unregistered.map((name) => ({ name })) };
      if (sql.includes('task_types')) return { rows: deadBound };
      if (sql.includes('INSERT INTO skill_drift_alerts')) { writes.push(params); return { rows: [] }; }
      return { rows: [] };
    }),
  };
}

describe('buildSkillLedgerAssertion', () => {
  it('扫描从未成功 → ok + degraded，不查账不落账', async () => {
    const p = pool({ state: null });
    const a = await buildSkillLedgerAssertion(p);
    expect(a).toMatchObject({ key: 'skill_ledger_consistency', ok: true, degraded: true });
    expect(p.writes).toEqual([]);
  });

  it('两项都干净 → ok', async () => {
    const a = await buildSkillLedgerAssertion(pool());
    expect(a.ok).toBe(true);
    expect(a.degraded).toBeFalsy();
  });

  it('① ops_skills 引用了账本里不在的 skill → 红，点名，落汇总行', async () => {
    const p = pool({ unregistered: ['ghost-skill'] });
    const a = await buildSkillLedgerAssertion(p);
    expect(a.ok).toBe(false);
    expect(a.detail).toMatch(/账实分叉/);
    expect(a.detail).toContain('ghost-skill');
    expect(p.writes).toHaveLength(1);
    expect(p.writes[0][0]).toBe('__skill_ledger_count__');
  });

  it('② 派发绑定行指向已下线/断链 skill → 红，点名带状态', async () => {
    const p = pool({ deadBound: [{ name: 'prd-review', presence: 'broken' }] });
    const a = await buildSkillLedgerAssertion(p);
    expect(a.ok).toBe(false);
    expect(a.detail).toContain('prd-review(broken)');
  });
});
```

- [ ] **Step 2：迁移 promise-map-nightly 单测 N14/N15**

把 `src/__tests__/promise-map-nightly.test.js` 里 `[S4-N14]` 和 `[S4-N15]` 两个 describe 整块换成下面这段（这是迁移，不是删除：N15 仍然要求亲眼看它报红）：

```js
// ── [S4-N14/N15] A6 skill 账本一致性（新口径：ops_skills ⊆ present + 派发绑定行健康，PR1a 任务 47def5bb）──
function a6Pool({ unregistered = [], deadBound = [] } = {}) {
  const writes = [];
  const q = vi.fn(async (sql, params) => {
    if (typeof sql !== 'string') return { rows: [] };
    if (sql.includes('INSERT INTO skill_drift_alerts')) { writes.push({ sql, params }); return { rows: [] }; }
    if (sql.includes("key = 'skill_inventory_state'")) return { rows: [{ value_json: { last_ok_at: '2026-09-30T00:00:00Z' } }] };
    if (sql.includes('FROM ops_skills')) return { rows: unregistered.map((name) => ({ name })) };
    if (sql.includes('task_types') && sql.includes('presence')) return { rows: deadBound };
    if (sql.includes('fact_snapshot_headers')) return { rows: [{ repo: 'cecelia', kind: 'api', age_hours: '1' }] };
    if (sql.includes('COUNT(*)')) return { rows: [{ count: '0' }] };
    return { rows: [] };
  });
  return { pool: makePool(q), writes };
}

describe('[S4-N14] A6 账本一致 → pass', () => {
  it('ops_skills 全在账且派发绑定行健康 → A6 pass', async () => {
    const { pool } = a6Pool();
    const a6 = (await buildNightlyAssertions(pool)).find((a) => a.key === 'skill_ledger_consistency');
    expect(a6).toBeTruthy();
    expect(a6.ok).toBe(true);
  });
});

describe('[S4-N15] A6 账实分叉 → fail 且写 skill_drift_alerts', () => {
  it('ops_skills 引用未入账 skill + 派发绑定行 gone → A6 fail、点名、落汇总行', async () => {
    const { pool, writes } = a6Pool({ unregistered: ['zz-missing'], deadBound: [{ name: 'dev', presence: 'gone' }] });
    const a6 = (await buildNightlyAssertions(pool)).find((a) => a.key === 'skill_ledger_consistency');
    expect(a6.ok).toBe(false);
    expect(a6.detail).toContain('zz-missing');
    expect(a6.detail).toContain('dev(gone)');
    expect(writes.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3：迁移 integration ⑥**

把 `src/__tests__/integration/promise-map-nightly.integration.test.js` 里 `proven-to-fire ⑥` 的用例体换成：

```js
  it('proven-to-fire ⑥：ops_skills 引用未入账 skill、派发绑定行已下线 → A6 报红且落 skill_drift_alerts', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ops_skills WHERE source='openclaw'`);
      await client.query(`INSERT INTO working_memory (key, value_json, updated_at) VALUES ('skill_inventory_state', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $1`, [JSON.stringify({ last_ok_at: new Date().toISOString() })]);
      await client.query(`INSERT INTO ops_skills (source, name, used_by) VALUES ('openclaw','__drift_probe__','[]'::jsonb)`);
      await client.query(`INSERT INTO skill_registry (name, status, presence, task_types)
        VALUES ('__dead_bound_probe__','active','gone',ARRAY['__probe_type__'])`);
      const results = await buildNightlyAssertions(client);
      const a6 = results.find(r => r.key === 'skill_ledger_consistency');
      expect(a6.ok).toBe(false);
      expect(a6.detail).toMatch(/账实分叉/);
      expect(a6.detail).toContain('__drift_probe__');
      expect(a6.detail).toContain('__dead_bound_probe__(gone)');
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM skill_drift_alerts
          WHERE skill_name='__skill_ledger_count__' AND drift_date=CURRENT_DATE`);
      expect(rows[0].n).toBeGreaterThan(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
```

「首跑全绿」用例：在 BEGIN 之后加一句 `await client.query(`DELETE FROM working_memory WHERE key='skill_inventory_state'`);`，确保新口径在「扫描从未成功」时走降级绿。

- [ ] **Step 4：跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/skill-ledger-assertion.test.js src/__tests__/promise-map-nightly.test.js`
Expected: FAIL（新 lib 不存在；N15 断言 `zz-missing` 失败）

- [ ] **Step 5：提交失败测试**

```bash
git add packages/brain/src/lib/__tests__/skill-ledger-assertion.test.js packages/brain/src/__tests__/promise-map-nightly.test.js packages/brain/src/__tests__/integration/promise-map-nightly.integration.test.js
git commit -m "test(brain): A6 新口径（ops_skills ⊆ present + 派发绑定行健康）失败测试，迁移 N14/N15/⑥ (Red)"
```

- [ ] **Step 6：实现** `packages/brain/src/lib/skill-ledger-assertion.js`

```js
/**
 * skill-ledger-assertion.js — MJ5 守夜 A6「skill 账本一致性」新口径（Skill 台账投影 PR1a，任务 47def5bb）
 *
 * 旧口径只比 skill_registry(openclaw) 与 ops_skills(openclaw) 两个行数（09-16 thin 版）。
 * 扫描入账（skill-inventory-sync）上线后，账本知道每个 skill 在不在，改比名单：
 *  ① ops_skills(openclaw)——clawdbot.json 里 agent 白名单引用的 skill——必须都在账本且 presence=present；
 *     不在 = agent 引用了一个不存在的 skill（真断链）。
 *  ② 带 task_types 的派发绑定行不得 gone/broken——否则派发会指向不存在的 skill。
 * 扫描从未成功过 → ok+degraded（与 A7~A10 无 token 降级同惯例），不猜。
 * 只要红就 upsert 一条 __skill_ledger_count__ 汇总行（UNIQUE(skill_name,drift_date) 幂等），名单只进 detail。
 * Notion 行数对账（A10 因 Skill Registry 改入口面而让出）由 PR1b 推送任务接上。
 */
export const SKILL_LEDGER_KEY = 'skill_ledger_consistency';
const LABEL = 'skill 账本一致性';
const SHOW = 8;

export async function buildSkillLedgerAssertion(q) {
  const st = await q.query(`SELECT value_json FROM working_memory WHERE key = 'skill_inventory_state'`);
  let state = st?.rows?.[0]?.value_json;
  if (typeof state === 'string') { try { state = JSON.parse(state); } catch { state = null; } }
  if (!state?.last_ok_at) {
    return { key: SKILL_LEDGER_KEY, label: LABEL, ok: true, degraded: true, detail: 'skill 扫描（skill-inventory-sync）尚未成功跑过，账本一致性暂不判' };
  }

  const unregistered = (await q.query(
    `SELECT o.name FROM ops_skills o
      WHERE o.source = 'openclaw'
        AND NOT EXISTS (SELECT 1 FROM skill_registry r
                         WHERE r.name = regexp_replace(o.name, '^openclaw/', '') AND r.presence = 'present')
      ORDER BY o.name`)).rows.map((r) => r.name);
  const deadBound = (await q.query(
    `SELECT name, presence FROM skill_registry
      WHERE task_types <> '{}' AND presence IN ('gone', 'broken') ORDER BY name`)).rows;

  const ok = unregistered.length === 0 && deadBound.length === 0;
  if (ok) {
    return { key: SKILL_LEDGER_KEY, label: LABEL, ok: true, detail: 'ops_skills 引用的 skill 全部在账且在用；派发绑定行无下线/断链' };
  }
  await q.query(
    `INSERT INTO skill_drift_alerts (skill_name, ssot_version, snapshot_version, drift_date)
     VALUES ($1, $2, $3, CURRENT_DATE)
     ON CONFLICT (skill_name, drift_date)
     DO UPDATE SET ssot_version = EXCLUDED.ssot_version, snapshot_version = EXCLUDED.snapshot_version, detected_at = NOW()`,
    ['__skill_ledger_count__', `ops引用未入账=${unregistered.length}`, `派发绑定失效=${deadBound.length}`],
  ).catch(() => {});
  const parts = [];
  if (unregistered.length) parts.push(`ops_skills 引用但账本不在/非在用 ${unregistered.length} 个：${unregistered.slice(0, SHOW).join('、')}${unregistered.length > SHOW ? '…' : ''}`);
  if (deadBound.length) parts.push(`派发绑定指向已下线/断链 ${deadBound.length} 个：${deadBound.slice(0, SHOW).map((r) => `${r.name}(${r.presence})`).join('、')}`);
  return { key: SKILL_LEDGER_KEY, label: LABEL, ok: false, detail: `账实分叉：${parts.join('；')}；已记入 skill_drift_alerts` };
}
```

- [ ] **Step 7：替换 promise-map-nightly 里的 A6 块**

在 `packages/brain/src/promise-map-nightly.js` 顶部 import 区加：

```js
import { buildSkillLedgerAssertion } from './lib/skill-ledger-assertion.js';
```

把从 `// ── A6: skill 账本一致性` 到 A6 的 `results.push({ key: 'skill_ledger_consistency', ... });` 结束为止整段（原 201-243 行）替换为：

```js
  // ── A6: skill 账本一致性（口径见 lib/skill-ledger-assertion.js；PR1a 任务 47def5bb 起比名单不比行数）──
  results.push(await buildSkillLedgerAssertion(queryPool));
```

- [ ] **Step 8：迁移 smoke 第 2 段**

把 `packages/brain/scripts/smoke/skill-ledger-reconcile-smoke.sh` 中 `# ── 2. A6` 这一段（从插入 skill_registry 那一行到「A6 重跑幂等」的 pass 为止）替换为下面内容，cleanup 里同时加一行删除 working_memory：

```bash
# ── 2. A6：ops_skills 引用未入账 skill → 必须报红 + 落 skill_drift_alerts ──
q "INSERT INTO working_memory (key, value_json, updated_at)
   VALUES ('skill_inventory_state', jsonb_build_object('last_ok_at', NOW()::text), NOW())
   ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json" >/dev/null
q "INSERT INTO skill_registry (name,description,location,status,presence)
   VALUES ('${TAG}-a','smoke','openclaw','active','present'),
          ('${TAG}-b','smoke','openclaw','active','gone')" >/dev/null
q "INSERT INTO ops_skills (source,name,used_by)
   VALUES ('openclaw','${TAG}-a','[]'::jsonb), ('openclaw','${TAG}-b','[]'::jsonb)" >/dev/null
A6="$(run_assertion skill_ledger_consistency)"
echo "$A6" | grep -q '"ok":false' || fail "A6 未对 ops_skills 引用已下线 skill 报红: $A6"
echo "$A6" | grep -q "${TAG}-b"   || fail "A6 报红但未点名: $A6"
pass "A6 skill 账本一致性：引用已下线 skill 真报红并点名（proven-to-fire）"

DRIFT="$(q "SELECT count(*) FROM skill_drift_alerts WHERE skill_name='__skill_ledger_count__' AND drift_date=CURRENT_DATE")"
[[ "$DRIFT" == "1" ]] || fail "A6 报红但未落账 skill_drift_alerts，got=$DRIFT"
pass "A6 分叉落账 skill_drift_alerts（汇总行）"

run_assertion skill_ledger_consistency >/dev/null
DRIFT2="$(q "SELECT count(*) FROM skill_drift_alerts WHERE skill_name='__skill_ledger_count__' AND drift_date=CURRENT_DATE")"
[[ "$DRIFT2" == "1" ]] || fail "重跑后 drift_alerts 重复写入，got=$DRIFT2"
pass "A6 重跑幂等：当日仍只一条告警"
```

cleanup 函数里加：

```bash
  q "DELETE FROM working_memory WHERE key = 'skill_inventory_state'" >/dev/null 2>&1 || true
```

- [ ] **Step 9：跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/skill-ledger-assertion.test.js src/__tests__/promise-map-nightly.test.js`
Expected: PASS
Run: `cd packages/brain && DB_NAME=cecelia_test npx vitest run -c vitest.integration.config.js src/__tests__/integration/promise-map-nightly.integration.test.js`
Expected: PASS
Run: `cd packages/brain && DATABASE_URL=postgresql://localhost/cecelia_test bash scripts/smoke/skill-ledger-reconcile-smoke.sh`
Expected: `ALL PASS: skill-ledger-reconcile`

- [ ] **Step 10：提交**

```bash
git add packages/brain/src/lib/skill-ledger-assertion.js packages/brain/src/promise-map-nightly.js packages/brain/scripts/smoke/skill-ledger-reconcile-smoke.sh
git commit -m "feat(brain): A6 skill 账本一致性改比名单（ops_skills ⊆ present + 派发绑定行健康，扫描未成功降级）"
```

---

### Task 6：`/api/brain/skills` 写入合并语义

**Files:**
- Modify: `packages/brain/src/routes/skills.js:46-104`
- Test: `packages/brain/src/routes/__tests__/skills.test.js`（追加用例）

**Interfaces:**
- Produces（行为）：
  - POST 遇到同名：没传的字段保留原值；status 只有显式传了才覆盖；metadata 合并，并剔除 `pushed_digest`。
  - PATCH：metadata 合并，并剔除 `pushed_digest`。

- [ ] **Step 1：写失败测试**，追加到 `src/routes/__tests__/skills.test.js` 末尾

```js
describe('POST /api/brain/skills 冲突合并（不再整行覆盖，PR1a 任务 47def5bb）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('冲突时 notion_id/location/area_id/description COALESCE 保留，metadata 合并', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 'x', name: 'n' }] });
    const { default: request } = await import('supertest');
    await request(makeApp()).post('/api/brain/skills').send({ name: 'n' });
    const [sql] = pool.query.mock.calls[0];
    for (const col of ['notion_id', 'location', 'area_id', 'description']) {
      expect(sql).toContain(`${col} = COALESCE(EXCLUDED.${col}, skill_registry.${col})`);
    }
    expect(sql).toMatch(/metadata = COALESCE\(skill_registry\.metadata, '\{\}'::jsonb\) \|\| EXCLUDED\.metadata/);
  });

  it('没传 status → 不覆盖原 status；显式传才覆盖', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 'x', name: 'n' }] });
    const { default: request } = await import('supertest');
    await request(makeApp()).post('/api/brain/skills').send({ name: 'n' });
    expect(pool.query.mock.calls[0][1][7]).toBe(false);
    await request(makeApp()).post('/api/brain/skills').send({ name: 'n', status: 'deprecated' });
    expect(pool.query.mock.calls[1][1][7]).toBe(true);
    expect(pool.query.mock.calls[1][1][3]).toBe('deprecated');
  });

  it('metadata 里的 pushed_digest 被剔除（推送指纹只归推送任务管）', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 'x', name: 'n' }] });
    const { default: request } = await import('supertest');
    await request(makeApp()).post('/api/brain/skills').send({ name: 'n', metadata: { pushed_digest: 'evil', eval_score: '9' } });
    expect(JSON.parse(pool.query.mock.calls[0][1][4])).toEqual({ eval_score: '9' });
  });
});

describe('PATCH /api/brain/skills/:id metadata 合并', () => {
  beforeEach(() => vi.clearAllMocks());

  it('metadata 用 || 合并而非整块替换，并剔除 pushed_digest', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 'x' }] });
    const { default: request } = await import('supertest');
    await request(makeApp()).patch('/api/brain/skills/x').send({ metadata: { a: 1, pushed_digest: 'p' } });
    const [sql, vals] = pool.query.mock.calls[0];
    expect(sql).toMatch(/metadata = COALESCE\(metadata, '\{\}'::jsonb\) \|\| \$1::jsonb/);
    expect(JSON.parse(vals[0])).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/skills.test.js`
Expected: FAIL（新用例）

- [ ] **Step 3：提交失败测试**

```bash
git add packages/brain/src/routes/__tests__/skills.test.js
git commit -m "test(brain): /skills POST/PATCH 冲突合并语义失败测试 (Red)"
```

- [ ] **Step 4：实现**

改 `routes/skills.js` 的 POST handler 主体：

```js
router.post('/', async (req, res) => {
  try {
    const { name, description, location, status, metadata = {}, area_id, notion_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    // 冲突不再整行覆盖（Skill 台账投影 PR1a）：没传的保留原值，status 只在显式传入时覆盖，
    // metadata 合并且剔除推送指纹——整块覆盖曾冲掉 pushed_digest/eval_score、清空 notion_id 致重复建页。
    const { pushed_digest: _drop, ...meta } = metadata || {};
    const { rows } = await pool.query(
      `INSERT INTO skill_registry (name, description, location, status, metadata, area_id, notion_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (name) DO UPDATE SET
         description = COALESCE(EXCLUDED.description, skill_registry.description),
         location = COALESCE(EXCLUDED.location, skill_registry.location),
         status = CASE WHEN $8::boolean THEN EXCLUDED.status ELSE skill_registry.status END,
         metadata = COALESCE(skill_registry.metadata, '{}'::jsonb) || EXCLUDED.metadata,
         area_id = COALESCE(EXCLUDED.area_id, skill_registry.area_id),
         notion_id = COALESCE(EXCLUDED.notion_id, skill_registry.notion_id),
         updated_at = NOW()
       RETURNING *`,
      [name, description || null, location || null, status || 'active', JSON.stringify(meta), area_id || null, notion_id || null, status !== undefined]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[skills] POST error:', err);
    return res.status(500).json({ error: err.message });
  }
});
```

PATCH 里 metadata 那一行改为：

```js
    if (metadata          !== undefined) {
      const { pushed_digest: _drop, ...meta } = metadata || {};
      vals.push(JSON.stringify(meta)); sets.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${vals.length}::jsonb`);
    }
```

- [ ] **Step 5：跑测试确认通过（含原有用例）**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/skills.test.js`
Expected: PASS

- [ ] **Step 6：提交**

```bash
git add packages/brain/src/routes/skills.js
git commit -m "fix(brain): /skills POST/PATCH 冲突合并——不再冲掉 notion_id/status/推送指纹"
```

---

### Task 7：CI 可跑的 smoke + 收尾文件

**Files:**
- Create: `packages/brain/scripts/smoke/skill-inventory-smoke.sh`（chmod +x）
- Modify: `packages/quality/smoke-allowlist.txt`（加一行 `skill-inventory-smoke.sh`）
- Create: `changes/cp-0929223401-skill-ledger-projection-pr1.md`
- Modify: `.dod.md`（整体替换为本任务 DoD）

- [ ] **Step 1：写 smoke** `packages/brain/scripts/smoke/skill-inventory-smoke.sh`

```bash
#!/usr/bin/env bash
# skill-inventory-smoke — Skill 台账投影 PR1a（任务 47def5bb）CI 可跑冒烟：
# ① 迁移 491 列/CHECK/注册表改面 ② 远端采集程序经 node - 真跑（临时 HOME + 假 openclaw）
# ③ 扫描入账在测试库真跑一轮：present 入账、人管列不动、重跑 updated_at 不动。
# 「生产扫描 ok、present>0」属部署后验收，不在此处（CI 无 ssh mmv）。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TAG="skinv-smoke-$$"
TMP_HOME="$(mktemp -d)"
cleanup() {
  q "DELETE FROM skill_registry WHERE name LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM working_memory WHERE key IN ('skill_inventory_state','skill_manifest_drift')" >/dev/null 2>&1 || true
  rm -rf "$TMP_HOME"
}
trap cleanup EXIT
cleanup; TMP_HOME="$(mktemp -d)"

# ── 1. 迁移 491 ─────────────────────────────────────────
for col in platforms_installed presence absent_since source_kind content_md copies drift_copies tier_suggested \
           platforms_target openclaw_tier business_line owner category note notion_baseline notion_next_retry_at; do
  [[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='skill_registry' AND column_name='${col}'")" == "1" ]] \
    || fail "skill_registry 缺列 ${col}"
done
pass "迁移 491：机器列/人管列/系统列齐"
if q "INSERT INTO skill_registry (name, presence) VALUES ('${TAG}-bad','bogus')" >/dev/null 2>&1; then fail "presence CHECK 未生效"; fi
pass "迁移 491：presence CHECK 生效"
FACE="$(q "SELECT face||'/'||direction FROM notion_projection_map WHERE notion_db_id='353c40c2-ba63-81bf-ae3e-f0e6fa3753d7' AND brain_table='skill_registry'")"
[[ -z "$FACE" || "$FACE" == "inlet/both" ]] || fail "Skill Registry 注册表未改入口面：$FACE"
pass "迁移 491：Skill Registry 注册为 inlet/both"

# ── 2. 远端采集程序经 node - 真跑 ─────────────────────────
mkdir -p "$TMP_HOME/.claude/skills/${TAG}-a" "$TMP_HOME/.agents/skills" "$TMP_HOME/perfect21/zenithjoy-skills" "$TMP_HOME/.openclaw"
printf -- '---\ndescription: 冒烟\n---\n# a\n' > "$TMP_HOME/.claude/skills/${TAG}-a/SKILL.md"
echo '{"agents":{"entries":{}}}' > "$TMP_HOME/.openclaw/openclaw.json"
INV="$("$NODE" --input-type=module -e "
  import { buildRemoteProgram } from '${BRAIN_DIR}/src/lib/skill-inventory-remote.js';
  process.stdout.write(buildRemoteProgram({ home: process.argv[1] }));
" "$TMP_HOME" | "$NODE" -)"
echo "$INV" | grep -q '"ok":true' || fail "远端采集程序 node - 真跑失败: ${INV:0:300}"
echo "$INV" | grep -q "${TAG}-a"  || fail "采集结果缺 fixture skill"
pass "远端采集程序：自包含，经 node - 真跑输出合法清单"

# ── 3. 扫描入账真跑两轮 ───────────────────────────────────
q "INSERT INTO skill_registry (name, status, note) VALUES ('${TAG}-a','deprecated','人写的')" >/dev/null
RUN="
  import pg from 'pg';
  import { runSkillInventorySync } from '${BRAIN_DIR}/src/skill-inventory-sync.js';
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const inv = process.argv[1];
  const r = await runSkillInventorySync(pool, { force: true, inContainer: false, exec: async () => inv });
  console.log(JSON.stringify(r));
  await pool.end();
"
R1="$("$NODE" --input-type=module -e "$RUN" "$INV")"
echo "$R1" | grep -q '"ok":true' || fail "扫描入账失败: $R1"
ROW="$(q "SELECT presence||'|'||status||'|'||note||'|'||array_to_string(platforms_installed,',') FROM skill_registry WHERE name='${TAG}-a'")"
[[ "$ROW" == "present|deprecated|人写的|claude-code" ]] || fail "入账结果不对（应 present、人管列与 status 不动）：$ROW"
pass "扫描入账：present + 平台正确，status/人管列不动"
U1="$(q "SELECT updated_at FROM skill_registry WHERE name='${TAG}-a'")"
"$NODE" --input-type=module -e "$RUN" "$INV" >/dev/null
U2="$(q "SELECT updated_at FROM skill_registry WHERE name='${TAG}-a'")"
[[ "$U1" == "$U2" ]] || fail "内容没变却改了 updated_at（会让推送抖动）：$U1 → $U2"
pass "扫描入账：内容未变不动 updated_at"

echo "ALL PASS: skill-inventory"
```

- [ ] **Step 2：跑 smoke 确认通过**

Run: `chmod +x packages/brain/scripts/smoke/skill-inventory-smoke.sh && cd packages/brain && DATABASE_URL=postgresql://localhost/cecelia_test bash scripts/smoke/skill-inventory-smoke.sh`
Expected: `ALL PASS: skill-inventory`

- [ ] **Step 3：allowlist、changes 碎片、DoD**

`packages/quality/smoke-allowlist.txt` 按字母序插入一行：`skill-inventory-smoke.sh`

`changes/cp-0929223401-skill-ledger-projection-pr1.md`：

```markdown
## Brain {VERSION} — Skill 台账投影 PR1a：三平台 skill 扫描入账 + A6 改比名单

- 迁移 491：skill_registry 加机器列（已装平台/在不在/原件/副本/分配 agent/正文/tier 建议）、人管列（目标平台/转 OpenClaw 难度/业务线/负责人/分类/备注）、推送基线列；去 `openclaw/` 前缀（先固定派发命令）；投影注册表 Skill Registry 改入口面 both（列级分权，同 Tasks）。决策 19391396 / 4b1da4ca，任务 47def5bb，F5 指挥舱 f20ec1cb。
- 新 job skill-inventory-sync（2h）：经 ssh mmv 送自包含 node 采集程序，扫 ~/.claude/skills、OpenClaw 各 agent 实际加载、~/.agents/skills、zenithjoy-skills 仓库；探不到≠零个，来源不全/熔断不判缺席，缺席满 24h 才 gone，断链即 broken；人管列与 status 不碰。
- A6 skill 账本一致性改比名单：ops_skills 引用的 skill 必须在账且在用、派发绑定行不得下线/断链；扫描未成功降级。
- /api/brain/skills POST/PATCH 冲突改合并，不再冲掉 notion_id/status/推送指纹。
```

`.dod.md`（整体替换）：

```markdown
# DoD: Skill 台账投影 PR1a——三平台扫描入账 + A6 改比名单（任务 47def5bb，决策 19391396/4b1da4ca）

- [x] [BEHAVIOR] 迁移 491：台账列齐、presence/tier CHECK、去 openclaw/ 前缀先固定派发命令、撞名保留、注册表改 inlet/both、幂等
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/migration-491-skill-registry-ledger.test.js"
- [x] [BEHAVIOR] 远端采集自包含（无 import()、base64≤90KB、node - 真跑），三平台 fixture 收齐，openclaw 任一 agent 失败整体 fail
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/skill-inventory-remote.test.js"
- [x] [BEHAVIOR] 归并判定：原件优先级、Codex 口径、跑场机独有、tier 建议、缺席 24h、断链、熔断
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/skill-inventory-reconcile.test.js"
- [x] [BEHAVIOR] skill-inventory-sync：锁/间隔/开跑即写 gate/ssh 失败不动行/170s 超时；调度注册在 scheduler-liveness 之前
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/skill-inventory-sync.test.js src/__tests__/scheduler-jobs.test.js"
- [x] [BEHAVIOR] A6 新口径：ops_skills ⊆ present、派发绑定行健康、未扫描降级、红即落汇总行
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/skill-ledger-assertion.test.js src/__tests__/promise-map-nightly.test.js"
- [x] [BEHAVIOR] /skills POST/PATCH 冲突合并，不冲 notion_id/status/pushed_digest
  Test: manual:bash -c "cd packages/brain && npx vitest run src/routes/__tests__/skills.test.js"
- [x] [BEHAVIOR] 真库冒烟：迁移 491 + 采集程序真跑 + 扫描入账两轮（人管列不动、updated_at 不抖）
  Test: manual:bash packages/brain/scripts/smoke/skill-inventory-smoke.sh
```

- [ ] **Step 4：跑 DevGate 与全量相关测试**

Run: `node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs`
Expected: 全部通过
Run: `cd packages/brain && VITEST_MAX_THREADS=3 npx vitest run src/lib/__tests__/skill-inventory-remote.test.js src/lib/__tests__/skill-inventory-reconcile.test.js src/__tests__/skill-inventory-sync.test.js src/__tests__/scheduler-jobs.test.js src/lib/__tests__/skill-ledger-assertion.test.js src/__tests__/promise-map-nightly.test.js src/routes/__tests__/skills.test.js src/__tests__/migration-491-skill-registry-ledger.test.js`
Expected: PASS

- [ ] **Step 5：提交**

```bash
git add packages/brain/scripts/smoke/skill-inventory-smoke.sh packages/quality/smoke-allowlist.txt changes/cp-0929223401-skill-ledger-projection-pr1.md .dod.md
git commit -m "test(brain): skill-inventory 真库冒烟 + changes 碎片 + DoD"
```

---

## 自查记录

- 设计覆盖：§4.1 → Task 1；§4.2 → Task 2；§4.3 → Task 3；§4.4 → Task 4（job 超时 200s，exec 170s）；§4.6 → Task 5（③ Notion 行数留给 PR1b）；§4.7 → Task 6；§7 smoke → Task 7。§4.5 推送不在本 PR（PR1b）。
- 类型一致：`buildRecords` 的返回值 `{records, sourcesOk, brokenNames, counts}` 在 Task 3 和 Task 4 中一致；`decideAbsent` 的签名在 Task 3 和 Task 4 中一致；`INVENTORY_STATE_KEY='skill_inventory_state'` 与 Task 5 的 SQL 字面量一致。
- 已知取舍：
  - repo 里有、但没装到任何平台的 skill 不新建行（它只用来判断原件在哪）。
  - OpenClaw 的 `agents-skills-personal`（superpowers）不计入 openclaw 副本，只记平台，避免与 ~/.agents 重复。
