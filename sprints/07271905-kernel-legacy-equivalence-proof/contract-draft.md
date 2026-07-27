# Sprint Contract Draft (Round 1)

## 合同边界与证据基线

- 冻结 PRD：`sprints/07271905-kernel-legacy-equivalence-proof/sprint-prd.md`
- 反例仅引用：PR #4372 head `4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13`。不得修改、cherry-pick、复用或合并该 PR 的实现。
- 当前 legacy inventory：`packages/engine/regression-contract.yaml`，P0=66、P1=63，共 129 个稳定 ID。
- 当前候选 SHA：执行时由 `git rev-parse --verify "HEAD^{commit}"` 取得；报告中的每条证据必须逐行携带该 SHA。
- 证据保质期：自动 oracle 与 GitHub protection 证据统一为 24 小时；`checked_at + 24h <= now` 即过期并 fail-closed。
- 本任务不得连接或修改生产数据库；所有 mutation 必须在临时目录或内存副本进行。
- PRD 显式授权修改 Engine 与 `.github/` 的等价门禁接线；不得顺带改动其他共享 CI 行为。

## Response Schema（推导来源: PRD字面）

N/A — 本任务无 HTTP 响应。验收入口是本地 CLI，输出 JSON 证明报告；报告字段严格取自 PRD 的完成定义与边界条件。

### Proof Report JSON

顶层必须包含：

```jsonc
{
  "schema_version": "legacy-equivalence-v1",
  "artifact_sha": "<40-char sha>",
  "generated_at": "<ISO-8601>",
  "evidence_ttl_hours": 24,
  "result": "pass|fail",
  "inventory_counts": {"total": 129, "P0": 66, "P1": 63},
  "status_counts": {
    "proven_active": 129,
    "unknown": 0,
    "drifted": 0,
    "missing_assertion": 0,
    "owner_mismatch": 0
  },
  "family_counts": {
    "F01": "<derived count>",
    "F02": "<derived count>",
    "F03": "<derived count>",
    "F04": "<derived count>",
    "F05": "<derived count>",
    "F06": "<derived count>",
    "F07": "<derived count>",
    "F08": "<derived count>"
  },
  "behaviors": [],
  "provider_matrix": [],
  "matrix": {"stage_count": 13, "element_count": 11, "cell_count": 143, "green": 143},
  "github_protection": {},
  "engine_test_summary": {},
  "violations": []
}
```

每个 `behaviors[]` 行必须含：

- `behavior_id`：与 inventory 稳定 ID 逐字一致且全局唯一。
- `severity`：只允许 `P0|P1`。
- `legacy_source`：仓库相对路径与可解析锚点。
- `family_id`：只允许 `F01..F08`；F01/F06 必须非空，F08 仅允许 staging/promote/rollback。
- `unified_owner` 与 `unified_construct`：均非空，且 owner registry 校验一致。
- `oracles.positive|violation|recovery`：每项均含真实 `command`、`exit_code`、`log_tail`、`observed_at`、`assertion_ref`。
- `artifact_sha`、`checked_at`、`expires_at`、`fail_semantics`、`proven_status`。
- `assertion_ref`：非空、唯一解析到一个自动测试/脚本；`manual:` 不得用于 `method=auto`。
- `matrix.cells[]`：每格含 `stage_id`、`element_id`、非空 `behavior_ids`、`artifact_sha`、
  `all_behaviors_proven` 与 `status`；只有 `all_behaviors_proven=true` 才可 green。

禁用的伪造汇总字段或语义：硬编码 `mismatch=0`、硬编码 `match_count`、把 `active+drifted` 计入 `proven_status_count`、无逐行证据直接写 green。
`family_counts` 的八项必须由 129 行逐行重算且总和=129；F01/F06>0；F08<110 且 F08 每行只允许 staging/promote/rollback。

## 已知约束（来自回归测试与累积 FR）

