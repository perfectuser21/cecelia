# DoD 合同：deploy-local.sh SHA 对账判变

- **Sprint**：sprints/07171130-deploy-local-sha
- **TASK_ID**：becfd554-adca-4fac-be69-f248de786716
- **日期**：2026-07-17

---

## [BEHAVIOR] 条目

### [BEHAVIOR-01] SHA 不等时强制触发 Brain 部署（squash merge 场景）

**前提条件**：
- `CECELIA_PROD_GIT_SHA` 设为与当前 `origin/main HEAD` 不同的值（模拟生产跑旧代码）
- 无 `--changed` 参数（`CHANGED_FILES` 为空，模拟 Gate3 webhook 路）

**行为**：
- 脚本检测到 SHA 不等 → 输出含 `SHA 对账` 的日志行 → `NEED_BRAIN=true` → 触发 Brain 部署路径

**可验证断言**：
- `exit 0`（dry-run 不实际部署）
- `stdout` 含字符串 `SHA 对账`
- `stdout` 含 `Brain 部署` 或 `brain-deploy`

**manual:bash**：
```bash
cd /workspace
ORIGIN_SHA=$(git rev-parse origin/main 2>/dev/null || git rev-parse HEAD)
CECELIA_DEPLOY_ROOT=. \
CECELIA_PROD_GIT_SHA=aaabbb000000 \
bash scripts/deploy-local.sh --dry-run 2>&1 | tee /tmp/dod-b01.log
grep -q "SHA 对账" /tmp/dod-b01.log && echo "PASS: SHA 对账行存在" || echo "FAIL: 缺少 SHA 对账行"
grep -qE "brain-deploy|Brain 部署|Brain 改动" /tmp/dod-b01.log && echo "PASS: Brain 部署触发" || echo "FAIL: Brain 部署未触发"
```

---

### [BEHAVIOR-02] SHA 相等时跳过 Brain 部署（幂等保护）

**前提条件**：
- `CECELIA_PROD_GIT_SHA` 设为与 `origin/main HEAD` 相同的值
- 无 `--changed` 参数

**行为**：
- 脚本检测到 SHA 相等 → 输出含 `一致` 或 `跳过` 的日志 → `NEED_BRAIN` 不因 SHA 对账被设为 true

**可验证断言**：
- `exit 0`
- `stdout` 含 `一致` 或 `跳过`
- `stdout` **不含** `brain-deploy` 命令触发行（由文件列表驱动的 `brain-deploy` 不计）

**manual:bash**：
```bash
cd /workspace
ORIGIN_SHA=$(git rev-parse origin/main 2>/dev/null || git rev-parse HEAD)
CECELIA_DEPLOY_ROOT=. \
CECELIA_PROD_GIT_SHA="$ORIGIN_SHA" \
bash scripts/deploy-local.sh --dry-run 2>&1 | tee /tmp/dod-b02.log
grep -q "SHA 对账" /tmp/dod-b02.log && echo "PASS: SHA 对账行存在" || echo "FAIL: 缺少 SHA 对账行"
grep -qE "一致|跳过" /tmp/dod-b02.log && echo "PASS: 幂等跳过行存在" || echo "FAIL: 未见幂等跳过"
```

---

### [BEHAVIOR-03] --changed 含 brain src 路径时仍触发 Brain 部署（文件列表范围加法）

**前提条件**：
- `CECELIA_PROD_GIT_SHA` 与 `origin/main HEAD` 相同（SHA 对账通过）
- `--changed=packages/brain/src/server.js`（明确传入 brain 文件）

**行为**：
- SHA 对账不叠加 NEED_BRAIN；但文件列表循环发现 brain src → `NEED_BRAIN=true` → 触发 Brain 部署

**可验证断言**：
- `exit 0`
- `stdout` 含 `Brain 改动` 或 `brain-deploy`
- 文件列表路径逻辑正常工作（不受 SHA 对账结果影响）

