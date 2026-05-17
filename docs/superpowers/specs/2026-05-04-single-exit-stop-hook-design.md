# Stop Hook 单一 exit 0 重构 — 设计 spec

分支：`cp-0504114459-single-exit-stop-hook`
Brain Task：`24152bde-41d6-49c4-9344-78f60477e570`
日期：2026-05-04

## 背景与根因诊断

Stop Hook trio 在过去 60 天内修复 64 次仍不收敛。`cwd-as-key` 切线（4/21）声明"99 commit 终结"，但合并后 13 天内又出 5+ 次"再终结"修复（Phase 7.x bash 加固、4/11 single-exit 删 ready_to_merge、5/2 v4.6.0 harness 单一 exit 0、5/3 self-drive-health 衍生）。

根因是**散点 exit 0 = 多攻击面**：

- `stop-dev.sh`（85 行）有 **7 个独立 `exit 0`** 语句（bypass / cwd 不是目录 / git rev-parse 失败 ×2 / 主分支 / 无 .dev-mode / devloop_check done）
- `devloop-check.sh`（416 行）有 **5 个独立 `return 0`**（cleanup_done / PR merged + step4 / PR merged + cleanup ok / auto-merge 成功 / auto-merge + cleanup ok）

合计 **12 个"真停"出口**。任何一处误放行就 PR 没合就退场。历史最经典案例（4/21 learning 记录）：老 stop.sh 里 session_id 不匹配 → exit 0 早退，导致**所有** dev session 全放行，stop-dev 的业务逻辑从未被调用过。99 commit 的 fix 都在修 stop-dev 内部 bug，真凶在 stop.sh 第 100 行。

## 目标

将"真停"出口归一到 **stop-dev.sh 唯一 1 个 `exit 0` 语句**、**devloop-check.sh 唯一 1 个 `return 0` 语句**。所有判断收敛到 status 字段，控制流不再分歧。CI grep 卡死，永远阻止散点出口复活。

## 不做（明确边界）

- 不改 hooks/stop.sh（路由层）
- 不动业务逻辑：auto-merge、cleanup.sh、CI 等待、Brain 回写、DoD 检查、harness 分叉、ci_fix_count、conversation-summary 全部保留原行为
- 不改 worktree-manage.sh、.dev-mode 字段、cleanup.sh
- 不引入 jq 之外的新依赖
- 不改 12 场景 E2E 测试的契约

## 设计方案：单 exit 0 statement（方案 C）

### 核心拓扑

```bash
# stop-dev.sh（重构后）
#!/usr/bin/env bash
set -euo pipefail

# 1. 加载 devloop-check.sh 库
source "$DEVLOOP_LIB"

# 2. 单一决策：classify 返回 JSON {status, reason, action, ci_run_id}
result=$(classify_session "${CLAUDE_HOOK_CWD:-$PWD}")
status=$(echo "$result" | jq -r '.status')

# 3. 全文唯一 case + 唯一 exit 0
case "$status" in
    not-dev|done)
        echo "$result"
        exit 0          # ← 全文唯一 exit 0
        ;;
    *)
        echo "$result"
        exit 2
        ;;
esac
```

### `classify_session()` 函数（在 devloop-check.sh）

签名：`classify_session(cwd) → JSON`

返回 status 取值：
- `not-dev` — 不在 dev 上下文，应放行（对应原 6 个早退）
- `done` — 业务真完成（PR merged + step_4 + cleanup ok）
- `blocked` — 还得继续干活（assistant 应继续）

内部分支：
1. **bypass / cwd 异常**（原 stop-dev.sh L22, L26, L29-30）→ `{status: "not-dev", reason: "bypass"|"no-cwd"|"no-git"}`
2. **主分支 / 无 .dev-mode**（原 L34, L39）→ `{status: "not-dev", reason: "main-branch"|"no-dev-mode"}`
3. **格式异常**（原 L60）→ `{status: "blocked", reason: "format-error"}`
4. **业务判定**（调原 devloop_check 内部逻辑）→ status 来自 devloop_check 输出

### `devloop_check()` 函数改造

把内部 5 处 `return 0` 全部改成 `return` 不带数字（默认 0），**但通过 stdout JSON status 字段携带语义**。

控制流改成：
```bash
devloop_check() {
    local result_json
    
    # ... 各条件依次填 result_json ...
    # 条件 0.1 cleanup_done: result_json='{"status":"done","reason":"..."}' ; goto END
    # 条件 5 PR merged: 跑 cleanup → result_json={status:done|blocked, ...} ; goto END
    # 条件 6 auto-merge: 跑 merge → result_json={status:done|blocked, ...} ; goto END
    # blocked: result_json={status:blocked, ...}
    
    END:
    echo "$result_json"
    return    # ← 全文唯一 return（默认 0），状态由 status 字段携带
}
```

调用方（stop-dev / 旧 stop-architect / stop-decomp）只看 stdout JSON 的 status 字段决定 exit code，不再依赖 return code 分歧。

### 控制流归一手法

把"分支条件 + return 0"改成"分支条件 + 赋值 result_json + goto END"。bash 没有 goto，用一个外层 `while :; do ... break; done` 包住所有条件，每条件 `result_json=...; break`。最后单一 `echo + return`。

