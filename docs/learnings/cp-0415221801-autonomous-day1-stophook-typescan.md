# Learning: autonomous 顺化 Day 1 — Stop Hook 孪生 bug + bypass + Self-Review 补全

## 上下文

2026-04-15 Cecelia autonomous /dev 跑了一天，用户反馈"整体都不顺"。Plan Agent 统筹 22 个症状 → 6 Epic / 19 PR 路线图。本 PR 是 Day 1 止血包，合并 B1+B2+F2 三个独立改动，一次 engine version bump 省 CI 周期。

## B1 — self-heal 孪生 bug

PR #2373 修了"跨 session orphan 隔离不对称"（line 194 的双 `-n` 条件）。同一文件 line 53 的 self-heal 块有**完全相同模式**的 bug：
```bash
if [[ -n "${CLAUDE_SESSION_ID:-}" ]]; then
    # self-heal 内部三条所有权验证
fi
```
headless / nested Claude Code 场景下 `CLAUDE_SESSION_ID` 空，外层门控直接跳过整段自愈——**即使内部第三条"无标识 + main HEAD == branch"fallback 明明能工作**。

### 根因
自愈块的内层三条所有权验证已经很谨慎（owner_session 匹配 / session_id 匹配 / 无标识+HEAD 匹配）。外层再加一道 `$CLAUDE_SESSION_ID` 门控是**冗余防御**，反而把 fallback 那条路给堵了。

### 修复
- 去掉外层 `if`
- 内层第 1/2 条原来只 check `owner == CLAUDE_SESSION_ID`，改成 `[[ -n current_sid && == ]]`——防空字符串意外匹配空 owner
- 第 3 条（无标识 + HEAD 匹配）本来就不依赖 sid，保持不变
- 重建 dev-lock 时 session_id 留空值不伪造

## B2 — `CECELIA_STOP_HOOK_BYPASS=1` 逃生 env

### 为什么需要
今天 PR #2373 之前，Stop Hook 误报 30+ 次反复 block 我的主 session。期间用户**没有任何显式手段让自己退出**——只能等 hook 自愈（当时还不自愈）或手改 dev-mode。这是 UX 裸奔。

### 修复
stop-dev.sh 最顶部（set -euo pipefail 之后、任何逻辑之前）加一个 env check：

```bash
if [[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]]; then
    echo "[Stop Hook] bypass requested via CECELIA_STOP_HOOK_BYPASS=1, exiting" >&2
    exit 0
fi
```

用户被 block 时：`CECELIA_STOP_HOOK_BYPASS=1` → 下次 hook 直接 exit 0。用完 `unset` 以免正式流程也被放行。

## F2 — Plan Self-Review 补 Step 4 Type consistency

来自今天早些时候 Explore agent 对 Superpowers 5.0.7 的深度比对。官方 writing-plans Self-Review 有 **4** 项，我们 `01-spec.md §0.2.5` 只有 **3** 项，漏了"类型一致性扫描"。

### 漏掉的代价
Task 3 定义 `clearLayers()`、Task 7 调用 `clearFullLayers()` 这类**跨 task 隐性不匹配**在 plan 阶段不会被发现，要等实际 run 才炸。

### 补法
`§0.2.5` 标题 `3 步` → `4 步`，追加：
- 逐 task 提取函数签名 / 常量定义 / import-export 名
- 对比"被调用名" vs "被定义名"
- 发现问题立刻修 plan，不触发整轮 Self-Review 重跑

## 测试兼容性踩坑

B1 的自愈修复 **打破了 2 个旧测试**：
- `should return exit 2 when no .dev-lock but incomplete .dev-mode exists (fail-closed)`
- `should return exit 0 when no .dev-lock and .dev-mode has cleanup_done (completed session)`

它们的原逻辑假设"self-heal 永不触发"（因为 test 没设 CLAUDE_SESSION_ID）。B1 修复后，self-heal 在"HEAD == branch + 无 owner"场景会正确自愈，路径变成 heal → devloop-check → 输出 JSON decision。

**更新测试**：
- 第一个测试：dev-mode 加 `owner_session: foreign-uuid-no-match`，让 self-heal 跳过，保留 orphan→block→exit 2 的测试目标
- 第二个测试：断言从 `toBe("0")` 改成 `toContain("EXIT:0")`，容忍 `decision=allow` 的 JSON 输出——结果仍然 exit 0，只是路径不同

这不是测试修补，是测试正确性修正——旧测试在断言"bug 行为"。

## 下次预防

- [ ] **外层防御和内层防御不要双保险**：当内层已经有细粒度判断（owner/sid/branch 三元组），外层再加粗粒度（CLAUDE_SESSION_ID 非空）会压掉 fallback 路径
- [ ] **每个守护性 hook 必须有显式 bypass**：hook 误报是必然的（session 环境多样），没有逃生通道会让用户被锁死
- [ ] **改 hook 时顺手跑 version-sync 测试**（它兼职检查 6 文件同步）：`npx vitest run packages/engine/tests/version-sync/`
- [ ] **用 bump-version.sh**：6 文件版本手改容易漏（上次漏 hooks/VERSION 导致 CI 失败）。memory 里记的"5 文件"过期了，应该删掉那个数字改成"跑脚本"
- [ ] **Superpowers 继承点要定期巡查**：这次是第 4 步漏了；规则原版有 4 项，我们只复刻 3 项。后续 /architect 或 /arch-review 应加"官方 vs 我们"对比 checklist
