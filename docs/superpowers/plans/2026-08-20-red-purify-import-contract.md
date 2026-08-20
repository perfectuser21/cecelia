# Red 纯净化：generator 合同产物预提交 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** kernel generator 的 (Red) commit 不再混入合同文档——runner 在血统闸安装后、Provider 启动前把合同产物机械预提交为 `chore(harness): import contract`。

**Architecture:** Brain 侧零改动（文档字节已在 bundle `inputs.contract_artifacts`）。改 runner 镜像两文件：materializer 扩展物化文档（可 require 模块化），entrypoint 新增 generator-only 预提交函数。TDD 闸 v5.1 已预留豁免，不动任何闸。

**Tech Stack:** bash（entrypoint）、Node CJS（materializer）、vitest（tests/gp）、bash 测试套（docker/cecelia-runner/__tests__）。

**关键已验证事实（执行者必读，勿再花时间重查）：**
- 预提交插入点必须在 `install_frozen_baseline_guard` 成功之后（该函数断言 HEAD==START_SHA）、`prepare_evaluator_provider_identity` 之前；lineage 检查认「start..HEAD 全为 attempt 新写」，import commit 通过。
- `finalize_generator_candidate` 要求 clean tree + 无 untracked（`.dev-lock.*`/`.brain-result.json` 除外），无 commit 数断言。
- TDD 闸 `packages/engine/scripts/devgate/check-tdd-commit-order.sh` RED_IDX 之前的 commit 不检查——闸零改动。
- `inputs.contract_artifacts[]` 形状：`{path, content, sha256, byte_length, source_revision}`；requireCore 保证三文档（contract-draft.md/contract-dod.md/sprint-prd.md）在集合内；`source_revision === approved_sha`。
- `inputs.artifacts[]`（tests）形状：`{type:"frozen_contract_test", path, content, sha256, source_sha}`。
- bootstrap 失败复用 code `frozen_contract_artifacts_invalid`（禁新增 failure code，DB 有 failure_class check 约束）。
- `docker/cecelia-runner/__tests__/*.test.sh` 目前无任何 CI job 执行（失明点）；tests/gp/**/*.test.js 由 brain-unit vitest 跑（packages/brain/vitest.config.js include `../../tests/gp/**`）。
- 产物闸 lint-gp-anchor-artifact：本 PR 碰 docker/ → 必须带 tests/gp/f1/step3-*.test.js 且真 import 被改模块（materializer .cjs 可 require 后满足）、禁 vi.mock 被改模块。

---

### Task 1: RED — gp 步骤断言（vitest，真 import materializer）

**Files:**
- Create: `tests/gp/f1/step3-red-purity-import-contract.test.js`

- [x] **Step 1: 写 failing test**（materializer 尚不导出函数、不物化文档 → 必红）

要点（完整代码见执行时；骨架如下）：
```js
// F1 step3「造完真验」—— 边：runner 合同物化 ↔ TDD Red 纯净
// 真 require materialize-frozen-contract-artifacts.cjs（产物闸：真 import 被改模块，禁 mock）
const { describe, it, expect, beforeEach } = require('vitest');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { materializeFrozenContractArtifacts } = require('../../../docker/cecelia-runner/materialize-frozen-contract-artifacts.cjs');

// fixtures: bundle(role, {artifacts, contract_artifacts, sprint_dir, approved_sha})
// 断言组 A（materializer 文档扩展）：
//  A1 generator：contract_artifacts 三文档落盘、内容一致、mode 0444
//  A2 divergent 已存在文档 → throw/false
//  A3 evaluator 缺文档 → throw/false
//  A4 无 contract_artifacts 字段 → 只物化 tests，不失败（legacy 兼容）
//  A5 文档 path 逃逸（../ / 绝对路径 / 不在 sprint_dir 前缀）→ 拒绝
//  A6 source_revision != approved_sha → 拒绝
// 断言组 B（entrypoint 预提交函数，spawn 真 bash + 真 git repo）：
//  B1 物化后调用函数 → HEAD 前进 1，message 为 chore(harness): import contract，
//     bundle 列出的产物全部 tracked，git status 无这些 untracked
//  B2 幂等：再次调用 → HEAD 不变
//  B3 工作区其他 untracked 杂物不被卷入 commit
//  B4 接线断言：entrypoint.sh 文本中调用点在 install_frozen_baseline_guard 之后、
//     prepare_evaluator_provider_identity 之前，且被 is_generator_task_bundle 守卫
// B 组通过提取 entrypoint.sh 中函数体 + 依赖 helper 后 bash -c 执行（真零件）
```

