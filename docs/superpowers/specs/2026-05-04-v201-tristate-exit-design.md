# Stop Hook v20.1.0 — 严格三态出口（done=0 / not-dev=99 / blocked=2）

分支：`cp-0504172144-v201-tristate`
Brain Task：`47130342-f7ad-4ccb-8045-96e5f492724e`
日期：2026-05-04
前置：PR #2745（c1f1e65ed）+ PR #2746（194bf334a）已合 main

## 背景

PR #2745 + #2746 后，main 上 stop-dev.sh 字面 1 个 `exit 0`（line 52），但 case 是 `not-dev|done) exit 0`——`not-dev` 和 `done` 共享同一行 exit 0。Alex 反复字面要求："**一旦确认进入开发模式，只有一个 exit 0 = PR 真完成**"。

虽然在开发模式中（.dev-mode 文件存在 + cp-* 分支）classify_session 不会产出 `not-dev`，所以"开发模式中唯一 exit 0 = done"在语义上成立——但代码上 `not-dev` 和 `done` 共享 exit 0 case 是**语义混叠**：从代码读不出"哪条路径才是 PR 真完成"。

更严格的三态拓扑（v20.1.0）让出口码与 status 一一对应：
- `exit 0` 全文字面唯一，且仅服务 status=`done`
- `exit 99` 服务 status=`not-dev`（非开发模式 / 不适用）
- `exit 2` 服务 status=`blocked`（开发模式中任何中间状态）

代码自解释：从 `exit 0` 读到的语义就是"PR 真完成"，没有歧义。

## 目标

- `stop-dev.sh` 字面 `exit 0` = 1（仅 done 路径）
- `stop-dev.sh` 字面 `exit 99` = 1（仅 not-dev 路径）
- `stop-dev.sh` 字面 `exit 2` = 1（仅 blocked 路径）
- `stop.sh` 路由层识别 `exit 99` = pass-through（继续走 architect/decomp）
- `classify_session()` 末尾按 status 三态映射：`done) return 0` / `not-dev) return 99` / `*) return 2`
- 4 个测试文件适配新协议
- `check-single-exit.sh` CI 守护增加 `exit 99 = 1` 验收

## 不做

- 不动 `devloop_check` 主函数（已是末尾单点出口，按 status 分发 return 0/2）
- 不动 .dev-mode 字段、worktree-manage.sh、cleanup.sh
- 不动 auto-merge / Brain 回写 / DoD / harness 业务
- 不引入新依赖
- 不重新设计 stop hook 协议（exit 99 仅在 stop-dev → stop.sh 内部，对 Claude Code 仍是 0/2）
- 不改 hooks/stop-architect.sh 或 hooks/stop-decomp.sh

## 设计

### stop-dev.sh 三态 case

```bash
case "$status" in
    done)
        # 唯一 exit 0：清理 .dev-mode + 输出 decision=allow
        _dm=$(echo "$result" | jq -r '.dev_mode // ""' 2>/dev/null || echo "")
        [[ -n "$_dm" && -f "$_dm" ]] && rm -f "$_dm"
        reason=$(echo "$result" | jq -r '.reason // ""' 2>/dev/null || echo "")
        jq -n --arg r "$reason" '{"decision":"allow","reason":$r}'
        exit 0
        ;;
    not-dev)
        # 不适用此 hook：reason 走 stderr 诊断，stdout 静默
        # exit 99 = custom code，stop.sh 路由层识别为 pass-through
        reason=$(echo "$result" | jq -r '.reason // ""' 2>/dev/null || echo "")
        [[ -n "$reason" ]] && echo "[stop-dev] $reason" >&2
        exit 99
        ;;
    *)
        # blocked（含探测异常 fail-closed）：附加 action 提示词
        reason=$(echo "$result" | jq -r '.reason // "未知"' 2>/dev/null || echo "未知")
        action=$(echo "$result" | jq -r '.action // ""' 2>/dev/null || echo "")
        run_id=$(echo "$result" | jq -r '.ci_run_id // ""' 2>/dev/null || echo "")
        [[ -n "$action" ]] && reason="${reason}。下一步：${action}。⚠️ 立即执行，禁止询问用户。"
        jq -n --arg r "$reason" --arg id "$run_id" '{"decision":"block","reason":$r,"ci_run_id":$id}'
        exit 2
        ;;
esac
```

### stop.sh 路由层

main 现有 stop.sh L48-51：
```bash
bash "$SCRIPT_DIR/stop-dev.sh"
_stop_dev_exit=$?
[[ $_stop_dev_exit -ne 0 ]] && exit $_stop_dev_exit
```

改成：
```bash
bash "$SCRIPT_DIR/stop-dev.sh"
_stop_dev_exit=$?
case $_stop_dev_exit in
    0)  ;;                # done，fall through 到后续 GC + 默认 exit 0
    99) ;;                # not-applicable，fall through 到后续路由（architect/decomp）
    2)  exit 2 ;;         # block 透传给 Claude Code
    *)  exit $_stop_dev_exit ;;  # 其他异常透传
esac
```

`exit 99` 对外（Claude Code）不会暴露——Claude Code 只看 stop.sh 的最终 exit code，stop.sh 在 fall-through 路径下最终走到 line 109 的 `exit 0`（默认放行）。

### classify_session 末尾三态

`devloop_check.sh` 内 classify_session 末尾改成：

```bash
case "$_final_status" in
    done)    return 0 ;;
    not-dev) return 99 ;;
    *)       return 2 ;;
esac
```

