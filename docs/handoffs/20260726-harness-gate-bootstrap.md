# Harness Gate Bootstrap Handoff — 2026-07-26

## 状态

本分支完成 Harness Test Contract 路径解析、sprint 过渡测试登记、
canonical E2E 证据解析，以及 pyramid/ratchet 单一统计口径的 bootstrap
修复。当前保持未 push、未建 PR、未 merge、未部署。Cecelia 逻辑终审已
APPROVE；外部 Skill SSOT 首轮复审发现 attempt 归属缺口后已按
Red→Green 修复到 evaluator 1.32.2，等待聚焦复验。

## 精确版本

- 基线 `origin/main` / merge-base：
  `1c74e3602a92cc0aaf1e90c29db97d6b7da4cda0`
- bootstrap HEAD：
  `b17f6ea51733080ad98ed3dd014a506fede60b78`
- 集成复验时重新 fetch 的 PR #4342 HEAD：
  `b115c19eada6cb7e2f520067946f661185926418`

bootstrap 提交链：

```text
94dbb4f4471c78cde4285e7ce16e876326fead64 docs(harness): design transitional test bootstrap
451a72354692b7929ecc077235bdf7b80675fc24 docs(harness): plan gate bootstrap implementation
536a623ecabb9161aefe3a3bc658cd7ba70011c3 fix(harness): normalize frozen Test Contract paths
e38c365dc3cd7b5426626713261cd1a020a978e4 fix(harness): preserve cwd-relative contract paths
23dfdeb7f92d7ad3a33e8343fadf64218ae1bdeb fix(harness): distinguish registered sprint tests
1996a7b50294d6aaadd31546580357cfc0903814 fix(harness): honor canonical sprint contract
6cd8285181a692d12cb1be932adce8f71c93432e fix(harness): normalize classifier root
739e06bf3e60e06b0c6c9637885a3d6b96121b97 fix(harness): unify transitional orphan ratchet
793b2b354d1060f0881e470e6e3a144de1ae4baf fix(harness): reject invalid ratchet roots
2c3026e8cc401d331794dd422fbe51c433503767 docs(harness): specify canonical e2e registration
d87ec74e0d7037a887b321603cbc7e5e4cc079c9 fix(harness): register canonical e2e evidence
d4dbf960d9f9e51367a79035b8c0aa63ad835be3 fix(harness): preserve semantic e2e whitespace
e84ad87f7d51c2c468ef2553ac76fbed76388339 fix(harness): unify canonical e2e parsing
305b89e70285e5144b7f259e38a0004f29bb4986 fix(harness): route evaluator through shared e2e parser
b17f6ea51733080ad98ed3dd014a506fede60b78 fix(harness): bundle e2e extractor with evaluator skill
```

## 根因与修复边界

原始失败由三项共享缺陷叠加：

1. coverage checker 把已经是仓库相对路径的
   `sprints/<slug>/tests/...` 再拼一次 sprint 目录。
2. pyramid 在 Judge 允许毕业之前，把合同已登记的 sprint 测试全部当作
   orphan；Evaluator/Judge 又要求 CI 先绿，形成自举死锁。
3. ratchet 继续读取原始 orphan 总数，和 pyramid 形成第二套口径。

本分支以共享 parser/classifier 修复：

- 仓库相对、sprint 相对、毕业后永久路径由同一个安全解析器处理；
- 仅同 sprint、真实存在、路径安全、由 canonical contract 登记的产物
  进入 `registered transitional`；
- canonical `## E2E 验收` bash 证据与实际 `e2e-verify.sh` 语义一致时，
  同 sprint E2E 可登记；缺失、歧义或语义漂移均 fail-closed；
- evaluator 生产解析、pyramid 登记和第三方 workspace 内嵌 runtime 使用同一
  canonical extractor；Skill 内嵌资产有逐字节锁定测试；
- pyramid 与 ratchet 都只把 `unregistered` 与零水位比较，同时继续报告
  raw/registered/unregistered 三个数。

未提高或删除任何 baseline。

## Red → Green 证据

- 路径解析 RED：Engine 配置下新增回归初跑为 `8 failed / 1 passed`，
  命中完整路径重复拼接、毕业目标缺失、越界路径被接受；修复从
  `536a623ec` 开始，审查修补落在 `e38c365dc`。
