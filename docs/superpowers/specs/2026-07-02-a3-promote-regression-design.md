# A3 Promotion 冻结登记 — 设计定稿

> harness 验证模型重构 A3。方案文档 `docs/current/harness-verify-redesign/A3-promotion-freeze-to-regression.md` 的落地版，含两处以代码为准的修正。
> PrepPRD：`sprints/07021124-a3-promote-regression/prep-prd.md`。

## 与方案文档的两处修正（以已合并代码/时序事实为准）

1. **yaml schema 对齐 B1 实际消费方**：`scripts/ci/run-core-regression.sh` 用 yq 读 `golden_paths[] | .id / .trigger[] / .test_command`（现存 CORE-001 条目即此格式）。方案文档 3.3 的 `checks[]` 数组 + `test:` 字段不被任何消费方解析。冻结条目 = 每个 `[BEHAVIOR]` 一条：`id: GP-<task前8位>-<NNN>` / `name` / `priority: P0` / `trigger: [PR, Release]` / `method: auto` / `test_command:`（`manual:` 后的命令原样）+ 溯源附加字段（`owner_task_id` / `journey_id` / `source: {pr_url, sprint_dir, frozen_at}`——yq 按字段取值，多余字段无害）。
2. **yaml 落 main 的通道 = promotion 专属 auto-PR**：reportNode 执行时所有 sub-task PR **已 merge**，往 initiative worktree 写文件没有任何后续流程带它上 main（方案文档"随本 sprint PR 一起 commit"时序不成立）。修正：`promoteToRegression` 在 worktree 里 `git checkout -b cp-<MMDDHHNN>-promote-regression-<task8>` → 改 `regression-contract.yaml` → commit → push → `gh pr create --fill` + `gh pr merge --auto --squash`（execFile 注入，best-effort）。gh/push 失败 → 告警 + 跳过 yaml（DB 侧仍已登记）。

## 组件

### 新文件 `packages/brain/src/harness-promote-regression.js`

```
promoteToRegression(deps, params) → { ok, dbWritten, yamlPrUrl?, skipped?, reason? }
  deps: { pool, execFile }            // 测试全 mock；与 reportNode 现有 DI 风格一致（opts.pool || pool）
  params: { task, sprintDir, subTasks, worktreePath }
```

内部纯函数（全部 export 便于单测）：
- `parseGoldenPathSteps(sprintPrdText)` → `[{order_no, note}]`：解析 `## Golden Path` 段的编号列表（格式已验证稳定：SKILL.md 模板 + 现存 3 个样本一致）。段缺失/无编号 → 降级用 `parseBehaviorEntries` 的条目序号当步骤（note=BEHAVIOR 描述），仍无 → 返回 []（跳过 DB 写，告警）。
- `parseBehaviorEntries(contractDodText)` → `[{desc, cmd}]`：匹配 `- [ ] [BEHAVIOR] <desc>` + 下一行 `Test: manual:<cmd>`（`- [x]` 也接受）。无匹配 → []。
- `buildGoldenPathEntries({taskId, journeyId, behaviors, prUrl, sprintDir, now})` → yaml 条目数组（schema 见修正 1）。
- `mergeGoldenPaths(existing, fresh, taskPrefix)` → 幂等合并：滤掉 `id` 以 `GP-<task8>-` 开头的旧条目，追加 fresh（同 task 二次 PASS 覆盖不叠加）。

执行序（对齐方案文档 3.2-3.4，先库、再校验、再文件）：
1. **golden_path 表覆盖写**：`DELETE FROM golden_path WHERE owner_task_id=$1` → 逐条 `INSERT (owner_task_id, order_no, feature_id, note)`；feature_id = `task.payload.feature_id`（journey_features uuid，验证存在失败则 NULL）；同一 client 事务内（BEGIN/COMMIT，失败 ROLLBACK）。
2. **commit 校验（防假卡）**：`git ls-files --error-unmatch ${sprintDir}/contract-dod.md`（execFile，cwd=worktreePath）确认已被 git 跟踪；未跟踪 → 拒绝 yaml 冻结（返回 skipped + 告警），DB 写保留（结构化事实与可执行卡片分层）。
3. **yaml 冻结（专属 auto-PR）**：js-yaml load 根 `regression-contract.yaml` → `mergeGoldenPaths` → `updated:` bump 当天 → dump（注释头抽常量重贴）→ git 分支/commit/push/gh pr create + merge --auto（全部 execFile，任一步失败 → 告警 + 返回 ok:true/dbWritten:true/yamlPrUrl:null，不抛）。

告警：所有"冻结失败/降级"路径 `console.error` + best-effort 动态 import `notifier.js` 的 `sendFeishu`（try/catch 包裹，与 reportNode 现有 non-fatal 风格一致）。

### reportNode 接线（harness-initiative.graph.js）

`computedVerdict === 'PASS'` 时（对称于 L1589 的 `!== 'PASS'` 失败报告分支）：

```javascript
if (computedVerdict === 'PASS') {
  try {
    const { promoteToRegression } = await import('../harness-promote-regression.js');
    await promoteToRegression(
      { pool: dbPool, execFile: opts.execFile || defaultExecFile },
      { task: state.task, sprintDir: state.sprintDir, subTasks: reconciledSubTasks, worktreePath: state.worktreePath },
    );
  } catch (err) {
    console.warn(`[reportNode] promoteToRegression failed (non-fatal): ${err.message}`);
  }
}
```

- best-effort：任何失败不阻断生命周期闭合（reportNode 仍返回 report_path）。
- 只 PASS 触发；FAIL/SKIP 不冻结。
- `worktreePath`/`sprintDir` 为 null → promoteToRegression 内部直接 skipped + 告警（DB 写也跳过——没有 sprintDir 无从解析步骤）。

## 测试

单测 `packages/brain/src/__tests__/harness-promote-regression.test.js`（mock pool + execFile + fs 注入）：
1. parseBehaviorEntries：标准格式 / `- [x]` / 无匹配 → []
2. parseGoldenPathSteps：标准编号列表 / 段缺失降级 BEHAVIOR / 全缺 → []
3. mergeGoldenPaths 幂等：跑两次条目数不翻倍（同前缀覆盖）
4. DB 覆盖写：DELETE 后 INSERT、事务、feature_id NULL 容忍
5. commit 校验失败 → yaml 跳过 + DB 保留
6. promoteToRegression 抛错场景 → reportNode 集成测试断言仍返回 report_path（扩展现有 reportNode 测试模式：mock pool.connect）
7. 只 PASS 触发：reportNode FAIL 分支不调 promote（spy import 或 execFile 未被调）

smoke `packages/brain/scripts/smoke/harness-promote-regression-smoke.sh`：真 DB + 临时 sprint fixture（写 contract-dod.md + sprint-prd.md）→ node -e 调 promoteToRegression（execFile mock 成 no-op 只验 DB 层 + yaml 纯函数层）→ 断言 golden_path 表行数 + mergeGoldenPaths 幂等，清理夹具。

## 不做

- 不动 test_registry（scanner 索引层，不同层）
- 不新建平行表/第二份 yaml
- A1（读取侧 loader）不在本次范围
- 不改 run-core-regression.sh（消费方已就绪，schema 我们对齐它）
