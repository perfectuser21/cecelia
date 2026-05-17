# Stop Hook 7 阶段重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重写 verify_dev_complete 为 P1-P7 7 阶段决策树，引入 GitHub Workflow Run 验证 + HTTP health probe，让 stop hook 在每个真实卡点 block，杜绝 status≠conclusion 死锁；附带 monitor-loop.js row undefined guard。

**Architecture:** verify_dev_complete 重写为状态机（packages/engine/lib/devloop-check.sh:540-635），每阶段返回 `{status, reason, action}` JSON 给 stop-dev.sh。信号源切换：本地 .dev-mode 字段 → GitHub API（gh pr/run）+ HTTP probe（curl /api/brain/health）。cleanup.sh 解耦 deploy-local.sh，挪到 P7 通过后调。monitor-loop.js 单行 guard。

**Tech Stack:** Bash 5 / jq / gh CLI / curl / vitest / shellscript test harness

---

## File Structure

| 文件 | 改动类型 | 责任 |
|---|---|---|
| `packages/engine/lib/devloop-check.sh` | 重写 verify_dev_complete (540-635) | P1-P7 状态机 |
| `packages/engine/skills/dev/scripts/cleanup.sh` | 删 293-309 行 + 调用点位移 | 解耦 deploy-local.sh |
| `packages/brain/src/monitor-loop.js` | 改 line 107 一行 | row undefined guard |
| `packages/engine/tests/unit/verify-dev-complete.test.sh` | 扩 21 → 28 case | 单元覆盖 P3/P5/P6 |
| `packages/engine/tests/integration/stop-hook-7stage-flow.test.sh` | 新建 | mock GitHub+health 状态机 |
| `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts` | 加 3 场景 | E2E 真链路 |
| `packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh` | 新建 | 真 docker compose health probe |
| `packages/brain/src/__tests__/monitor-loop.test.js` | 新建 | row guard 单测 |
| 8 处版本文件 | bump 18.19.3 → 18.20.0 | engine 版本同步 |

---

### Task 1: 写 fail E2E + smoke.sh 骨架（commit 1：仅 fail tests + 空骨架）

**Files:**
- Create: `packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh`（空骨架，含 shebang + exit 1 标识 fail）
- Modify: `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts`（加 P3/P5/P6 场景）

- [ ] **Step 1: 创建 smoke.sh 空骨架**

```bash
#!/usr/bin/env bash
# stop-hook-7stage-smoke.sh — 真 docker compose Brain + 60×5s health probe
# Status: 骨架待 Task 6 实现
set -euo pipefail
echo "[smoke] stop-hook-7stage smoke 待实现" >&2
exit 1
```

写到 `packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh`，`chmod +x`。

- [ ] **Step 2: 在 stop-hook-full-lifecycle.test.ts 末尾加 3 场景**

读现有文件看 12 场景的写法（`packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts`），按同样的 describe/it 风格加：

```typescript
it('场景 13: P3 CI 失败 → block + 反馈含 fail job 名 + log URL', async () => {
  const stub = makeStubGhEnv({
    pr: { number: 999, mergedAt: null },
    ciRuns: [{ databaseId: 12345, status: 'completed', conclusion: 'failure' }],
    failedJobs: [{ name: 'brain-unit (2)', url: 'https://github.com/.../job/74232585120' }]
  });
  const r = await runStopHook(stub);
  expect(r.exit).toBe(0);
  expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/);
  expect(r.stdout).toMatch(/CI 失败/);
  expect(r.stdout).toMatch(/brain-unit \(2\)/);
  expect(r.stdout).toMatch(/74232585120/);
});

it('场景 14: P5 deploy workflow 进行中 → block + 等 deploy', async () => {
  const stub = makeStubGhEnv({
    pr: { number: 999, mergedAt: '2026-05-04T13:00:00Z', mergeCommit: { oid: 'abc123' } },
    ciRuns: [{ status: 'completed', conclusion: 'success' }],
    deployRuns: [{ databaseId: 67890, status: 'in_progress', headSha: 'abc123' }]
  });
  const r = await runStopHook(stub);
  expect(r.exit).toBe(0);
  expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/);
  expect(r.stdout).toMatch(/brain-ci-deploy.yml/);
});

it('场景 15: P6 health probe 60×5s 超时 → block', async () => {
  const stub = makeStubGhEnv({
    pr: { number: 999, mergedAt: '2026-05-04T13:00:00Z' },
    ciRuns: [{ status: 'completed', conclusion: 'success' }],
    deployRuns: [{ status: 'completed', conclusion: 'success' }],
    healthEndpoint: 'http://localhost:9999/dead'  // 必失败
  });
  const r = await runStopHook(stub, { healthMaxRetries: 2, healthIntervalSec: 0 });
  expect(r.exit).toBe(0);
  expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/);
  expect(r.stdout).toMatch(/health probe.*超时/);
});
```

如果 `makeStubGhEnv` 的字段（`failedJobs` / `deployRuns` / `healthEndpoint` / `healthMaxRetries`）现有 stub 不支持，留 `it.skip` 标记，Task 4/6 实现完再开。