- `[packages/engine/tests/hooks/branch-protect.test.ts]` → branch-protect 对保护分支违规写入必须阻断，对有效 worktree 正常路径必须放行。
- `[packages/engine/tests/hooks/bash-guard.test.ts]` → bash guard 必须覆盖命令违规与正常放行。
- `[packages/engine/tests/hooks/main-repo-write-guard.test.ts]` → 主仓写入/提交必须阻断，worktree 内相同行为必须放行。
- `[packages/engine/tests/hooks/stop-hook-retry.test.ts]` → stop hook 的重试、失败原因与恢复状态必须真实执行。
- `[packages/engine/tests/hooks/stop-sh-routing.test.ts]` → stop.sh 对现存 stop hooks 的路由必须与退役项区分。
- `[packages/engine/tests/integration/hook-contracts.test.ts]` → branch-protect、worktree 检测与 hook-utils 接缝必须真脚本集成。
- `[packages/engine/tests/integration/pre-commit.test.sh]` → pre-commit 必须由 shell job 真执行。
- `[packages/engine/tests/integration/worktree-checkout-guard.test.sh]` → checkout guard 必须由 shell job真执行，不能只做文件扫描。
- `[.github/workflows/ci.yml]` → `engine-tests` 跑 TypeCheck/Vitest，`engine-tests-shell` glob 跑全部 shell tests；等价证明不得接受 skipped。
- `[累积FR]` 本 line 暂无已验收历史行为。
- `context-manifest: unavailable`：`GET /api/brain/line/128dcb6a-fdf1-44b1-8124-37993dbd922c/context-manifest` 当前返回 404 HTML。

## 真实调用方请求 shape

N/A — 本任务不新增设备/agent 调服务端接口。唯一第三方调用为 CLI 通过 `gh api` 对 GitHub REST
`GET /repos/perfectuser21/cecelia/branches/main/protection` 发起只读请求；认证沿用 `gh` 的安全 credential store，
不在 body、参数、日志或产物中传 token。必须读取并校验：
`required_status_checks.strict/contexts`、`enforce_admins.enabled`、
`required_pull_request_reviews`、`required_linear_history.enabled`、
`allow_force_pushes.enabled`、`allow_deletions.enabled`。

### GitHub main protection 版本化政策（本轮真实只读基线）

- `required_status_checks.strict=true`
- `required_status_checks.contexts` 精确集合：
  `ci-passed`、`Harness V5 Gate Passed`、`Smoke Glob Runner Passed`
- `enforce_admins.enabled=true`
- `required_pull_request_reviews.dismiss_stale_reviews=false`
- `required_pull_request_reviews.require_code_owner_reviews=false`
- `required_pull_request_reviews.require_last_push_approval=false`
- `required_pull_request_reviews.required_approving_review_count=0`
- `required_linear_history.enabled=true`
- `allow_force_pushes.enabled=false`
- `allow_deletions.enabled=false`

该政策必须写入版本化 JSON 并与 live API 逐字段比较；禁止从 live 响应自动覆写政策以消除 drift。

## 禁 mock 边清单

- `packages/engine/regression-contract.yaml` ↔ inventory loader：129 条必须从真实文件解析，禁止用内嵌数组替代。
- equivalence gate ↔ Engine guards/hooks/DevGate/Evaluator/Judge/staging-promote-rollback：必须真起子进程并记录退出码，禁止 mock `spawn/exec` 或相邻脚本。
- equivalence gate ↔ Git/current SHA：必须真执行 `git rev-parse --verify "<ref>^{commit}"`，禁止注入假 SHA。
- equivalence gate ↔ GitHub branch protection：必须真执行只读 `gh api`，禁止 stub 响应。
- `.github/workflows/ci.yml` ↔ equivalence CLI/shell test：workflow 必须真调用门禁并检查非零退出，禁止仅 grep 接线文本。

## 未覆盖真实链路清单

