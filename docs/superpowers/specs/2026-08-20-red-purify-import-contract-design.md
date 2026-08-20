# 设计：generator 合同产物预提交（Red 天然纯净）

日期：2026-08-20 ｜ Brain task 80623752 ｜ F1 step3（line00/f1_dev_loop#step3）

## 问题
r30（run ee2f9ff9）暴露结构矛盾：TDD 顺序闸要求 (Red) commit 纯净，但合同文档
（contract-draft.md / contract-dod.md / sprint-prd.md）由 generator Provider 按 skill
冻结档指令自行落盘，随 (Red) 一起 commit → 闸红；重排历史又被 append-only 血统闸
拒 → fail-closed 死锁。方案 (b) 出自 generator-fix 自己的陈词（attempt 0a2c004e）。

## 已验证的关键事实
1. TDD 闸 v5.1（check-tdd-commit-order.sh）已预留豁免：RED_IDX 之前的 commit 不检查，
   尾注明写「允许 Red 前有 chore(harness): import contract 预提交」。闸零改动。
2. 污染源是三份合同文档；tests/DoD.md/red-evidence.md 本在 Red 白名单内。
3. 三文档的 canonical 字节已在 TaskBundle：requireCore 强制入封印集
   （initiative_contract_artifacts），dispatcher 以 `inputs.contract_artifacts`
   （{path,content,sha256,byte_length,source_revision}）发给 generator/evaluator/judge。
   **Brain 侧零改动。**
4. 血统闸 install_frozen_baseline_guard 安装时断言 HEAD==START_SHA →
   预提交必须在闸安装**之后**、Provider 启动之前；lineage 检查只认
   「start..HEAD 全为 attempt 新写 commit」，import commit 天然通过。
5. finalize_generator_candidate 无 commit 数断言；要求 clean tree + 无 untracked，
   import commit 正好消掉 untracked 合同文件。
6. r30 Green 只碰实现文件，合同文档 Red 后不再被修改 → 0444 只读物化安全。

## 改动面（全在 runner 镜像 + 闸配置 + skill 文案）
1. `docker/cecelia-runner/materialize-frozen-contract-artifacts.cjs`
   - 重构为可 require 模块（`module.exports`），`require.main === module` 时保持
     现 CLI 行为（argv 兼容，产物闸 gp 测试需真 import 本模块）。
   - 新增：物化 `inputs.contract_artifacts` 中非 `/tests/` 文档。校验与 tests 同强度：
     path 必须 `${sprintDir}/` 前缀、无逃逸、`source_revision === approvedSha`、
     sha256 与 content 一致；存在则必须字节一致（diverged → fail）；
     generator 缺失 → 写入（wx, 0444）；evaluator 缺失 → fail（候选必须带文档）。
   - `contract_artifacts` 缺席（legacy/旧 Brain bundle）→ 文档步跳过，向后兼容。
   - Provider 退出后的第二次调用（3238 行）自动获得文档完整性复核（CONTRACT IS LAW 扩展到文档）。
2. `docker/cecelia-runner/entrypoint.sh`
   - 新函数 `import_contract_artifacts_precommit`：取 bundle 内
     `inputs.artifacts[].path + inputs.contract_artifacts[].path`（unique），
     对存在于工作区且未 tracked 的路径 `git add`；有 staged 才
     `git -c user.name=cecelia-runner -c user.email=runner@cecelia.local commit --no-verify -m "chore(harness): import contract"`；幂等（fix 重入无新文件即静默跳过）。
   - 调用点：`install_frozen_baseline_guard` 成功之后、`prepare_evaluator_provider_identity`
     之前，仅 `is_generator_task_bundle`。失败 fail-closed：
     `write_provider_bootstrap_failure` 复用 code `frozen_contract_artifacts_invalid`
     （不新增 failure code，避开 harness_attempts_failure_class_check），message 写真实原因。
3. `packages/workflows/skills/harness-generator/SKILL.md`（SSOT）
   - 冻结档 Step 1 改写：Runner 已物化并预提交全部合同产物为
     `chore(harness): import contract`；Generator 禁止再落盘/改写/自行抽取 DoD，
     直接读盘上文件进入 Red。版本 bump + changelog。
4. `.github/workflows/scripts/lint-gp-anchor-artifact.sh`（排队待办 2 附带）
   - PIPELINE_RE 补 `packages/brain/src/impact-contract/`（#4982 漏判实证）。
   - `scripts/ci/__tests__/lint-gp-anchor-artifact.test.sh` 补对应用例。
5. 版本与 repin：Brain bump 1.273.99（四处同步）；merge 后重建 runner 镜像 →
   canonical digest repin（`docker image inspect --format '{{.Id}}'`）→ fleet rollout。

## 测试（RED 先行）
- `tests/gp/f1/step3-red-purity-import-contract.test.js`（产物闸要求，真 import
  materialize-frozen-contract-artifacts.cjs，禁 mock）：
  - generator：文档+tests 物化落盘、内容/权限正确；existing divergent 文档 → fail；
    evaluator 缺文档 → fail；bundle 无 contract_artifacts → 跳过文档。
- `docker/cecelia-runner/__tests__/entrypoint-import-contract-precommit.test.sh`（bash 真 git repo）：
  - 物化后未 tracked 产物被提交为 `chore(harness): import contract`，HEAD 前进 1，
    工作区无 untracked 合同文件（Red 纯净前提）；
  - 幂等：二次调用不产生新 commit；
  - 非 bundle 清单内的 untracked 杂物不被卷入；
  - 调用点接线断言：在 install_frozen_baseline_guard 之后、generator-only。
- proven-to-fire：先跑 RED（无实现时上述断言必须红），留存输出。

## 不做
- 不动 TDD 闸 / 血统闸 / Brain 侧 dispatcher（两法并存，不动任何闸——陈词原文）。
- 不新增 failure_class 枚举。
- 不处理 relay/普通 dev 档 generator（不走冻结物化链）。

## 回滚
runner 镜像 digest 回 pin 上一版即可整体回滚；entrypoint 变更不含 DB/接口迁移。