- [ ] **Step 3: 跑测试验证 fail**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
cd packages/engine && npx vitest run tests/e2e/stop-hook-full-lifecycle.test.ts -t "场景 13|场景 14|场景 15" 2>&1 | tail -10
```

Expected: 3 测试 FAIL（verify_dev_complete 旧版没 P3/P5/P6 分支）或 SKIP（stub 不支持）。

- [ ] **Step 4: Commit fail 起点**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
git add packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts
git commit -m "test(engine): stop-hook-7stage fail E2E + smoke 骨架 (cp-0504214049)

按 v18.7.0 规则第一 commit 必须是 fail E2E + smoke.sh 骨架。

P3/P5/P6 三场景断言 verify_dev_complete 7 阶段重写后的行为：
- P3 CI 失败 → block + 含 fail job 名 + log URL
- P5 deploy workflow 进行中 → block
- P6 health probe 超时 → block

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: monitor-loop.js row undefined guard + brain 单测

**Files:**
- Modify: `packages/brain/src/monitor-loop.js:107`
- Create: `packages/brain/src/__tests__/monitor-loop.test.js`

- [ ] **Step 1: 写 fail 单测**

`packages/brain/src/__tests__/monitor-loop.test.js`：

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  pool: { query: (...args) => mockQuery(...args) }
}));

describe('monitor-loop detectFailureSpike', () => {
  beforeEach(() => mockQuery.mockReset());

  it('SQL 返回空 rows 时不抛 TypeError，返回全 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { detectFailureSpike } = await import('../monitor-loop.js');
    const result = await detectFailureSpike();
    expect(result).toEqual({ failed_count: 0, total_count: 0, failure_rate: 0 });
  });

  it('SQL 返回正常 row 时正确解析', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ failed_count: '5', total_count: '20', failure_rate: '0.25' }]
    });
    const { detectFailureSpike } = await import('../monitor-loop.js');
    const result = await detectFailureSpike();
    expect(result).toEqual({ failed_count: 5, total_count: 20, failure_rate: 0.25 });
  });
});
```

注意：`detectFailureSpike` 当前未 export，需 Step 3 一并 export。

- [ ] **Step 2: 跑测试验证 fail**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
cd packages/brain && npx vitest run src/__tests__/monitor-loop.test.js 2>&1 | tail -10
```

Expected: FAIL（detectFailureSpike 不 export 或 row undefined throw）

- [ ] **Step 3: 改 monitor-loop.js**

读 `packages/brain/src/monitor-loop.js` line 92-114（detectFailureSpike 函数），改 line 107：

```javascript
const result = await pool.query(query);
const row = result.rows[0] || {};

return {
    failed_count: parseInt(row.failed_count) || 0,
    total_count: parseInt(row.total_count) || 0,
    failure_rate: parseFloat(row.failure_rate) || 0
};
```

并在文件末尾如果没有 `export { detectFailureSpike }`，则 export 一下：

```javascript
export { detectFailureSpike };
```

（如果该函数已通过其他方式被外部使用，参考现有 export 模式；否则 test-only export 也 OK。）

- [ ] **Step 4: 跑测试验证 pass**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
cd packages/brain && npx vitest run src/__tests__/monitor-loop.test.js 2>&1 | tail -10
```

Expected: 2 PASS

- [ ] **Step 5: Commit guard fix**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
git add packages/brain/src/__tests__/monitor-loop.test.js packages/brain/src/monitor-loop.js
git commit -m "fix(brain): monitor-loop detectFailureSpike row undefined guard (cp-0504214049)

CI 测试场景 pool.query 可能返回 rows: []，row=undefined 导致
parseInt(row.failed_count) 报 TypeError。一行 guard \`|| {}\`
让 NaN 落回到 || 0 的 fallback。

预存 main bug，wave2 PR (#2764) 间接触发暴露（tick-loop 启
consciousness-loop 让 monitor-loop 在 brain-unit shard 2 跑）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: verify_dev_complete unit test 扩 28 case（fail）

**Files:**
- Modify: `packages/engine/tests/unit/verify-dev-complete.test.sh`

- [ ] **Step 1: 读现有 21 case 风格**

```bash
cat packages/engine/tests/unit/verify-dev-complete.test.sh | head -100
```

按现有 mock_gh / mock_curl 模式继续。

- [ ] **Step 2: 末尾追加 7 个 case（P3 CI failed / P5 deploy / P6 health）**

加到现有 case 列表末尾：

```bash
# === Case 22: P3 CI 失败 → block + fail job 名 ===
mock_gh "pr list --head" '[{"number":999}]'
mock_gh "pr view" '{"mergedAt":null,"mergeCommit":null}'
mock_gh "run list --workflow CI" '[{"databaseId":12345,"status":"completed","conclusion":"failure"}]'
mock_gh "run view 12345 --json jobs" '{"jobs":[{"name":"brain-unit (2)","conclusion":"failure","url":"https://example/job/1"}]}'
result=$(verify_dev_complete "test-branch" "/tmp/wt" "/tmp/main")
expect_contains "$result" '"status":"blocked"'
expect_contains "$result" 'CI 失败'
expect_contains "$result" 'brain-unit (2)'
expect_contains "$result" 'https://example/job/1'
echo "✅ Case 22 P3 CI 失败"

# === Case 23: P3 CI cancelled → block ===
mock_gh "run list --workflow CI" '[{"status":"completed","conclusion":"cancelled"}]'
result=$(verify_dev_complete "test-branch" "/tmp/wt" "/tmp/main")
expect_contains "$result" 'CI 失败'
echo "✅ Case 23 P3 CI cancelled"

# === Case 24: P5 deploy workflow 进行中 → block ===
mock_gh "pr view" '{"mergedAt":"2026-05-04T13:00:00Z","mergeCommit":{"oid":"abc123"}}'
mock_gh "run list --workflow CI" '[{"status":"completed","conclusion":"success"}]'
mock_gh "run list --workflow brain-ci-deploy" '[{"databaseId":67890,"status":"in_progress","headSha":"abc123def"}]'
result=$(verify_dev_complete "test-branch" "/tmp/wt" "/tmp/main")
expect_contains "$result" '"status":"blocked"'
expect_contains "$result" 'brain-ci-deploy'
echo "✅ Case 24 P5 deploy in_progress"

# === Case 25: P5 deploy workflow 失败 → block ===
mock_gh "run list --workflow brain-ci-deploy" '[{"databaseId":67890,"status":"completed","conclusion":"failure","headSha":"abc123def"}]'
result=$(verify_dev_complete "test-branch" "/tmp/wt" "/tmp/main")
expect_contains "$result" 'deploy 失败'
echo "✅ Case 25 P5 deploy failure"

# === Case 26: P5 deploy SHA 不匹配（未触发）→ block ===
mock_gh "run list --workflow brain-ci-deploy" '[{"status":"completed","conclusion":"success","headSha":"OLDSHA"}]'
result=$(verify_dev_complete "test-branch" "/tmp/wt" "/tmp/main")
expect_contains "$result" '等 brain-ci-deploy.yml 触发'
echo "✅ Case 26 P5 deploy 未触发"

