# QA Decision

Decision: MUST_ADD_RCI
Priority: P1
RepoType: Engine

## 分析

**改动类型**: feature (核心工作流改动)
- P1 阶段从"事件驱动"改为"轮询循环"
- Step 8 不再调用 Step 9（让 Stop Hook 触发）
- Step 9 改为完整的 while 循环（在 P1 阶段执行）

**影响范围**:
- 修改 skills/dev/steps/08-pr.md（P0 阶段结束逻辑）
- 重写 skills/dev/steps/09-ci.md（P1 阶段轮询循环）
- 更新 skills/dev/SKILL.md（流程图）
- 两阶段分离的核心机制变更

**测试策略**:
- P0 阶段：manual 验证 Step 8 不调用 Step 9
- Stop Hook：manual 验证 PR 创建后触发 exit 0
- P1 阶段：manual 验证轮询循环持续到成功
- 向后兼容：auto 回归测试

## Tests

- dod_item: "Step 8 创建 PR 后不调用 Step 9"
  method: manual
  location: manual:code-review

- dod_item: "Stop Hook 在 PR 创建后能够触发 exit 0"
  method: manual
  location: manual:hook-test

- dod_item: "Step 9 包含完整的 while 轮询循环"
  method: manual
  location: manual:code-review

- dod_item: "P1 阶段能够持续循环直到成功"
  method: manual
  location: manual:e2e-test

- dod_item: "npm run typecheck 通过"
  method: auto
  location: npm run typecheck

- dod_item: "npm run test 通过"
  method: auto
  location: npm run test

## RCI

new:
  - W1-008  # P1 阶段轮询循环（新增）

update:
  - W1-004  # p0 阶段完整流程（Step 8 不调用 Step 9）

## Reason

核心工作流两阶段分离机制变更，P1 从事件驱动改为轮询循环，必须纳入回归契约确保不会退化。
