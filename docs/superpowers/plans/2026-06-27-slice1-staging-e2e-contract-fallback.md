# Slice1 staging-e2e contract_content 兜底解析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（inline）。Steps 用 `- [ ]`。

**Goal:** `loadE2eAcceptance` 在 `e2e_acceptance` 为 NULL 时回退解析 `contract_content` 的 `## E2E 验收` bash 块，让 staging_e2e 真跑而非永久 SKIP。

**Architecture:** 新增纯函数 `parseE2eAcceptanceFromContract` 抽 bash 围栏块成规范化 scenarios（过 `normalizeAcceptance`，不合格返 null 走 SKIP）；`loadE2eAcceptance` 改取两列、NULL 时兜底。只动读取侧，不碰写入链。

**Tech Stack:** Node ESM, vitest, PostgreSQL（mock）。

---

### Task 1: parser + loadE2eAcceptance 兜底（TDD）

**Files:**
- Modify: `packages/brain/src/staging-e2e-runner.js`（新增 export `parseE2eAcceptanceFromContract`；改 `loadE2eAcceptance` 取两列 + 兜底 + export）
- Test: `packages/brain/src/__tests__/staging-e2e-contract-fallback.test.js`（新建）

- [ ] **Step 1: 写 failing test**（5 个断言，见下）

```js
import { describe, it, expect, vi } from 'vitest';
vi.mock('../task-updater.js', () => ({ updateTaskStatus: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
const { parseE2eAcceptanceFromContract, loadE2eAcceptance } = await import('../staging-e2e-runner.js');
const { normalizeAcceptance } = await import('../harness-final-e2e.js');

const CONTRACT_WITH_E2E = `# 合同
## 背景
xxx
## E2E 验收（final-e2e — target_environment: local_api）
**target_environment**: local_api
\`\`\`bash
#!/bin/bash
set -e
echo "▶ Step 1"
node "sprints/x/tests/check.mjs"
echo "✅ Golden Path 全过"
\`\`\`
## Test Contract
yyy`;

describe('parseE2eAcceptanceFromContract', () => {
  it('含 ## E2E + bash 块 → 非空 scenarios 且过 normalizeAcceptance', () => {
    const r = parseE2eAcceptanceFromContract(CONTRACT_WITH_E2E, 'init-1');
    expect(r).not.toBeNull();
    expect(r.scenarios.length).toBe(1);
    expect(r.scenarios[0].commands[0].cmd).toContain('Golden Path');
    expect(() => normalizeAcceptance(r)).not.toThrow();
  });
  it('无 ## E2E 段 → null', () => {
    expect(parseE2eAcceptanceFromContract('# 合同\n## 背景\nxxx', 'init-1')).toBeNull();
  });
  it('有 ## E2E 段但无 bash 块 → null', () => {
    expect(parseE2eAcceptanceFromContract('## E2E 验收\n纯文字无代码块', 'init-1')).toBeNull();
  });
  it('空输入 → null', () => {
    expect(parseE2eAcceptanceFromContract(null, 'init-1')).toBeNull();
  });
});

