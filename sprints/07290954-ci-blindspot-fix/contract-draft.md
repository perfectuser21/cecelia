# Contract Draft：CI 两处失明修复

sprint_dir: sprints/07290954-ci-blindspot-fix
task_id: 241578ce-6726-4658-afbc-03ac93036494
created: 2026-07-29
round: 1（无上轮 reviewer feedback）

---

## 一、背景与范围

本次 sprint 修复 `.github/workflows/ci.yml` 中两处已知盲点：

- **失明点①**：`changes` job 在 push 事件时 `git diff origin/main...HEAD` 恒为空，导致所有下游 job 被 skip，main 合并后 CI 形同虚设。
- **失明点②**：`packages/brain/scripts/fleet-worker/*.test.sh` 共 5 个 shell 测试无任何 CI job 执行，属孤儿测试。

修复范围严格最小化：仅修改 `.github/workflows/ci.yml` + 新增一个测试文件，零应用代码变更。

---

## 二、[BEHAVIOR] 条目（共 8 条）

### B1 — push 事件全量短路
**触发**：workflow 在 `push` 事件（任意分支）下运行  
**行为**：`changes` job 的 `detect` step 在 `BASE_REF` 计算之后、`git diff` 之前，检测 `github.event_name == 'push'`，若为真则立即输出 brain/engine/workspace/compose/dod/quality 全 true 并 `exit 0`  
**断言**：ci.yml `changes` job 区块内存在 `event_name` 与 `push` 的对比逻辑（正则 `event_name.*(==|!=).*push` 或等效）  
**FR 来源**：失明点①

### B2 — PR 改 workflow 文件时全量短路
**触发**：PR diff 中含 `.github/workflows/` 路径的文件  
**行为**：`detect` step 在 `CHANGED` 变量赋值之后、各 output 赋值之前，检测 `CHANGED` 是否含 `^\.github/workflows/`，若为真则同样输出全 true 并 `exit 0`  
**断言**：ci.yml `changes` job 区块内存在针对 `.github/workflows/` 的 grep 全量触发逻辑  
**FR 来源**：失明点①（防止修复 PR 本身被 skip）

### B3 — brain-tests-shell job 存在
**触发**：任意 PR/push 且 `changes.outputs.brain == 'true'` 或 push 到 main  
**行为**：ci.yml 包含名为 `brain-tests-shell` 的 job，glob 目标为 `packages/brain/scripts/fleet-worker/*.test.sh`，有 `needs: changes` 依赖  
**断言**：ci.yml 中存在 `brain-tests-shell:` job 定义，且含 `for t in packages/brain/scripts/fleet-worker/*.test.sh` 行  
**FR 来源**：失明点②

### B4 — ci-passed 将 brain-tests-shell 列入 needs
**触发**：ci-passed job 执行  
**行为**：`ci-passed` 的 `needs:` 数组包含 `brain-tests-shell`，`Check results` step 中调用 `check "brain-tests-shell"` 并传入其 result  
**断言**：ci.yml 的 `ci-passed` job 块中同时出现 `brain-tests-shell`（needs 数组）和 `check "brain-tests-shell"` 调用  
**FR 来源**：失明点②

### B5 — TDD 契约测试文件存在
**触发**：`engine-tests-shell` job 运行时  
**行为**：`packages/engine/tests/integrity/ci-blindspot-contract.test.sh` 存在且可由 `engine-tests-shell` 的 integrity glob 自动接线  
**断言**：文件存在，且 engine-tests-shell integrity step 的 glob `packages/engine/tests/integrity/*.test.sh` 能匹配到它  
**FR 来源**：TDD 回归测试要求

### B6 — 契约测试断言一：push 事件短路逻辑（静态）
**触发**：契约测试在未修改 ci.yml 时执行（Commit-1 阶段）  
**行为**：测试 grep ci.yml `changes` job 区块，查找 push 事件判断逻辑，未修复时断言失败  
**断言**：修复后 `ci-blindspot-contract.test.sh` 该断言 PASS  
**FR 来源**：TDD Commit-1 → Commit-2 红绿节奏