- 过渡登记 RED：旧 A1 对 raw 直接执行零水位，且没有
  `classifySprintArtifacts`；主修复为 `23dfdeb7f`，canonical contract 与
  root 归一修补为 `1996a7b50`、`6cd828518`。
- ratchet RED：旧 CLI 不支持隔离 root，并读取
  `countOrphans().total`；主修复为 `739e06bf3`，无效 root fail-closed
  修补为 `793b2b354`。
- 真 PR 集成 RED（bootstrap `793b2b354` + #4342
  `b115c19ea`）：分类为
  `raw=3 / registered=2 / unregistered=1`，剩余项是 canonical
  `e2e-verify.sh`。这证明仅修 test row 仍未关闭原始 A1 自举环。
- E2E Green：`d87ec74e0` 至 `b17f6ea51` 引入 canonical E2E 登记、
  语义保真、共享 parser、真实 evaluator 接线和第三方 Skill 内嵌 runtime。
  同一 #4342 HEAD 复验变为
  `raw=3 / registered=3 / unregistered=0`，pyramid 与 ratchet 均退出 0。

## 2026-07-26 Fresh Verification

### Focused suites

```bash
cd packages/engine
npx vitest run \
  tests/harness/evaluate-e2e-parser.test.ts \
  tests/devgate/check-test-coverage-paths.test.ts \
  tests/devgate/check-test-coverage-ext.test.ts \
  tests/skills/harness-v5-ci-checks.test.ts
```

结果：`4 passed` files，`35 passed` tests。

```bash
npx vitest run \
  tests/test-pyramid-guard.test.ts \
  tests/ratchet-transitional-orphans.test.ts \
  tests/contract-e2e-extractor.test.ts
```

结果：首轮 `3 passed` files，`54 passed` tests；attempt 归属补丁后复跑为
`3 passed` files，`55 passed` tests。这里包含：

- evaluator Skill 内嵌 extractor 与 canonical 文件逐字节相等；
- 在不含 Cecelia `scripts/` 的第三方临时 workspace 内落地并真实执行，
  stdout 为 `echo third-party\n`；
- 多段/缺失/空 E2E、语义空白、跨 sprint、越界、缺文件均 fail-closed。

### Proven-to-fire 与静态检查

```bash
bash scripts/__tests__/test-pyramid-guard.test.sh
bash scripts/__tests__/ratchet-guard.test.sh
node --check scripts/extract-contract-e2e.cjs
node --check scripts/lib/test-contract-paths.cjs
node --check packages/engine/scripts/devgate/check-test-coverage.cjs
node --check scripts/test-pyramid-guard.mjs
node --check scripts/ratchet-guard.mjs
git diff --check origin/main...HEAD
```

结果：

- pyramid shell：`8 通过 / 0 失败`
- ratchet shell：`PASS=4 FAIL=0`
- 五个 Node 文件 syntax check 全部退出 0
- diff check 退出 0

### 当前真实仓库

```bash
node packages/engine/scripts/devgate/check-test-coverage.cjs
CI=true node scripts/test-pyramid-guard.mjs --json
node scripts/ratchet-guard.mjs --json
```

结果：

- 当前 diff 无 contract 变更，coverage checker 按既有语义 skip；
- pyramid `pass=true`，
  `raw=0 / registered=0 / unregistered=0`；
- ratchet `pass=true`，orphans value `0`，其余在用指标未越水位；
- `seven_ring_hard_flaws` 因 Brain 不可达按既有规则为 skipped，并非本
  bootstrap 修改。

## PR #4342 Disposable Integration

执行：

```bash
git fetch --force origin \
  pull/4342/head:refs/remotes/origin/pr-4342
VERIFY_DIR="$(mktemp -d /tmp/cecelia-bootstrap-verify.XXXXXX)"
git worktree add --detach "$VERIFY_DIR" refs/remotes/origin/pr-4342
git -C "$VERIFY_DIR" merge --no-commit --no-ff \
  hotfix/harness-gate-bootstrap

cd "$VERIFY_DIR"
node packages/engine/scripts/devgate/check-test-coverage.cjs \
  sprints/07251915-kernel-ed561be4/contract-draft.md
CI=true node scripts/test-pyramid-guard.mjs --json
node scripts/ratchet-guard.mjs --json
git diff --check --cached
```

