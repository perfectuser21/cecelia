---
> ⚠️ **DEPRECATED** — 此文档为初稿，已被 `docs/current/CI_PIPELINE.md` 取代。
> 请阅读 [docs/current/CI_PIPELINE.md](./current/CI_PIPELINE.md)（authority: CURRENT_STATE）。
---

---
id: ci-pipeline
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
changelog:
  - 1.0.0: 初始版本，基于 .github/workflows/ 实际文件生成
---

# CI 流水线架构（CI PIPELINE）

> 本文档基于 `.github/workflows/` 实际 YAML 文件生成，不包含推测内容。
> 文件列表：brain-ci.yml、engine-ci.yml、quality-ci.yml、workflows-ci.yml、workspace-ci.yml

---

## 1. CI 体系总览

Cecelia 采用**分子系统独立 CI**策略，每个子包有专属 workflow：

```
┌─────────────────────────────────────────────────────┐
│               GitHub Actions CI                      │
│                                                      │
│  brain-ci.yml      packages/brain/** 变更时触发       │
│  engine-ci.yml     packages/engine/** 变更时触发      │
│  quality-ci.yml    packages/quality/** 变更时触发     │
│  workflows-ci.yml  packages/workflows/** 变更时触发   │
│  workspace-ci.yml  apps/** 变更时触发                 │
│  devgate.yml       DevGate 独立检查                   │
│  auto-version.yml  自动版本管理                        │
└─────────────────────────────────────────────────────┘
```

所有 workflow 共同特性：
- `concurrency` 策略：同分支同 workflow 只跑一个，push 时取消旧的
- 路径过滤（`changes` 检测 job）：非相关文件变更时 skip 重 job

---

## 2. Brain CI（brain-ci.yml）

**触发条件**：
- push → main（`packages/brain/**`, `DEFINITION.md`, `.brain-versions`）
- pull_request → main（任何路径）
- workflow_dispatch

**Runner**：brain-test job 使用 `macos-latest`，其余 `ubuntu-latest`

### 2.1 Job 依赖图

```
changes
  │
  ├──► facts-check        (ubuntu, DEFINITION.md 与代码一致性)
  │
  ├──► manifest-sync      (ubuntu, brain-manifest 同步检查)
  │
  ├──► fitness-check      (ubuntu, LLM/Executor/Skills 注册表完整性)
  │
  └──► brain-test         (macOS, PostgreSQL + 全量测试 + GoldenPath)
          │
          ▼
       ci-passed           (汇总门禁，always 运行)
```

所有 job 仅在 `changes.outputs.brain == 'true'` 时执行。

### 2.2 facts-check — 事实一致性

```bash
node scripts/facts-check.mjs      # DEFINITION.md ↔ 代码常数对比
bash scripts/check-version-sync.sh # Brain 版本 4 文件同步验证
```

检查项：
- Brain 版本（package.json ↔ DEFINITION.md 第 9 行）
- PORT = 5221
- TICK_LOOP_INTERVAL_MS, TICK_INTERVAL_MINUTES
- EXPECTED_SCHEMA_VERSION
- ACTION_WHITELIST 数量
- 迁移文件无重复

### 2.3 manifest-sync — 清单同步

```bash
node packages/brain/scripts/generate-manifest.mjs --check
```

验证 `brain-manifest.generated.json` 与当前源代码同步。

### 2.4 fitness-check — 注册表完整性

```bash
node scripts/devgate/check-llm-agents.mjs       # LLM agent 注册完整性
node scripts/devgate/check-executor-agents.mjs  # Executor agent 注册完整性
node scripts/devgate/check-skills-registry.mjs  # Skills 注册表完整性
node scripts/devgate/check-contract-drift.mjs   # 模块边界保护
```

### 2.5 brain-test — 集成测试（macOS + PostgreSQL）

**PostgreSQL 配置**：
- Homebrew 安装 postgresql@17 + pgvector
- 缓存 key：`brew-postgresql17-pgvector-{OS}-{arch}-v2`（含 `share/postgresql@17`）
- 初始化 `/tmp/pgdata`，运行迁移，创建 `cecelia` 用户和数据库
- `pg_isready` 前置检查（防止 initdb 静默失败）

**测试执行**：
```bash
npx vitest run --exclude='src/__tests__/blocks.test.js' \
  --reporter=verbose --coverage
```

**OOM 容错逻辑**：
- 若 vitest 非 0 退出但所有测试通过（worker OOM during cleanup）→ exit 0
- 若包含 "Coverage threshold" → 强制 fail（HARD GATE，不可绕过）

**GoldenPath E2E**：
```bash
bash scripts/goldenpath-check.sh
```

### 2.6 ci-passed — 汇总门禁

`always()` 运行，汇总所有 job 结果。
- 跳过（skipped）= brain 无变更 → pass
- 任一 job 失败 → fail

---

## 3. Engine CI（engine-ci.yml）

**触发条件**：
- push → main（`packages/engine/**`）
- pull_request → main（任何路径）
- workflow_dispatch

**Runner**：`ubuntu-latest`

### 3.1 Job 依赖图

```
changes
  │
  ├──► version-check      (仅 PR + engine 有变更)
  │
  └──► test               (engine 有变更时，含多个 step)
```

