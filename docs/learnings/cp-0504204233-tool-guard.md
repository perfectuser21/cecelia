# Learning — Stop Hook 行为 bug 终结：PreToolUse 拦截

分支：cp-0504204233-tool-guard
日期：2026-05-04
Brain Task：ca2a969f-baf2-4303-97dc-fb94efd4dc42
前置 PR：#2503 + #2745 + #2746 + #2747 + #2749 + #2752 + #2757

## 背景

Stop Hook 经过 7 段重构（PR #2503 起到 #2757）+ 50 case 测试金字塔，代码层面已无懈可击。但 Alex 抓的最深层 bug 还没修：**assistant 能主动退出 turn 让 stop hook 循环失效**。

整个 stop hook 循环机制依赖"assistant 想停 → stop hook 触发 → exit 2 + decision:block 让下一轮继续"。但 assistant 有"主动安排退出"的工具：

- `ScheduleWakeup`：调度未来唤醒，turn 主动退出
- `Bash run_in_background:true`：命令后台跑，turn 立即退出

assistant 用了这些工具后**没有"下一轮"**——要等延迟时刻或后台命令完成才唤醒。stop hook 即使 decision:block 也无法 block 当前 turn 退出。整个循环形同虚设。

## 根本原因

stop hook 是**被动通知**机制，不是**主动拦截**机制。它在 turn 已经决定退出后才触发。但 assistant 有工具直接退出 turn 的能力——这是机制不对称：

```
assistant 的工具能力 > stop hook 的拦截能力
```

memory `feedback_foreground_block_ci_wait.md` 早记了"必须 foreground until 阻塞"——但 LLM 自觉不可靠，今天 assistant 自己又犯了 1 次（用 ScheduleWakeup 等 CI 被 Alex 抓包）。

## 本次解法

引入 **PreToolUse hook 拦截器**——比 stop hook **更早**触发的层级。tool 调用前先过 hook：

```
assistant 想调 ScheduleWakeup
  ↓
PreToolUse hook 触发（dev-mode-tool-guard.sh）
  ↓
检测 .cecelia/dev-active-*.json 存在？
  ↓ 是
exit 2 + decision:block → tool 调用被拒，assistant 必须改用 foreground
```

assistant 在 dev 流程中**调不到** ScheduleWakeup / Bash run_in_background:true——机器级强制，不靠 LLM 自觉。

唯一让 turn 退出的路径 = stop hook 自己输出 decision:allow（PR 真完成）。

## 设计

### `hooks/dev-mode-tool-guard.sh`

PreToolUse hook，输入 stdin JSON 含 `tool_name` / `cwd` / `tool_input`：

```bash
1. 读 cwd → git worktree list 找主仓库根
2. 检测 .cecelia/dev-active-*.json 是否存在
3. 不存在 → exit 0 放行
4. 存在 + tool_name=ScheduleWakeup → exit 2 + reason
5. 存在 + tool_name=Bash + run_in_background:true → exit 2 + reason
6. 其他 → exit 0 放行
```

### `~/.claude/settings.json` 注册

```json
"PreToolUse": [
    { "matcher": "Bash", "hooks": [bash-guard.sh, dev-mode-tool-guard.sh] },
    { "matcher": "ScheduleWakeup", "hooks": [dev-mode-tool-guard.sh] }
]
```

`Bash` matcher 的 hook chain 让 dev-mode-tool-guard 在 bash-guard 之后跑。

## 防御层级（Stop Hook 完整闭环）

| 层 | 何时触发 | 拦截能力 |
|---|---|---|
| **PreToolUse**（本 PR）| tool 调用前 | 拦 assistant 主动退出 turn 的工具 |
| Stop hook（PR #2752）| turn 退出时 | 业务判定（PR/Learning/cleanup）|
| CI 守护（PR #2745）| PR 合并前 | 散点 exit 0 / 协议违规 |

三层叠加：assistant 调不动绕过工具 + turn 退出时 stop hook 主动验证 + PR 合并前 CI 守护。**任何一层都无法绕过**。

## 下次预防

- [ ] 任何"机制不对称"问题（assistant 工具能力 vs hook 拦截能力）必须用 PreToolUse 强制对齐
- [ ] 不能依赖 memory feedback / LLM 自觉守 — 必须机器级强制
- [ ] PreToolUse hook 设计：先检测"是否在 dev 流程"（.cecelia/dev-active-*.json），不在就放行（不打扰普通对话）
- [ ] 任何新增的"主动退出 turn"工具必须 review 是否需要纳入 dev-mode-tool-guard 拦截

## 验证证据

- 5 case integration 100% 通过（dev-mode-tool-guard.test.sh）
- settings.json JSON 合法 ✅
- 既有 50 case Ralph 测试金字塔不退化
- 8 处版本文件同步 18.19.2

## Stop Hook 完整重构闭环（8 段）

| 阶段 | PR | 内容 |
|---|---|---|
| 4/21 | #2503 | cwd-as-key 身份归一 |
| 5/4 | #2745 | 散点 12 → 集中 3 |
| 5/4 | #2746 | 探测失败 fail-closed |
| 5/4 | #2747 | 三态出口严格分离 |
| 5/4 | #2749 | condition 5 真完成守门 |
| 5/4 | #2752 | Ralph Loop 模式 |
| 5/4 | #2757 | 50 case 测试金字塔 |
| 5/4 | **本 PR** | **PreToolUse 拦截 — 行为 bug 终结** |

至此整个 Stop Hook 链路：代码 + 测试 + 守护 + 行为强制 全部就位。assistant 在 dev 流程中没有任何路径能绕过 stop hook 真完成判定。