临时 merge 无冲突。共享 bootstrap 结果：

```text
pyramid: pass=true
raw=3 (tests=2, e2e=1)
registered=3 (tests=2, e2e=1)
unregistered=0

ratchet: pass=true
orphans value=0
detail="raw=3 registered=3 unregistered=0"

diff-check: exit 0
```

因此完整路径重复拼接和 CI-before-graduation A1 死锁均已解除。

### #4342 仍有一个产品合同 typo

coverage checker 正确找到两个测试文件后仍退出 1，唯一错误为：

```text
contract: 全池失败返回人审基础设施阻断并产出结构化告警与 evidence
it():     全池失败返回人审基础设施阻塞并产出结构化告警与 evidence
```

这是 #4342 自身冻结合同与测试行为名不一致，不是路径解析或 A1 bootstrap
失败。本交接不宣称 #4342 产品 CI 已绿，也未修改其合同或业务实现。

临时 merge 已 abort，disposable worktree 已删除。

## 已知非阻塞项

`scripts/ratchet-registry.json` 的 `orphans.source` 仍写：

```text
countOrphans(root).total via test-pyramid-guard.mjs
```

实际执行已改为共享 classifier 的 `unregistered.total`。这是台账说明文字
陈旧，不影响当前测量值或安全门；应以独立小改修正文案，不在 bootstrap
终验阶段扩大实现 diff。

## Engine 发布账本

本分支修改 Engine runtime/DevGate，因此按模块规则完成：

- Engine `19.6.0 → 19.6.1` 六处同步；
- `packages/engine/feature-registry.yml` 追加 `19.6.1` changelog；
- `check-engine-hygiene.cjs --verbose` 通过；
- PR 标题必须包含 `[CONFIG]`，以触发 `engine-ci.yml`。

## 外部 Skill SSOT 同步要求

`packages/workflows/skills/harness-evaluator/SKILL.md` 是 monorepo 快照，
不是唯一 SSOT。唯一源是 `zenithjoy-skills` 仓库，默认本机路径：

```text
/Users/administrator/perfect21/zenithjoy-skills/harness-evaluator/SKILL.md
```

在合并/部署本 bootstrap 前，必须通过 zenithjoy-skills 的正常
skill-creator → PR 流程把 evaluator `1.32.2` 与内嵌 canonical extractor
同步到外部 SSOT；随后用：

```bash
SKILLS_SSOT_DIR=/Users/administrator/perfect21/zenithjoy-skills \
  bash scripts/sync-skills-snapshot.sh
```

验证 monorepo 快照无漂移，并复跑 byte-lock/第三方 workspace 测试。不得
只部署当前快照后让 skill drift patrol 再覆盖回旧版本。

## Scope / Non-goals

本分支修改范围仅为：

- Test Contract/E2E 共享解析；
- Engine evaluator 对共享 E2E parser 的消费；
- pyramid/ratchet 分类与回归测试；
- harness-evaluator monorepo 快照及设计、计划、交接文档。

明确未做：

- 未修改 `packages/brain/src/`，因此无 Brain 版本 bump；
- 未修改 pyramid/ratchet baseline 或冻结产品合同；
- 未修改 #4342/#4343 业务文件；
- 未批准、merge、部署任何 PR；
- 未宣称 #4342/#4343/#4340 的产品级 CI 已绿。

## 合入后的恢复顺序

1. **先完成外部 Skill SSOT 同步**，确认 evaluator 1.32.2 与本分支
   byte-for-byte 契约一致。
2. bootstrap PR 独立复审通过后合入 `main`。
3. **#4342**：update-branch；修正其产品合同 `阻断/阻塞` 行为名不一致，
   再跑完整 CI，从 Evaluator/Judge 恢复，不重跑已经完成的
   Planner/GAN/Generator。
4. **#4343**：update-branch；共享 pyramid/ratchet 红灯解除后，将剩余
   failures 逐项归为自身实现问题并继续原 run，不重新开 full-GAN。
5. **#4340**：先基于更新后的 main 修复自身剩余 CI，独立审批合入；随后
   必须从 main 重建并部署 Brain，确认生产 SHA 与 main 一致，不能继续把
   未合入候选 SHA 当 production 基线。
