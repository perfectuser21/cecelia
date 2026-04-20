# Phase 7.4 设计：/dev 7 棒接力链 + Stop Hook 循环机制 E2E regression test

**日期**：2026-04-20
**分支**：`cp-0420160255-cp-04201602-phase74-dev-flow-e2e`
**Engine 版本**：v18.3.1 → v18.3.2（patch — 纯加测试，不改功能）

---

## 背景

Phase 7.1 / 7.2 / 7.3 三连发把 Stop Hook 循环机制从「形同虚设」修到「端到端能跑」，每次都加了**单点**回归测试。但至今没有**集成测试**把「launcher → worktree-manage → stop.sh → devloop-check」这条接力链作为一个整体 E2E 覆盖。任何一环被破坏 CI 都不会发现，要等下次交互 /dev 翻车才暴露。

## 方案

新增 `packages/engine/tests/integration/dev-flow-e2e.test.ts`，用 vitest + `execSync` 驱动真实 bash 脚本，不起 claude CLI（mock 关键环节）。覆盖 6 个场景：

| # | 场景 | 覆盖的破坏点 |
|---|---|---|
| S1 | claude-launch 透传 CLAUDE_SESSION_ID env + --session-id flag | `scripts/claude-launch.sh` export + exec 逻辑 |
| S2 | worktree-manage cmd_create 把 env session_id 写进 .dev-lock owner_session | `worktree-manage.sh::_resolve_claude_session_id` env 优先分支 |
| S3 | stop.sh 按 owner_session 精确路由，不误匹配其他 session | `hooks/stop.sh` v17.0.0 session 匹配循环 |
| S4 | 无 git / 无 worktree 场景 stop.sh 不抛 unbound variable | `hooks/stop.sh` Phase 7.2 空数组 guard |
| S5 | devloop_check CI 失败 → blocked + reason 含「CI 失败」 | `packages/engine/lib/devloop-check.sh` 条件 4 |
| S6 | devloop_check cleanup_done: true → done | `packages/engine/lib/devloop-check.sh` 条件 0.1 |

## 实现要点

- **不起 claude CLI**：S1 mock 一个假 `claude` 脚本 dump env + args；S2/S3 不需要 claude，直接驱动 bash 脚本；S5 mock gh。
- **PATH 前置机制**：mock 脚本放在 tmp 目录，通过 `env: { PATH: mockDir + ":" + process.env.PATH }` 注入给子进程。
- **CLAUDE_HOOK_STDIN_JSON_OVERRIDE**：复用 Phase 7 提供的 test 逃生 env，避免 vitest spawn stdin 稳定性问题。
- **真实 git repo**：用 `mkdtempSync` 起临时 repo，`git init -b main` + `git worktree add`，CI-safe。
- **jq 输出宽松匹配**：`toMatch(/"status":\s*"blocked"/)` 容忍格式化空白/换行。
- **afterEach 清理**：`rmSync(tmpRoot, { recursive: true, force: true })`，不污染 $HOME / 其他 worktree。

## 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A：vitest + execSync 驱动真实脚本（选）** | 用现有 test runner；mock 范围最小；CI 不装额外依赖 | 依赖 macOS/linux bash 行为一致（已确认 CI ubuntu + 本机 bash 3.2 都能跑） |
| B：新建 shell-based e2e harness（bats / shunit2） | 最贴近生产环境 | 需额外装测试框架 + 新 CI job；与现有 test 风格割裂 |
| C：起真实 claude CLI（headless）+ 真 PR 流程 | 最真实 | 太慢、依赖 API key、不能在 CI 跑；unreliable |

**选 A**：现有 test infra + mock PATH 已经够用，0 额外依赖。

## 变更清单

### 新建
- `packages/engine/tests/integration/dev-flow-e2e.test.ts` — 6 scenarios E2E
- `docs/learnings/cp-0420160255-cp-04201602-phase74-dev-flow-e2e.md`
- `docs/superpowers/specs/2026-04-20-phase74-dev-flow-e2e-design.md`（本文件）

### 修改
- `packages/engine/feature-registry.yml`（追加 18.3.2 条目）
- Engine 7 处版本文件（18.3.1 → 18.3.2）

### 不改
- 接力链脚本本身不动（`scripts/claude-launch.sh` / `hooks/stop.sh` / `worktree-manage.sh` / `lib/devloop-check.sh`）——纯加测试

## Review（B-5 spec approval）

**依据**：
- 用户任务描述（Phase 7.4）：建立 /dev 完整接力链 + Stop Hook 循环机制的 regression baseline
- 代码：Phase 7.1 / 7.2 / 7.3 已有的各单点 test，把它们串成 E2E
- OKR：Cecelia Engine KR — Stop Hook 循环机制完整可靠

**判断**：APPROVE

**confidence**：HIGH（纯加测试零生产风险；mock 机制已在 multi-worktree-routing.test.ts / claude-launch.test.ts 验证可行）