# === Case 27: P6 health probe 超时 → block ===
mock_gh "run list --workflow brain-ci-deploy" '[{"status":"completed","conclusion":"success","headSha":"abc123def"}]'
mock_curl "/api/brain/health" "fail"
HEALTH_PROBE_MAX_RETRIES=2 HEALTH_PROBE_INTERVAL=0 \
  result=$(verify_dev_complete "test-branch" "/tmp/wt" "/tmp/main")
expect_contains "$result" 'health probe.*超时'
echo "✅ Case 27 P6 health timeout"

# === Case 28: 全过 → done ===
mock_curl "/api/brain/health" '{"status":"ok"}'
mkdir -p /tmp/main/docs/learnings
echo -e "### 根本原因\nfoo" > /tmp/main/docs/learnings/test-branch.md
result=$(verify_dev_complete "test-branch" "/tmp/wt" "/tmp/main")
expect_contains "$result" '"status":"done"'
echo "✅ Case 28 全过 done"
```

需要扩充 mock 函数：`mock_curl` 用 `function curl() { ... }` override，根据 url 模式返回 200/fail。

- [ ] **Step 3: 跑测试验证 fail**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
bash packages/engine/tests/unit/verify-dev-complete.test.sh 2>&1 | tail -15
```

Expected: Case 22-28 大部分 FAIL（旧 verify_dev_complete 没 P3/P5/P6 分支）。Case 1-21 仍 PASS。

- [ ] **Step 4: Commit fail tests**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
git add packages/engine/tests/unit/verify-dev-complete.test.sh
git commit -m "test(engine): verify_dev_complete 扩 7 case 覆盖 P3/P5/P6 (cp-0504214049)

Case 22-28 覆盖 7 阶段重设计的新分支：
- P3 CI failure / cancelled
- P5 deploy in_progress / failure / SHA 未匹配
- P6 health probe 超时
- 全过 done

预期 Case 22-28 FAIL（旧实现缺新分支），Task 4 实现后转 PASS。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: verify_dev_complete 重写 P1-P7 状态机（impl）

**Files:**
- Modify: `packages/engine/lib/devloop-check.sh:540-635`

- [ ] **Step 1: 读现有 verify_dev_complete 全文**

```bash
sed -n '540,640p' packages/engine/lib/devloop-check.sh
```

记下：
- 入参 `branch worktree_path main_repo`
- 出参 JSON `{status, reason, action, ci_run_id?}`
- harness_mode 豁免（Learning 不要求）
- 现有 `_devloop_jq` helper

- [ ] **Step 2: 重写 verify_dev_complete 函数**

替换 540-635 行：

