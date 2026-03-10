---
id: current-ci-pipeline
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
authority: CURRENT_STATE
changelog:
  - 1.0.0: 初始版本，基于 .github/workflows/ 实际文件审计
---

# CI 流水线（当前事实版）

> **Authority: CURRENT_STATE**
> 基于当前 main 分支 `.github/workflows/` 实际 YAML 文件。
>
> **⚠️ 重要**：MEMORY.md 描述的四层 gate（ci-l1-process.yml / ci-l2-consistency.yml /
> ci-l3-code.yml / ci-l4-runtime.yml）**尚未落地**。
> 当前仍为**子系统独立 CI** 架构，共 7 个 workflow。

---

## 1. 当前 Workflow 列表

```
.github/workflows/
├── brain-ci.yml       触发：packages/brain/**, DEFINITION.md, .brain-versions
├── engine-ci.yml      触发：packages/engine/**
├── quality-ci.yml     触发：packages/quality/**（内容未完整审计）
├── workflows-ci.yml   触发：packages/workflows/**（内容未完整审计）
├── workspace-ci.yml   触发：apps/**（内容未完整审计）
├── devgate.yml        DevGate 独立检查（内容未完整审计）
└── auto-version.yml   自动版本管理（内容未完整审计）
```

已完整审计：`brain-ci.yml`、`engine-ci.yml`。
其余 5 个 workflow 内容见 `docs/gaps/ARCHITECTURE_GAPS.md`。

---

## 2. Brain CI（brain-ci.yml）

**触发**：push → main（特定路径）| pull_request → main | workflow_dispatch
**并发策略**：同分支只跑一个，push 时取消旧的

### Job 依赖图

```
changes（路径过滤）
  │
  ├──► facts-check        ubuntu · 5min
  ├──► manifest-sync      ubuntu · 5min
  ├──► fitness-check      ubuntu · 5min
  └──► brain-test         macOS  · 30min
          │
          ▼
       ci-passed（汇总，always 运行）
```

所有 job 仅在 `changes.outputs.brain == 'true'` 时执行。

### facts-check

```bash
node scripts/facts-check.mjs      # DEFINITION.md ↔ 代码常数
bash scripts/check-version-sync.sh # 版本 4 文件同步
```

检查项：Brain 版本、PORT、TICK 间隔、SCHEMA_VERSION、ACTION_WHITELIST 数量、迁移文件无重复。

### manifest-sync

```bash
node packages/brain/scripts/generate-manifest.mjs --check
```

验证 `brain-manifest.generated.json` 与源代码同步。

### fitness-check

```bash
node scripts/devgate/check-llm-agents.mjs
node scripts/devgate/check-executor-agents.mjs
node scripts/devgate/check-skills-registry.mjs
node scripts/devgate/check-contract-drift.mjs --base=origin/main
```

### brain-test（macOS + PostgreSQL）

**PostgreSQL 初始化**：
- Homebrew postgresql@17 + pgvector
- 缓存 key：`brew-postgresql17-pgvector-{OS}-{arch}-v2`（含 `share/postgresql@17`）
- 初始化 `/tmp/pgdata`，pg_isready 前置检查（防止 initdb 静默失败）
- 创建 `cecelia` 用户和数据库，安装 pgvector 扩展
- 运行 139 个迁移文件

**测试执行**：
```bash
npx vitest run --exclude='src/__tests__/blocks.test.js' \
  --reporter=verbose --coverage
```

**OOM 容错**：vitest 非 0 退出但所有测试通过（worker OOM）→ exit 0。
**硬门禁**：包含 "Coverage threshold" → 强制 fail，不可绕过。

**GoldenPath E2E**：
```bash
bash scripts/goldenpath-check.sh
```

---

## 3. Engine CI（engine-ci.yml）

**触发**：push → main（`packages/engine/**`）| pull_request → main | workflow_dispatch
**并发策略**：同上

