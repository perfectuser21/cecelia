# Sprint PRD：deploy-local.sh 判变替换为 SHA 对账

- **Sprint 目录**：sprints/07171130-deploy-local-sha/
- **TASK_ID**：becfd554-adca-4fac-be69-f248de786716
- **日期**：2026-07-17
- **父路 PRD**：docs/prd/2026-07-16-deploy-golden-path.prd.md（铁律：SHA 是唯一判变真相，禁文件列表）
- **HARNESS_GEAR**：hotfix
- **BRAIN_URL**：http://host.docker.internal:5221

---

## 问题陈述

Gate3 webhook 路 deploy-local.sh 的判变逻辑现版本使用文件列表（`--changed` 参数 + `git diff --name-only`）作为"要不要部署 Brain"的依据。

**根因**：webhook 从 `cecelia-deploy-main` 分支检出同仓 deploy-local.sh 后，`HEAD` 恒等于 `origin/main`，`git diff origin/main...HEAD` 恒为空 → `CHANGED_FILES` 为空 → `NEED_BRAIN=false` → 跳过真部署。

G1 修法（版本号对比兜底，见脚本第 82-93 行）只覆盖了 git diff 判空的情况，但**仍依赖 `packages/brain/package.json` 版本号**——若 squash merge 改了 `packages/brain/src/` 但未 bump version（#4024 场景），兜底同样失效，仍假跳过。

**本次要修的 webhook 路**：生产 webhook 从 `cecelia-deploy-main` 调 `deploy-local.sh`，不是 CI 路（CI 路 G1 已修）。

---

## 修复目标

用 **SHA 对账** 取代文件列表作为"是否需要 Brain 部署"的判变依据：

> 比较 `origin/main HEAD SHA`（本地 git 可查） vs 生产 `/health` 端点的 `git_sha` 字段 → 不等 = 必须部署。

文件列表逻辑退化为**范围加法**：仅用于决定"除 Brain 外还要不要同时部署 Dashboard / Workflow Skills"，禁止再作为跳过依据。

---

## 现状快照（代码定位）

### 判变入口：scripts/deploy-local.sh

1. **第 65-70 行**：`git diff origin/main...HEAD` → `CHANGED_FILES`（webhook 路恒为空）
2. **第 82-93 行**：G1 兜底：仅在 `CHANGED_FILES` 为空时用 `brain/package.json` version 对比，仍非 SHA
3. **第 140-160 行**：`NEED_BRAIN / NEED_DASHBOARD / NEED_WORKFLOW_SKILLS` 判断，全部依赖 `CHANGED_FILES`
4. **第 163-166 行**：三者均 false → `exit 0` 假跳过

### 生产 SHA 端点

- `GET /api/brain/health` → 返回 `git_sha: process.env.GIT_SHA || 'unknown'`
- 实现：`packages/brain/src/routes/goals.js` 第 196-197 行
- 端口：`localhost:5221`（或 `BRAIN_PORT` env var）

### 测试基础设施

- 现有测试目录：`packages/brain/src/__tests__/`
- 模板参考：`deploy-root-guard.test.js`（Vitest + bash spawnSync 驱动真实脚本）

---

## 实现规格

### 修改一：scripts/deploy-local.sh

**移除**：G1 版本号兜底段（第 82-93 行）

**新增**：SHA 对账段（替换原版本号兜底，位置：在 git diff 判空后，在文件列表循环前）

