# Harness Transitional Test Bootstrap Design

## 目标

修复 Harness 自举阶段的两项共享验收缺陷，使已经完成 Red→Green 的
PR #4342 与后续 Harness PR 能进入真实 Evaluator/Judge，而不放宽
“未登记测试不得留在 `sprints/`”的安全门。

## 已证实根因

1. `packages/engine/scripts/devgate/check-test-coverage.cjs` 无条件把合同
   `Test File` 拼到合同目录。合同写仓库相对路径
   `sprints/<slug>/tests/x.test.ts` 时，解析结果变成
   `sprints/<slug>/sprints/<slug>/tests/x.test.ts`。
2. `scripts/test-pyramid-guard.mjs` 在 PR 的初次 CI 就要求 `sprints/`
   孤儿数为零；Harness Controller v2.10 又规定测试只能在 Judge PASS
   后毕业。Evaluator/Judge 要求 CI 先绿，形成不可满足的时序环。
3. `scripts/ratchet-guard.mjs` 直接复用原始孤儿总数，因此即使金字塔守卫
   修正口径，统一棘轮仍会用第二套口径继续阻断。

## 方案

### 1. 单一 Test Contract 路径解析器

新增一个无副作用的共享解析模块，输入仓库根、合同路径和 `Test File`，
输出候选路径：

- `Test File` 已是 `sprints/`、`packages/`、`scripts/` 或
  `tests/regression/` 开头的仓库相对路径时，从仓库根解析，不再重复拼
  合同目录。
- 普通相对路径（尤其现有合同常用的 `tests/x.test.ts`）继续相对合同
  目录解析，保持兼容。
- sprint 源测试已经毕业而源路径不存在时，按
  `scripts/graduate-sprint-tests.mjs` 的确定性规则查找永久目标：
  `tests/regression/<slug>/...` 或 `scripts/smoke/e2e/<slug>.sh`。
- 候选必须位于仓库根内；绝对路径、`..` 越界和无法归一化的路径
  fail-closed。
- E2E 登记、`packages/engine/src/harness/evaluate.js` 与默认
  `harness-evaluator` Step B-1 必须调用同一个共享 parser；仅识别行首
  H2+ `E2E 验收` 标题，多个 E2E 段 fail-closed；段落沿用 Skill 的下一个
  H2 边界（内部 H3 不截断），多个 bash fence 按文档顺序拼接，保持
  evaluator v1.22 兼容。
- `scripts/extract-contract-e2e.cjs` 是 parser 的唯一自包含实现；
  `test-contract-paths.cjs` 只导入/转出。Skill 以逐字节锁定的 quoted
  here-doc 携带同一 runtime，确保第三方仓库无需 Cecelia `scripts/`。

`check-test-coverage.cjs` 和过渡测试登记器必须复用该解析器，避免双口径。

### 2. 登记中的过渡测试

测试金字塔把 `sprints/` 文件分成两类：

- **registered transitional**：被同 sprint 的 `Test Contract` 表引用，
  文件真实存在，路径安全，且对应合同可被解析；或同 sprint 的
  `e2e-verify.sh` 与 canonical 合同 `## E2E 验收` 中的 `bash`
  代码块内容一致（只归一化行尾空白与末尾换行）。
- **unregistered orphan**：其余所有 sprint 测试和 `e2e-verify.sh`。

棘轮的零水位只约束 `unregistered orphan`。登记中的过渡测试会被明确
报告数量，但不触发 A1；因此它们可以先在 PR CI 运行，Judge PASS 后再按
既有流程毕业。仅仅新建合同文件不能掩盖任意测试：引用必须解析到同一
sprint 内的真实测试文件。`e2e-verify.sh` 不能仅凭固定文件名登记：
canonical 合同必须存在唯一可解析的 E2E 段且含至少一个 bash 代码块，
脚本内容必须与该段全部 bash 代码块按顺序拼接后的内容一致；缺段、空段、
段落歧义或内容/顺序漂移均 fail-closed。
`contract-draft.md` 是 canonical 合同；仅当读取返回 `ENOENT` 时才可
回退到 `sprint-contract.md`，权限、目录或其他 I/O 错误一律按该 sprint
未登记处理。

### 3. 单一孤儿统计口径

`test-pyramid-guard.mjs` 导出注册分类结果；
`ratchet-guard.mjs` 使用同一结果测量 `orphans`，不再直接统计原始总数。
输出同时显示：

- 原始 sprint artifacts
- registered transitional
- unregistered orphan

现有基线仍保持零，不上调、不删除守卫。

## 安全边界

- 不修改 PR #4342、#4343 的业务实现或冻结合同。
- 不自动批准、merge 或部署任何 PR。
- 不允许任意合同引用仓库外路径，也不允许跨 sprint 登记来掩盖孤儿。
- 不降低永久池、smoke 跑道、裸奔 FR 等其他棘轮。
- bootstrap 本身严格 Red→Green；回归测试必须先在 `origin/main` 失败。

## 验收

1. 完整 sprint 路径不再重复拼接。
2. 传统 `tests/x.test.ts` 相对路径保持兼容。
3. 毕业前源路径与毕业后永久路径都能被同一冻结合同验证。
4. 合同登记的同 sprint 测试不会触发 A1。
5. 与 canonical E2E 代码块一致的同 sprint `e2e-verify.sh` 不触发 A1；
   缺失或内容漂移的 E2E 仍触发 A1。
6. 未登记、跨 sprint、越界或不存在的测试仍触发 A1/合同检查失败。
7. `test-pyramid-guard` 与 `ratchet-guard` 对 orphan 使用同一统计结果。
8. 既有 checker、毕业脚本、金字塔和 ratchet 自测全部通过。

## 恢复顺序

bootstrap PR 独立复审并合入 `main` 后：

1. #4342 update-branch，修复其剩余产品级 CI（例如真实孤岛接线），从
   Evaluator/Judge 恢复，不重跑 Planner/GAN/Generator。
2. #4343 update-branch，区分共享跑道红灯与自身实现红灯后继续修绿。
3. #4339 只保留最新合法 session-id 分支，停止继续创建 full-GAN 子任务。
4. #4340 修复自身 CI、合入 main，再从 main 重建生产 Brain，使生产 SHA
   与 main 一致。