（本合同无 mock、force_*、stub 或假数据豁免，N/A。GitHub protection 在 final E2E 中真调；凭据不可用、限流或 API
异常均为 fail-closed，不得转成 PASS。）

## 接缝清单

1. Engine inventory/owner registry 与真实 hooks/tests：本地 `local_api` evaluator 真执行 129×3 oracle；未执行完标
   `logic-done-pending`，不得 green。
2. 候选 checkout 与 Git SHA：报告逐行 `artifact_sha` 必须等于真实 `HEAD^{commit}`；fixture SHA 必须等于
   `4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13`。
3. GitHub main protection：final E2E 用当前凭据真读 GitHub API；不可达、限流、字段缺失或与版本化政策不一致均 FAIL。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 将 129 个 legacy P0/P1 行为逐条映射到 unified owner/construct，真跑三态 oracle、provider 矩阵、Engine 与 GitHub protection，并由 fail-closed gate 产出 13×11 矩阵。 |
| **NFR（做得多好）** | 性能/可靠性 | 全量执行预算 10 分钟；单 oracle 最长 120 秒，超时即 FAIL；证据 TTL=24h；任何缺证据不得降级。 |
| **Invariant（永不违反）** | 安全/一致性 | 不修改生产 DB，不写/打印凭据，不修改 PR #4372；计数从 129 行重算；current SHA、owner、assertion_ref 与证据时效全部 fail-closed。 |
| **判定点（怎么知道）** | 模糊现实判断 | 见下方登记表。 |
| **保质期（何时过期）** | 证据生命周期 | 自动 oracle 与 GitHub policy 证据 24h；过期后整行不计 proven，下一次 gate 必须重跑。 |
| **死亡告警（停了谁知道）** | 停止工作告警 | CI required check `Legacy P0/P1 Equivalence` 非绿并输出 violations；`ci-passed` 聚合失败，PR 作者/Reviewer 当次获知。 |
| **失败语义（挂了怎么办）** | 故障处理 | fail-closed、非零退出；不重写为 unknown/PASS；可重试一次只读 GitHub API，但限流/认证失败仍 BLOCK/FAIL。 |
| **效果确认（已发≠已生效）** | 动作真实生效 | 每条 oracle 记录真实 exit/log/assertion_ref；GitHub policy 比较真实响应；只有逐行重算 129 proven active 才允许 143 green。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 自动 oracle 是否真实可执行 | A. 信 inventory 的 `method`; B. 真启动目标解释器并验 exit/log | B | PRD 禁 manual 冒充 auto，且 #4372 的 129 assertion_ref 全空 | 假 active，安全门禁静默失效 |
| ⚠️ provider 是否支持某行为 | A. 名称猜测; B. provider capability registry + 真三态执行 | B | PRD 要求 Claude/Codex/Grok 支持项真跑，不支持项需批准 decision | 支持缺口被隐藏或无谓阻断 |
| ⚠️ owner/construct 是否等价 | A. F08 catch-all; B. owner registry 与真实入口/测试逐行解析 | B | #4372 F08 吞 110 项是已知反例 | 行为归错所有者，删除真实 guard 时 gate 不红 |
| ⚠️ GitHub protection 是否漂移 | A. HTTP 200 即通过; B. 六类字段与版本化 policy 逐字段比较 | B | PRD 明确要求真实只读 API 与外部漂移 fail | 外部保护被关闭却仍报告安全 |
| 矩阵 cell 是否 green | A. 汇总值直写; B. cell 所辖行全部 current/proven 后聚合 | B | 禁止硬编码 zero/match_count 和 active+drifted | 130 gray 被错误翻绿 |

notes:

