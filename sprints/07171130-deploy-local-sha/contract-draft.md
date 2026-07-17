# 合同草案：deploy-local.sh SHA 对账判变

- **Sprint**：sprints/07171130-deploy-local-sha
- **TASK_ID**：becfd554-adca-4fac-be69-f248de786716
- **日期**：2026-07-17
- **状态**：DRAFT

---

## 变更范围

| 文件 | 操作 |
|---|---|
| `scripts/deploy-local.sh` | 修改：移除 G1 版本号兜底段（第 82-93 行），新增 SHA 对账段；NEED_BRAIN 叠加 SHA_MISMATCH=true |
| `packages/brain/src/__tests__/deploy-sha-gate.test.js` | 新增：4 个 Vitest 用例（TDD 顺序：Case 1 先 failing 再 passing） |

---

## 根因与修复逻辑

**根因**：Gate3 webhook 路在 `cecelia-deploy-main` 分支上检出脚本后，`git diff origin/main...HEAD` 恒为空，导致 `CHANGED_FILES` 为空 → `NEED_BRAIN=false` → 假跳过生产部署。G1 版本号兜底（`packages/brain/package.json` version 对比）仍无法覆盖 squash merge 后不 bump version 的场景。

**修复**：用 `origin/main HEAD SHA` 与生产 `/api/brain/health` 返回的 `git_sha` 字段做对账，SHA 不等则强制 `NEED_BRAIN=true`，与文件列表无关。

---

## 行为合同

### 核心不变量

1. **SHA 是唯一判变真相**：`origin/main HEAD SHA ≠ 生产 git_sha` → `NEED_BRAIN=true`，无论 CHANGED_FILES 是否为空
2. **SHA 相等时不强制部署**：防止幂等误触，`NEED_BRAIN` 仍可由文件列表路径设为 true，但 SHA 相等不额外叠加
3. **文件列表范围加法**：`NEED_DASHBOARD` / `NEED_WORKFLOW_SKILLS` 仍由文件列表决定，`NEED_BRAIN` 的判变不再依赖文件列表排他
4. **蓝绿机制不变**：现有 pre-swap / post-deploy / brain-deploy.sh 调用链保留不动

### 脚本输出要求

- 每次执行必须打印含 `SHA 对账` 字样的日志行
- 日志必须包含 `origin/main=<SHA>` 和 `生产=<SHA>` 两侧值（供运维 grep 日志）
- SHA 不等时必须含 `强制走 Brain 部署` 或等价中文描述

### 测试钩子

| 环境变量 | 说明 |
|---|---|
| `CECELIA_PROD_GIT_SHA` | 注入假生产 SHA，跳过真实 curl（测试专用） |
| `CECELIA_DEPLOY_ROOT` | 注入部署根路径（隔离真实仓库） |

---

## E2E 验收

### E2E-1：Vitest 单元套件（自动化）

```bash
npx vitest run packages/brain/src/__tests__/deploy-sha-gate.test.js
```

**断言**：
- Case 1（SHA 不等 + `CHANGED_FILES` 为空）：exit 0，stdout 含 `SHA 对账`，stdout 含 `Brain 部署` 或 `brain-deploy`
- Case 2（SHA 相等）：exit 0，stdout 含 `跳过` 或 `一致`，stdout **不含** `brain-deploy` 的触发行
- Case 3（`--changed` 含 brain src + SHA 相等）：exit 0，stdout 含 `Brain 改动` 或 `brain-deploy`
- Case 4（无 brain 改动 + SHA 相等）：exit 0，stdout 含 `跳过`

### E2E-2：dry-run 日志断言（手动可验）

```bash
CECELIA_DEPLOY_ROOT=. \
CECELIA_PROD_GIT_SHA=aaabbbcccddd \
bash scripts/deploy-local.sh --dry-run 2>&1 | tee /tmp/deploy-sha-test.log

grep "SHA 对账" /tmp/deploy-sha-test.log
grep "origin/main=" /tmp/deploy-sha-test.log
grep "生产=" /tmp/deploy-sha-test.log
```

**期望**：三条 grep 均有输出，不报 `grep: no match`。

### E2E-3：CI 绿（自动化）

`brain-ci.yml` 中 Vitest 套件（含 deploy-sha-gate.test.js）全绿，无 skip/todo 标记。

---

## Test Contract

| BEHAVIOR | Test File | it() 描述（子串） |
|---|---|---|
| [BEHAVIOR] B-01 SHA 不等时强制触发 Brain 部署 | `../../packages/brain/src/__tests__/deploy-sha-gate.test.js` | 生产 SHA ≠ origin/main |
| [BEHAVIOR] B-02 SHA 相等时跳过 Brain 部署 | `../../packages/brain/src/__tests__/deploy-sha-gate.test.js` | SHA 相等 |
| [BEHAVIOR] B-03 --changed 含 brain src 时仍触发 | `../../packages/brain/src/__tests__/deploy-sha-gate.test.js` | --changed=packages/brain |
| [BEHAVIOR] B-04 无 brain 改动 + SHA 相等完全跳过 | `../../packages/brain/src/__tests__/deploy-sha-gate.test.js` | 无 brain 改动 |
| [BEHAVIOR] B-05 脚本日志含两侧 SHA 值 | `../../packages/brain/src/__tests__/deploy-sha-gate.test.js` | SHA 对账 |

---

## 不在范围

- Dashboard SHA 对账（无独立 /health git_sha 端点）
- Workflow Skills SHA 对账
- S0 漂移哨兵（drift-sentinel.js）
- S6 post-deploy SHA 回读断言

---

## 铁律（继承自父路 PRD）

1. SHA 对账是唯一判变真相；禁再引入任何"文件列表/路径过滤"类判据作为跳过依据
2. 文件列表仅用于 Dashboard/Skills 的范围加法（`NEED_DASHBOARD` / `NEED_WORKFLOW_SKILLS`）
3. 测试禁 mock 真实外部命令行为（spawnSync 驱动真实 bash 脚本，git/curl 退出码语义真实复现）
4. 蓝绿/pre-swap/post-deploy 现有机制保留不动
