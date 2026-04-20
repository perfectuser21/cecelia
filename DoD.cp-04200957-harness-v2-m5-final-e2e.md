# DoD: Harness v2 M5 — Initiative 级 Final E2E + 失败归因

contract_branch: cp-04200957-harness-v2-m5-final-e2e
sprint_dir: (N/A — M5 本身不跑 harness pipeline)

PRD: `docs/design/harness-v2-prd.md` §3.1 阶段 C · §5.7 Final E2E · §6.3 失败归因

---

## ARTIFACT 条目

- [x] [ARTIFACT] packages/brain/src/harness-final-e2e.js 存在且导出 5 个函数
  - Test: `manual:node -e "const m=require('fs').readFileSync('packages/brain/src/harness-final-e2e.js','utf8');if(!m.includes('export function runScenarioCommand')||!m.includes('export function normalizeAcceptance')||!m.includes('export function bootstrapE2E')||!m.includes('export function teardownE2E')||!m.includes('export async function runFinalE2E')||!m.includes('export function attributeFailures'))process.exit(1)"`

- [x] [ARTIFACT] packages/brain/src/harness-initiative-runner.js 新增 runPhaseCIfReady 导出
  - Test: `manual:node -e "const m=require('fs').readFileSync('packages/brain/src/harness-initiative-runner.js','utf8');if(!m.includes('export async function runPhaseCIfReady')||!m.includes('export async function checkAllTasksCompleted')||!m.includes('export async function createFixTask'))process.exit(1)"`

- [x] [ARTIFACT] scripts/harness-e2e-up.sh 存在且可执行
  - Test: `manual:node -e "const fs=require('fs');const s=fs.statSync('scripts/harness-e2e-up.sh');if(!(s.mode & 0o111))process.exit(1);const c=fs.readFileSync('scripts/harness-e2e-up.sh','utf8');if(!c.includes('docker compose -f')||!c.includes('55432')||!c.includes('5222')||!c.includes('5174'))process.exit(1)"`

- [x] [ARTIFACT] scripts/harness-e2e-down.sh 存在且可执行
  - Test: `manual:node -e "const fs=require('fs');const s=fs.statSync('scripts/harness-e2e-down.sh');if(!(s.mode & 0o111))process.exit(1);const c=fs.readFileSync('scripts/harness-e2e-down.sh','utf8');if(!c.includes('docker compose')||!c.includes('down -v'))process.exit(1)"`

- [x] [ARTIFACT] docker-compose.e2e.yml 存在且端口 55432:5432
  - Test: `manual:node -e "const y=require('fs').readFileSync('docker-compose.e2e.yml','utf8');if(!y.includes('postgres:17')||!y.includes('55432:5432')||!y.includes('cecelia_e2e'))process.exit(1)"`

- [x] [ARTIFACT] 测试文件 harness-final-e2e.test.js 存在
  - Test: `manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/harness-final-e2e.test.js')"`

- [x] [ARTIFACT] 测试文件 harness-initiative-runner-phase-c.test.js 存在
  - Test: `manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/harness-initiative-runner-phase-c.test.js')"`

## BEHAVIOR 条目

- [x] [BEHAVIOR] runFinalE2E happy path — 所有 scenarios PASS → verdict PASS
  - Test: `tests/harness-final-e2e.test.js::所有 scenarios PASS → verdict PASS`

- [x] [BEHAVIOR] runFinalE2E 部分 scenario 失败 → verdict FAIL + failedScenarios 列表正确
  - Test: `tests/harness-final-e2e.test.js::B fail-fast + C fail → verdict FAIL + 2 项失败`

- [x] [BEHAVIOR] runFinalE2E scenario 内 fail-fast — 第一条失败不跑后续命令
  - Test: `tests/harness-final-e2e.test.js::scenario 内第一条失败 → 不继续跑后续命令（fail-fast）`

- [x] [BEHAVIOR] runFinalE2E bootstrap 失败 → FAIL 且归因汇聚所有 covered_tasks
  - Test: `tests/harness-final-e2e.test.js::up 脚本失败 → FAIL + 归因汇聚所有 covered_tasks`

- [x] [BEHAVIOR] runFinalE2E 参数校验 — initiativeId / contract / acceptance 非法抛错
  - Test: `tests/harness-final-e2e.test.js::initiativeId 缺失 → 抛错`

- [x] [BEHAVIOR] attributeFailures 按 covered_tasks 聚合正确 — 同 Task 多 scenario 击中 failureCount 累加
  - Test: `tests/harness-final-e2e.test.js::多 scenario 击中同 task → failureCount 累加`

- [x] [BEHAVIOR] attributeFailures 保留 Map 插入顺序（回 Generator 顺序稳定）
  - Test: `tests/harness-final-e2e.test.js::保留 Map 插入顺序`

- [x] [BEHAVIOR] runPhaseCIfReady 子任务未全完成 → not_ready 不触发 E2E
  - Test: `tests/harness-initiative-runner-phase-c.test.js::子任务未全完 → not_ready`

- [x] [BEHAVIOR] runPhaseCIfReady 合同未 approved → no_contract
  - Test: `tests/harness-initiative-runner-phase-c.test.js::找不到 approved 合同 → no_contract`

- [x] [BEHAVIOR] runPhaseCIfReady E2E PASS → initiative_runs.phase='done' + completed_at=NOW()
  - Test: `tests/harness-initiative-runner-phase-c.test.js::PASS → phase=done + completed_at=NOW`

- [x] [BEHAVIOR] runPhaseCIfReady E2E FAIL → 为可疑 Task 建 fix-mode harness_task + fix_round=+1
  - Test: `tests/harness-initiative-runner-phase-c.test.js::首次失败 → 建 fix task + fix_round=1, phase 退回 B`

- [x] [BEHAVIOR] runPhaseCIfReady fix_round > 3 → phase='failed' + failure_reason 写入 DB
  - Test: `tests/harness-initiative-runner-phase-c.test.js::fix_round 已到 MAX → 不建 fix task + phase=failed + failure_reason`

- [x] [BEHAVIOR] runPhaseCIfReady maxFixRounds 可覆盖（默认 3）
  - Test: `tests/harness-initiative-runner-phase-c.test.js::可配置 maxFixRounds（传入 1）`

- [x] [BEHAVIOR] runPhaseCIfReady runE2E 抛错 → error 且 client 被 release
  - Test: `tests/harness-initiative-runner-phase-c.test.js::runE2E 抛错 → error 且 client 被 release`

---

## 覆盖率（本地 npm run test:coverage 抽样）

新文件覆盖率（仅跑本 PR 两个新测试时的数据，满足 vitest.config.js threshold 75/75/80/75）：

- `src/harness-final-e2e.js` lines=100%, functions=100%, branches=94.38%, statements=100%
- `src/harness-initiative-runner.js` 总体 lines=69.81%（含 M2 runInitiative 未在本 PR 测试），新增 phase C 部分近 100%

## 成功标准

- 所有 DoD ARTIFACT / BEHAVIOR 项被 CI `check-dod-mapping.cjs` 映射到实际测试
- `npx vitest run src/__tests__/harness-final-e2e.test.js src/__tests__/harness-initiative-runner-phase-c.test.js` 全绿（51 tests）
- 脚本 `bash -n` 语法校验通过
- `docker-compose.e2e.yml` YAML 合法
