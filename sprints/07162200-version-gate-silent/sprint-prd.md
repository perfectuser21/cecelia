# Sprint PRD：版本防线静默修复（07162200）

**Task ID**: d8189a83-3bd3-4da3-ac70-f0ed2ba4ece4
**Sprint Dir**: sprints/07162200-version-gate-silent
**Target**: local_api
**Date**: 2026-07-17

---

## 背景与症状

PR #3940（`fix(watchdog): OPEN PR 死局解除`）改动了 `packages/brain/src/harness-relay-watchdog.js`，但**未 bump `packages/brain/package.json` 版本**，CI 全绿放行。

**实际诊断结果**（证据已从代码中直接读取，非估测）：

`git show 815f89821 --stat` 输出：
- 改动 `packages/brain/src/harness-relay-watchdog.js`（+64 行）
- **无** `packages/brain/package.json`、`.brain-versions`、`DEFINITION.md` 版本字段改动

但 CI 全绿，`check-version-sync` 未拦截。

---

## 根因诊断（双重漏洞）

### 漏洞一：check-version-sync.sh 只验"四处一致性"，不验"是否递增"

`scripts/check-version-sync.sh` 的逻辑是：
1. 读 `packages/brain/package.json` 的版本作为基准
2. 检查 `packages/brain/package-lock.json`、`.brain-versions`、`DEFINITION.md` 三处是否与基准一致

**结论**：只要四处都是同一个版本（即使是旧版本），脚本就通过。改了 src 但不 bump 版本 → 四处仍一致 → 全绿。该脚本**从设计上就不检查"版本是否比 main 高"**。

### 漏洞二：ci.yml brain 路径根本不调用 check-version-sync.sh

`ci.yml` 中唯一的 `check-version-sync.sh` 调用位于：
```yaml
engine-tests:
  run: cd packages/engine && bash ci/scripts/check-version-sync.sh
```

Brain PR 触发的 `brain-unit` / `brain-integration` / `brain-diff-coverage` job **均无版本检查步骤**。`scripts/check-version-sync.sh`（Brain 版）在 CI 中**未被任何 job 调用**。

### 关于 auto-version.yml

`auto-version.yml` 在 push to main 后按 conventional commit 类型自动 bump 版本，但这是**事后 bump**（merge 后才跑），无法在 PR 阶段拦截未 bump 的提交。且仅 `feat/fix` 开头的 commit 才触发，`chore/docs/test` 开头的 commit 不会 bump。

---

## 决策：方案选择

**选择方案①**：在 brain PR 的 CI 中加"src 变更必须 bump 版本"门禁。

**否决方案②（删除版本系统）**的理由：
- `brain-ci-deploy.yml` 的部署效果断言步骤 `assert-deploy-effect.sh` 用 `/health.version == 本次期望版本` 验证容器真正重启，版本号是唯一对账字段。
- 若退役版本号，需同时重写 Gate3 的生产校验机制，超出本次 sprint 边界。

---

## 目标

在 brain PR 的 CI 中加一个轻量门禁 job：**diff `packages/brain/src/**` 非空 → 要求 PR 分支的 `packages/brain/package.json` 版本 > main 分支的对应版本**，否则 CI 失败并给出 fix 提示。

---

## Golden Path（4 条，必须有测试）

### GP-1：改 brain src 且 bump 了版本 → 门禁通过
**条件**：PR diff 含 `packages/brain/src/*.js`，PR 分支 `package.json` version > main version  
**期望**：门禁脚本返回 exit 0，CI 绿

### GP-2：改 brain src 未 bump 版本 → 门禁拦截
**条件**：PR diff 含 `packages/brain/src/*.js`，PR 分支 `package.json` version == main version  
**期望**：门禁脚本返回 exit 1，输出明确的 bump 提示，CI 红

### GP-3：未改 brain src（仅改 tests/docs/sprints）→ 门禁跳过
**条件**：PR diff 不含 `packages/brain/src/**`（仅含 `__tests__/`、`sprints/`、`.md` 等）  
**期望**：门禁脚本跳过检查（exit 0），不阻塞纯 test/doc PR

### GP-4：改 brain src + version 已是更高值（patch/minor/major 均可）→ 通过
**条件**：PR 分支 version=1.268.0，main version=1.267.0，diff 含 src  
**期望**：exit 0（验证 semver 比较逻辑正确，不要求固定步长）

