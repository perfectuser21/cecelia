task_id: a79163a0-3937-4785-98b1-b11acb363214
branch: cp-0425182134-brain-p0-triplet-fix-04241430

## 任务标题
Brain P0 三联修 — 启动 UUID + shepherd ci_passed 状态机 + quarantine 白名单

## 任务描述

Brain 反复重启不稳定的 3 个核心 P0：
1. `packages/brain/src/startup-recovery.js` cleanupStaleClaims `WHERE id = ANY($1::int[])` 把 UUID 强转 integer，启动 100% 抛 `operator does not exist: uuid = integer`，stale claim 永不释放。
2. `packages/brain/src/shepherd.js` ci_passed + MERGEABLE 分支 executeMerge 后只 UPDATE pr_status，不读 PR 最新 state；主 SELECT WHERE 又漏 `'ci_passed'` → task 永远停在 in_progress。
3. `packages/brain/src/quarantine.js::hasActivePr` 白名单漏 `'ci_passed'` → ci_passed 阶段 failure_count 累计可触发误判隔离 → quarantined→queued 死循环。

修复：
- startup-recovery.js: `int[]` → `uuid[]`
- shepherd.js: 主 SELECT 加 `'ci_passed'`；ci_passed + MERGEABLE 分支 merge 后 reload PR state，state=MERGED 时同时 UPDATE status='completed' + pr_status='merged'
- quarantine.js: hasActivePr 白名单加 `'ci_passed'`

## DoD

- [x] [ARTIFACT] startup-recovery.js 用 `uuid[]` 而非 `int[]`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/startup-recovery.js','utf8');if(!c.includes('uuid[]')||/id = ANY\(\$1::int\[\]\)/.test(c))process.exit(1)"

- [x] [ARTIFACT] shepherd.js 主 SELECT WHERE 含 'ci_passed'
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/shepherd.js','utf8');if(!/pr_status\s+IN\s*\([^)]*'ci_passed'/.test(c))process.exit(1)"

- [x] [ARTIFACT] shepherd.js executeMerge 后 reload 决定 status='completed'
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/shepherd.js','utf8');if(!c.includes(\"status = 'completed'\")||!/checkPrStatus\(task\.pr_url\)/.test(c))process.exit(1)"

- [x] [ARTIFACT] quarantine.js hasActivePr 含 'ci_passed'
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/quarantine.js','utf8');if(!/\['open',\s*'ci_pending',\s*'ci_passed',\s*'merged'\]/.test(c))process.exit(1)"

- [x] [BEHAVIOR] startup-recovery-uuid 测试文件存在且断言 uuid[]
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/startup-recovery-uuid.test.js','utf8');if(!c.includes(\"toContain('uuid[]')\")||!c.includes(\"not.toContain('int[]')\"))process.exit(1)"

- [x] [BEHAVIOR] shepherd-ci-passed 测试文件存在且断言 status='completed'
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/shepherd-ci-passed.test.js','utf8');if(!c.includes(\"'ci_passed'\")||!c.includes(\"'completed'\"))process.exit(1)"

- [x] [BEHAVIOR] quarantine-ci-passed 测试文件存在且覆盖 ci_passed=true 用例
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/quarantine-ci-passed.test.js','utf8');if(!c.includes(\"pr_status: 'ci_passed'\"))process.exit(1)"

- [x] [ARTIFACT] Learning 文档存在且含根本原因 + 下次预防
  Test: manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-0425182134-brain-p0-triplet-fix-04241430.md','utf8');if(!c.includes('根本原因')||!c.includes('下次预防'))process.exit(1)"

## 目标文件

- packages/brain/src/startup-recovery.js
- packages/brain/src/shepherd.js
- packages/brain/src/quarantine.js
- packages/brain/src/__tests__/startup-recovery-uuid.test.js（新建）
- packages/brain/src/__tests__/shepherd-ci-passed.test.js（新建）
- packages/brain/src/__tests__/quarantine-ci-passed.test.js（新建）
- docs/learnings/cp-0425182134-brain-p0-triplet-fix-04241430.md（新建）
- docs/superpowers/specs/2026-04-25-brain-p0-triplet-fix-design.md（新建）
- docs/superpowers/plans/2026-04-25-brain-p0-triplet-fix.md（新建）

## 备注

测试均用 vi.mock 注入 pool/execSync，CI 不依赖真实 DB / GitHub API。
本地全量回归（startup-recovery-uuid + shepherd-ci-passed + quarantine-ci-passed + shepherd + quarantine + quarantine-skip-active-pr）75/75 全绿。
PRD 修 2（harness-task-dispatch.js INSERT status='queued'）经核对当前代码已正确含 `'queued'`，无需修改；本 PR 不为它单独建测试以避免 over-spec。
