# Stop Hook exit 2 修复设计

**日期**: 2026-05-21  
**分支**: cp-0521130824-fix-stop-dev-exit2-block  
**类型**: bug fix（v24 回归）

---

## 根因

`stop-dev.sh` v24 引入"单一出口纪律"（single exit point），将所有散点 `exit` 收拢到文件末尾一个无条件 `exit 0`。这无意间把 block 分支本应发出的 `exit 2` 也改成了 `exit 0`，导致 Claude Code 永远收不到 block 信号。

```bash
# 现状（BUG）—— stop-dev.sh 末尾
if [[ "$DECISION" == "block" ]]; then
    jq -n --arg r "$BLOCK_REASON" '{"decision":"block","reason":$r}'
else
    echo "{\"reason_code\":\"${REASON_CODE:-release}\"}" >&2
fi
exit 0   # ← 无论 block/release 都 exit 0
```

`stop.sh` 路由依赖 exit code：
```bash
case "$_stop_dev_exit" in
    0|99) ;;          # fall-through → exit 0 → Claude 退出
    *)    exit "$_stop_dev_exit" ;;  # exit 2 → Claude 保持 block
esac
```

## 修复方案

把 `exit 0` 按 DECISION 拆到两个分支：

```bash
if [[ "$DECISION" == "block" ]]; then
    jq -n --arg r "$BLOCK_REASON" '{"decision":"block","reason":$r}'
    exit 2   # ← Claude Code block 信号
else
    echo "{\"reason_code\":\"${REASON_CODE:-release}\"}" >&2
    exit 0
fi
```

唯一改动：`exit 2` 加入 block 分支，`exit 0` 移入 else，删除末尾无条件 `exit 0`。

## 工作参照

```bash
# stop-architect.sh（正确）
exit 2   # 未完成时

# stop-decomp.sh（正确）
exit 2   # 未完成时
```

## 测试策略

**Integration test**（现有框架 `packages/engine/tests/integration/`）：

- T-new-block：stop-dev.sh 在 DECISION=block 时 exit code 必须为 2
- T-new-release：stop-dev.sh 在 DECISION=release 时 exit code 必须为 0
- 回归：T13-T16 现有测试仍通过

测试命名：`packages/engine/tests/integration/stop-dev-exit-code.test.sh`

## 成功标准

```
## 成功标准
- stop-dev.sh block 路径 exit 2
- stop-dev.sh release 路径 exit 0
- stop.sh 正确传播 exit 2 给 Claude Code
- PR 提交 → CI in_progress → stop hook 返回 block（不再 X0）
```