---

## 验收标准

### 功能验收
- [ ] GP-1 ~ GP-4 测试全部通过（failing test 先 commit，修复后再绿）
- [ ] `tests/check-version-sync.test.js` 中现有 DEFINITION.md 漂移测试仍通过（无回归）
- [ ] 门禁脚本本地可独立运行（`bash scripts/ci/check-brain-version-bump.sh`）

### 实现约束
- 门禁脚本须能接受 `BASE_REF` 环境变量指定 main 基准（CI 中为 `origin/main`，本地测试可传临时 ref）
- 版本比较用 `node -e` + semver 库（brain 已有 semver 依赖）或简单 IFS 拆分比较，不引入新依赖
- 脚本失败时**必须输出** fix 提示，至少包含：`npm version patch --no-git-tag-version` 命令示例
- ci.yml 中新增 job 须设置 `if: needs.changes.outputs.brain == 'true'`（复用已有 changes job）
- 新 CI job 名须加入 `ci-passed` 聚合 job 的 `needs` 列表

### 铁律
- 不改 auto-version.yml（不干扰 push-to-main 后的自动 bump）
- 不删 check-version-sync.sh（该脚本仍负责"四处一致性"校验，两者互补）
- 不改 brain-ci-deploy.yml（Gate3 部署效果校验逻辑独立）
- 不触碰四处同步规则（`scripts/check-version-sync.sh` 仍由 engine-tests 调用）

---

## 实现路径

### 新增文件
- `scripts/ci/check-brain-version-bump.sh`：门禁脚本主体

### 变更文件
- `.github/workflows/ci.yml`：在 brain-unit 前新增 `brain-version-bump-gate` job
- `.github/workflows/ci.yml`：`ci-passed` job 的 `needs` 列表加入 `brain-version-bump-gate`
- `tests/check-brain-version-bump.test.js`：GP-1 ~ GP-4 的 failing test（先写先 commit）

### 门禁脚本逻辑（伪代码）

```bash
#!/usr/bin/env bash
# check-brain-version-bump.sh
# 若 PR diff 含 packages/brain/src/**，则要求版本比 main 高

set -e
BASE_REF="${BASE_REF:-origin/main}"

# 1. 检查 diff 是否含 brain src
CHANGED=$(git diff --name-only "$BASE_REF"...HEAD 2>/dev/null || echo "")
if ! echo "$CHANGED" | grep -qE '^packages/brain/src/'; then
  echo "⏭️  PR 不含 packages/brain/src/ 变更 — 跳过版本 bump 检查"
  exit 0
fi

# 2. 读当前分支版本 vs main 版本
PR_VERSION=$(node -e "process.stdout.write(require('./packages/brain/package.json').version)")
MAIN_VERSION=$(git show "$BASE_REF":packages/brain/package.json | node -e "
  const d=require('fs').readFileSync('/dev/stdin','utf8');
  process.stdout.write(JSON.parse(d).version)
")

# 3. semver 比较（PR 必须 > main）
IS_BUMPED=$(node -e "
  const [a,b] = ['$PR_VERSION','$MAIN_VERSION'].map(v=>v.split('.').map(Number));
  const gt = a[0]>b[0] || (a[0]===b[0] && (a[1]>b[1] || (a[1]===b[1] && a[2]>b[2])));
  process.stdout.write(gt ? 'yes' : 'no')
")

if [ "$IS_BUMPED" = "yes" ]; then
  echo "✅ 版本已 bump：$MAIN_VERSION → $PR_VERSION"
  exit 0
else
  echo "❌ PR 改了 packages/brain/src/，但版本未 bump（当前: $PR_VERSION，main: $MAIN_VERSION）"
  echo ""
  echo "Fix:"
  echo "  cd packages/brain && npm version patch --no-git-tag-version"
  echo "  node -e \"process.stdout.write(require('./packages/brain/package.json').version)\" > ../../.brain-versions"
  echo "  # 同步更新 DEFINITION.md 的 Brain 版本行"
  exit 1
fi
```

