# Stop Hook 二次精修 — 开发模式中唯一 exit 0 = PR 真完成

分支：`cp-0504140226-single-exit-strict`
Brain Task：`60d121d8-2db4-452b-a5fa-6e7e612e16c4`
日期：2026-05-04
前置：PR #2745（cp-0504114459，已合 c1f1e65ed）做了散点 12 → 集中 3 处的拓扑归一

## 背景

PR #2745 把 stop-dev.sh 的 7 处 `exit 0` 收敛到 1 处（L52）+ devloop-check.sh 的 4 处 `return 0` 收敛到 2 处（每个函数末尾各 1）。但 stop-dev.sh L52 把 **`not-dev` 路径也归到 exit 0**：

```bash
case "$status" in
    not-dev|done)        # ← 共享 exit 0
        ...
        exit 0
        ;;
    *)
        ...
        exit 2
        ;;
esac
```

这意味着以下情况都 exit 0：
- ✓ 主分支日常对话（合理）
- ✓ bypass env（合理）
- ✗ **cwd 探测失败 / git rev-parse 抖动失败**（误判成 not-dev → 误放行）
- ✗ **无 .dev-mode 文件**（如果文件因竞态读不到，误放行）

后两种是 Alex 最早说的"PR1 开就停"故障的真正源头——在 dev 流程中某次 stop hook 调用，刚好遇到 git rev-parse 短暂失败 → 走 L29 早退（旧版）或 not-dev 路径（PR #2745 后） → exit 0 → assistant 真停。

## 用户意图（澄清版）

> "你一旦确认进入开发模式（开始写代码这个模式），它只有一个（exit 0），而不是很多地方等等待"

含义：
- **一旦确认进入开发模式**（.dev-mode 文件存在 + cp-* 分支）
- **唯一的 exit 0** = PR 真完成（status=done）
- 所有"等待"状态——等 CI / 等合并 / 等 cleanup / 等 stage 完成 / 探测异常 / 文件读不到——**全部 exit 2** 让 assistant 继续干活
- 不是"很多地方"散开判断"我现在该不该 exit 0"

## 目标

1. `stop-dev.sh` 字面**唯一** 1 处 `exit 0`，且仅在 status=done 路径
2. 开发模式中任何探测异常 fail-closed → exit 2（不再 fail-open 误放行）
3. 非开发模式（主分支 / bypass / 无 .dev-mode）→ 用 exit 99（custom code）让 stop.sh 路由层接管放行
4. CI 守护脚本更新匹配新拓扑

## 不做

- 不改 `devloop_check` 主函数（已是末尾单点出口，符合精神）
- 不改 `classify_session` 主入口的状态分类逻辑（仅改 stop-dev.sh 处理 status 的方式）
- 不改 .dev-mode / .dev-lock 字段
- 不改 worktree-manage.sh
- 不改 cleanup.sh / auto-merge / Brain 回写
- 不改 12 场景 E2E 既有断言（行为兼容）
- 不引入新依赖

## 设计

### stop-dev.sh case 重写（唯一 exit 0）

```bash
case "$status" in
    done)
        # 唯一 exit 0：PR 已合并 + step_4 done + cleanup 完成
        _dm=$(echo "$result" | jq -r '.dev_mode // ""' 2>/dev/null || echo "")
        [[ -n "$_dm" && -f "$_dm" ]] && rm -f "$_dm"
        reason=$(echo "$result" | jq -r '.reason // ""' 2>/dev/null || echo "")
        jq -n --arg r "$reason" '{"decision":"allow","reason":$r}'
        exit 0
        ;;
    not-dev)
        # 非开发模式（主分支 / bypass / 无 .dev-mode 等）→ stop-dev.sh 不处理
        # 用 exit 99 表示 not-applicable，让 stop.sh 路由层放行
        reason=$(echo "$result" | jq -r '.reason // ""' 2>/dev/null || echo "")
        [[ -n "$reason" ]] && echo "[stop-dev] $reason" >&2
        exit 99
        ;;
    *)
        # 任何其他状态（blocked / 未知 / 探测异常） → fail-closed exit 2
        reason=$(echo "$result" | jq -r '.reason // "未知"' 2>/dev/null || echo "未知")
        action=$(echo "$result" | jq -r '.action // ""' 2>/dev/null || echo "")
        run_id=$(echo "$result" | jq -r '.ci_run_id // ""' 2>/dev/null || echo "")
        [[ -n "$action" ]] && reason="${reason}。下一步：${action}。⚠️ 立即执行，禁止询问用户。"
        jq -n --arg r "$reason" --arg id "$run_id" '{"decision":"block","reason":$r,"ci_run_id":$id}'
        exit 2
        ;;
esac
```

