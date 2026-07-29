# Sprint PRD：CI 两处失明修复
task_id: 241578ce-6726-4658-afbc-03ac93036494
sprint_dir: sprints/07290954-ci-blindspot-fix
created: 2026-07-29

---

## 一、问题描述

### 失明点①：main push 全量回归死码
`.github/workflows/ci.yml` 的 `changes` job（第 28–61 行）检测逻辑缺陷：

```
BASE_REF="origin/${{ github.base_ref || 'main' }}"
```

`github.base_ref` 仅在 `pull_request` 事件时非空；push 事件时为空，fallback 到 `origin/main`。
push 到 main 时 HEAD == origin/main → `git diff origin/main...HEAD` 恒为空 →
brain/engine/workspace/compose/dod/quality 六个 output 全部 false → 下游几乎所有测试 job 被 skip。

**实证**：PR #4422 合入 main 后 CI 仅 1m31s 绿，什么都没测。

### 失明点②：fleet-worker regression test 孤儿
最近 6 个 fix(fleet) PR 累积的 5 个 shell 测试文件（`packages/brain/scripts/fleet-worker/*.test.sh`）
没有任何 CI job 执行：`engine-tests-shell` 的 glob 只扫 `packages/engine/tests/{unit,integration,integrity}/*.test.sh`。

---

## 二、修法（一个 PR，两个 commit）

### Commit-1（TDD 红：先提测试，此时对照未修复的 ci.yml 应为 3 项全红）

**新增** `packages/engine/tests/integrity/ci-blindspot-contract.test.sh`

目录 `packages/engine/tests/integrity/` 当前**不存在**，需新建。
该目录已在 `engine-tests-shell` job 的 `Run integrity meta-tests` step 中被 glob 扫描：

```bash
for t in packages/engine/tests/integrity/*.test.sh; do
```

新增文件自动接线，不需要额外改 job 定义。

三条静态契约断言（grep ci.yml 文本内容）：

| # | 断言描述 | 正则 / grep 目标 |
|---|---------|----------------|
| 1 | `changes` job 内含 push 事件分支判断 | 提取 `changes:` job 到下一顶层 job 之间内容，正则 `event_name.*(==\|!=).*push` |
| 2 | ci.yml 里存在运行 fleet-worker 测试的 glob 行 | `for t in packages/brain/scripts/fleet-worker/\*.test.sh` |
| 3 | `ci-passed` job 的 `needs:` 数组含 `brain-tests-shell` | grep `brain-tests-shell` 在 `ci-passed` 块内 |

Commit-1 预期结果：`PASS=0 FAIL=3`（契约尚未满足）

### Commit-2（TDD 绿：改 ci.yml 让测试全绿）

修改 `.github/workflows/ci.yml` 四处：

**改动 A — `changes` job `detect` step**

在 `BASE_REF` 计算之后、`git diff` 之前插入 push 事件短路逻辑：

```bash
# push 到 main：直接全量，不依赖恒空的 diff
if [ "${{ github.event_name }}" = "push" ]; then
  echo "brain=true"    >> $GITHUB_OUTPUT
  echo "engine=true"   >> $GITHUB_OUTPUT
  echo "workspace=true" >> $GITHUB_OUTPUT
  echo "compose=true"  >> $GITHUB_OUTPUT
  echo "dod=true"      >> $GITHUB_OUTPUT
  echo "quality=true"  >> $GITHUB_OUTPUT
  exit 0
fi
```

**改动 B — `changes` job `detect` step（PR 改 workflow 文件时全量）**

在 `git diff` 得到 `CHANGED` 后、各 output 赋值前插入：

```bash
# PR 改了 workflow 文件 → 也全量跑，让本修复 PR 自己触发全量测试
if echo "$CHANGED" | grep -qE '^\.github/workflows/'; then
  echo "brain=true"    >> $GITHUB_OUTPUT
  echo "engine=true"   >> $GITHUB_OUTPUT
  echo "workspace=true" >> $GITHUB_OUTPUT
  echo "compose=true"  >> $GITHUB_OUTPUT
  echo "dod=true"      >> $GITHUB_OUTPUT
  echo "quality=true"  >> $GITHUB_OUTPUT
  exit 0
fi
```

**改动 C — 新增 `brain-tests-shell` job**

照抄 `engine-tests-shell` 的结构，glob 目标改为 fleet-worker：

```yaml
brain-tests-shell:
  name: Brain Shell Tests (fleet-worker 套)
  needs: changes
  if: needs.changes.outputs.brain == 'true' || github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  timeout-minutes: 10
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - name: Run fleet-worker shell tests
      run: |
        for t in packages/brain/scripts/fleet-worker/*.test.sh; do
          [[ -f "$t" ]] || continue
          echo "::group::$(basename "$t")"
          bash "$t" || exit 1
          echo "::endgroup::"
        done
```

**改动 D — `ci-passed` job 的 `needs` 数组**

在第 1779 行的 needs 数组末尾追加 `brain-tests-shell`，同时在 Check results step 中追加：

```bash
check "brain-tests-shell" "${{ needs.brain-tests-shell.result }}"
```

Commit-2 预期结果：`PASS=3 FAIL=0`

---

## 三、验收标准（Final E2E Invariants）

| # | 验收项 | 技术断言 |
|---|--------|---------|
| I1 | TDD commit 顺序正确 | `lint-tdd-commit-order` 检测到 Commit-1（红）在先、Commit-2（绿）在后 |
| I2 | 本 PR 触发全量测试 | 因改了 `.github/workflows/**`，`changes` job 所有 output == true，无 job 被 skip |
| I3 | fleet-worker 5 个测试在 CI 中真实执行 | `brain-tests-shell` job status == `success`（非 skipped），5 个 .test.sh 均可见 |
| I4 | `brain-tests-shell` 是 ci-passed 必过项 | `ci-passed` job needs 数组含该名，check 函数对其 result 做 skipped=fail 判断 |
| I5 | 全 CI 绿，无既有 job 破坏 | `ci-passed` 最终 exit 0 |
| I6 | 合入 main 后下次 push CI 不 skip | `gh run list --branch main --limit 1` 看到 brain-unit 等 job status == success/failure（非 skipped） |

共 **6 个 invariant**。

---

## 四、不包含

- 夜间三闸（nightly-regression / integration-nightly / smoke-e2e-nightly）容器命名 / DB schema drift 问题（已登记 issue 9b6d49a7）
- auto-merge 绕过 harness judge 门禁问题（另案处理）

---

## 五、关键文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `.github/workflows/ci.yml` | 修改 | 改动 A/B/C/D（changes 短路、新 job、ci-passed needs） |
| `packages/engine/tests/integrity/ci-blindspot-contract.test.sh` | 新增 | 三条静态契约断言（先红后绿） |

---

## 六、当前状态快照

- `packages/brain/scripts/fleet-worker/*.test.sh`：5 个文件，本地预跑全绿
- `packages/engine/tests/integrity/`：目录**不存在**，需新建
- `engine-tests-shell` job 的 integrity glob 已覆盖该目录（第 356–361 行）
- `ci-passed` needs 数组当前末尾为 `brain-version-bump-gate`（第 1779 行），需追加 `brain-tests-shell`
- `ci-passed` Check results step 当前最后一个 check 为 `brain-version-bump-gate`（约第 1843 行），需追加 `brain-tests-shell`

---

## 七、FR 累积计数

本 sprint 新增 FR 数量：**2**（失明点① + 失明点②）
累积 FR 数量（本任务）：**2**