describe('loadE2eAcceptance 兜底', () => {
  const mkPool = (row) => ({ query: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }) });
  it('e2e_acceptance=NULL + contract_content 有块 → 兜底非空 scenarios', async () => {
    const pool = mkPool({ e2e_acceptance: null, contract_content: CONTRACT_WITH_E2E });
    const r = await loadE2eAcceptance(pool, 'init-1');
    expect(r).not.toBeNull();
    expect(r.scenarios.length).toBeGreaterThan(0);
  });
  it('e2e_acceptance 非空 → 原样返回（行为保留）', async () => {
    const existing = { scenarios: [{ name: 'x', covered_tasks: ['t'], commands: [{ cmd: 'ls' }] }] };
    const pool = mkPool({ e2e_acceptance: existing, contract_content: CONTRACT_WITH_E2E });
    const r = await loadE2eAcceptance(pool, 'init-1');
    expect(r).toBe(existing);
  });
  it('两列都空 → null', async () => {
    const pool = mkPool({ e2e_acceptance: null, contract_content: null });
    expect(await loadE2eAcceptance(pool, 'init-1')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `cd packages/brain && npx vitest run src/__tests__/staging-e2e-contract-fallback.test.js`
Expected: FAIL（`parseE2eAcceptanceFromContract is not a function` / `loadE2eAcceptance is not exported`）

- [ ] **Step 3: commit-1（Red）**

```bash
git add packages/brain/src/__tests__/staging-e2e-contract-fallback.test.js
git commit -m "test(slice1): staging-e2e contract_content 兜底解析 failing test (Red)"
```

- [ ] **Step 4: 实现**（staging-e2e-runner.js）

新增导出纯函数：
```js
/**
 * 兜底：从合同 contract_content 的 `## E2E 验收` 段抽 bash 围栏块，
 * 包成规范化 e2e_acceptance。无段/无块/不合格 → null（让上层走 SKIP）。
 */
export function parseE2eAcceptanceFromContract(contractContent, initiativeId) {
  if (!contractContent || typeof contractContent !== 'string') return null;
  // 抽 ## E2E 验收 段：从 ^## E2E 起到下一个 ^## 或 EOF
  const secMatch = contractContent.match(/^##\s*E2E[^\n]*\n([\s\S]*?)(?=^##\s|\Z)/m);
  const section = secMatch ? secMatch[1] : null;
  if (!section) return null;
  // 抽 ```bash / ```sh 围栏块
  const blocks = [];
  const re = /```(?:bash|sh)\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    const body = m[1].trim();
    if (body) blocks.push(body);
  }
  if (blocks.length === 0) return null;
  const acceptance = {
    scenarios: [{
      name: 'Golden Path E2E (fallback parsed from contract_content)',
      covered_tasks: [initiativeId || 'fallback'],
      commands: blocks.map((b) => ({ cmd: b })),
    }],
  };
  // 迎合 normalizeAcceptance；不合格则 null（SKIP 比 FAIL 省资源）
  try {
    normalizeAcceptance(acceptance);
    return acceptance;
  } catch {
    return null;
  }
}
```

改 `loadE2eAcceptance`（取两列 + 兜底 + 导出）：
```js
/** 加载 e2e_acceptance（优先 approved）；为空时兜底解析 contract_content。 */
export async function loadE2eAcceptance(dbPool, initiativeId) {
  const q = await dbPool.query(
    `SELECT e2e_acceptance, contract_content FROM initiative_contracts
     WHERE initiative_id::text = $1
     ORDER BY (CASE WHEN status = 'approved' THEN 0 ELSE 1 END), version DESC
     LIMIT 1`,
    [initiativeId]
  );
  const row = q.rows[0];
  if (!row) return null;
  if (row.e2e_acceptance) return row.e2e_acceptance;
  if (row.contract_content) return parseE2eAcceptanceFromContract(row.contract_content, initiativeId);
  return null;
}
```

> 注：`normalizeAcceptance` 已 import（文件头 line 23）。`loadE2eAcceptance` 原为 `async function`（私有），改成 `export async function`。

- [ ] **Step 5: 跑测试确认 PASS + 不破坏既有**

Run: `cd packages/brain && npx vitest run src/__tests__/staging-e2e-contract-fallback.test.js src/__tests__/staging-e2e-runner.test.js`
Expected: PASS（新测全绿 + 既有 staging-e2e-runner 测试不回归）

- [ ] **Step 6: node --check 冒烟**

Run: `node --check packages/brain/src/staging-e2e-runner.js`
Expected: 无输出（语法 OK）

- [ ] **Step 7: commit-2（Green）**

```bash
git add packages/brain/src/staging-e2e-runner.js
git commit -m "fix(brain): staging-e2e loadE2eAcceptance 兜底解析 contract_content（解 P0 永久 SKIP）"
```

---

### Task 2: bump brain 版本 + DevGate

**Files:** brain 版本 4 处（package.json / package-lock 两处 / selfcheck 若涉及）

- [ ] **Step 1: bump 版本**

Run: `bash scripts/check-version-sync.sh`（先看当前差异）→ 按提示 bump `packages/brain/package.json` patch 版本 + 同步 package-lock.json 两处。

- [ ] **Step 2: DevGate 三连**

Run:
```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全 PASS

- [ ] **Step 3: commit**

```bash
git add -A && git commit -m "chore(brain): bump 版本 + DevGate（slice1）"
```

---

## Self-Review

- **Spec coverage**：组件1 parser → Task1 Step4；组件2 loadE2eAcceptance → Task1 Step4；测试策略5条 → Task1 Step1；DevGate+版本 → Task2。✅ 全覆盖。
- **Placeholder**：无 TBD/TODO，代码完整。
- **Type 一致**：`parseE2eAcceptanceFromContract(contractContent, initiativeId)` / `loadE2eAcceptance(dbPool, initiativeId)` 前后一致；scenario 形状 `{name, covered_tasks, commands:[{cmd}]}` 与 `normalizeAcceptance` + `runStagingCommand` 一致。