- `judgment-pending-user: 自动 oracle 是否真实可执行`
- `judgment-pending-user: provider 是否支持某行为`
- `judgment-pending-user: owner/construct 是否等价`
- `judgment-pending-user: GitHub protection 是否漂移`

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| inventory 缺行/重复/字段空 | CLI exit 1，报告具体 behavior_id | 是，只读重算 | 无降级 |
| oracle 非零、超时、skipped | 对应行非 proven，CLI exit 1 | 可在同 SHA 重跑 | 不得变 unknown/PASS |
| unsupported provider 无批准 decision | CLI exit 1，列 provider/family | 是 | 无降级 |
| GitHub API 认证/限流/字段漂移 | CLI exit 1，日志脱敏 | 可重试一次 | 无缓存 PASS |
| current SHA/TTL/assertion_ref 不符 | CLI exit 1 | 重新生成证据 | 旧证据不得复用 |
| mutation/fixture 被错误接受 | 测试与 gate exit 1 | 是 | 禁止继续标 green |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| legacy YAML 的 name/description/test 字段 | 不可信仓库输入 | 结构化解析；命令只允许仓库内 assertion registry 的 argv 模板，不使用 `eval`/`bash -c` 执行任意 YAML 文本 | 越界路径、shell 元字符、manual→auto、未知 owner/family 直接 FAIL |
| GitHub API JSON | 外部低信任 | 只按固定 JSON path 取布尔/数组/数字；不执行文本字段 | 缺字段、类型错、额外认证指令直接 FAIL |
| mutation fixture | 测试不可信输入 | 临时目录深拷贝、固定 mutation 枚举 | 禁止写工作区、生产 DB、git ref |

## Golden Path

覆盖父路 Legacy P0/P1 全量行为等价证明矩阵 第 1-5 步

[129 inventory] → [逐行映射] → [三态/provider/Engine/GitHub 真验] → [反例与 mutation 验火] → [fail-closed 汇总] → [143 cells 可信出口]

### Step 1: 载入并规范化全部 129 个 P0/P1 行为

**来源**: `[FROM_PRD]` — PRD 第 18 行、第 34 行、第 52 行。

**可观测行为**: JSON 报告精确给出 total=129、P0=66、P1=63；ID 唯一；每行稳定字段齐全；F01/F06
非空且 F08 只含 staging/promote/rollback。

**验证命令**:

```bash
node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --inventory-only --output /tmp/legacy-inventory.json
jq -e '.inventory_counts == {"total":129,"P0":66,"P1":63}
  and ([.behaviors[].behavior_id] | length)==129
  and ([.behaviors[].behavior_id] | unique | length)==129
  and ([.behaviors[] | select(.family_id=="F01")] | length > 0)
  and ([.behaviors[] | select(.family_id=="F06")] | length > 0)
  and ([.behaviors[] | select(.family_id=="F08" and
       (.unified_construct|test("staging|promote|rollback")|not))] | length == 0)' /tmp/legacy-inventory.json
```

**硬阈值**: 129=66+63；重复/空字段=0；F01>0、F06>0、F08 catch-all=0。上述 `jq -e` 非零即 FAIL。

### Step 2: 建立 unified owner/construct 与 positive/violation/recovery oracle

**来源**: `[FROM_PRD]` — PRD 第 18-20 行、第 54 行。

**可观测行为**: 129 行每行均有三态自动 oracle；8 个行为族的 Claude/Codex/Grok 支持项三态有真
exit/log，不支持项关联 approved retirement/supersession decision。

**验证命令**:

```bash
node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --run-oracles --output /tmp/legacy-oracles.json
jq -e '
  [.behaviors[] | select(
    (.unified_owner|length)==0 or (.unified_construct|length)==0 or
    (.assertion_ref|length)==0 or
    ([.oracles.positive,.oracles.violation,.oracles.recovery]
      | any(.started!=true or .passed!=true or .command==null or .exit_code==null or
            (.log_tail|length)==0 or .assertion_ref==null))
  )] | length == 0
' /tmp/legacy-oracles.json
jq -e '
  [.provider_matrix[] | select(
    if .support=="supported"
    then ([.positive,.violation,.recovery] |
          any(.started!=true or .passed!=true or .exit_code==null or .assertion_ref==null))
    else (.decision.status!="approved" or
          (.decision.kind!="retirement" and .decision.kind!="supersession"))
    end
  )] | length == 0
' /tmp/legacy-oracles.json
```

