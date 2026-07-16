# Sprint PRD — G1：Gate3 判变换真相（GIT_SHA 对账）

- task_id: 9039956f-cd80-4991-aa4c-f19960a028e1
- sprint_dir: sprints/07161500-gate3-sha-truth
- 挂靠 PRD: docs/prd/2026-07-16-deploy-golden-path.prd.md §S2/S3/S6 + 铁律
- 日期: 2026-07-16
- 依赖: 无（本 sprint 是 G1，G2/G3 串行依赖本件 merge）

---

## Invariant 约束

继承 PRD 铁律 + 系统级不变量：

| ID | 约束 |
|----|------|
| INV-01 | SHA 对账是唯一判变真相；禁再引入任何"文件列表/路径过滤"类判据 |
| INV-02 | 蓝绿/pre-swap/post-deploy 现有机制一律不动（实战证明是好闸） |
| INV-03 | S0 自动补部署沿用 brain-deploy.sh 全闸路径，禁旁路直切 |
| INV-04 | 测试禁 mock 真实外部命令行为（git rev-parse / curl health 的行为用真实 fixture） |
| INV-05 | GIT_SHA 须在构建期烙进镜像（build arg → 容器内 env），不得运行时写入 |
| INV-06 | /health（或 /version）端点必须返回 git_sha 字段，字段名固定 |
| INV-07 | S6 SHA 断言失败 → 走既有回滚路径，不得绕过 |
| INV-08 | 删除 gate3-changed-paths.sh 及 brain-ci-deploy.yml 中文件列表判据后，禁留死代码注释残骸 |

---

## 累积 FR

**本件新增（G1）：**

| ID | 描述 | 涉及文件 |
|----|------|---------|
| FR-01 | 镜像构建注入 GIT_SHA：Dockerfile 增 `ARG GIT_SHA` → `ENV GIT_SHA=${GIT_SHA}`，docker build 传 `--build-arg GIT_SHA=$(git rev-parse HEAD)` | Dockerfile（packages/brain/）、brain-deploy.sh |
| FR-02 | /health 端点返回 `git_sha` 字段：`{ ok: true, git_sha: process.env.GIT_SHA \|\| 'unknown' }` | packages/brain/src/routes/ops.js（或 health handler） |
| FR-03 | S2 判变换 SHA 对账：brain-ci-deploy.yml 删「计算变更路径」step（gate3-changed-paths.sh 调用），替换为：`PROD_SHA=$(curl -s ${BRAIN_URL}/api/brain/health \| jq -r .git_sha)` vs `HEAD_SHA=$(git rev-parse HEAD)` → 不等则触发部署，相等跳过 | .github/workflows/brain-ci-deploy.yml |
| FR-04 | /api/brain/deploy 端点去除对 changed_paths 的路由判据（changed_paths 为空时不再视为"无改动跳过"），接受空 body 仍触发部署 | packages/brain/src/routes/ops.js |
| FR-05 | S6 post-deploy SHA 回读断言：brain-deploy.sh 部署成功后，curl /health 取 git_sha，校验 == 预期 SHA（`EXPECTED_SHA`），不等输出错误并走既有回滚 trap | scripts/brain-deploy.sh |
| FR-06 | L1 串链测试（failing → passing）：模拟 squash merge 场景——构造 fixture：HEAD_SHA ≠ PROD_SHA + changed 为空 → 旧路径（版本对比）跳过部署（应 fail），新路径（SHA 对账）触发部署（应 pass）；SHA 相等 → 跳过（防无限重部署回归） | sprints/07161500-gate3-sha-truth/tests/ |
| FR-07 | gate3-brain-deploy-smoke.sh 升级：增加 S6 SHA 回读断言场景——注入 EXPECTED_SHA ≠ health 返回值 → 脚本输出 ROLLBACK 并 exit 1 | scripts/smoke/gate3-brain-deploy-smoke.sh |

**已有（不重新实现）：**
- 蓝绿切流（bluegreen.sh、brain-deploy.sh S4/S5 段）
- pre-swap smoke（gate3-gate2-smoke.sh）
- deploy record 落库（deploy-receipt 系列）
- assert-deploy-effect.sh 版本效果确认（保留，SHA 断言为其补充不替代）

---

## NFR

| 项 | 要求 |
|----|------|
| 部署端到端耗时 | ≤ 15 分钟（PRD S1→S7 总 budget，不因 SHA 对账步骤显著增加） |
| SHA 读取失败容错 | curl /health 超时或 git_sha=unknown → 保守视为「需部署」（fail open，不假跳过） |
| 回归防线 | FR-06 测试永久留在 CI（brain-ci-deploy.yml L1 矩阵），不可删除 |

---

## 交付边界（不含）

- G2 漂移哨兵（S0 常驻对账 + 自动补部署）→ 后续 sprint
- G3 每日演习（deploy record 时间线对账）→ 后续 sprint
- Workspace / Dashboard 部署路径 → 不改

---

journey_type: server-deploy
target_environment: mac_web