### Job 依赖图

```
changes（路径过滤）
  │
  ├──► version-check   ubuntu · 5min · 仅 PR + engine 有变更
  └──► test            ubuntu · 30min · engine 有变更
```

### version-check（PR 专属）

条件：PR event + engine 有变更 + PR title 非 `chore:/docs:/test:` 前缀

验证：
1. 当前版本 > base branch 版本（semver 格式）
2. 5 个版本文件全部同步（`packages/engine/ci/scripts/check-version-sync.sh`）

### test job（单 job，按序执行多步）

#### TypeCheck（L1-1）
```bash
npm run typecheck
```
结果写入 `.quality-evidence.json`。

#### Unit Tests（L1-2，含 Known-Failures 白名单）
```bash
npm run test
```
若失败，校验 `.quality-evidence.json` 中的 `known_failure_keys`：
- 非空，数量 ≤ `ci/known-failures.json` 中的 `rules.max_skip_count`（默认 3）
- 每个 key 必须在 `allowed` 列表中

#### Build（L1-3）
```bash
npm run build
```

#### PRD/DoD Gate（L2A，PR to main 专属）
```bash
git diff --diff-filter=AM --name-only origin/$BASE_REF...HEAD \
  | grep -E '^\.(prd|dod)(-[^/]+)?\.md$'
```
若 PR 中包含 `.prd.md` / `.dod.md` → 报错拦截（工作文档禁止进 main）。

#### Shell Check
```bash
bash -n *.sh  # 所有 .sh 文件语法检查
```

#### Evidence Gate
```bash
bash ci/scripts/generate-evidence.sh
bash ci/scripts/evidence-gate.sh
```

#### DevGate（PR 专属，排除 chore/docs/test/release 前缀）

四项检查：
1. **脚本存在性**（P1）：必要 DevGate 脚本文件存在
2. **DoD 映射**：`node scripts/devgate/check-dod-mapping.cjs`
3. **P0/P1 RCI 更新**：`bash scripts/devgate/require-rci-update-if-p0p1.sh`
4. **RCI 覆盖率**：`node scripts/devgate/scan-rci-coverage.cjs`

---

## 4. CI 路由决策

```
PR 提交
├── packages/brain/** 或 DEFINITION.md 有变更？
│     └── YES → brain-ci 全部 job 运行
├── packages/engine/** 有变更？
│     └── YES → engine-ci version-check（PR）+ test job
├── packages/quality/** 有变更？
│     └── YES → quality-ci（内容待审计）
├── packages/workflows/** 有变更？
│     └── YES → workflows-ci（内容待审计）
└── apps/** 有变更？
      └── YES → workspace-ci（内容待审计）
```

跨子系统改动 → 多个 CI 并发运行。

---

## 5. 本地对应命令

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

---

## 6. 约束汇总

| 约束 | CI 位置 | 时机 |
|------|---------|------|
| Brain 版本 4 文件同步 | brain-ci / facts-check | push + PR |
| DEFINITION.md ↔ 代码 | brain-ci / facts-check | push + PR |
| brain-manifest 同步 | brain-ci / manifest-sync | push + PR |
| 注册表完整性 | brain-ci / fitness-check | push + PR |
| Engine 版本 5 文件同步 | engine-ci / version-check | PR only |
| TypeCheck + Build | engine-ci / test | push + PR |
| Known-Failures 白名单 | engine-ci / test | push + PR |
| PRD/DoD 不进 main | engine-ci / test（L2A） | PR to main |
| Shell 语法检查 | engine-ci / test | push + PR |
| DoD→Test 映射 | engine-ci / DevGate | PR（非 chore/docs/test/release） |
| P0/P1 → RCI 更新 | engine-ci / DevGate | PR（非 chore/docs/test/release） |
| Coverage threshold | brain-ci / brain-test | push + PR |
| GoldenPath E2E | brain-ci / brain-test | push + PR |
