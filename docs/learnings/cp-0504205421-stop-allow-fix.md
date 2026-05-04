# Learning — Stop Hook done schema 修正（删 decision:allow）

分支：cp-0504205421-stop-allow-fix
日期：2026-05-04
Brain Task：1f0b7b18-5159-44c8-821e-d0ef954dd02c
前置 PR：#2752 (Ralph Loop) + #2757 (50 case 测试) + #2759 (PreToolUse)

## 故障

Alex 看到 Claude Code 报 stop hook JSON validation 失败：

```
Hook JSON output validation failed — (root): Invalid input
The hook's output was: {"decision": "allow", "reason": "PR #2759 真完成..."}
Expected schema: decision: "approve" | "block" (optional)
```

## 根本原因

Claude Code Stop Hook 协议合法 `decision` 字段值**只有** `"approve"` 和 `"block"`。

`"allow"` 是 **PreToolUse** hook 的 `permissionDecision` 字段值，不是 Stop hook 的。两套协议字段我串了。

PR #2752 抄 Anthropic 官方 ralph-loop 插件时，Ralph 官方做法是 done 路径直接 exit 0 静默（不输出 decision）。我自创了 `decision:"allow"`。

## 50 case 测试为什么没抓住

测试断言写**错方向**：
```typescript
expect(r.stdout).toMatch(/"decision"\s*:\s*"allow"/)  // 只验证字符串存在
```

不验证 Claude Code schema 合法性。schema 是 Claude Code runtime 才校验的——本地 vitest / shell 不跑 schema validator。

**测试通过 + Claude Code runtime 报错** = 验收无法捕捉协议级 bug 的盲区。

## 本次解法

stop-dev.sh done case 不输出 decision JSON（按 Ralph 官方）：
- reason 走 stderr 诊断
- 直接 exit 0 静默放行

测试断言反向（stdout 不含 decision，stderr 含 reason）。

## 下次预防

- [ ] 抄外部源码时**完整复现**协议输出格式，不"看似合理"地自创字段值
- [ ] 任何 hook 输出 JSON 时先查 Claude Code 官方 schema 文档，不靠直觉
- [ ] 测试断言"输出含某字符串"是弱断言——验证协议合法性需要单独 schema validator
- [ ] PreToolUse / Stop / PostToolUse 不同 hook event 的字段名/值集都不一样，跨抄要小心
- [ ] runtime 报 schema invalid 但本地测试全过 → 立刻怀疑测试断言只验字符串、漏验合法性

## 验证证据

- 12 场景 E2E 100% 通过（场景 10 期望反向后）
- ralph-loop-smoke 12 case 100% 通过
- 全 stop-hook 套 142 PASS / 33 skipped
- 8 处版本文件同步 18.19.3

## Stop Hook 完整闭环（9 段）

| 阶段 | PR | 内容 |
|---|---|---|
| 4/21 | #2503 | cwd-as-key 身份归一 |
| 5/4 | #2745 | 散点 12 → 集中 3 |
| 5/4 | #2746 | 探测失败 fail-closed |
| 5/4 | #2747 | 三态出口严格分离 |
| 5/4 | #2749 | condition 5 真完成守门 |
| 5/4 | #2752 | Ralph Loop 模式（埋 decision:allow bug）|
| 5/4 | #2757 | 50 case 测试金字塔（断言方向错漏抓）|
| 5/4 | #2759 | PreToolUse 拦截 — 行为 bug 终结 |
| 5/4 | **本 PR** | **done schema 修正 — 协议合规** |