**manual:bash**：
```bash
cd /workspace
ORIGIN_SHA=$(git rev-parse origin/main 2>/dev/null || git rev-parse HEAD)
CECELIA_DEPLOY_ROOT=. \
CECELIA_PROD_GIT_SHA="$ORIGIN_SHA" \
bash scripts/deploy-local.sh --dry-run --changed="packages/brain/src/server.js" 2>&1 | tee /tmp/dod-b03.log
grep -qE "brain-deploy|Brain 改动|Brain 部署" /tmp/dod-b03.log && echo "PASS: Brain 部署触发" || echo "FAIL: Brain 部署未触发"
```

---

### [BEHAVIOR-04] 无 brain 改动 + SHA 相等 → 完全跳过

**前提条件**：
- `CECELIA_PROD_GIT_SHA` 与 `origin/main HEAD` 相同
- 无 `--changed` 参数，无 brain 相关文件改动

**行为**：
- SHA 对账：一致，不叠加 NEED_BRAIN
- 文件列表：无 brain 路径，NEED_BRAIN 为 false
- `NEED_BRAIN / NEED_DASHBOARD / NEED_WORKFLOW_SKILLS` 全 false → 整体跳过

**可验证断言**：
- `exit 0`
- `stdout` 含 `跳过` 字样
- `stdout` 不含任何 `brain-deploy` / `Dashboard` / `Workflow Skills` 触发行

**manual:bash**：
```bash
cd /workspace
ORIGIN_SHA=$(git rev-parse origin/main 2>/dev/null || git rev-parse HEAD)
CECELIA_DEPLOY_ROOT=. \
CECELIA_PROD_GIT_SHA="$ORIGIN_SHA" \
bash scripts/deploy-local.sh --dry-run 2>&1 | tee /tmp/dod-b04.log
grep -q "跳过" /tmp/dod-b04.log && echo "PASS: 跳过行存在" || echo "FAIL: 未见跳过行"
grep -qE "brain-deploy|Brain 部署" /tmp/dod-b04.log && echo "FAIL: 不应触发 Brain 部署" || echo "PASS: Brain 部署未触发"
```

---

### [BEHAVIOR-05] 脚本日志含两侧 SHA 值（可观测性要求）

**前提条件**：任意调用场景（SHA 等或不等均适用）

**行为**：
- 脚本必须在 SHA 对账行中同时打印 `origin/main=<SHA>` 和 `生产=<SHA>` 两个值

**可验证断言**：
- `stdout` 含 `origin/main=`（后跟 SHA 字符串）
- `stdout` 含 `生产=`（后跟 SHA 字符串或 `N/A`）

**manual:bash**：
```bash
cd /workspace
CECELIA_DEPLOY_ROOT=. \
CECELIA_PROD_GIT_SHA=aaabbb000000 \
bash scripts/deploy-local.sh --dry-run 2>&1 | tee /tmp/dod-b05.log
grep -q "origin/main=" /tmp/dod-b05.log && echo "PASS: origin SHA 存在" || echo "FAIL: 缺少 origin SHA"
grep -q "生产=" /tmp/dod-b05.log && echo "PASS: 生产 SHA 存在" || echo "FAIL: 缺少生产 SHA"
```

---

## Vitest 自动化覆盖

```bash
# 在 CI 中执行（brain-ci.yml）
npx vitest run packages/brain/src/__tests__/deploy-sha-gate.test.js
```

测试文件：`packages/brain/src/__tests__/deploy-sha-gate.test.js`（4 个 Case 全覆盖 BEHAVIOR-01 ~ 04）

---

## 不变量约束（铁律）

| 编号 | 约束 |
|---|---|
| INV-1 | `NEED_BRAIN` 的"是否跳过"判据唯一来源：`SHA_MISMATCH`，禁止文件列表作为跳过依据 |
| INV-2 | 文件列表循环仅做范围加法（`NEED_DASHBOARD` / `NEED_WORKFLOW_SKILLS` / 文件列表路径触发 brain） |
| INV-3 | 测试必须用 `spawnSync` 驱动真实 bash 脚本；禁 jest.mock / sinon mock git/curl 退出码 |
| INV-4 | 蓝绿、pre-swap、post-deploy 调用链代码行保持不变 |
| INV-5 | `CECELIA_PROD_GIT_SHA` 是唯一合法的测试注入钩子（替代真实 curl） |
