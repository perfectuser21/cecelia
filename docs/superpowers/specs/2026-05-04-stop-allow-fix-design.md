# Stop Hook done schema 修正 — 删 decision:allow

分支：`cp-0504205421-stop-allow-fix`
Brain Task：`1f0b7b18-5159-44c8-821e-d0ef954dd02c`
日期：2026-05-04
前置：PR #2752 (Ralph Loop 模式) + #2757/2759 (测试 + PreToolUse)

## 故障

Claude Code Stop Hook 协议合法 `decision` 值只有 `"approve"` 和 `"block"`。**没有 `"allow"`**——`"allow"` 是 PreToolUse `permissionDecision` 字段值。

PR #2752 我抄 Anthropic 官方 ralph-loop 插件源码时，**done 路径自创了 `decision:"allow"`**。Ralph 官方源码完成时 exit 0 静默（不输出 decision），我抄错了。

```bash
# 错误（PR #2752 引入）：
case "$status" in
    done)
        rm -f "$dev_state"
        jq -n --arg r "$reason" '{"decision":"allow","reason":$r}'  # ← schema 违规
        exit 0
        ;;

# Claude Code runtime 报：
# Hook JSON output validation failed — decision: 'allow' not in enum [approve, block]
```

## 影响

- **功能**：Claude Code 当 non-blocking error 处理 → exit 0 仍然放行（done 真完成）
- **用户体验**：每次 done 触发都报 schema 错（ctrl+o 看到红色）
- **协议层**：违反 Claude Code 文档约定，将来升级可能强 fail

## 50 case 测试为什么没抓住

测试断言写错方向：
```typescript
expect(r.stdout).toMatch(/"decision"\s*:\s*"allow"/)  // 验证字符串存在
```

只验证**字符串存在**，不验证 Claude Code schema 合法性。schema 验证由 Claude Code runtime 跑，本地 vitest / shell test 不做。所以测试通过但实际行为错。

## 修复（最小变更）

### `stop-dev.sh` done case

```bash
# 修后（按 Ralph 官方静默退出）：
case "$status" in
    done)
        rm -f "$dev_state"
        [[ -f "$dev_mode_file" ]] && rm -f "$dev_mode_file"
        # reason 走 stderr 诊断（同 not-dev 路径），stdout 静默
        reason=$(echo "$result" | jq -r '.reason // ""' 2>/dev/null || echo "")
        [[ -n "$reason" ]] && echo "[stop-dev] $reason" >&2
        exit 0
        ;;
```

不输出 `decision` JSON——直接 exit 0 静默放行。Claude Code 看到 exit 0 + 无 decision 字段就放行。

### 测试断言反向

3 个测试文件的 done 路径断言改为"stdout **不含** decision"：

1. `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts` 场景 10：
   - `expect(r.stdout).toMatch(/"decision"\s*:\s*"allow"/)` → `expect(r.stdout).not.toContain('"decision"')`
   - 保留 `expect(r.stdout).toMatch(/真完成/)` 改成 stderr 检查（`expect(r.stderr).toMatch(/真完成/)`）

2. `packages/engine/scripts/smoke/ralph-loop-smoke.sh` Step 4：
   - `assert_contains "Step 4 含 decision" '"decision"' "$OUT_4"` → 反向（不含）
   - `assert_contains "Step 4 含真完成" "真完成" "$OUT_4"` 改成 stderr 检查或保留（reason 现在走 stderr，OUT_4 用 2>&1 合并捕获，所以 "真完成" 仍在 OUT_4 中）

3. `packages/engine/tests/integration/ralph-loop-mode.test.sh`：
   - 检查 5 个 case 中是否有断言 done 路径 decision，反向

## 不做

- 不动 block 路径（`decision:"block"` 是合法值）
- 不动 verify_dev_complete（输出 status 字段是函数 stdout，不是 hook 协议）
- 不动 PreToolUse hook dev-mode-tool-guard.sh（PreToolUse 协议的 decision:allow/deny 是合法值）
- 不动 not-dev 路径（已经是 reason 走 stderr + 不输出 decision）
- 不动 verify_dev_complete unit test（不验证 stop-dev 输出）

## 测试策略

按 Cecelia 测试金字塔：

- **既有 E2E** （rigid）：12 场景 stop-hook-full-lifecycle 100% 回归（场景 10 期望反向）
- **既有 integration**：ralph-loop-mode.test.sh 5 case 不退化
- **既有 smoke**：ralph-loop-smoke.sh 12 case 不退化（Step 4 期望反向）
- **既有 unit**：verify-dev-complete.test.sh 21 case 完全不受影响

不新增测试——这是修测试期望方向错误的 PR，不是新增覆盖。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| reason 走 stderr 后 assistant 看不到完成原因 | reason 在 done 路径不重要（stop hook exit 0 后 turn 真停，不需要 inject 给 assistant）。reason 走 stderr 仅供诊断/日志 |
| stop-hook-full-lifecycle 场景 10 [HAPPY PATH] 测试期望大改 | scope 极小（1 个场景断言反向），易审 |
| 旧 ralph-loop-smoke.sh 的 OUT_4 用 2>&1 合并 stdout/stderr，反向断言后 OUT_4 仍含 "真完成" | OK，这是预期 — stderr 走过去合并到 OUT_4，断言含"真完成"仍 PASS，但断言含 decision 反向通过（stdout 没了 decision JSON） |

## 验收清单

- [BEHAVIOR] stop-dev.sh done case 不输出 decision JSON（直接 exit 0）
- [BEHAVIOR] 真实 Claude Code session 中 stop hook done 不再报 schema 验证错
- [BEHAVIOR] 12 场景 E2E 100% 通过（场景 10 期望反向后）
- [BEHAVIOR] 既有 50 case 测试金字塔不退化
- [ARTIFACT] Engine 版本 patch bump 18.19.2 → 18.19.3

## 实施顺序

1. stop-dev.sh done case 改 → 测试 12 场景 E2E 看 fail（红灯证明改动生效）
2. 反向 3 个测试断言 → 全过
3. Engine 版本 bump + changelog + Learning
4. push + PR + engine-ship