### CI job 片段
```yaml
brain-version-bump-gate:
  name: Brain Version Bump Gate
  needs: [changes]
  if: needs.changes.outputs.brain == 'true' && github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  timeout-minutes: 3
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - name: Check brain src → version bump required
      run: |
        git fetch origin "${{ github.base_ref }}" --depth=1 || true
        BASE_REF="origin/${{ github.base_ref }}" bash scripts/ci/check-brain-version-bump.sh
```

---

## 测试设计（新增 4 条，failing first）

文件：`tests/check-brain-version-bump.test.js`

```js
// GP-1: 改 src + bump → 通过
it('改 brain src 且 bump 了版本 → exit 0', () => {
  // 搭建 fixture: PR version=1.268.0, main version=1.267.0, diff 含 src/foo.js
  // execSync('bash scripts/ci/check-brain-version-bump.sh', { env: { BASE_REF: ... } })
  // expect exit code === 0
});

// GP-2: 改 src 未 bump → 拦截（failing test，改代码前先红）
it('改 brain src 未 bump → exit 1 且含 fix 提示', () => {
  // PR version === main version, diff 含 src/foo.js
  // expect exit code === 1, output 含 'npm version patch'
});

// GP-3: 未改 src → 跳过
it('未改 brain src（仅改 tests）→ exit 0（跳过）', () => {
  // diff 仅含 __tests__/foo.test.js
  // expect exit code === 0, output 含 '跳过'
});

// GP-4: bump 任意步长均通过
it('版本 major/minor/patch bump 均视为合法', () => {
  // PR=2.0.0 > main=1.267.0 → exit 0
  // PR=1.268.0 > main=1.267.0 → exit 0
  // PR=1.267.1 > main=1.267.0 → exit 0
});
```

`createFixture(prVersion, mainVersion, srcChanged)` 用 `mkdtempSync` 搭建临时 git 仓库，写 `packages/brain/package.json` 并 commit，再 `git checkout -b pr-branch` 修改版本 + 按参数决定是否写 src 文件，通过 `BASE_REF=main bash <SCRIPT>` 执行。

---

## Invariants（不可违反，共 8 条）

1. **src 变更必须 bump**：任何 `packages/brain/src/**` 的改动，对应 PR 的 `packages/brain/package.json` version 必须严格 > main 分支版本
2. **非 src 不拦**：仅改 tests/sprints/docs 的 PR，门禁不得阻塞
3. **semver 严格比较**：`>` 不是 `!=`，不接受降版本或同版本
4. **四处一致性保留**：新门禁不替代 `check-version-sync.sh`，两者并存
5. **脚本可本地运行**：门禁脚本无 CI 专属依赖，开发者本地可执行
6. **fix 提示可操作**：错误输出须含明确可执行命令，不能只说"请 bump"
7. **门禁仅限 PR**：push-to-main 后由 `auto-version.yml` 负责，门禁仅在 PR 时触发
8. **ci-passed 聚合**：新 job 须纳入 `ci-passed` 的 needs，不得游离在外

---

## 累积 FR（Functional Requirements）

| # | 描述 | 来源 |
|---|------|------|
| FR-01 | diff `packages/brain/src/**` 非空 → 要求 version > main | PrepPRD 核心需求 |
| FR-02 | diff 不含 `packages/brain/src/**` → 跳过检查 | PrepPRD GP-3 |
| FR-03 | 版本比较用 semver 严格大于（支持任意步长）| PrepPRD GP-4 |
| FR-04 | 检查失败时输出可执行 fix 命令 | PrepPRD 铁律 |
| FR-05 | 门禁仅在 pull_request 事件触发（push-to-main 不触发）| 避免与 auto-version 冲突 |
| FR-06 | 新 job 纳入 ci-passed 聚合 | 分支保护规则完整性 |
| FR-07 | 现有 check-version-sync.sh 四处一致性检查不变 | 漏洞一补丁，两者互补 |
| FR-08 | 门禁脚本接受 BASE_REF 环境变量（本地可测）| 可测试性 |

---

## NFR

- 门禁 job `timeout-minutes: 3`（无 npm install，纯 git + node 操作，应在 30s 内完成）
- 不引入新的 CI 依赖（npm package 等）
- 不影响现有 CI 总时长（新 job 与 brain-unit 并行，在 changes detection 之后）

---

journey_type: bug_fix
target_environment: local_api
status: planning
