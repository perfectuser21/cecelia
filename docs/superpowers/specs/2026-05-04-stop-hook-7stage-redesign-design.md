# Stop Hook 7 阶段重设计 — Design Spec

> 分支: cp-0504214049-stop-hook-redesign-7stage
> 日期: 2026-05-04
> 前置 PR: cp-0504205421-stop-allow-fix (#2761) — stop hook 9 段闭环已合
> 本 PR: 第 10 段（按段计）

## 1. 背景与动机

今晚 wave2 PR 三连（#2762 plan doc / #2763 Learning / #2764 fail-test+impl）实战暴露 stop hook 4 个设计盲区：

1. **CI status="completed" 误判为绿** — `verify_dev_complete` 用 `gh run list --limit 1 --json status` 取 `status` 字段（in_progress/completed），不看 `conclusion`（success/failure）。CI conclusion=failure 时仍走 "completed → 启 auto-merge" 分支，GitHub 因 BLOCKED 拒绝合并 → stop hook 反复反馈"启 auto-merge"死循环。
2. **CI 失败时无 retry 反馈协议** — `verify_dev_complete` 没有 P3 (CI failed) 分支，assistant 拿不到"修哪个 fail job、看哪条 log"的信号，无法主动修代码 push。
3. **merge 后无 deploy workflow 验证** — `cleanup.sh` 内 `deploy-local.sh` 是 fire-and-forget（`setsid ... &`），且 `verify_dev_complete` 不监听 `brain-ci-deploy.yml` workflow run conclusion。merge 完 deploy 是否成功无人盯。
4. **无 health 探针** — 没有 `GET /api/brain/health` 200 验证。stop hook X0 在 `cleanup.sh exit 0` 就放，但 cleanup.sh exit 0 ≠ deploy 成功 ≠ Brain 服务存活。

附带顺手修：`packages/brain/src/monitor-loop.js:107` `result.rows[0]` 可能为 undefined（CI 测试 mock 场景）→ 一行 guard `|| {}`。

## 2. 设计目标

stop hook 必须卡在以下 7 个时点（P0-P7），任一未满足都 block：

```
P1  PR 未创建        → block: 立即 push + gh pr create
P2  PR CI 进行中     → block + foreground 轮询 conclusion
P3  PR CI 失败       → block: "修 fail job X，log URL Y"  ← 新增
P4  PR CI 通过未合   → block: auto-merge / squash
P5  merged，等 deploy workflow conclusion=success ← 新增
P6  deploy 完成，等 GET /api/brain/health 200 (60×5s) ← 新增
P7  health 200 后写 Learning（如未写）→ block 写 Learning
P0  全过 → done → rm .cecelia/dev-active → exit 0
```

信号源全部走 GitHub API + HTTP probe，不再读本地 `.dev-mode` 字段（merge 后 `.dev-mode` 可能被 stop hook 自删）。

## 3. 架构

### 3.1 verify_dev_complete 重写（packages/engine/lib/devloop-check.sh:540-635）

**当前 7 阶段决策树**（伪代码）：

```bash
verify_dev_complete(branch, worktree_path, main_repo) {
    # P1: gh pr list --head $branch
    pr_number=...
    if [[ -z "$pr_number" ]]; then
        return blocked + "立即 push + gh pr create"
    fi

    # P2/P3/P4: gh run list --workflow CI --branch $branch --limit 1 --json status,conclusion
    ci_status=...
    ci_conclusion=...

    case "$ci_status" in
        in_progress|queued|waiting|pending)
            return blocked + "等 CI 完成 (gh pr checks $pr --watch)"
            ;;
        completed)
            case "$ci_conclusion" in
                success)
                    pr_merged_at=$(gh pr view ...)
                    if [[ -z "$pr_merged_at" ]]; then
                        return blocked + "auto-merge: gh pr merge $pr --squash --auto"
                    fi
                    # 进入 P5
                    ;;
                failure|cancelled|timed_out)
                    failed_jobs=$(gh pr checks $pr | grep fail | head -3)
                    log_url=$(gh run view $run_id --json jobs -q '.jobs[] | select(.conclusion=="failure") | .url' | head -1)
                    return blocked + "CI 失败：$failed_jobs。看 log: $log_url。修代码 → commit → push 触发新 CI"
                    ;;
                *)
                    return blocked + "CI conclusion 异常: $ci_conclusion"
                    ;;
            esac
            ;;
    esac

    # P5: brain-ci-deploy.yml workflow run conclusion
    deploy_run=$(gh run list --workflow brain-ci-deploy.yml --branch main --limit 1 --json status,conclusion,databaseId,headSha)
    deploy_status=...
    deploy_conclusion=...
    merge_sha=$(gh pr view $pr --json mergeCommit -q .mergeCommit.oid)
    deploy_head=$(echo $deploy_run | jq -r '.[0].headSha')

    if [[ "$merge_sha" != "$deploy_head"* ]]; then
        # deploy workflow 还没触发或未跑到 merge sha
        return blocked + "等 brain-ci-deploy.yml 触发（合并 SHA $merge_sha）"
    fi

    case "$deploy_status" in
        in_progress|queued)
            return blocked + "deploy workflow 进行中，gh run watch $deploy_run_id"
            ;;
        completed)
            if [[ "$deploy_conclusion" != "success" ]]; then
                return blocked + "deploy 失败 ($deploy_conclusion)，看 gh run view $deploy_run_id --log-failed"
            fi
            ;;
    esac

    # P6: health probe
    BRAIN_HEALTH_URL="${BRAIN_HEALTH_URL:-http://localhost:5221/api/brain/health}"
    for i in {1..60}; do
        if curl -fsS --max-time 3 "$BRAIN_HEALTH_URL" >/dev/null 2>&1; then
            break
        fi
        sleep 5
        [[ $i -eq 60 ]] && return blocked + "health probe 60×5s 超时: $BRAIN_HEALTH_URL"
    done

    # P7: Learning 文件
    if [[ "$harness_mode" != "true" ]]; then
        learning_file="$main_repo/docs/learnings/$branch.md"
        if [[ ! -f "$learning_file" ]] || ! grep -q "^### 根本原因" "$learning_file"; then
            return blocked + "立即写 Learning: $learning_file"
        fi
    fi

    return done
}
```

### 3.2 stop-dev.sh 配合（packages/engine/hooks/stop-dev.sh）

无需改动核心 dispatch。仅在 done 路径加注释说明：done 来自 P7 通过，不是 cleanup.sh exit 0。

P3 (CI failed) 反馈中的 "log URL Y" 让 assistant 能直接 `gh run view $id --log-failed` 看错误，不需要先猜 run id。

### 3.3 cleanup.sh 解耦（packages/engine/skills/dev/scripts/cleanup.sh）

**保留**：cleanup.sh 仍在 verify_dev_complete 走完 P5/P6 后由 stop-dev.sh done 路径前调用（归档 PRD/DoD、清理 git config）。

**移除**：cleanup.sh 不再调 `deploy-local.sh`（deploy 走 brain-ci-deploy.yml workflow，本机 deploy-local 重复且不可观测）。删除第 293-309 行的 `deploy-local.sh` 调用块。

**新位置**：cleanup.sh 调用挪到 verify_dev_complete P7 通过后、return done 前——确保归档 + git config 清理只在真完成时跑。

### 3.4 monitor-loop.js guard（packages/brain/src/monitor-loop.js:107）

```js
const result = await pool.query(query);
const row = result.rows[0] || {};   // ← 一行 guard
return {
    failed_count: parseInt(row.failed_count) || 0,
    ...
};
```

`parseInt(undefined) || 0 = 0`，row 是 `{}` 时 `parseInt(undefined)` 返回 NaN，`NaN || 0 = 0`，行为正确。

## 4. 数据流

```
push                                 ← assistant
   ↓
gh pr create                         ← assistant (P1 → P2)
   ↓
CI workflow runs                     ← GitHub Actions
   ↓
verify_dev_complete reads:
  - gh pr list --head <branch>           (P1)
  - gh run list --workflow CI ...        (P2/P3/P4)
  - gh pr view <pr> --json mergedAt      (P4 → P5)
  - gh run list --workflow brain-ci-deploy.yml ...   (P5)
  - curl GET /api/brain/health           (P6)
  - test -f Learning && grep             (P7)
   ↓
all OK → cleanup.sh                  ← stop-dev.sh done 路径
   ↓
rm .cecelia/dev-active-*.json
   ↓
exit 0 (turn 真停)
```

## 5. 错误处理

| 阶段 | 失败 | 反馈格式 | 期望 assistant 动作 |
|---|---|---|---|
| P1 | PR 未建 | "立即 push + gh pr create" | 执行 |
| P2 | CI 进行中 | "等 CI: gh pr checks $pr --watch" | foreground 阻塞 |
| P3 | CI 失败 | "CI 失败：$jobs。log: $url。修 → commit → push" | 看 log → 修代码 → 新 commit → push 触发新 CI run |
| P4 | PR 未合 | "auto-merge: gh pr merge $pr --squash --auto" | 执行 |
| P5 | deploy 未触发 | "等 brain-ci-deploy.yml 触发 (sha $merge_sha)" | 等 |
| P5 | deploy 失败 | "deploy 失败：log $url" | 看 log → 修 → 新 PR |
| P6 | health 超时 | "health probe 60×5s 超时: $url" | 检查 deploy log + Brain server 进程 |
| P7 | Learning 缺 | "立即写 Learning $file" | 写 |

P3 是关键新分支：assistant 收到 fail job 名 + log URL，直接 `gh run view --log-failed` 看错误，修代码 commit push。这是今晚 wave2 死锁的根本解。

## 6. 测试策略

按 Cecelia 测试金字塔四档：

| 测试类型 | 文件 | 覆盖 |
|---|---|---|
| **Unit** | `packages/engine/tests/unit/verify-dev-complete.test.sh` | 7 阶段 case：P1-P7 各分支输入输出（已有 21 case，扩到 ~28 case，加 P3/P5/P6 mock 子段） |
| **Integration** | `packages/engine/tests/integration/stop-hook-7stage-flow.test.sh` | 模拟完整 P1→P7 链路（用 mock GitHub API + mock health endpoint），验证状态机正确切换 |
| **E2E** | `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts` | 现有 12 场景扩 3 场景（P3 CI 失败、P5 deploy 失败、P6 health 超时） |
| **Smoke** | `packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh` | 真起 docker compose Brain，跑 P6 真 health probe，验证 60×5s loop 行为 |
| **Brain Unit** | `packages/brain/src/__tests__/monitor-loop.test.js` | monitor-loop guard 单测：mock pool.query 返回 `{rows: []}` 验证不抛 |

**TDD 顺序**：每个 task commit-1 fail test / commit-2 impl。

## 7. 关键文件清单

| 文件 | 改动 |
|---|---|
| `packages/engine/lib/devloop-check.sh:540-635` | verify_dev_complete 重写为 7 阶段决策树 |
| `packages/engine/hooks/stop-dev.sh` | done 路径注释更新（无逻辑改） |
| `packages/engine/skills/dev/scripts/cleanup.sh:293-309` | 删 deploy-local.sh 调用块 |
| `packages/brain/src/monitor-loop.js:107` | row guard `|| {}` |
| `packages/engine/tests/unit/verify-dev-complete.test.sh` | 扩 28 case |
| `packages/engine/tests/integration/stop-hook-7stage-flow.test.sh` | 新 |
| `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts` | 加 3 场景 |
| `packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh` | 新 |
| `packages/brain/src/__tests__/monitor-loop.test.js` | 新（guard 单测） |
| 8 处版本文件 | bump 18.20.0 |

## 8. Out of Scope

- 不动 worktree-manage.sh / worktree-gc.sh
- 不动 `.dev-mode` 文件用途（仍是 worktree 元数据缓存）
- 不引入 retry 次数限制（Cecelia Bot worker 可无限推 fix commit）
- 不动 PreToolUse 拦截器（PR #2759 行为 bug 终结仍生效）

## 9. 后续段（不在本 PR）

- 第 11 段（如有）：deploy timeout 后的自动回滚信号
- 第 12 段（如有）：Brain server 主进程心跳监控（不只 HTTP /health）