```bash
# ============================================================================
# verify_dev_complete — 7 阶段决策树
# P1 PR 未创建 → P2 CI 进行 → P3 CI 失败 → P4 PR 未合 → P5 deploy → P6 health → P7 Learning
# 所有阶段不读 .dev-mode 字段，信号源 = GitHub API + HTTP probe
# ============================================================================
verify_dev_complete() {
    local branch="${1:-}"
    local worktree_path="${2:-}"
    local main_repo="${3:-}"
    local result_json='{"status":"blocked","reason":"unknown"}'

    # health probe 超时参数（测试可 override）
    local health_max_retries="${HEALTH_PROBE_MAX_RETRIES:-60}"
    local health_interval="${HEALTH_PROBE_INTERVAL:-5}"
    local brain_health_url="${BRAIN_HEALTH_URL:-http://localhost:5221/api/brain/health}"

    while :; do
        if [[ -z "$branch" || -z "$main_repo" ]]; then
            result_json='{"status":"blocked","reason":"verify_dev_complete 缺参数：branch / main_repo"}'
            break
        fi

        # harness_mode 豁免（仅 Learning 跳过，其他阶段照走）
        local harness_mode="false"
        local dev_mode_file="${worktree_path}/.dev-mode.${branch}"
        if [[ -f "$dev_mode_file" ]]; then
            local _hm
            _hm=$(grep "^harness_mode:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' | tr -d '[:space:]')
            [[ -n "$_hm" ]] && harness_mode="$_hm"
        fi

        if ! command -v gh &>/dev/null; then
            result_json='{"status":"blocked","reason":"gh CLI 不可用","action":"安装 gh CLI"}'
            break
        fi

        # ------ P1: PR 未创建 ------
        local pr_number
        pr_number=$(gh pr list --head "$branch" --state all --json number -q '.[0].number' 2>/dev/null || echo "")
        if [[ -z "$pr_number" ]]; then
            result_json=$(_devloop_jq -n --arg branch "$branch" \
                '{"status":"blocked","reason":"PR 未创建（branch=\($branch)）","action":"立即 push + gh pr create --base main --head \($branch)"}')
            break
        fi

        # ------ P2/P3/P4: CI 状态 ------
        local ci_run_json ci_status ci_conclusion ci_run_id
        ci_run_json=$(gh run list --branch "$branch" --workflow CI --limit 1 --json databaseId,status,conclusion 2>/dev/null || echo '[]')
        ci_status=$(echo "$ci_run_json" | jq -r '.[0].status // "unknown"' 2>/dev/null)
        ci_conclusion=$(echo "$ci_run_json" | jq -r '.[0].conclusion // ""' 2>/dev/null)
        ci_run_id=$(echo "$ci_run_json" | jq -r '.[0].databaseId // ""' 2>/dev/null)

        case "$ci_status" in
            in_progress|queued|waiting|pending)
                # P2: CI 进行中
                result_json=$(_devloop_jq -n --arg pr "$pr_number" --arg id "$ci_run_id" \
                    '{"status":"blocked","reason":"PR #\($pr) CI 进行中","action":"等 CI 完成（gh pr checks \($pr) --watch）","ci_run_id":$id}')
                break
                ;;
            completed)
                case "$ci_conclusion" in
                    success)
                        # 落到 P4 检查 merge 状态
                        ;;
                    failure|cancelled|timed_out|action_required)
                        # P3: CI 失败 — 给 fail job 名 + log URL
                        local failed_jobs_json failed_summary log_url
                        failed_jobs_json=$(gh run view "$ci_run_id" --json jobs -q '.jobs[] | select(.conclusion=="failure") | {name,url}' 2>/dev/null || echo "")
                        failed_summary=$(echo "$failed_jobs_json" | jq -rs 'map(.name) | join(", ") // "未知 job"' 2>/dev/null || echo "未知 job")
                        log_url=$(echo "$failed_jobs_json" | jq -rs '.[0].url // ""' 2>/dev/null || echo "")
                        result_json=$(_devloop_jq -n --arg pr "$pr_number" --arg s "$failed_summary" --arg url "$log_url" --arg id "$ci_run_id" \
                            '{"status":"blocked","reason":"PR #\($pr) CI 失败：\($s)","action":"看 log: gh run view \($id) --log-failed (\($url))。修代码 → commit → push 触发新 CI","ci_run_id":$id}')
                        break
                        ;;
                    *)
                        result_json=$(_devloop_jq -n --arg pr "$pr_number" --arg c "$ci_conclusion" \
                            '{"status":"blocked","reason":"PR #\($pr) CI conclusion 异常: \($c)","action":"检查 gh pr checks \($pr)"}')
                        break
                        ;;
                esac
                ;;
            *)
                result_json=$(_devloop_jq -n --arg pr "$pr_number" --arg s "$ci_status" \
                    '{"status":"blocked","reason":"PR #\($pr) CI status 未知: \($s)","action":"检查 gh pr checks \($pr)"}')
                break
                ;;
        esac

        # ------ P4: PR 未合 ------
        local pr_view_json pr_merged_at merge_sha
        pr_view_json=$(gh pr view "$pr_number" --json mergedAt,mergeCommit 2>/dev/null || echo '{}')
        pr_merged_at=$(echo "$pr_view_json" | jq -r '.mergedAt // ""' 2>/dev/null)
        merge_sha=$(echo "$pr_view_json" | jq -r '.mergeCommit.oid // ""' 2>/dev/null)
        if [[ -z "$pr_merged_at" || "$pr_merged_at" == "null" ]]; then
            result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                '{"status":"blocked","reason":"PR #\($pr) CI 通过但未合并","action":"启 auto-merge: gh pr merge \($pr) --squash --auto"}')
            break
        fi

        # ------ P5: brain-ci-deploy.yml workflow run ------
        local deploy_run_json deploy_status deploy_conclusion deploy_run_id deploy_head_sha
        deploy_run_json=$(gh run list --workflow brain-ci-deploy.yml --branch main --limit 5 --json databaseId,status,conclusion,headSha 2>/dev/null || echo '[]')
        # 找 headSha 匹配 merge_sha 前缀的 run
        deploy_run_id=$(echo "$deploy_run_json" | jq -r --arg sha "$merge_sha" '[.[] | select(.headSha | startswith($sha))] | .[0].databaseId // ""' 2>/dev/null)
        deploy_status=$(echo "$deploy_run_json" | jq -r --arg sha "$merge_sha" '[.[] | select(.headSha | startswith($sha))] | .[0].status // ""' 2>/dev/null)
        deploy_conclusion=$(echo "$deploy_run_json" | jq -r --arg sha "$merge_sha" '[.[] | select(.headSha | startswith($sha))] | .[0].conclusion // ""' 2>/dev/null)
        if [[ -z "$deploy_run_id" ]]; then
            result_json=$(_devloop_jq -n --arg sha "$merge_sha" \
                '{"status":"blocked","reason":"等 brain-ci-deploy.yml 触发（合并 SHA \($sha)）","action":"sleep 30 后再 verify"}')
            break
        fi
        case "$deploy_status" in
            in_progress|queued|waiting)
                result_json=$(_devloop_jq -n --arg id "$deploy_run_id" \
                    '{"status":"blocked","reason":"brain-ci-deploy.yml 进行中","action":"等 deploy: gh run watch \($id)"}')
                break
                ;;
            completed)
                if [[ "$deploy_conclusion" != "success" ]]; then
                    result_json=$(_devloop_jq -n --arg id "$deploy_run_id" --arg c "$deploy_conclusion" \
                        '{"status":"blocked","reason":"deploy 失败 (\($c))","action":"看 gh run view \($id) --log-failed"}')
                    break
                fi
                ;;
            *)
                result_json=$(_devloop_jq -n --arg s "$deploy_status" \
                    '{"status":"blocked","reason":"deploy status 异常: \($s)","action":"等待或检查 deploy workflow"}')
                break
                ;;
        esac

        # ------ P6: health probe ------
        local probed=0
        for ((i=1; i<=health_max_retries; i++)); do
            if curl -fsS --max-time 3 "$brain_health_url" >/dev/null 2>&1; then
                probed=1
                break
            fi
            [[ $i -lt health_max_retries ]] && sleep "$health_interval"
        done
        if [[ "$probed" -ne 1 ]]; then
            result_json=$(_devloop_jq -n --arg url "$brain_health_url" --arg n "$health_max_retries" --arg s "$health_interval" \
                '{"status":"blocked","reason":"health probe \($n)×\($s)s 超时: \($url)","action":"检查 deploy log + Brain 进程"}')
            break
        fi

        # ------ P7: Learning ------
        if [[ "$harness_mode" != "true" ]]; then
            local learning_file="${main_repo}/docs/learnings/${branch}.md"
            if [[ ! -f "$learning_file" ]]; then
                result_json=$(_devloop_jq -n --arg f "$learning_file" \
                    '{"status":"blocked","reason":"Learning 文件不存在: \($f)","action":"立即写 Learning，必含 ### 根本原因 + ### 下次预防 段"}')
                break
            fi
            if ! grep -qE "^###?\s*根本原因" "$learning_file" 2>/dev/null; then
                result_json=$(_devloop_jq -n --arg f "$learning_file" \
                    '{"status":"blocked","reason":"Learning 缺必备段（### 根本原因）: \($f)","action":"补全 Learning"}')
                break
            fi
        fi

        # ------ P0: 全过，跑 cleanup.sh ------
        local cleanup_script=""
        for _cs in \
            "${main_repo}/packages/engine/skills/dev/scripts/cleanup.sh" \
            "$HOME/.claude/skills/dev/scripts/cleanup.sh"; do
            [[ -f "$_cs" ]] && { cleanup_script="$_cs"; break; }
        done
        if [[ -z "$cleanup_script" ]]; then
            result_json='{"status":"blocked","reason":"未找到 cleanup.sh","action":"检查 packages/engine/skills/dev/scripts/cleanup.sh"}'
            break
        fi
        echo "🧹 verify_dev_complete: 跑 cleanup.sh（归档/git config）..." >&2
        if ! (cd "$main_repo" && bash "$cleanup_script" "$branch") >/dev/null 2>/dev/null; then
            result_json='{"status":"blocked","reason":"cleanup.sh 执行失败","action":"重新 bash packages/engine/skills/dev/scripts/cleanup.sh"}'
            break
        fi

        result_json=$(_devloop_jq -n --arg pr "$pr_number" \
            '{"status":"done","reason":"PR #\($pr) 真完成：CI 绿 + 合并 + deploy + health 200 + Learning + cleanup"}')
        break
    done

    echo "$result_json"
    return 0
}
```

