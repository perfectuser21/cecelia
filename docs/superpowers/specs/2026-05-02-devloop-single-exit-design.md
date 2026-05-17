# devloop-check 单一 exit 0 设计（2026-05-02）

## 目标

所有任务（harness 模式或非 harness 模式）统一收敛到同一个 exit 0 条件：**PR merged**。删除 harness 快速通道的提前退出逻辑，确保每个 task 的基础单元保证为"start → code → PR → CI green → merge"。

## 背景

当前 devloop-check.sh 有两条 exit 0 路径：

1. **条件 0.5（harness 快速通道）**：代码写完 + PR 创建 → 立即退出，Brain 另派 Evaluator 处理 CI + merge
2. **条件 5/6（通用路径）**：PR merged + step_4_ship=done → 退出

这造成 harness 任务"保证弱"——Generator 退出后，若 Brain 派不出 Evaluator（claimed_by 死锁、队列满），PR 永远开着无人合并。AI-native 正确模型：一个 session 拥有一个 task 从开始到 merge 的完整生命周期。

## 设计

### 唯一 exit 0

```
所有模式（harness + 非 harness）：
  PR merged → _mark_cleanup_done → status: done → exit 0
```

### harness_mode=true 跳过的检查

| 条件 | 非 harness | harness |
|------|-----------|---------|
| 1: step_1_spec | 检查 | 已跳过（现有） |
| 2: step_2_code | 检查 | 检查（保留） |
| 2.6: DoD 完整性 | 检查 | **跳过（新增）** |
| 3: PR 创建 | 检查 | 检查（保留） |
| 4: CI 等待 | 检查 | **检查（新增）** |
| 5: step_4_ship | 检查 | **跳过（新增）** |
| 6: auto-merge | 检查 step_4_ship | **直接 merge（新增）** |

### 条件 0.5 改动

**删除**：`_mark_cleanup_done` + `return 0`（第 178-181 行）

**保留**：`gh pr merge "$_h_pr" --squash --auto`（提前开启 auto-merge，作为优化，不作为退出条件）

**效果**：harness PR 创建后继续 fall-through → 条件 4（CI 等待）→ 条件 6（自动 merge）

### 条件 2.6 改动

```bash
# 原: if [[ -f "$dev_mode_file" ]]; then ... DoD check ... fi
# 新:
if [[ "$_harness_mode" != "true" ]] && [[ -f "$dev_mode_file" ]]; then
    ... DoD check ...
fi
```

### 条件 5 改动（PR merged）

```bash
if [[ "$step_4_status" == "done" ]] || [[ "$_harness_mode" == "true" ]]; then
    _mark_cleanup_done "$dev_mode_file"
    return 0
fi
```

### 条件 6 改动（CI green → merge）

```bash
# 原: if [[ "$step_4_status" != "done" ]]; then blocked; fi
# 新:
if [[ "$_harness_mode" != "true" ]] && [[ "$step_4_status" != "done" ]]; then
    ... blocked: CI 通过，Stage 4 未完成 ...
    return 2
fi
# harness 直接走到自动合并
```

## 测试策略

**类型：unit test**（单函数行为，mock gh/git 调用，与现有 `devloop-check-*.test.ts` 同层）

修改现有测试：
- `devloop-check-gates.test.ts`：更新 harness 路径断言（原期望 PR 创建后 status=done，改为 blocked/CI 等待）
- `devloop-check-evaluator.test.ts`：更新 harness PR 创建后的期望状态

新增 3 个测试（文件：`devloop-check-harness-ci.test.ts`）：
1. harness + CI in_progress → status=blocked, reason 含 "CI 进行中"
2. harness + CI success + PR not merged → auto-merge → status=done
3. harness + CI failed → status=blocked, ci_fix_count +1

## 版本

Engine 版本 bump（5 个文件），PR title 含 `[CONFIG]`。
