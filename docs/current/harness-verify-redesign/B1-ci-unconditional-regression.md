# B1：核心回归套件脱离路径门、无条件每次全跑

> 方案起草，**不改代码、不 commit**。落地时走 /dev + [CONFIG]。
> 消费上游 A3 产出的 `regression-contract.yaml`（见「## 依赖」）。

---

## 问题现状

CI 用**目录前缀**做路径门，跨服务回归会从门缝里漏过去。

- `.github/workflows/ci.yml` 第 19-51 行 `changes` job：用 `git diff --name-only` 匹配目录前缀产出布尔量。
  - 第 49 行 `workspace=$(echo "$CHANGED" | grep -qE '^apps/' && echo true || echo false)` —— **只有改动含 `^apps/` 才 `workspace=true`**。
  - 第 47 行 `brain` 同理只认 `^packages/brain/`。
- 第 628-658 行 `workspace-test` job，第 630 行 `if: needs.changes.outputs.workspace == 'true'` —— **改了 `apps/` 才跑**。同样地 `workspace-build`(615)、`brain-unit`(425)、`brain-integration`(569) 全是路径门控。
- **漏洞链路**：一个 PR 只改 `packages/brain/`（比如改了共享 DB schema 或某个 brain API 的响应结构），打坏了 `apps/` 客服行为。因为 diff 里没有 `^apps/`，`workspace=false` → `workspace-test` 被 `if` 跳过 → 该 job 在 `ci-passed`(1446-1494) 里记为 `skipped`（`check()` 把 skipped 当通过）→ **绿灯放行**。
- **深层原因**：Facebook/Bazel 那种"只测受影响的"靠**精确依赖图**；这里的 `changes` job 是廉价的目录前缀近似。而 `apps/` ↔ `packages/brain/` 是**共享 DB schema + HTTP API 契约的运行时耦合**，连静态依赖图都算不全（跨进程、跨 HTTP、跨库）。目录前缀近似必然漏这类耦合。
- 现有的无条件层不覆盖这个缺口：
  - `e2e-smoke`(663-709) 无路径门，但只跑 **brain 侧** golden-path / agent-lifecycle / dev-lifecycle 三条 integration。
  - `regression-smoke`(716-794) 无 `if` 门（`needs:[changes]` 但不消费），却**只扫 `packages/quality/tests/regression/*.golden-smoke.test.ts`**，且该目录当前不存在 → 第 784 行 `echo "INFO: 暂无..."; exit 0` 静默跳过。它没有消费 `regression-contract.yaml`，也没沉淀任何跨服务不变量。
  - `workspace-api-smoke`(1000-1077) 无门，但用 **stub brain**（第 1029 行 python 假服务），只验代理路由，不验真实 brain 行为对 apps 的影响。

**现成可复用的"main 无条件"先例**：第 333 行 `engine-tests-shell` 的 `if: needs.changes.outputs.engine == 'true' || github.ref == 'refs/heads/main'` —— 路径命中 **或** push 到 main 都跑。

---

## 目标

新增一个 **`core-regression`** job，作为路径门之外的**无条件回归层**：

1. **不受 `changes` 路径门限制**——每次 PR 都跑（不管改了哪个目录）；push 到 main 时跑**全集**。
2. 跑的是 A3 在 `regression-contract.yaml` 里累积的 **golden path 逻辑测试 + invariant 断言**——即"这些跨服务行为永远不许坏"的策展子集。
3. 定位是**补一个无条件层，不是替代** `workspace-test`/`brain-unit`（见「## 与现有 job 的关系」）。
4. CI 时间可控（见「## 风险与注意」）。

---

## 具体改动

### 1. 触发条件（核心：拆掉路径门）

新 job **不写任何 `if: needs.changes.outputs.* == 'true'`**。采用两档策略，对齐 `regression-contract.yaml` 已有的 `trigger: [PR, Release]` 语义：

```yaml
core-regression:
  name: Core Regression (无条件 · 跨服务不变量)
  # ⚠️ 关键：不 needs [changes]，不写路径门 if。永远跑。
  runs-on: ubuntu-latest
  timeout-minutes: 15
  services:
    postgres:            # 复用现有 e2e-smoke / workspace-test 的 pg service 配方
      image: pgvector/pgvector:pg15
      env: { POSTGRES_USER: cecelia, POSTGRES_PASSWORD: ${{ secrets.CI_DB_PASSWORD }}, POSTGRES_DB: cecelia_test }
      ports: ['5432:5432']
      options: >-
        --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: '22', cache: 'npm' }
    - name: 选档（PR=P0/P1 must_never_break 子集 · main=全集）
      id: gate
      run: |
        if [ "${{ github.ref }}" = "refs/heads/main" ]; then
          echo "mode=release" >> $GITHUB_OUTPUT   # 跑 trigger 含 Release 的全部条目
        else
          echo "mode=pr" >> $GITHUB_OUTPUT         # 只跑 trigger 含 PR 的条目
        fi
    - name: 装依赖 + migrate（按 contract 涉及的包）
      run: |
        npm ci
        cd packages/brain && node src/migrate.js
    - name: Run core regression（消费 regression-contract.yaml）
      run: bash scripts/ci/run-core-regression.sh "${{ steps.gate.outputs.mode }}"
```