字面 1 个 `exit 0`、1 个 `exit 2`、1 个 `exit 99`。

### classify_session fail-closed 化

`packages/engine/lib/devloop-check.sh` 内的 classify_session 当前把"探测失败"也归到 not-dev：

| 触发条件 | 当前 status | 改后 status |
|---|---|---|
| `CECELIA_STOP_HOOK_BYPASS=1` | not-dev | not-dev（保持，确认绕过）|
| `cwd` 不是目录 | not-dev | **blocked**（fail-closed）|
| `git rev-parse --show-toplevel` 失败 | not-dev | **blocked**（fail-closed）|
| `git rev-parse --abbrev-ref` 失败 | not-dev | **blocked**（fail-closed）|
| 主分支（main/master/develop/HEAD）| not-dev | not-dev（保持，明确非 dev）|
| 无 .dev-mode 文件 | not-dev | not-dev（保持，明确非 dev）|
| .dev-mode 格式异常 | blocked | blocked（保持，已 fail-closed）|

**判定原则**：能明确"用户在跟我聊天，不是在跑 /dev"的情况 → not-dev；任何"我读不到状态"的情况 → blocked（fail-closed）。

classify_session 末尾出口逻辑（PR #2745 已实现）保持不变：
```bash
case "$_final_status" in
    not-dev|done) return 0 ;;
    *) return 2 ;;
esac
```

### stop.sh 路由层调整

`packages/engine/hooks/stop.sh` 当前：
```bash
bash "$SCRIPT_DIR/stop-dev.sh"
_stop_dev_exit=$?
[[ $_stop_dev_exit -ne 0 ]] && exit $_stop_dev_exit
# fall through 到后续 stop.sh 逻辑（worktree GC 等）
```

新增对 exit 99 的识别：
```bash
bash "$SCRIPT_DIR/stop-dev.sh"
_stop_dev_exit=$?
case $_stop_dev_exit in
    0|99) ;;             # 0 = done（done 路径已自处理），99 = not-applicable，都 fall through
    2)    exit 2 ;;      # block 透传
    *)    exit $_stop_dev_exit ;;  # 其他异常透传
esac
```

`exit 99` 不阻断 stop.sh 后续逻辑（孤儿 worktree GC、conversation summary 等仍跑）。

## 测试策略

按 Cecelia 测试金字塔分类：

- **既有 E2E（rigid，必须 100% 回归）**：
  - `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts` 12 场景
  - `packages/engine/tests/e2e/dev-workflow-e2e.test.ts`
  - `packages/engine/tests/e2e/engine-dynamic-behavior.test.ts`
  - `packages/engine/tests/hooks/stop-hook-exit-codes.test.ts` 174+ 场景
  - `packages/engine/tests/hooks/stop-hook-exit.test.ts`

- **新增 integration**：扩展 `packages/engine/tests/integration/devloop-classify.test.sh`，新增 4 个 case 验证 fail-closed：
  9. cwd 不是目录 → status=blocked（不再是 not-dev）
  10. 非 git repo → status=blocked
  11. cwd 是 git repo 但 rev-parse --abbrev-ref 失败（detached HEAD 模拟） → status=blocked 或 not-dev（HEAD 路径）
  12. cp-* 分支 + .dev-mode 存在但格式异常 → status=blocked（已存在，回归保护）

- **新增 unit**：`packages/engine/tests/hooks/stop-dev-exit-99.test.ts` 1 个 unit case 验证非 dev 上下文 stop-dev.sh 返回 exit 99（用 bash 直跑断言 `$?`）