**硬阈值**: owner/construct/assertion_ref 缺失=0；129×3 oracle 均实际启动；支持矩阵缺口=0；未批准 unsupported=0。

### Step 3: 真执行 guards、全部 stop hooks、DevGate、Evaluator/Judge 与发布链

**来源**: `[FROM_PRD]` — PRD 第 20-21 行、第 57 行。

**可观测行为**: branch-protect、credential-guard、bash-guard、branch/push、main-repo-write、pre-push、
worktree-checkout、全部现存 stop hooks、DevGate/TDD/DoD、Evaluator/Judge、staging/promote/rollback 均有
positive/violation/recovery 退出码；Engine shell/stop hook `skipped=0`。

**验证命令**:

```bash
node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --run-engine --output /tmp/legacy-engine.json
jq -e '.engine_test_summary.started == true
  and .engine_test_summary.failed == 0
  and .engine_test_summary.skipped == 0
  and ([.required_constructs[]] | sort ==
    (["bash-guard","branch-protect","branch-push-guard","credential-guard",
      "devgate-dod","devgate-tdd","evaluator","github-branch-protection","judge",
      "main-repo-write-guard","pre-push","rollback","staging","stop-architect",
      "stop-conversation","stop-decomp","stop-router","worktree-checkout-guard"] | sort))' /tmp/legacy-engine.json
```

**硬阈值**: required construct 缺失=0；started=true；failed=0；skipped=0。

### Step 4: 在 current SHA 重算证据与时效

**来源**: `[FROM_PRD]` — PRD 第 21-22 行、第 29-30 行、第 65-66 行。

**可观测行为**: 每行 SHA 等于当前 checkout HEAD，证据未过期，assertion_ref 唯一可解析；任何异常都进入
violations 而不是 unknown/PASS。

**验证命令**:

```bash
CURRENT_SHA=$(git rev-parse --verify "HEAD^{commit}")
node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --output /tmp/legacy-current.json
jq -e --arg sha "$CURRENT_SHA" --argjson now "$(date +%s)" '
  .artifact_sha==$sha and .evidence_ttl_hours==24 and
  ([.behaviors[] | select(
     .artifact_sha!=$sha or (.assertion_ref|length)==0 or
     ((.expires_at|fromdateiso8601) <= $now)
  )] | length)==0
' /tmp/legacy-current.json
```

**硬阈值**: SHA mismatch=0、expired=0、missing assertion=0；TTL=24h。

### Step 5: 真读 GitHub main protection 并逐字段比对版本化政策

**来源**: `[FROM_PRD]` — PRD 第 21 行、第 29 行、第 42 行、第 57 行。

**可观测行为**: `gh api` 真请求成功；required checks/admin/linear history/force-push/delete/review policy
逐字段相等；认证、限流、字段缺失或漂移均非零退出。

**验证命令**:

```bash
gh api repos/perfectuser21/cecelia/branches/main/protection > /tmp/github-main-protection.json
jq -e '
  (.required_status_checks.strict|type)=="boolean" and
  (.required_status_checks.contexts|type)=="array" and
  (.enforce_admins.enabled|type)=="boolean" and
  (.required_pull_request_reviews|type)=="object" and
  (.required_linear_history.enabled|type)=="boolean" and
  (.allow_force_pushes.enabled|type)=="boolean" and
  (.allow_deletions.enabled|type)=="boolean"
' /tmp/github-main-protection.json
node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" \
  --verify-github-protection perfectuser21/cecelia main --output /tmp/legacy-github.json
jq -e '.github_protection.requested_live==true and .github_protection.match==true' /tmp/legacy-github.json
```