伪代码：
```bash
devloop_check() {
    local result_json='{"status":"blocked","reason":"unknown"}'
    
    while :; do
        # 条件 0 harness_mode 预检
        # ...
        
        # 条件 0.1 cleanup_done
        if [[ "$_harness_mode" != "true" ]] && grep -q "cleanup_done: true" ...; then
            result_json='{"status":"done","reason":"cleanup_done"}'
            break
        fi
        
        # 条件 0.5 / 1 / 2 / 2.6 / 3 / 4 ...
        # 每条件赋 result_json + break
        
        # 条件 5 PR merged
        if [[ "$pr_state" == "merged" ]]; then
            # ... cleanup + 决定 result_json status ...
            break
        fi
        
        # 条件 6 auto-merge
        # ... gh pr merge + 决定 result_json ...
        break
    done
    
    echo "$result_json"
    return    # ← 唯一 return
}
```

`devloop_check_main()`（直接执行入口，会话压缩诊断用）保持现状，只读取 status 字段不变。

## 测试策略

按 Cecelia 测试金字塔分类：

- **E2E（rigid）**：`packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts` 既有 12 场景全跑，断言所有场景的 exit code 与重构前一致（行为保留）。这是 cwd-as-key 时期建立的回归契约，本次重构必须 100% 通过。
- **integration**：新增 `packages/engine/tests/integration/devloop-classify.test.sh`，覆盖 `classify_session` 函数的 8 个分支：
  1. bypass env → not-dev
  2. cwd 不是目录 → not-dev
  3. git rev-parse 失败 → not-dev
  4. 主分支 → not-dev
  5. 无 .dev-mode → not-dev
  6. .dev-mode 格式异常 → blocked
  7. devloop_check 返回 done → done
  8. devloop_check 返回 blocked → blocked
- **unit**：不需要（bash 函数没有可测的纯逻辑单元，所有判断都涉及文件 / git / gh）。

## CI 守护（机器化）

新增 `scripts/check-single-exit.sh`（在 lint phase 跑）：

```bash
#!/usr/bin/env bash
set -euo pipefail

check_count() {
    local file="$1" pattern="$2" expected="$3"
    local count
    count=$(grep -cE "$pattern" "$file" || echo 0)
    if [[ "$count" -ne "$expected" ]]; then
        echo "❌ $file: '$pattern' 出现 $count 次（期望 $expected）"
        return 1
    fi
}

check_count packages/engine/hooks/stop-dev.sh   '^[[:space:]]*exit 0' 1
check_count hooks/stop-dev.sh                    '^[[:space:]]*exit 0' 1
check_count packages/engine/lib/devloop-check.sh '^[[:space:]]*return 0|^[[:space:]]*return$' 1

echo "✅ 单一出口检查通过"
```

接入位置：`.github/workflows/engine-ci.yml` 的 lint job（与 lint-test-pairing 等并列）。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 重写 devloop_check 控制流引入业务行为变化 | 严格逐条件对照原代码，并通过 12 场景 E2E 全量回归 |
| `while:; break` 模式难以阅读 | 函数顶部加注释明确"单一出口模式"，每条件块的 break 紧跟语义注释 |
| CI grep 误判（注释中的 `exit 0`） | 正则锚定行首 + 可选空白：`^[[:space:]]*exit 0` |
| harness 模式分叉残留 | 不动 harness 业务，仅把 harness 通道里的 `return 0` 也归一 |

## 验收清单

- [BEHAVIOR] `grep -cE '^[[:space:]]*exit 0' packages/engine/hooks/stop-dev.sh` = 1
- [BEHAVIOR] `grep -cE '^[[:space:]]*exit 0' hooks/stop-dev.sh` = 1
- [BEHAVIOR] `grep -cE '^[[:space:]]*return 0|^[[:space:]]*return$' packages/engine/lib/devloop-check.sh` = 1
- [BEHAVIOR] 12 场景 E2E 全部通过：`tests/e2e/stop-hook-full-lifecycle.test.ts`
- [BEHAVIOR] `classify_session` 8 分支测试通过：`tests/integration/devloop-classify.test.sh`
- [ARTIFACT] `scripts/check-single-exit.sh` 存在且可执行
- [ARTIFACT] `engine-ci.yml` 接入 check-single-exit lint job

## 实施顺序（writing-plans 阶段决定具体 task 拆分）

1. 新增 `classify_session()` 函数（在 devloop-check.sh 末尾）+ integration test 红灯
2. 改写 `devloop_check()` 控制流为单一出口（while:; break 模式）+ E2E 红灯/绿灯
3. 重构 stop-dev.sh 为 case + 单一 exit 0
4. 镜像同步 hooks/stop-dev.sh（双向：packages/engine/hooks/ 是源，hooks/ 是部署副本）
5. 新增 check-single-exit.sh + 接入 engine-ci.yml
6. Engine 版本 bump（5 文件：package.json、package-lock.json、VERSION、.hook-core-version、regression-contract.yaml）
7. feature-registry.yml 加 changelog + 跑 generate-path-views.sh