- **两档语义**：PR 触发 → 跑 `trigger` 含 `PR` 的条目（策展的 P0/P1 `must_never_break` 核心，速度优先）；push main → 跑含 `Release` 的**全集**（合入前最后一道全量网）。这直接复用 A3 契约里的 `triggers: [PR, Release]` 字段，不新造维度。
- 底线满足任务要求的"至少 merge 到 main 时全跑"，同时 PR 阶段也有一层策展防护（比"只在 main 跑"更早拦住跨服务回归）。

### 2. 跑什么（从 `regression-contract.yaml` 读，不写死清单）

新增 runner 脚本 `scripts/ci/run-core-regression.sh`（本地可独立执行，便于调试），职责：

1. `yq` 解析 A3 的 `regression-contract.yaml`，按 `mode`(pr/release) 过滤 `triggers` 字段（复用 `packages/quality` 已有的 `rc-filter` / `scan-rci-coverage.cjs` 解析范式）。
2. 对每条命中的 RCI，执行其 `test_command` 字段（例：`bash tests/...` / `npx vitest run <file>` / `node -e ...` invariant 断言）。
3. **golden path 逻辑测试** = `golden_paths:` 段里 `method: auto` 且带 `test:` 的条目（跨多 RCI 的端到端断言，如"brain 改动后 apps 客服接口契约仍成立"）。
4. **invariant 断言** = `core:` / `rcis:` 段里 `must_never_break: true` 的条目——机器可执行的不变量（DB schema 关键字段存在、跨包 API 响应结构、状态机合法转移等）。
5. 任一 `must_never_break` 条目失败 → 脚本非 0 退出 → job 红。汇总输出 `通过/失败/跳过` 计数（对齐 `regression-smoke` 现有风格）。

> **glob/契约自动发现**：新增一条跨服务不变量 = 往 `regression-contract.yaml` 加一条 `trigger:[PR]` + `must_never_break:true` 的 RCI（+ 对应 test 文件）。runner 下次自动跑，**永不消失、无需改 ci.yml**。这和 vitest `include` glob（`apps/api/vitest.config.ts`）自动发现新 test 是同一哲学：登记面收敛到契约文件一处。

> **首次落地不空跑**：A3 需把当前 `apps/` ↔ `brain` 最关键的 1-3 条跨服务 golden path（如客服会话读写、任务状态回写）写进 root `regression-contract.yaml`（现在是空的 `core: []` / `golden_paths: []`），否则本 job 沦为 `regression-smoke` 那样的静默 `exit 0` 摆设。runner 里应加一条**空契约守卫**：`mode=release` 全集为空即 fail（防契约被清空后无声退化），`mode=pr` 子集为空时告警但放行。

### 3. 接入 `ci-passed` 聚合门

- 把 `core-regression` 加进第 1446 行 `ci-passed` 的 `needs:` 列表，并在 `check()` 段（1456-1489）加一行 `check "core-regression" "${{ needs.core-regression.result }}"`。
- 因为本 job 无路径门、永远真跑，它的 result 只会是 `success`/`failure`，**不会是 skipped** —— 这正是要的：绿灯必须包含它真跑过。
- 落地后建议将 `core-regression` 纳入 GitHub 分支保护 required checks（防止它变成"可选绿"）。

---

## DoD