注意：`return 99` 仅用于 classify_session 函数内部 → stop-dev.sh 直接读 stdout JSON status 字段，不依赖 return code 区分（实际上 stop-dev.sh 用的就是 status 字段）。但保留 return 99 让 classify_session 函数对 bash 调用方语义自洽。

### 测试文件适配

需要更新 4 个测试文件中**特定 not-dev 场景**的 EXIT 期望：

1. `packages/engine/tests/hooks/stop-hook-exit-codes.test.ts` — 部分场景断言 `EXIT:0` 改为 `EXIT:99`（仅 not-dev 场景，主分支聊天 / bypass 等）
2. `packages/engine/tests/hooks/stop-hook-session-isolation.test.ts` — 同上
3. `packages/engine/tests/e2e/dev-workflow-e2e.test.ts` — Phase 7.4 [S4] 场景 `EXIT=0` 改为 `EXIT=99`（empty 目录 not-dev）
4. `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts` — 部分非 dev 场景断言适配
5. `packages/engine/tests/integration/devloop-classify.test.sh` — Case 不变（断言 status 字段，不依赖 exit code）

实施时**逐个 grep "EXIT:0"** 看断言对应的场景：
- 场景对应 `done`（PR 真完成）→ EXIT:0 不变
- 场景对应 `not-dev`（普通对话 / bypass / 主分支）→ 改为 EXIT:99
- 场景对应 `blocked` → EXIT:2 不变

## 测试策略

按 Cecelia 测试金字塔分类：

- **既有 E2E（rigid，必须 100% 回归）**：
  - `stop-hook-full-lifecycle.test.ts` 12 场景（部分场景适配 EXIT:99）
  - `dev-workflow-e2e.test.ts` Phase 7.4（[S4] 适配 EXIT=99）
  - `engine-dynamic-behavior.test.ts`（无影响）
  - `stop-hook-exit-codes.test.ts` 174+ 场景（not-dev 场景断言 EXIT:99）
  - `stop-hook-exit.test.ts`（无影响）
  - `stop-hook-session-isolation.test.ts`（部分适配）

- **既有 integration**：
  - `devloop-classify.test.sh` 10 case（status 字段不变，无需适配）

- **新增 unit**：不需要（行为不变，仅出口码语义分离）

- **CI 守护更新**：
  - `scripts/check-single-exit.sh` 新增 `exit 99 = 1`、`return 99 = 1`、`exit 2 = 1` 验收

## CI 守护脚本扩展

`scripts/check-single-exit.sh` 新增检查：

```bash
# stop-dev.sh：三态各 1 个出口
check_count "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" '\bexit 0\b' 1 "stop-dev.sh exit 0"
check_count "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" '\bexit 99\b' 1 "stop-dev.sh exit 99"
check_count "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" '\bexit 2\b' 1 "stop-dev.sh exit 2"

# devloop-check.sh classify_session 末尾三态 case
check_count "$REPO_ROOT/packages/engine/lib/devloop-check.sh" '\breturn 99\b' 1 "devloop-check.sh return 99"
```

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| Claude Code 看到 stop.sh 最终 exit 99 误判为 error | stop.sh 路由层对 exit 99 fall-through，最终 stop.sh 自己 exit 0；exit 99 仅在 stop-dev → stop.sh 内部 |
| 测试场景识别错误（误把 done 改成 EXIT:99）| 实施时**逐个**审查测试断言对应的场景 setup（看 .dev-mode 内容、git 分支、cleanup_done 字段） |
| 用户 zsh 终端跑 bash hook，exit 99 被 zsh 解释为 SIGSPECIFIC | exit 99 是合法 bash exit code（< 128），zsh 不会特殊处理 |
| working tree stash@{0} 与新 worktree 代码差异 | stash 基于 main 状态做的，worktree 也是基于 main，apply stash 应该干净。如有冲突按提示 resolve |

## 验收清单

- [BEHAVIOR] `sed 's/#.*//' packages/engine/hooks/stop-dev.sh | grep -cE '\bexit 0\b'` = 1
- [BEHAVIOR] `sed 's/#.*//' packages/engine/hooks/stop-dev.sh | grep -cE '\bexit 99\b'` = 1
- [BEHAVIOR] `sed 's/#.*//' packages/engine/hooks/stop-dev.sh | grep -cE '\bexit 2\b'` = 1
- [BEHAVIOR] `sed 's/#.*//' packages/engine/lib/devloop-check.sh | grep -cE '\breturn 99\b'` = 1
- [BEHAVIOR] check-single-exit.sh 通过（守护脚本扩展）
- [BEHAVIOR] 12 场景 E2E 适配后 100% 通过
- [BEHAVIOR] 174+ stop-hook-exit-codes 适配后通过
- [BEHAVIOR] 10 分支 integration 不变（status 字段断言）
- [BEHAVIOR] stop.sh 路由层接收 exit 99 后 fall-through 不报错
- [ARTIFACT] Engine 版本 bump 18.17.1 → 18.18.0（minor，新增 stop hook 协议三态语义）

## 实施顺序

1. apply stash@{0}（v20.1.0-strict-tristate-exit-codes-pending-dev）到新 worktree
2. 跑全套测试看哪些过 / 哪些 fail
3. 修 fail 的测试断言（逐个对应场景判定 EXIT 期望）
4. 扩展 check-single-exit.sh 守护
5. Engine 版本 bump 18.17.1 → 18.18.0
6. feature-registry.yml 加 18.18.0 changelog
7. Learning 文件