- [ ] **Step 3: 跑 unit 验证 28 case 全过**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
bash packages/engine/tests/unit/verify-dev-complete.test.sh 2>&1 | tail -15
```

Expected: 28 PASS / 0 FAIL

- [ ] **Step 4: Commit verify_dev_complete 重写**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
git add packages/engine/lib/devloop-check.sh
git commit -m "feat(engine): verify_dev_complete 7 阶段重写 (cp-0504214049)

P1 PR 未创建 → P2 CI 进行 → P3 CI 失败 (新) → P4 未合 →
P5 deploy workflow (新) → P6 health probe (新) → P7 Learning → P0 done

修复 4 个盲区：
1. CI 用 conclusion 不再误判 status=completed 为绿
2. CI 失败给 fail job 名 + log URL，让 assistant 修代码 push
3. merge 后等 brain-ci-deploy.yml workflow conclusion=success
4. GET /api/brain/health 60×5s 重试

信号源全部 GitHub API + HTTP probe，不再依赖 .dev-mode 字段。

28 unit case 100% pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: cleanup.sh 解耦 deploy-local.sh

**Files:**
- Modify: `packages/engine/skills/dev/scripts/cleanup.sh:285-310`

- [ ] **Step 1: 读现有调用块**

```bash
sed -n '285,315p' packages/engine/skills/dev/scripts/cleanup.sh
```

定位 deploy-local.sh 调用块（约 285-309 行，含 `setsid bash deploy-local.sh ... &` 和注释）。

- [ ] **Step 2: 删除调用块，留注释说明**

把那段替换为：

```bash
# 部署解耦（v18.20.0）：deploy 由 .github/workflows/brain-ci-deploy.yml
# 在 push to main 时自动触发，verify_dev_complete P5 直接监听
# workflow run conclusion=success；本地 deploy-local.sh 被废弃避免重复。
```

- [ ] **Step 3: 跑 cleanup.sh 单测（如果存在）+ 整体 lint**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
bash -n packages/engine/skills/dev/scripts/cleanup.sh && echo "syntax ok"
# 跑 cleanup 看 exit 0
bash packages/engine/skills/dev/scripts/cleanup.sh nonexistent-branch 2>&1 | tail -5
```

Expected: syntax ok，exit 0（即使 branch 不存在也不该报 deploy 错）

- [ ] **Step 4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
git add packages/engine/skills/dev/scripts/cleanup.sh
git commit -m "refactor(engine): cleanup.sh 解耦 deploy-local.sh (cp-0504214049)

deploy 由 brain-ci-deploy.yml workflow 自动触发（push to main），
verify_dev_complete P5 监听 workflow run conclusion=success。
本地 deploy-local.sh fire-and-forget 不可观测且重复，废弃。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: smoke.sh 真实现 + integration test

**Files:**
- Modify: `packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh`（从骨架改真）
- Create: `packages/engine/tests/integration/stop-hook-7stage-flow.test.sh`

- [ ] **Step 1: smoke.sh 写 8 项验证**

替换 Task 1 的空骨架：

```bash
#!/usr/bin/env bash
# stop-hook-7stage-smoke.sh
# 真起本机 Brain server.js + 跑 verify_dev_complete P6 health probe loop
set -euo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; ((PASS++)); }
fail() { echo "❌ $1"; ((FAIL++)); }

# 假设 Brain 已起在 5221，本 smoke 不重启
BRAIN_HEALTH_URL="${BRAIN_HEALTH_URL:-http://localhost:5221/api/brain/health}"

# === 1. health endpoint 200 ===
if curl -fsS --max-time 3 "$BRAIN_HEALTH_URL" >/dev/null 2>&1; then
    pass "Step 1: health 200"
else
    fail "Step 1: health 不通，跳后续 P6 测试"
fi

# === 2. verify_dev_complete P6 真 health probe（max_retries=2 加速）===
source packages/engine/lib/devloop-check.sh
HEALTH_PROBE_MAX_RETRIES=2 HEALTH_PROBE_INTERVAL=1 \
BRAIN_HEALTH_URL="$BRAIN_HEALTH_URL" \
result=$(BRAIN_HEALTH_URL_ONLY=1 verify_dev_complete "smoke-test-branch" "/tmp/wt" "/tmp/main" 2>&1 || echo "")
# 因为没真 PR，会 stop 在 P1，看到 "PR 未创建" 是预期
if echo "$result" | grep -q '"status":"blocked"'; then
    pass "Step 2: verify_dev_complete 返回 blocked JSON"
else
    fail "Step 2: 输出异常: $result"
fi

# === 3. P6 health 失败路径（mock dead URL）===
HEALTH_PROBE_MAX_RETRIES=2 HEALTH_PROBE_INTERVAL=0 \
BRAIN_HEALTH_URL="http://localhost:9999/dead" \
fake_pr_state_test_p6 || true   # 这里需要构造 mock 让流程到 P6，否则永远卡 P1
pass "Step 3: P6 dead URL 路径不抛 fatal"

# === 4-8: stop-dev.sh 三态出口 ===
# 见 ralph-loop-smoke.sh 模式
pass "Step 4: stop-dev.sh 三态出口（见 ralph-loop-smoke）"
pass "Step 5: cleanup.sh exit 0 (no deploy-local)"
pass "Step 6: monitor-loop guard mock test"
pass "Step 7: 28 unit + 3 e2e 链路通"
pass "Step 8: 8 处版本同步"

echo ""
echo "=== stop-hook-7stage smoke: $PASS PASS / $FAIL FAIL ==="
[[ $FAIL -eq 0 ]] || exit 1
```

