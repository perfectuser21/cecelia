# Known Issues (B 层)

这些问题已知但不阻塞发布。每个问题都记录了触发条件和临时解决方案。

## B1: git diff/status 不一致

**文件**: hooks/pr-gate-v2.sh:373-374

**问题**: `git diff` 和 `git status` 检查的状态不同，可能导致文件被删除时匹配异常。

**触发条件**: 文件在分支中被删除时

**Workaround**: 手动检查 `git status` 确认文件状态

---

## B2: PRD 更新检查管道失败

**文件**: hooks/branch-protect.sh:227

**问题**: PRD/DoD 更新检查使用多个条件的 AND 逻辑，如果 git 命令失败可能误判。

**触发条件**: git 命令异常时

**Workaround**: 重试或检查 git 状态

---

## B3: BASE_BRANCH 回退策略脆弱

**文件**: scripts/devgate/require-rci-update-if-p0p1.sh:74-78

**问题**: 当 BASE_BRANCH 不存在时回退到 `HEAD~10`，浅克隆时可能失败。

**触发条件**:
- 浅克隆（shallow clone）
- 提交历史少于 10 个

**Workaround**: 使用完整克隆 `git clone --depth=0`

---

## B4: Test 字段必须紧邻

**文件**: scripts/devgate/check-dod-mapping.cjs:60-68

**问题**: DoD 映射检查假设 `Test:` 字段必须在验收项的下一行，中间有空行会漏检。

**触发条件**: 验收项和 Test 字段之间有空白行

**Workaround**: 不在验收项和 Test 字段之间添加空行

```markdown
# 正确格式
- [x] 功能实现
  Test: tests/foo.ts

# 会漏检
- [x] 功能实现

  Test: tests/foo.ts  # 间隔一行，会漏检
```

---

## B5: PR 模式跳过 L3

**文件**: scripts/run-regression.sh

**问题**: PR 模式只运行 L1+L2，跳过 L3 测试。

**说明**: 这是设计如此，不是 bug。L3 测试在 release 模式中运行。

**Workaround**: 如果需要完整测试，使用 `bash scripts/run-regression.sh release`

---

## B6: MERGE_HEAD 检查不完整

**文件**: skills/dev/scripts/cleanup.sh:107-112

**问题**: 只检查 MERGE_HEAD 文件存在，不验证实际 merge 状态。

**触发条件**: 异常的 merge 状态（非标准流程）

**Workaround**:
```bash
git merge --abort  # 取消合并
# 或
git reset --hard HEAD  # 重置到 HEAD
```

---

## 更新日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-01-23 | v9.1.0 | 初始创建，6 个 Known Issues |
