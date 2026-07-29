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

## 五、关键文件

| 文件 | 操作 |
|------|------|
| `.github/workflows/ci.yml` | 改动 A（push 短路）/ B（workflow 文件全量）/ C（新 brain-tests-shell job）/ D（ci-passed needs 追加） |
| `packages/engine/tests/integrity/ci-blindspot-contract.test.sh` | 新增（三条静态断言） |