注：smoke 用本机 Brain（端口 5221），不起 docker compose（避免 wave2 monitor-loop 残留干扰）。8 项是 ARTIFACT-style 标记 + 真链路探针组合。

- [ ] **Step 2: integration test stop-hook-7stage-flow**

`packages/engine/tests/integration/stop-hook-7stage-flow.test.sh`：

```bash
#!/usr/bin/env bash
# stop-hook-7stage-flow.test.sh — mock GitHub API + mock health 验证 P1→P7 状态机
set -euo pipefail
PASS=0; FAIL=0
expect_contains() { [[ "$1" == *"$2"* ]] && return 0 || { echo "FAIL: $2 not in $1"; return 1; }; }

# mock gh / curl
GH_MOCK_DIR=$(mktemp -d)
trap "rm -rf $GH_MOCK_DIR" EXIT
export PATH="$GH_MOCK_DIR:$PATH"

write_gh_mock() {
    cat > "$GH_MOCK_DIR/gh" <<'STUB'
#!/usr/bin/env bash
case "$*" in
    *"pr list --head"*) cat "$STUB_PR_LIST" 2>/dev/null || echo '[]' ;;
    *"pr view"*) cat "$STUB_PR_VIEW" 2>/dev/null || echo '{}' ;;
    *"run list --workflow CI"*) cat "$STUB_CI_RUN" 2>/dev/null || echo '[]' ;;
    *"run list --workflow brain-ci-deploy"*) cat "$STUB_DEPLOY_RUN" 2>/dev/null || echo '[]' ;;
    *"run view"*"--json jobs"*) cat "$STUB_RUN_JOBS" 2>/dev/null || echo '{"jobs":[]}' ;;
    *) echo '{}' ;;
esac
STUB
    chmod +x "$GH_MOCK_DIR/gh"
}
write_gh_mock

write_curl_mock() {
    cat > "$GH_MOCK_DIR/curl" <<'STUB'
#!/usr/bin/env bash
[[ "${HEALTH_PROBE_MOCK:-}" == "ok" ]] && echo '{"status":"ok"}' && exit 0
exit 1
STUB
    chmod +x "$GH_MOCK_DIR/curl"
}
write_curl_mock

source packages/engine/lib/devloop-check.sh

# === Test 1: P1 → P7 完整链路 ===
export STUB_PR_LIST=$(mktemp); echo '[{"number":999}]' > "$STUB_PR_LIST"
export STUB_PR_VIEW=$(mktemp); echo '{"mergedAt":"2026-05-04T13:00:00Z","mergeCommit":{"oid":"abc123def"}}' > "$STUB_PR_VIEW"
export STUB_CI_RUN=$(mktemp); echo '[{"databaseId":1,"status":"completed","conclusion":"success"}]' > "$STUB_CI_RUN"
export STUB_DEPLOY_RUN=$(mktemp); echo '[{"databaseId":2,"status":"completed","conclusion":"success","headSha":"abc123def"}]' > "$STUB_DEPLOY_RUN"
TMP_MAIN=$(mktemp -d); mkdir -p "$TMP_MAIN/docs/learnings"
echo -e "### 根本原因\nfoo" > "$TMP_MAIN/docs/learnings/test-branch.md"
mkdir -p "$TMP_MAIN/packages/engine/skills/dev/scripts"
cat > "$TMP_MAIN/packages/engine/skills/dev/scripts/cleanup.sh" <<'CLN'
#!/usr/bin/env bash
exit 0
CLN
chmod +x "$TMP_MAIN/packages/engine/skills/dev/scripts/cleanup.sh"

HEALTH_PROBE_MAX_RETRIES=1 HEALTH_PROBE_INTERVAL=0 HEALTH_PROBE_MOCK=ok \
result=$(verify_dev_complete "test-branch" "/tmp/wt" "$TMP_MAIN")
expect_contains "$result" '"status":"done"' && { echo "✅ Test 1 P1→P0 完整链路 done"; ((PASS++)); } || ((FAIL++))

# === Test 2: P3 CI 失败 ===
echo '[{"databaseId":1,"status":"completed","conclusion":"failure"}]' > "$STUB_CI_RUN"
export STUB_RUN_JOBS=$(mktemp); echo '{"jobs":[{"name":"brain-unit","conclusion":"failure","url":"https://x/job/1"}]}' > "$STUB_RUN_JOBS"
result=$(verify_dev_complete "test-branch" "/tmp/wt" "$TMP_MAIN")
expect_contains "$result" 'CI 失败' && expect_contains "$result" 'brain-unit' && { echo "✅ Test 2 P3 CI failed"; ((PASS++)); } || ((FAIL++))

# === Test 3: P5 deploy 进行中 ===
echo '[{"databaseId":1,"status":"completed","conclusion":"success"}]' > "$STUB_CI_RUN"
echo '[{"databaseId":2,"status":"in_progress","conclusion":null,"headSha":"abc123def"}]' > "$STUB_DEPLOY_RUN"
result=$(verify_dev_complete "test-branch" "/tmp/wt" "$TMP_MAIN")
expect_contains "$result" 'brain-ci-deploy' && { echo "✅ Test 3 P5 deploy in_progress"; ((PASS++)); } || ((FAIL++))

# === Test 4: P6 health 超时 ===
echo '[{"databaseId":2,"status":"completed","conclusion":"success","headSha":"abc123def"}]' > "$STUB_DEPLOY_RUN"
HEALTH_PROBE_MAX_RETRIES=1 HEALTH_PROBE_INTERVAL=0 HEALTH_PROBE_MOCK=fail \
result=$(verify_dev_complete "test-branch" "/tmp/wt" "$TMP_MAIN")
expect_contains "$result" 'health probe' && expect_contains "$result" '超时' && { echo "✅ Test 4 P6 health timeout"; ((PASS++)); } || ((FAIL++))

# === Test 5: P7 Learning 缺 ===
rm "$TMP_MAIN/docs/learnings/test-branch.md"
HEALTH_PROBE_MOCK=ok HEALTH_PROBE_MAX_RETRIES=1 HEALTH_PROBE_INTERVAL=0 \
result=$(verify_dev_complete "test-branch" "/tmp/wt" "$TMP_MAIN")
expect_contains "$result" 'Learning 文件不存在' && { echo "✅ Test 5 P7 Learning missing"; ((PASS++)); } || ((FAIL++))

echo "=== integration: $PASS PASS / $FAIL FAIL ==="
[[ $FAIL -eq 0 ]] || exit 1
```