**硬阈值**: 六类 policy 字段齐全且版本化 policy mismatch=0；真实请求失败即 FAIL。

### Step 6: 以 #4372 当前产物证明 gate 会红

**来源**: `[FROM_PRD]` — PRD 第 11 行、第 26 行、第 40 行、第 56 行。

**可观测行为**: 固定 SHA fixture 必须非零退出，并精确报告 unknown=100、drifted=5、missing assertion=129、
green=0。

**验证命令**:

```bash
FIXTURE_REF=4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13
git rev-parse --verify "${FIXTURE_REF}^{commit}" >/dev/null
FIXTURE_LOG=/tmp/pr4372-counterexample.json
if node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" \
  --counterexample-ref "$FIXTURE_REF" --output "$FIXTURE_LOG"; then
  echo "FAIL: PR #4372 counterexample 被错误接受"
  exit 1
fi
jq -e '.status_counts.unknown==100 and .status_counts.drifted==5
  and .status_counts.missing_assertion==129 and .matrix.green==0
  and .result=="fail"' "$FIXTURE_LOG"
```

**硬阈值**: fixture exit≠0；100/5/129/0 逐字相等；不得改写 fixture。

### Step 7: 关键 guard 缺失 mutation 必须 proven-to-fire

**来源**: `[FROM_PRD]` — PRD 第 27 行、第 56 行。

**可观测行为**: 临时副本分别移除 credential guard、任一 stop hook、branch guard，gate 三次均非零退出且返回对应
behavior_id/construct。

**验证命令**:

```bash
for MUTATION in remove-credential-guard remove-stop-hook remove-branch-guard; do
  OUT="/tmp/${MUTATION}.json"
  if node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" \
    --mutation "$MUTATION" --output "$OUT"; then
    echo "FAIL: mutation 被错误接受: $MUTATION"
    exit 1
  fi
  jq -e --arg mutation "$MUTATION" '
    .result=="fail" and
    ([.violations[] | select(.mutation==$mutation and
      (.reason_code=="missing_construct" or .reason_code=="oracle_not_fired"))] | length)>0
  ' "$OUT"
done
```

**硬阈值**: 3/3 mutation 非零退出且 violation 可定位；工作区零改动。

### Step 8: 证据类型与汇总防伪 mutation 必须 proven-to-fire

**来源**: `[FROM_PRD]` — PRD 第 28 行、第 36 行、第 53 行。

**可观测行为**: manual→auto、hardcoded mismatch=0、伪造 match_count 均被拒绝；错误不得被汇总字段覆盖。

**验证命令**:

```bash
for MUTATION in manual-as-auto hardcoded-mismatch-zero forged-match-count; do
  OUT="/tmp/${MUTATION}.json"
  if node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" \
    --mutation "$MUTATION" --output "$OUT"; then
    echo "FAIL: evidence forgery 被错误接受: $MUTATION"
    exit 1
  fi
  jq -e --arg mutation "$MUTATION" '
    .result=="fail" and
    ([.violations[] | select(.mutation==$mutation and
      (.reason_code|test("manual_auto_mismatch|derived_count_mismatch|forged_aggregate")))] | length)>0
  ' "$OUT"
done
```

**硬阈值**: 3/3 防伪 mutation 非零；reason_code 精确；派生计数必须来自 behaviors/cells 重算。

### Step 9: 外部漂移、过期、SHA/owner/ref 异常全部 fail-closed

**来源**: `[FROM_PRD]` — PRD 第 29-30 行。

**可观测行为**: GitHub policy drift、expired evidence、wrong SHA、empty assertion、owner mismatch、oracle exception、
unsupported-without-decision、skipped Engine test 均非零退出。

**验证命令**:

```bash
for MUTATION in github-protection-drift expired-evidence wrong-current-sha empty-assertion-ref \
  owner-mismatch oracle-exception unsupported-without-decision skipped-engine-test; do
  OUT="/tmp/${MUTATION}.json"
  if node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" \
    --mutation "$MUTATION" --output "$OUT"; then
    echo "FAIL: fail-closed mutation 被错误接受: $MUTATION"
    exit 1
  fi
  jq -e --arg mutation "$MUTATION" \
    '.result=="fail" and ([.violations[] | select(.mutation==$mutation)] | length)>0' "$OUT"
done
```

**硬阈值**: 8/8 mutation 非零；不得降级为 unknown/PASS。

### Step 10: 只以逐行 proven active 汇总 PASS 与 143 green

**来源**: `[FROM_PRD]` — PRD 第 22 行、第 34 行、第 53-55 行。

**可观测行为**: final report 的五项门禁精确为 129/0/0/0/0；`proven_status_count` 只数真实 proven active；
13×11=143 个 cell 仅在辖下行为全部 current/proven 后 green。

**验证命令**:

```bash
node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" \
  --verify-github-protection perfectuser21/cecelia main --output /tmp/legacy-final.json
jq -e '
  .result=="pass" and
  .inventory_counts=={"total":129,"P0":66,"P1":63} and
  .status_counts=={"proven_active":129,"unknown":0,"drifted":0,
                   "missing_assertion":0,"owner_mismatch":0} and
  .proven_status_count==([.behaviors[]|select(.proven_status=="active")]|length) and
  .matrix.stage_count==13 and .matrix.element_count==11 and
  .matrix.cell_count==143 and .matrix.green==143 and
  ([.matrix.cells[]|select(
    (.behavior_ids|length)==0 or
    (.status=="green" and .all_behaviors_proven!=true)
  )]|length)==0
' /tmp/legacy-final.json
```

**硬阈值**: proven active=129；unknown/drifted/missing/owner mismatch=0；green=143；任何逐行重算不等即 FAIL。

## E2E 验收（最终 final-e2e 跑 — local_api）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"
FIXTURE_REF=4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13
CURRENT_SHA=$(git rev-parse --verify "HEAD^{commit}")
git fetch origin "$FIXTURE_REF"
git rev-parse --verify "${FIXTURE_REF}^{commit}" >/dev/null

npm ci --prefix packages/engine