- [ ] **[BEHAVIOR]** 新 job `core-regression` 在 ci.yml 中**无** `needs.changes` 路径门 `if`。Test: `manual: node -e "const y=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); const m=y.split('core-regression:')[1].split(/\n  [a-z]/)[0]; if(/needs\.changes\.outputs/.test(m)) throw new Error('core-regression 被路径门污染'); console.log('ok: 无路径门')"`
- [ ] **[BEHAVIOR]** 一个只改 `packages/brain/`、打坏跨服务不变量的 PR 会让 `core-regression` 变红（构造 fixture：改 brain 侧某契约字段 → 对应 invariant test 失败）。Test: `tests/ci/core-regression-catches-cross-service.test.ts`
- [ ] **[BEHAVIOR]** runner 按 `mode` 正确过滤 `triggers`：pr 模式只跑含 PR 的条目，release 模式跑含 Release 的条目。Test: `manual: bash scripts/ci/run-core-regression.sh pr --dry-run | grep -q 'trigger=PR'`
- [ ] **[BEHAVIOR]** 空契约守卫：`mode=release` 且契约全集为空时 runner 非 0 退出。Test: `tests/ci/run-core-regression-empty-guard.test.ts`
- [ ] **[ARTIFACT]** `core-regression` 已加入 `ci-passed` 的 `needs` 与 `check()` 段。Test: `manual: node -e "const y=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!/needs.core-regression.result/.test(y)) throw new Error('未接入 ci-passed'); console.log('ok')"`
- [ ] **[ARTIFACT]** root `regression-contract.yaml` 至少含 1 条 `apps/↔brain` 跨服务 golden path（`method: auto` + `test:` + `must_never_break: true`）。

---

## 依赖（消费 A3 写的 regression-contract.yaml）

- **强依赖 A3**：本 job 只是 `regression-contract.yaml` 的**执行器**，契约内容（RCI 定义、golden path、invariant、`triggers`/`must_never_break`/`test_command` 字段）由 A3 产出与维护。A3 未落地前，本 job 无东西可跑。
- **契约位置/schema 需与 A3 对齐**：仓库现有三份同名文件语义不一——
  - root `regression-contract.yaml`：`core: []` / `golden_paths: []`（**空**，v1.0.0）。
  - `packages/quality/regression-contract.yaml`：`rcis:` 数组，字段 `triggers/test_command/test_file/must_never_break`（**这份的 schema 最贴合 B1 需求**）。
  - `packages/quality/contracts/regression-contract.template.yaml`：完整 hooks/workflow/ci/golden_paths 模板，字段 `trigger/method/test`。
  A3 需**定一处 SSOT**（建议 root `regression-contract.yaml` 或 `packages/quality/`）并统一 schema；B1 runner 按该 SSOT 的字段名解析。**本方案默认采用 quality 那份的字段名**（`triggers` 复数 + `test_command` + `must_never_break`），若 A3 选别的 schema，runner 解析逻辑随之对齐。
- **解析工具已就绪**：`yq`（本机 `/opt/homebrew/bin/yq`，CI runner 需 `apt-get install` 或用 node yaml 解析）+ 现成范式 `packages/quality/scripts/devgate/scan-rci-coverage.cjs`。

---

## 风险与注意（CI 时间）

- **时间预算**：本 job **永远跑**，直接加到每个 PR 的关键路径。控制手段：
  1. **PR 档只跑策展子集**（`trigger:[PR]` 的 P0/P1 `must_never_break`），不是全量 apps/brain 测试；全量留给 push-main 档。目标 PR 档 < 8min，main 档 < 15min（`timeout-minutes: 15` 兜底）。
  2. **复用单个 postgres service**，不 docker build（对比 `real-env-smoke` 要 build 镜像、慢）。
  3. 契约增长后若超时，用 vitest `--shard=i/N` 矩阵并行（brain-unit 第 428-431 行已有先例），或按 `priority` 再分档（P0 每 PR、P1 仅 main）。
- **与并行 job 争 runner**：新增一个常驻 job 会占并发额度。缓解：`concurrency`(13-15) 已 `cancel-in-progress`，过期 run 会被取消；本 job 单实例、无 matrix，增量可控。
- **契约空跑陷阱**：若 A3 契约为空，本 job 会像现在的 `regression-smoke` 一样静默绿 → 假安全。**空契约守卫**（见 2.5）是硬要求，否则这层等于没加。
- **不变量必须机器可执行**：`method: manual` 的条目不能进本 job（无法自动断言）。runner 只挑 `method: auto` + 有 `test`/`test_command` 的条目；`manual` 条目跳过并计数提示（留给人工/evaluator）。
- **DB 依赖成本**：跨服务不变量多半要真 DB（schema/契约断言），故本 job 带 postgres service。若某些不变量是纯静态（grep 代码/结构），可拆出一个无 service 的快前置步骤先跑，快速失败省 runner 时间。
- **不替代、勿删既有门**：`workspace-test`/`brain-unit` 的路径门保留（改哪测哪的**全量深测**仍有价值、且快）。本 job 只补**策展的跨服务浅层网**。两者叠加：路径命中时深测 + 永远浅测跨服务不变量。
