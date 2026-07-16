# Contract Draft — G1：Gate3 判变换真相（GIT_SHA 对账）

- sprint_dir: sprints/07161500-gate3-sha-truth
- task_id: 9039956f-cd80-4991-aa4c-f19960a028e1
- 日期: 2026-07-16
- 版本: v2（GAN Round 2，修复 F-01..F-05）

---

## 能力承诺（Ability Contract）

本 sprint 交付后，系统具备以下可验证能力：

**合并即上线（交付轴 Golden Path S2/S3/S6 段）**

| 能力 ID | 承诺 |
|---------|------|
| C-01 | squash merge 后（`--changed` 为空），只要 origin/main HEAD SHA ≠ 生产容器 GIT_SHA，必触发部署（假跳过彻底根治） |
| C-02 | SHA 相等时跳过部署（防无限重部署，幂等保证） |
| C-03 | 镜像构建期 GIT_SHA 烙进容器（build arg → ENV），运行时不可覆写 |
| C-04 | `/api/brain/health`（或 `/api/brain/version`）响应体含 `git_sha` 字段，值为容器构建时的 commit SHA |
| C-05 | 部署完成后，脚本回读 `/health.git_sha` == 预期 SHA，不等则走既有回滚 trap 并 exit 1 |
| C-06 | `git rev-parse` 和 `curl /health` 使用真实 fixture 而非 mock，保证行为等价 |

---

## 变更范围

| FR | 文件 | 动作 |
|----|------|------|
| FR-01 | `packages/brain/Dockerfile` | 增 `ARG GIT_SHA` + `ENV GIT_SHA=${GIT_SHA}` |
| FR-01 | `scripts/brain-deploy.sh` | docker build 传 `--build-arg GIT_SHA=$(git rev-parse HEAD)` |
| FR-02 | `packages/brain/src/routes/ops.js`（health handler） | 响应体加 `git_sha: process.env.GIT_SHA \|\| 'unknown'` |
| FR-03 | `.github/workflows/brain-ci-deploy.yml` | 删「计算变更路径」step，替换为 SHA 对账（PROD_SHA vs HEAD_SHA） |
| FR-04 | `packages/brain/src/routes/ops.js`（deploy handler） | 去除 `changed_paths` 为空时跳过部署的判据 |
| FR-05 | `scripts/brain-deploy.sh` | 部署后 curl /health 取 git_sha，校验 == EXPECTED_SHA，不等 exit 1 + 既有回滚。**brain-deploy.sh 须支持 `--sha-check-only` flag**：传入该 flag 时，仅执行 S6 SHA 回读断言（接受 `HEALTH_JSON_OVERRIDE` 环境变量注入 fixture 文件路径替代真实 curl），不执行实际部署步骤；供测试注入使用（见 BEHAVIOR-04 验收命令）。 |
| FR-06 | `sprints/07161500-gate3-sha-truth/tests/` | L1 串链测试（failing → passing + 回归） |
| FR-07 | `scripts/smoke/gate3-brain-deploy-smoke.sh` | 升级：增 SHA 回读断言场景 |

**不改动（INV-02 保护）**：
- `scripts/lib/bluegreen.sh` 蓝绿切流
- `scripts/brain-deploy.sh` pre-swap / post-deploy smoke 段
- `scripts/ci/assert-deploy-effect.sh` 版本效果确认

---

## E2E 验收

### 场景 E1：squash merge 假跳过复现（failing → passing）

**前提构造**：
```bash
# 构造 fixture：HEAD_SHA ≠ PROD_SHA，changed 为空（squash merge 现场）
HEAD_SHA="abc1234deadbeef"
PROD_SHA="000000000000000"   # 旧值，不等
```

**旧路径（应 FAIL，证明问题存在）**：
```bash
# 使用 gate3-changed-paths.sh，changed 为空时 fallback packages/brain/
# → /api/brain/deploy body changed_paths 为空 → 旧 deploy handler 跳过
# 断言：deploy handler 日志含"changed_paths 为空，跳过"  ← 现版本 PASS = 问题存在
```

**新路径（应 PASS，证明问题修复）**：
```bash
# SHA 对账：PROD_SHA != HEAD_SHA → 触发 deploy
# 断言：workflow 触发部署（curl /api/brain/deploy 返回 202，不跳过）
```

### 场景 E2：SHA 相等跳过（回归防线）

```bash
HEAD_SHA="abc1234deadbeef"
PROD_SHA="abc1234deadbeef"   # 相等
# 断言：workflow 输出 "SHA 相同，跳过部署"，不调用 /api/brain/deploy
```

### 场景 E3：/health 返回 git_sha 字段

```bash
curl -s http://localhost:5221/api/brain/health | jq -e '.git_sha != null and .git_sha != ""'
# 预期：exit 0（字段存在且非空）
```

### 场景 E4：S6 SHA 回读断言（ROLLBACK 场景）

```bash
# 注入 EXPECTED_SHA ≠ health 返回值 → brain-deploy.sh 输出 ROLLBACK 并 exit 1
HEALTH_JSON_OVERRIDE=<fixture_file_with_wrong_sha> \
EXPECTED_SHA="abc1234deadbeef" \
bash scripts/brain-deploy.sh --dry-run
# 断言：退出码 1，stdout 含 "ROLLBACK" 或 "SHA 不匹配"
```

### 场景 E5：镜像构建期 GIT_SHA 烙入

```bash
docker build -t cecelia-brain:test \
  --build-arg GIT_SHA=abc1234deadbeef \
  -f packages/brain/Dockerfile .
docker run --rm cecelia-brain:test printenv GIT_SHA
# 断言：输出 "abc1234deadbeef"（构建期烙入，不可被运行时覆写）
```

---

## 不变量（Invariants）

继承 PRD 铁律，合同层重申：

| INV | 合同约束 |
|-----|---------|
| INV-01 | 测试内不得出现 `jest.mock('child_process')` 或等效对 `git rev-parse` / `curl` 的完整行为 mock |
| INV-02 | 蓝绿 / pre-swap / post-deploy 相关行数变更量：0 |
| INV-03 | FR-06 测试文件必须进入 `brain-ci-deploy.yml` 的 L1 矩阵，不可仅存在于 sprints/ 目录 |
| INV-04 | Dockerfile 的 GIT_SHA 赋值必须在 `FROM ... AS runtime` 层（不只在 deps layer） |

---

## 完成标准

1. `bash sprints/07161500-gate3-sha-truth/tests/sha-account.test.sh` 在旧代码上至少 1 个场景 FAIL（证明复现），在新代码上全部 PASS
2. `curl -s http://localhost:5221/api/brain/health | jq .git_sha` 返回非 `null` 非 `"unknown"` 的 40 位 hex SHA
3. `docker run --rm cecelia-brain:$(git rev-parse --short HEAD) printenv GIT_SHA` 与 `git rev-parse HEAD` 前 40 位一致
4. `bash scripts/smoke/gate3-brain-deploy-smoke.sh` 全绿（含新增 SHA 回读 E 场景）
5. `brain-ci-deploy.yml` 不含 `gate3-changed-paths.sh` 调用，且含 SHA 对账 step

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|-----------|-----------|--------------|-----------|
| G1 | `../../packages/brain/tests/gate3-sha-account.test.js` | BEHAVIOR-01..07 | CI 跑旧代码时 sha-account shell tests 失败 |