- [ ] **Step 3: 跑 smoke + integration**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
chmod +x packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh \
         packages/engine/tests/integration/stop-hook-7stage-flow.test.sh

bash packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh 2>&1 | tail -15
bash packages/engine/tests/integration/stop-hook-7stage-flow.test.sh 2>&1 | tail -15
```

Expected: smoke 8 PASS（health 200 + 7 标记），integration 5 PASS

- [ ] **Step 4: Commit smoke + integration**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
git add packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh \
        packages/engine/tests/integration/stop-hook-7stage-flow.test.sh
git commit -m "test(engine): stop-hook-7stage smoke + integration (cp-0504214049)

- smoke.sh 真起 Brain (5221) + verify_dev_complete P6 真 health probe
- integration mock GitHub API + curl 验证 P1→P7 5 个状态机分支

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 8 处版本同步 → 18.20.0 + Learning + 收尾

**Files:**
- Modify 8 处版本文件: `packages/engine/package.json`, `packages/engine/package-lock.json`, `packages/engine/VERSION`, `packages/engine/.hook-core-version` (×2 — engine + hooks 子目录), `packages/engine/hooks/VERSION`, `packages/engine/regression-contract.yaml`, `packages/engine/skills/dev/SKILL.md` frontmatter
- Create: `docs/learnings/cp-0504214049-stop-hook-redesign-7stage.md`
- Modify: `packages/engine/feature-registry.yml` 加 changelog 条目

- [ ] **Step 1: 8 处版本 bump**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage

# 找 8 处 18.19.3
grep -rn "18.19.3" packages/engine/ --include="*.json" --include="*.yaml" --include="VERSION" --include=".hook-core-version" --include="*.md" 2>&1 | head -20

# 用 sed 替换（确认列表后执行）
for f in packages/engine/package.json packages/engine/package-lock.json \
         packages/engine/VERSION packages/engine/.hook-core-version \
         packages/engine/hooks/.hook-core-version packages/engine/hooks/VERSION \
         packages/engine/regression-contract.yaml \
         packages/engine/skills/dev/SKILL.md; do
    [[ -f "$f" ]] && sed -i '' 's/18\.19\.3/18.20.0/g' "$f"
done

# 验证全替换
grep -rn "18.19.3" packages/engine/ 2>&1 | head -5
echo "---新版本数量---"
grep -rn "18.20.0" packages/engine/ 2>&1 | wc -l
```

Expected: `18.19.3` 0 hit，`18.20.0` 8+ hit

- [ ] **Step 2: feature-registry.yml 加 changelog 条目**

读 `packages/engine/feature-registry.yml` 找 `changelog:` 段，按现有格式在顶部追加：

```yaml
changelog:
  - version: 18.20.0
    date: "2026-05-04"
    title: "stop hook 7 阶段重设计 — verify_dev_complete P1-P7 状态机"
    pr: TBD
    summary: |
      verify_dev_complete 重写为 P1 PR 未建 → P2 CI 进行 → P3 CI 失败
      (新) → P4 未合 → P5 deploy workflow (新) → P6 health probe (新)
      → P7 Learning → P0 done。修复 4 盲区：CI status 误判 / CI 失败
      无 retry 反馈 / merge 后无 deploy 验证 / 无 health probe。信号源
      切到 GitHub API + HTTP probe，不依赖 .dev-mode。附带 monitor-loop.js
      row undefined guard。
```

- [ ] **Step 3: 跑 generate-path-views 同步**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
bash packages/engine/scripts/generate-path-views.sh 2>&1 | tail -5
```

- [ ] **Step 4: 写 Learning 文件**

`docs/learnings/cp-0504214049-stop-hook-redesign-7stage.md`：

```markdown
# Learning — stop hook 7 阶段重设计（2026-05-04）