```
SHA_MISMATCH=false
ORIGIN_SHA=$(git -C "$MAIN_ROOT" rev-parse origin/"$BASE_BRANCH" 2>/dev/null || echo "")
PROD_SHA=""
if [[ -z "${CECELIA_PROD_GIT_SHA:-}" ]]; then
    PROD_SHA=$(curl -sf --max-time 5 \
        "http://localhost:${BRAIN_PORT:-5221}/api/brain/health" 2>/dev/null \
        | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.git_sha||'')}catch{process.stdout.write('')}})" \
        2>/dev/null || echo "")
else
    PROD_SHA="${CECELIA_PROD_GIT_SHA}"
fi

if [[ -n "$ORIGIN_SHA" && -n "$PROD_SHA" && "$PROD_SHA" != "unknown" ]]; then
    if [[ "$ORIGIN_SHA" != "$PROD_SHA" ]]; then
        echo "🔎 SHA 对账：origin/main=$ORIGIN_SHA 生产=$PROD_SHA → 不等，强制走 Brain 部署"
        SHA_MISMATCH=true
    else
        echo "✅ SHA 对账：origin/main=$ORIGIN_SHA 生产=$PROD_SHA → 一致，Brain 无需重部署"
    fi
else
    echo "⚠️  SHA 对账：无法获取完整 SHA（origin=$ORIGIN_SHA 生产=${PROD_SHA:-N/A}），跳过对账"
fi
```

**修改**：`NEED_BRAIN` 判断段，在文件列表循环完成后加一条：

```
# SHA 对账结果叠加（SHA 优先于文件列表，squash merge 不 bump version 场景的保障）
[[ "$SHA_MISMATCH" == true ]] && NEED_BRAIN=true
```

**规则边界**：
- `NEED_DASHBOARD` / `NEED_WORKFLOW_SKILLS` 仍走文件列表（Dashboard 和 Skills 没有 SHA 对账端点）
- SHA 对账用变量 `CECELIA_PROD_GIT_SHA` 注入测试假值（对应 G1 的 `CECELIA_DEPLOYED_BRAIN_VERSION`）
- 脚本输出中必须有明确的 "SHA 判据" 行（供验收日志断言）

### 修改二：新增测试文件

路径：`packages/brain/src/__tests__/deploy-sha-gate.test.js`

**测试用例清单**（必须先写 failing test 再修脚本）：

#### Case 1（failing→passing）：squash merge 改 brain src，--changed 为空，SHA 不等 → 必须触发 Brain 部署

```
场景：
  CECELIA_PROD_GIT_SHA=aaabbb（假生产 SHA）
  git 仓库 origin/main HEAD = cccddd（squash merge 后的新 SHA）
  调用：bash deploy-local.sh --dry-run（无 --changed 参数）
预期：
  exit 0（dry-run 不实际部署）
  stdout 含 "SHA 判据" 或 "SHA 对账"
  stdout 含 "Brain 部署" 或 "brain-deploy"
```

#### Case 2（回归保障）：SHA 相等 → 跳过（防重复部署）

```
场景：
  CECELIA_PROD_GIT_SHA=cccddd
  git 仓库 origin/main HEAD = cccddd
  调用：bash deploy-local.sh --dry-run
预期：
  exit 0
  stdout 含 "跳过" 或 "一致"
  stdout 不含 "brain-deploy" 触发行
```

#### Case 3（回归保障）：--changed 明确含 brain src → 仍触发 Brain 部署（不依赖 SHA）

```
场景：
  CECELIA_PROD_GIT_SHA=cccddd（SHA 相等）
  调用：bash deploy-local.sh --dry-run --changed="packages/brain/src/server.js"
预期：
  exit 0
  stdout 含 "Brain 改动" 或 "brain-deploy"
```

#### Case 4（回归保障）：无 brain 改动 + SHA 相等 → 完全跳过

```
场景：
  CECELIA_PROD_GIT_SHA=cccddd（SHA 相等）
  调用：bash deploy-local.sh --dry-run（无 --changed，git diff 也无改动）
预期：
  exit 0
  stdout 含 "跳过"
```

**测试实现参考**（与 deploy-root-guard.test.js 风格一致）：
- 用 `spawnSync('bash', [SCRIPT, '--dry-run'], {env: {..., CECELIA_DEPLOY_ROOT: clone, CECELIA_PROD_GIT_SHA: 'aaabbb'}})` 驱动真实脚本
- `CECELIA_DEPLOY_ROOT` 隔离部署根（不碰真实仓库）
- `CECELIA_PROD_GIT_SHA` 注入生产 SHA（跳过真 curl）
- 用 `git commit --allow-empty` 制造 SHA 不等场景

---

## 验收标准