- [x] **Step 2: 跑测确认 RED**
Run: `cd packages/brain && npx vitest run ../../tests/gp/f1/step3-red-purity-import-contract.test.js`
Expected: FAIL（materializeFrozenContractArtifacts is not a function / 文档未物化 / 函数不存在）
留证 RED 输出（proven-to-fire）。

### Task 2: RED — runner bash 套

**Files:**
- Create: `docker/cecelia-runner/__tests__/entrypoint-import-contract-precommit.test.sh`
- Modify: `docker/cecelia-runner/__tests__/entrypoint-frozen-contract-artifacts.test.sh`（补 contract_artifacts 文档用例）

- [x] **Step 1: 写 bash 测试**（沿现有 mktemp+jq+node 套路；precommit 测试构造真 git repo、写 bundle、source 函数、断言 commit/幂等/不卷杂物）
- [x] **Step 2: 跑确认 RED**：`bash docker/cecelia-runner/__tests__/entrypoint-import-contract-precommit.test.sh` → 非零退出。
- [x] **Step 3: commit RED**
```bash
git add tests/gp/f1/step3-red-purity-import-contract.test.js docker/cecelia-runner/__tests__/
git commit -m "test(runner): Red 纯净化——合同产物物化+预提交回归测试 (Red)"
```

### Task 3: GREEN — materializer 模块化 + 文档物化

**Files:**
- Modify: `docker/cecelia-runner/materialize-frozen-contract-artifacts.cjs`

- [x] 重构：全逻辑进 `function materializeFrozenContractArtifacts(envelope, workspacePath)`（throw Error 代替 process.exit）；`module.exports = { materializeFrozenContractArtifacts }`；`if (require.main === module)` 保持 CLI argv/退出码/stderr 前缀完全兼容。
- [x] 文档物化：`bundle.inputs.contract_artifacts`（若为非空数组）取 `!path.includes('/tests/')` 条目：校验 path 前缀 `${sprintDir}/`、无 `..`/`\\`/绝对路径、`source_revision === approvedSha`、sha256 == digest(content)、去重；存在 → 字节必须一致否则 fail `frozen contract document diverged`；缺失 → evaluator fail `candidate PR is missing frozen document`，generator 写入（`wx`, 0444）。字段缺席 → 跳过（legacy）。
- [x] Run: gp 测试 A 组 + `bash docker/cecelia-runner/__tests__/entrypoint-frozen-contract-artifacts.test.sh` → PASS。

### Task 4: GREEN — entrypoint 预提交

**Files:**
- Modify: `docker/cecelia-runner/entrypoint.sh`

- [x] 新函数（放 `is_publisher_task_bundle` 附近 helper 区）：
```bash
import_contract_artifacts_precommit() {
  local task_bundle_file="$1"
  local workspace="${WORKTREE_PATH:-$PWD}"
  local paths p staged=0
  paths="$(jq -r '[((.task_bundle.inputs.artifacts // [])[] | .path), ((.task_bundle.inputs.contract_artifacts // [])[] | .path)] | unique | .[]' "$task_bundle_file" 2>/dev/null)" || return 1
  [[ -n "$paths" ]] || return 0
  while IFS= read -r p; do
    [[ -n "$p" && -f "$workspace/$p" ]] || continue
    if ! git -C "$workspace" ls-files --error-unmatch -- "$p" >/dev/null 2>&1; then
      git -C "$workspace" add -- "$p" || return 1
      staged=1
    fi
  done <<< "$paths"
  [[ "$staged" == "1" ]] || return 0
  git -C "$workspace" \
    -c user.name='cecelia-runner' -c user.email='runner@cecelia.local' \
    commit --no-verify -m 'chore(harness): import contract' >/dev/null || return 1
  echo "[entrypoint] pre-committed contract artifacts as 'chore(harness): import contract'" >&2
}
```
- [x] 调用点：`run_provider_contract` 内 `install_frozen_baseline_guard` 成功块之后、`prepare_evaluator_provider_identity` 之前：
```bash
  if is_generator_task_bundle && ! import_contract_artifacts_precommit "$task_bundle_file"; then
    write_provider_bootstrap_failure \
      "$NORMALIZED_RESULT_FILE" "$HARNESS_ATTEMPT_ID" "$provider" \
      'Contract import pre-commit rejected' frozen_contract_artifacts_invalid \
      'runner could not pre-commit materialized contract artifacts for a pure Red baseline' \
      "${CREDENTIAL_REF:-}" "${CREDENTIAL_COPY_MUTATED:-false}"
    return 1
  fi
```
- [x] Run: gp B 组 + 两个 bash 测试 → PASS。
- [x] commit GREEN：`fix(runner): generator 物化合同产物后预提交 import contract，(Red) 天然纯净 (Green)`