# TDD/Engine 真测试；任何 skipped 都由等价 CLI 汇总为失败。
npm --prefix packages/engine test -- --reporter=verbose
for test_script in packages/engine/tests/integration/*.test.sh; do
  [ -f "$test_script" ] || continue
  bash "$test_script"
done

# 第三方真调：真实只读 GitHub protection API，不打印 token。
gh api repos/perfectuser21/cecelia/branches/main/protection > /tmp/github-main-protection.json
jq -e '
  (.required_status_checks.strict|type)=="boolean" and
  (.required_status_checks.contexts|type)=="array" and
  (.enforce_admins.enabled|type)=="boolean" and
  (.required_pull_request_reviews|type)=="object" and
  (.required_linear_history.enabled|type)=="boolean" and
  (.allow_force_pushes.enabled|type)=="boolean" and
  (.allow_deletions.enabled|type)=="boolean"
' /tmp/github-main-protection.json

# 固定 #4372 反例必须精确 FAIL。
if node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$REPO_ROOT" \
  --counterexample-ref "$FIXTURE_REF" --output /tmp/pr4372-counterexample.json; then
  echo "FAIL: PR #4372 counterexample 被错误接受"
  exit 1
fi
jq -e '.artifact_sha=="4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13"
  and .status_counts.unknown==100 and .status_counts.drifted==5
  and .status_counts.missing_assertion==129 and .matrix.green==0
  and .result=="fail"' /tmp/pr4372-counterexample.json

# 所有 PRD 指定 mutation 必须 proven-to-fire。
for MUTATION in remove-credential-guard remove-stop-hook remove-branch-guard \
  manual-as-auto hardcoded-mismatch-zero forged-match-count github-protection-drift \
  expired-evidence wrong-current-sha empty-assertion-ref owner-mismatch oracle-exception \
  unsupported-without-decision skipped-engine-test; do
  OUT="/tmp/legacy-${MUTATION}.json"
  if node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$REPO_ROOT" \
    --mutation "$MUTATION" --output "$OUT"; then
    echo "FAIL: mutation 被错误接受: $MUTATION"
    exit 1
  fi
  jq -e --arg mutation "$MUTATION" \
    '.result=="fail" and ([.violations[]|select(.mutation==$mutation)]|length)>0' "$OUT"
done

# 全量 current-SHA 真实矩阵；CLI 内部再次真读 GitHub API并逐字段比政策。
node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$REPO_ROOT" \
  --verify-github-protection perfectuser21/cecelia main --output /tmp/legacy-final.json
jq -e --arg sha "$CURRENT_SHA" '
  .artifact_sha==$sha and .evidence_ttl_hours==24 and .result=="pass" and
  .inventory_counts=={"total":129,"P0":66,"P1":63} and
  .status_counts=={"proven_active":129,"unknown":0,"drifted":0,
                   "missing_assertion":0,"owner_mismatch":0} and
  .proven_status_count==129 and
  .matrix.stage_count==13 and .matrix.element_count==11 and
  .matrix.cell_count==143 and .matrix.green==143 and
  ([.matrix.cells[]|select(
    (.behavior_ids|length)==0 or .artifact_sha!=$sha or
    (.status=="green" and .all_behaviors_proven!=true)
  )]|length)==0 and
  .engine_test_summary.started==true and
  .engine_test_summary.failed==0 and .engine_test_summary.skipped==0 and
  .github_protection.requested_live==true and .github_protection.match==true and
  ([.behaviors[]|select(.artifact_sha!=$sha or (.assertion_ref|length)==0)]|length)==0
' /tmp/legacy-final.json

git diff --exit-code -- packages/engine .github
echo "Legacy P0/P1 全量行为等价证明通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| inventory/三态/provider/矩阵/fixture/mutation | `sprints/07271905-kernel-legacy-equivalence-proof/tests/legacy-p0p1-equivalence.contract.test.ts` | `129 条 P0/P1 inventory`；`#4372 反例精确报告`；`credential guard 缺失`；`stop hook 缺失`；`branch guard 缺失`；`manual oracle 填入 auto 行`；`hardcoded mismatch zero`；`伪造 match_count`；`current SHA 与证据时效`；`proven_status_count 只数真实 proven active`；`provider unsupported 必须 approved retirement 或 supersession decision`；`13×11 cell 仅由 current-SHA proven active 行聚合为 green` | CLI/fixture/policy artifacts 尚不存在，测试失败 |
| 真 GitHub/Engine 接缝 | `sprints/07271905-kernel-legacy-equivalence-proof/tests/github-protection-equivalence.integration.test.ts` | `GitHub main protection 真实只读 API`；`Engine shell 与 stop hook 全量真跑且 skipped=0` | equivalence CLI 尚不存在，真实接缝测试失败 |

## CI 接线合同

- `.github/workflows/ci.yml` 的 `engine-tests` 或独立 required job 必须真执行
  `legacy-equivalence-gate.mjs`，并纳入 `ci-passed` needs/check；不能只验证文件存在。
- GitHub 分支保护版本化 policy 必须是只读比较基准；更新 policy 需独立批准 decision，不能由 live 响应自学习覆盖。
- Engine 版本同步按 `packages/engine/AGENTS` 既有规则更新 package/version/feature registry；不修改 Brain 源码，因此无需 Brain DEFINITION bump。

## notes

- registry API 有返回，但没有与本任务同名的新 endpoint/schema；CLI 报告按 PRD 字面定义。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)。
- #4372 只作为不可变反例 SHA/产物读取，不进入当前实现分支历史。