### B7 — 契约测试断言二：fleet-worker glob 行存在（静态）
**触发**：契约测试执行  
**行为**：grep ci.yml 是否含 `for t in packages/brain/scripts/fleet-worker/*.test.sh`  
**断言**：修复后该断言 PASS  
**FR 来源**：失明点②

### B8 — 契约测试断言三：ci-passed needs 含 brain-tests-shell（静态）
**触发**：契约测试执行  
**行为**：grep ci.yml 的 `ci-passed` 块，查找 `brain-tests-shell`  
**断言**：修复后该断言 PASS  
**FR 来源**：失明点②

---

## 三、非功能约束（NFR）

| # | 约束 | 验证方式 |
|---|------|---------|
| N1 | 改动范围最小化：仅 ci.yml + 新增测试文件，零应用代码变更 | git diff --name-only 仅含两条路径 |
| N2 | 不引入新的第三方 Action 依赖 | ci.yml 中 uses: 行不新增 `actions/` 外的 action |
| N3 | 不改变现有 job 触发条件语义（只扩充，不收窄） | 现有 if 条件行无删改 |

---

## 四、不包含（Out of Scope）

- 夜间三闸（nightly-regression / integration-nightly / smoke-e2e-nightly）容器命名 / DB schema drift
- auto-merge 绕过 harness judge 门禁问题

---

## 五、风险与已知限制

**R1 已知限制（可接受）**：`ci-blindspot-contract.test.sh` 由 `engine-tests-shell` job 接线（glob `packages/engine/tests/integrity/*.test.sh`），触发条件为 `needs.changes.outputs.engine == 'true' || github.ref == 'refs/heads/main'`。对于仅改 brain 代码的 PR（engine=false），该契约测试不会在 PR CI 中运行，但会在合入 main 后的下次 push CI 中运行（可接受时差，main push 全量兜底是本次修复的核心目标）。

---

## 六、关键文件

| 文件 | 操作 |
|------|------|
| `.github/workflows/ci.yml` | 改动 A（push 短路）/ B（workflow 文件全量）/ C（新 brain-tests-shell job）/ D（ci-passed needs 追加） |
| `packages/engine/tests/integrity/ci-blindspot-contract.test.sh` | 新增（三条静态断言） |

---

## E2E 验收

最终验收步骤：

1. **本地静态契约测试**（验证 ci.yml 三条断言全绿）：
   ```bash
   bash packages/engine/tests/integrity/ci-blindspot-contract.test.sh
   # 期望输出：PASS=3 FAIL=0
   ```

2. **触发 CI run**：push 到分支 `cp-07291011-ws-241578ce`，确认以下 job 均为 success（非 skipped）：
   - `changes`（detect step 输出 brain/engine/workspace/compose/dod/quality 全 true）
   - `brain-tests-shell`（5 个 fleet-worker .test.sh 均有 `::group::` 日志）
   - `engine-tests-shell`（ci-blindspot-contract.test.sh 被接线执行）
   - `ci-passed`（最终 exit 0）

3. **验收 CI 日志**：
   ```bash
   gh run list --branch cp-07291011-ws-241578ce --limit 1
   gh run view <run-id> --log | grep -E 'PASS|FAIL|brain-tests-shell|ci-passed'
   ```

4. **合入 main 后验证**：下次 push 到 main 触发的 CI run 中，`brain-unit` / `engine-tests-shell` 等 job status 均为 success 或 failure（非 skipped），确认 push 短路修复生效。

## Test Contract

| Workstream | Test File | Behaviors |
|---|---|---|
| ws1 | `packages/engine/tests/integrity/ci-blindspot-contract.test.sh` | B5、B6、B7、B8 |
| ws2 | `tests/ci-blindspot-contract.test.sh` | B1、B2、B3、B4 |