### Task 5: SKILL SSOT + 快照同步

**Files:**
- Modify: `~/perfect21/zenithjoy-skills/harness-generator/SKILL.md`（SSOT，先改）
- Modify: `packages/workflows/skills/harness-generator/SKILL.md`（`bash scripts/sync-skills-snapshot.sh` 生成）

- [x] 冻结档 Step 1 改写：Runner 已物化并预提交全部合同产物（三文档+tests）为 `chore(harness): import contract`；Generator 禁止落盘/改写/自行抽取 DoD；直接读文件进 Red（Red=red-evidence.md+DoD.md 勾选）。version 7.17.0 + changelog 条目。
- [x] SSOT repo commit+push（按该 repo 分支策略）；worktree 内跑 sync 脚本后 commit 快照。

### Task 6: 产物闸路径清单补 impact-contract/（排队待办 2）

**Files:**
- Modify: `.github/workflows/scripts/lint-gp-anchor-artifact.sh`（PIPELINE_RE 加 `packages/brain/src/impact-contract/`）
- Modify: `scripts/ci/__tests__/lint-gp-anchor-artifact.test.sh`（补用例：改 impact-contract/ 文件无步骤断言 → 必须 FAIL）

- [x] 先补用例跑 RED，再改 PIPELINE_RE 跑 GREEN，单独 commit。

### Task 7: runner bash 套接 CI（失明点修复）

**Files:**
- Modify: `.github/workflows/ci.yml`（新 job `runner-tests-shell`，glob `docker/cecelia-runner/__tests__/*.test.sh`，进 ci-passed needs）

- [x] 先本地全量跑 20+2 个测试；全绿 → 接 glob；有环境性失败 → 只接可跑子集 + 建 Notion issue 记失明点残留。

### Task 8: 版本 bump + DevGate + repin

- [x] `node scripts/facts-check.mjs` && `bash scripts/check-version-sync.sh` && `node packages/quality/scripts/devgate/check-dod-mapping.cjs`
- [x] Brain 1.273.98 → 1.273.99：packages/brain/package.json、package-lock.json（两处）、.brain-versions、DEFINITION.md
- [x] 构建 runner 镜像：`docker build -t cecelia/runner:latest docker/cecelia-runner/`（在 worktree 执行，确保 entrypoint 为本分支版）；取 digest `docker image inspect --format '{{.Id}}' cecelia/runner:latest`；替换旧 digest `sha256:53839dcd…` 全部 11 处（9 文件）；commit
- [x] DoD.md 对应条目补勾

### Task 9: 全量验证 + push + PR

- [x] `cd packages/brain && npx vitest run`（brain-unit 全量）+ 三 DevGate + 产物闸本地跑 `bash .github/workflows/scripts/lint-gp-anchor-artifact.sh origin/main`
- [x] push（`git push -u origin cp-0820201918-red-purify-import-contract --no-verify` 若 pre-push 慢）→ 开 PR（body 带 GP-Anchor: line00/f1_dev_loop#step3）→ engine-ship → engine-pr-watchdog 阻塞到 merge