- **trivial 验证**：grep 守护本身（check-single-exit.sh）

## CI 守护更新

`scripts/check-single-exit.sh` 验收预期更新：

```bash
# 之前：
check_count "stop-dev.sh" '\bexit 0\b' 1     # 不变（仍是 1 个）
check_count "devloop-check.sh" '\breturn 0\b' 2  # 不变

# 新增检查：stop-dev.sh 必须有 exit 99（保证 not-dev 走 stop.sh 路由）
check_count "stop-dev.sh" '\bexit 99\b' 1
```

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| stop.sh 接收 exit 99 后行为改变（孤儿 worktree GC 等）| 实测既有 logic（line 84-106 的 worktree GC、conversation summary）在 fall-through 路径下不依赖 stop-dev.sh exit code，安全 |
| not-dev → exit 99 改变 stop-hook-exit-codes.test 断言 | 测试断言 `EXIT:0`（来自 `echo "EXIT:$?"`），现在变成 `EXIT:99`。需要更新测试期望或让 stop.sh 路由层把 99 转成 0 |
| 文件读异常分类成 blocked 后，普通对话进入 dev 流程上下文是否会影响 | 主分支永远 not-dev（case 第 4 步），不影响普通对话 |
| Stop Hook 协议只识别 0 / 2 两种 code，exit 99 是否合法 | Claude Code Stop Hook 协议：非 0 非 2 视为 "non-blocking error"，hook 输出仅 logged 不 block。等同 exit 0 的"放行"语义 + 一个错误日志，影响微小 |

## 风险二的进一步处理

stop-hook-exit-codes 测试目前断言 `EXIT:0`（line 62, 140 等）。两选项：

- **A. 测试期望更新**：把 not-dev 场景的断言从 `EXIT:0` 改成 `EXIT:99`
- **B. stop.sh 路由层把 99 转 0**：保持 exit code 对外为 0，仅内部用 99 区分

推荐 **B**：对外 stop hook 协议保持 0/2 二态（Claude Code 协议要求），内部只是 stop-dev.sh 用 99 通知 stop.sh "我不处理"。`stop.sh` case 中：
```bash
99) ;;  # fall through，由 stop.sh 后续 GC + 默认 exit 0 决定
```
这样 stop hook 整体对外看仍是 exit 0（在 stop.sh 末尾）。stop-hook-exit-codes 测试无需改动。

## 验收清单

- [BEHAVIOR] `sed 's/#.*//' packages/engine/hooks/stop-dev.sh | grep -cE '\bexit 0\b'` = 1
- [BEHAVIOR] `sed 's/#.*//' packages/engine/hooks/stop-dev.sh | grep -cE '\bexit 99\b'` = 1
- [BEHAVIOR] `sed 's/#.*//' packages/engine/hooks/stop-dev.sh | grep -cE '\bexit 2\b'` = 1
- [BEHAVIOR] classify_session：cwd 不是目录 / git rev-parse 失败 → status=blocked（不再 not-dev）
- [BEHAVIOR] 12 场景 E2E（stop-hook-full-lifecycle）100% 通过
- [BEHAVIOR] 174+ stop-hook-exit-codes 测试通过（不需要改测试，借助 B 方案）
- [BEHAVIOR] integration 12 个分支（含新增 4 个）通过
- [ARTIFACT] `scripts/check-single-exit.sh` 更新含 exit 99 检查
- [ARTIFACT] Engine 版本 bump 18.17.0 → 18.17.1（patch，行为级精修）

## 实施顺序（writing-plans 决定具体 task）

1. classify_session：探测异常路径改 status=blocked + integration 测试新增 4 case（红→绿）
2. stop-dev.sh 改造为三态 case（done=exit 0 / not-dev=exit 99 / *=exit 2）
3. stop.sh 路由层增加 exit 99 识别
4. check-single-exit.sh 更新验收
5. 全测试集合回归
6. Engine 版本 bump（patch）+ feature-registry changelog
7. Learning 文件