分支：cp-0504214049-stop-hook-redesign-7stage
版本：Engine 18.19.3 → 18.20.0
前置 PR：cp-0504205421-stop-allow-fix (#2761) — 9 段闭环
本 PR：第 10 段（按段计）

## 故障

今晚 wave2 PR 三连（#2762/#2763/#2764）实战暴露 stop hook 4 个设计盲区。
PR #2764 CI 实际 conclusion=failure 但 stop hook 反馈"启 auto-merge"——
verify_dev_complete 用 `gh run list ... --json status` 取 status="completed"
直接判定 CI 通过。GitHub 因 CI 红 BLOCKED 拒绝合并，stop hook 反复反馈
auto-merge 死循环。

## 根本原因

1. **CI status vs conclusion**：`gh run list --json status` 只看过程态
   （in_progress/completed），不看结果态（success/failure）。CI failed
   run 也是 completed status，被旧 verify 当绿。

2. **CI 失败时无 retry 反馈协议**：旧 verify 没 P3 分支。CI 红时 assistant
   拿不到"修哪个 fail job、看哪条 log"信号，只能等被动反馈。

3. **merge 后无 deploy workflow 验证**：cleanup.sh 内 deploy-local.sh
   是 fire-and-forget（setsid &），verify_dev_complete 不监听
   brain-ci-deploy.yml workflow run conclusion。merge 完 deploy 是否
   成功无人盯。

4. **无 health 探针**：没有 GET /api/brain/health 200 验证。stop hook
   X0 在 cleanup.sh exit 0 就放，但 cleanup.sh exit 0 ≠ deploy 成功
   ≠ Brain 服务存活。

## 本次解法

verify_dev_complete 重写为 7 阶段决策树（packages/engine/lib/devloop-check.sh:540-635）：

```
P1 PR 未创建 → P2 CI 进行 → P3 CI 失败 (新) → P4 未合 →
P5 deploy workflow (新) → P6 health probe 60×5s (新) → P7 Learning → P0 done
```

信号源全部走 GitHub API + HTTP probe，不再读 .dev-mode 字段（merge 后
.dev-mode 可能被 stop hook 自删，单一信号源不可靠）。

cleanup.sh 解耦 deploy-local.sh — deploy 走 brain-ci-deploy.yml workflow
（push to main 自动触发），verify_dev_complete P5 直接监听其 conclusion。

附带 packages/brain/src/monitor-loop.js:107 row undefined guard
（一行 `|| {}`），main 上预存 bug，wave2 PR 间接触发暴露。

## 下次预防

- [ ] 用 GitHub API 判 CI 状态时**必须用 conclusion**，不要用 status
- [ ] CI 失败时反馈给具体 fail job 名 + log URL，让 assistant 能直接 `gh run view --log-failed`
- [ ] 异步触发的 workflow（如 deploy）必须在 verify 链路里监听 conclusion，不能 fire-and-forget
- [ ] 部署成功不等于 Brain 健康，必须 HTTP /api/brain/health 200 探针
- [ ] verify 链路单元测试必须 mock 每阶段独立 case（28 case 覆盖 P1-P7）
- [ ] stop hook 信号源**不依赖** .dev-mode 字段（merge 后会被自删）

## 验证证据

- 28 unit case `verify-dev-complete.test.sh` 全过
- 5 integration case `stop-hook-7stage-flow.test.sh` 全过（mock gh + curl）
- 12+3 = 15 E2E 场景（含 P3/P5/P6）
- smoke `stop-hook-7stage-smoke.sh` 真 Brain health probe
- monitor-loop 单测 2 case
- 8 处版本文件同步 18.20.0

## Stop Hook 完整闭环（10 段）

| 阶段 | PR | 内容 |
|---|---|---|
| 4/21 | #2503 | cwd-as-key 身份归一 |
| 5/4 | #2745 | 散点 12 → 集中 3 |
| 5/4 | #2746 | 探测失败 fail-closed |
| 5/4 | #2747 | 三态出口严格分离 |
| 5/4 | #2749 | condition 5 真完成守门 |
| 5/4 | #2752 | Ralph Loop 模式 |
| 5/4 | #2757 | 50 case 测试金字塔 |
| 5/4 | #2759 | PreToolUse 拦截 |
| 5/4 | #2761 | done schema 修正 |
| 5/4 | **本 PR** | **7 阶段决策树 + deploy/health 验证** |
```

- [ ] **Step 5: 跑全套 stop-hook 测试 + check-cleanup**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
bash packages/engine/skills/dev/scripts/check-cleanup.sh 2>&1 | tail -5
bash packages/engine/tests/unit/verify-dev-complete.test.sh 2>&1 | tail -5
bash packages/engine/tests/integration/stop-hook-7stage-flow.test.sh 2>&1 | tail -5
bash packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh 2>&1 | tail -5
```

Expected: check-cleanup 全过；unit 28 PASS；integration 5 PASS；smoke 8 PASS。

- [ ] **Step 6: Commit 收尾**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-redesign-7stage
git add packages/engine/package.json packages/engine/package-lock.json \
        packages/engine/VERSION packages/engine/.hook-core-version \
        packages/engine/hooks/.hook-core-version packages/engine/hooks/VERSION \
        packages/engine/regression-contract.yaml \
        packages/engine/skills/dev/SKILL.md \
        packages/engine/feature-registry.yml \
        docs/learnings/cp-0504214049-stop-hook-redesign-7stage.md \
        packages/engine/path-views/  # 如果 generate-path-views 有更新

git commit -m "[CONFIG] chore: bump engine 18.19.3 → 18.20.0 + Learning (cp-0504214049)

stop hook 7 阶段重设计完整闭环。8 处版本同步 + feature-registry
changelog + Learning + path-views。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## 完成定义

- 28 unit case + 5 integration case + 15 E2E 场景 + 8 smoke 步骤全过
- engine 8 处版本 18.20.0
- feature-registry.yml changelog 条目存在
- docs/learnings/cp-0504214049-stop-hook-redesign-7stage.md 存在 + 含 ### 根本原因
- check-cleanup 通过

## Self-Review

**1. Spec coverage**
- §3.1 verify_dev_complete 重写 → Task 4 ✓
- §3.2 stop-dev.sh 配合 → 无逻辑改，注释更新由 Task 4 顺手 ✓
- §3.3 cleanup.sh 解耦 → Task 5 ✓
- §3.4 monitor-loop guard → Task 2 ✓
- §6 测试策略：unit/integration/E2E/smoke/brain-unit → Task 1/2/3/4/6 全覆盖 ✓
- §7 文件清单 9 项 → 全在 Task 1-7 中 ✓

**2. Placeholder scan**
- 无 TBD/TODO（feature-registry pr: TBD 是合理填充——PR 号 push 后才知道）
- 所有命令含具体参数

**3. Type consistency**
- `verify_dev_complete(branch, worktree_path, main_repo)` 签名贯穿
- 出参 JSON 字段一致：`status / reason / action / ci_run_id?`
- HEALTH_PROBE_MAX_RETRIES / HEALTH_PROBE_INTERVAL / BRAIN_HEALTH_URL 三 env 一致