### V1：Failing Test 先绿（Case 1 从失败到通过）
- 修改前运行 `npx vitest run packages/brain/src/__tests__/deploy-sha-gate.test.js` → Case 1 failing
- 修改 deploy-local.sh 后 → Case 1 passing
- Case 2/3/4 全程 passing（回归保障）

### V2：真实 webhook 触发日志断言
- 真实 webhook 触发一次的部署日志（或 dry-run 模拟日志）中：
  - 必须含 "SHA 对账" 字样
  - 必须含 `origin/main=<SHA>` 和 `生产=<SHA>` 两个 SHA 值
  - 若两者不等：含 "强制走 Brain 部署" 字样

### V3：GitHub Actions CI 绿
- `brain-ci.yml` 中 Vitest 全套通过（含新增 deploy-sha-gate.test.js）
- deploy-local.sh smoke 测试（如有 gate3-brain-deploy-smoke.sh）保持绿

---

## 不在范围（明确排除）

- Dashboard SHA 对账（Dashboard 无独立 /health git_sha 端点，留 G2）
- Workflow Skills SHA 对账（同上）
- S0 漂移哨兵（已在 drift-sentinel.js，G2 范畴）
- S6 post-deploy SHA 回读断言（G1 已有或 G2 范畴）
- 蓝绿 / pre-swap / post-deploy 现有机制（保留不动）

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `scripts/deploy-local.sh` | 修改 | 移除 G1 版本号兜底，新增 SHA 对账段；NEED_BRAIN 叠加 SHA_MISMATCH |
| `packages/brain/src/__tests__/deploy-sha-gate.test.js` | 新增 | 4 用例 Vitest 测试 |

---

## 开发顺序（强制）

1. **先写 deploy-sha-gate.test.js**（4 个 Case 全写），运行确认 Case 1 failing
2. **再改 deploy-local.sh**，运行确认全绿
3. **提交两个文件**，PR 标题含 `fix(deploy-local): SHA 对账取代文件列表判变`
4. **等 CI 绿**，回写 Brain 任务状态

---

## Invariant 约束

来源三源（父路 PRD + decisions + golden-path 铁律）：

1. **SHA 唯一判变真相**：`origin/main HEAD SHA vs 生产 git_sha`，任何文件列表/路径过滤禁作跳过依据（父路 PRD §4）
2. **文件列表范围加法**：`NEED_DASHBOARD / NEED_WORKFLOW_SKILLS` 可继续用文件列表，`NEED_BRAIN` 判变禁用
3. **禁 mock 退出码**：测试必须驱动真实 bash 脚本（spawnSync），git/curl 行为必须真实复现
4. **蓝绿机制保留**：现有 pre-swap / post-deploy 流程不动

---

## 累积 FR

本次 sprint 加载的 Functional Requirements（来自 PrepPRD + 父路 PRD）：

- FR-01：`CHANGED_FILES` 为空且 SHA 不等 → `NEED_BRAIN=true`（squash merge 不 bump version 场景）
- FR-02：SHA 相等 → Brain 不重部署（防幂等误触）
- FR-03：`--changed` 含 brain src 路径 → 仍触发（文件列表范围加法路径不受影响）
- FR-04：测试必须含 Case 1 先 failing 再 passing 的 TDD 顺序
- FR-05：脚本输出含"SHA 对账"字样（供 webhook 日志断言）

---

## NFR

- **性能**：SHA 对账 curl 超时 ≤5s（`--max-time 5`），与 G1 版本号 curl 一致
- **幂等性**：SHA 相等时脚本退出 0 不重部署（防 Brain 重启风暴）
- **可观测**：脚本必须打印两侧 SHA 值（origin= 和 生产=），便于运维 grep 日志

---

## 铁律（继承自父路 PRD）

- SHA 对账是唯一判变真相；禁再引入任何"文件列表/路径过滤"类判据作为跳过依据
- 文件列表仅用于 Dashboard/Skills 的范围加法
- 测试禁 mock 真实外部命令行为（git/curl 退出码语义必须真实复现）
- 蓝绿/pre-swap/post-deploy 现有机制保留不动

---

journey_type: hotfix
target_environment: local_api