**质量分**：9/10
- +1 覆盖接力链 4 个关键环节（launcher / worktree-manage / stop.sh / devloop-check）
- +1 每个场景都对应一个过去已修的具体 bug，再现性强
- +1 mock PATH + stdin override 机制与 Phase 7 既有 test 一致
- +1 不起 claude CLI，CI 可跑不用 API key
- −1 未覆盖「PR 已合并 → cleanup.sh 执行 → cleanup_done」这段，因为涉及真实 git push/merge 太重（S6 直接读 flag，信任中间流程）

**风险**：
- R1：mock gh 的响应格式需与真实 gh 对齐 → 已对 `gh run list --json status,conclusion,databaseId` / `gh pr list --state open --json number -q '.[0].number'` 两种 command 做分派，覆盖 devloop-check 实际调用
- R2：`git worktree add` 在 CI ubuntu-latest runner 需要 `git init -b main` 明示初始分支（老版 git 默认 master）→ 所有临时 repo 已 `-b main`
- R3：临时目录若未清理会污染 $HOME/worktrees → `afterEach` 用 `rmSync force:true` + S2 里主动 `git worktree remove --force`

**下一步**：进入 writing-plans 阶段

---

## 成功标准

- [x] `packages/engine/tests/integration/dev-flow-e2e.test.ts` 存在且 6 个场景全部 pass
  - Test: `manual:node -e "require('fs').accessSync('packages/engine/tests/integration/dev-flow-e2e.test.ts')"`
- [x] 新 test 覆盖 S1 (claude-launch env + flag 透传)
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/tests/integration/dev-flow-e2e.test.ts','utf8');if(!c.includes('[S1]'))process.exit(1);if(!c.includes('CLAUDE_SESSION_ID_ENV=phase74-s1-fixed-uuid'))process.exit(1);"`
- [x] 新 test 覆盖 S2 (worktree-manage 写 owner_session)
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/tests/integration/dev-flow-e2e.test.ts','utf8');if(!c.includes('[S2]'))process.exit(1);if(!c.includes('owner_session'))process.exit(1);"`
- [x] 新 test 覆盖 S3 (stop.sh 按 owner_session 精确路由)
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/tests/integration/dev-flow-e2e.test.ts','utf8');if(!c.includes('[S3]'))process.exit(1);if(!c.includes('ROUTED_TO_STOP_DEV'))process.exit(1);"`
- [x] 新 test 覆盖 S4 (stop.sh 空数组 guard 回归)
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/tests/integration/dev-flow-e2e.test.ts','utf8');if(!c.includes('[S4]'))process.exit(1);if(!c.includes('unbound variable'))process.exit(1);"`
- [x] 新 test 覆盖 S5 (devloop-check CI 失败 → blocked)
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/tests/integration/dev-flow-e2e.test.ts','utf8');if(!c.includes('[S5]'))process.exit(1);if(!c.includes('devloop_check'))process.exit(1);"`
- [x] 新 test 覆盖 S6 (devloop-check cleanup_done → done)
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/tests/integration/dev-flow-e2e.test.ts','utf8');if(!c.includes('[S6]'))process.exit(1);if(!c.includes('cleanup_done'))process.exit(1);"`
- [x] [ARTIFACT] Engine 7 处版本文件同步到 18.3.2
  - Test: `manual:node -e "const fs=require('fs');const v='18.3.2';if(fs.readFileSync('packages/engine/VERSION','utf8').trim()!==v)process.exit(1);if(!fs.readFileSync('packages/engine/.hook-core-version','utf8').includes(v))process.exit(1);if(!fs.readFileSync('packages/engine/hooks/VERSION','utf8').includes(v))process.exit(1);if(JSON.parse(fs.readFileSync('packages/engine/package.json','utf8')).version!==v)process.exit(1);"`
- [x] [ARTIFACT] feature-registry.yml 含 18.3.2 changelog + Phase 7.4 描述
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('version: \"18.3.2\"'))process.exit(1);if(!c.includes('Phase 7.4'))process.exit(1);"`
- [x] [ARTIFACT] regression-contract.yaml + SKILL.md frontmatter 也同步到 18.3.2
  - Test: `manual:node -e "const fs=require('fs');const v='18.3.2';if(!fs.readFileSync('packages/engine/regression-contract.yaml','utf8').includes('version: '+v))process.exit(1);if(!fs.readFileSync('packages/engine/skills/dev/SKILL.md','utf8').includes('version: '+v))process.exit(1);"`
- [x] [ARTIFACT] Learning 文件含 `### 根本原因` + `### 下次预防` + `- [ ]` checklist
  - Test: `manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-0420160255-cp-04201602-phase74-dev-flow-e2e.md','utf8');if(!c.includes('### 根本原因'))process.exit(1);if(!c.includes('### 下次预防'))process.exit(1);if(!c.includes('- [ ]'))process.exit(1);"`
- [x] [BEHAVIOR] `npm run test` 在 engine 目录下全绿（含新增 dev-flow-e2e 6 scenarios）
  - Test: `tests/integration/dev-flow-e2e.test.ts`