### 3.2 version-check — 版本同步（PR 专属）

条件：PR event + engine 有变更 + PR title 非 `chore:/docs:/test:` 前缀

```bash
# 对比 base branch 版本
git show origin/$BASE_REF:packages/engine/package.json | jq -r '.version'

# 检查 5 个版本文件同步
bash packages/engine/ci/scripts/check-version-sync.sh
```

5 个必须同步的文件：
1. `package.json`
2. `package-lock.json`
3. `VERSION`
4. `.hook-core-version`
5. `regression-contract.yaml`

### 3.3 test job — 代码质量门禁（含多层检查）

**Step 标签说明**（单 job 内，按顺序执行）：

#### L1-1：TypeCheck

```bash
npm run typecheck
```

写入 `.quality-evidence.json`（check 结果记录）。

#### L1-2：Unit Tests（含 Known-Failures 白名单验证）

```bash
npm run test
```

若测试失败，校验 `.quality-evidence.json` 中的 `known_failure_keys`：
- 必须存在且非空
- 数量不超过 `ci/known-failures.json` 中 `rules.max_skip_count`（默认 3）
- key 必须在 `ci/known-failures.json` 的 `allowed` 列表中

Known-Failures 机制：允许已知不稳定测试短暂豁免，但有上限且必须注册。

#### L1-3：Build

```bash
npm run build
```

#### L2A：PRD/DoD Gate（PR to main 专属）

```bash
git diff --diff-filter=AM --name-only origin/$BASE_REF...HEAD \
  | grep -E '^\.(prd|dod)(-[^/]+)?\.md$'
```

若 PR 中包含 `.prd.md` 或 `.dod.md` 文件 → 报错拦截。
防止工作文档进入 main 分支。

#### Shell Check

```bash
bash -n *.sh   # 对所有 .sh 文件做语法检查
```

#### Evidence Gate

```bash
bash ci/scripts/generate-evidence.sh
bash ci/scripts/evidence-gate.sh
```

汇总所有 check 结果，生成质量证据报告。

#### DevGate（PR 专属，排除 chore/docs/test/release 前缀）

四项检查：

1. **Script Existence**（P1）：必要 DevGate 脚本文件存在

2. **DoD Mapping Check**：
   ```bash
   node scripts/devgate/check-dod-mapping.cjs
   ```
   DoD 条目必须有对应测试映射。

3. **P0/P1 RCI Update Check**：
   ```bash
   bash scripts/devgate/require-rci-update-if-p0p1.sh
   ```
   P0/P1 功能变更必须同步更新 RCI。

4. **RCI Coverage Check**：
   ```bash
   node scripts/devgate/scan-rci-coverage.cjs
   ```
   新增业务条目必须有 `regression-contract.yaml` 覆盖。

---

## 4. 路由决策：哪些 CI 会运行

```
PR 提交
    │
    ├── 改了 packages/brain/** 或 DEFINITION.md ?
    │       └── YES → brain-ci.yml 的 facts-check + manifest-sync + fitness-check + brain-test
    │
    ├── 改了 packages/engine/** ?
    │       └── YES → engine-ci.yml 的 version-check (PR only) + test job
    │
    ├── 改了 packages/quality/** ?
    │       └── YES → quality-ci.yml
    │
    ├── 改了 packages/workflows/** ?
    │       └── YES → workflows-ci.yml
    │
    └── 改了 apps/** ?
            └── YES → workspace-ci.yml
```

**注**：当 PR 改动跨多个子系统，多个 CI 同时运行（并发）。

---

## 5. 关键约束总结

| 约束 | 所在 CI | 时机 |
|------|---------|------|
| Brain 版本 4 文件同步 | brain-ci / facts-check | push + PR |
| DEFINITION.md 与代码一致 | brain-ci / facts-check | push + PR |
| brain-manifest 同步 | brain-ci / manifest-sync | push + PR |
| 注册表完整性（LLM/Executor/Skills） | brain-ci / fitness-check | push + PR |
| Engine 版本 5 文件同步 | engine-ci / version-check | PR only |
| TypeCheck + Build | engine-ci / test | push + PR |
| Known-Failures 白名单 | engine-ci / test | push + PR |
| PRD/DoD 不进 main | engine-ci / test（L2A） | PR to main |
| Shell 语法检查 | engine-ci / test | push + PR |
| DoD→Test 映射 | engine-ci / DevGate | PR（非 chore/docs/test/release） |
| P0/P1 → RCI 必须更新 | engine-ci / DevGate | PR（非 chore/docs/test/release） |
| Coverage threshold | brain-ci / brain-test | push + PR |
| GoldenPath E2E | brain-ci / brain-test | push + PR |

---

## 6. 本地对应命令

在 push 之前，可以在本地运行对应检查：

**Brain 改动前**：
```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node scripts/devgate/check-llm-agents.mjs
node scripts/devgate/check-executor-agents.mjs
node scripts/devgate/check-skills-registry.mjs
node packages/brain/scripts/generate-manifest.mjs --check
```

**Engine 改动前**：
```bash
cd packages/engine
npm run typecheck
npm run test
npm run build
node scripts/devgate/check-dod-mapping.cjs
bash scripts/devgate/require-rci-update-if-p0p1.sh
node scripts/devgate/scan-rci-coverage.cjs
```
