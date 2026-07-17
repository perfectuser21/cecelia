# Contract Draft — 建制W8: 发布准入查账脚本（RTM Release Gate）

## 元数据

- task_id: f284c0a2-f2ed-4dfc-bd61-ce5416d93c8c
- sprint_dir: sprints/07162100-release-gate-rtm
- contract_version: v1
- author: harness-contract-proposer
- created: 2026-07-17
- base_prd: sprints/07162100-release-gate-rtm/sprint-prd.md

---

## 背景与目标

W1（599338ce）已产出 `docs/rtm/path4-customer-service.md`（16 步 RTM），其中接缝步 S1/S3/S6/S14/S15/S16 实际等级均为 L1，承诺等级 L3。

本合同约束 W8 的实现：宣布 ability 可用前，必须运行 `scripts/release-gate.mjs` 读取 RTM，逐步核对接缝步等级；接缝步未达 L3 时强制拦截（exit 1），RTM 缺失时 exit 2（禁默认放行），全达标时 exit 0 并写 decisions 判定记录。

---

## 核心场景（Golden Path）

### 场景 A：含低等级接缝步 → 拦截

```
node scripts/release-gate.mjs --path path4-customer-service
```

- 脚本读取 `docs/rtm/path4-customer-service.md`
- 检测接缝步 S1/S3/S6/S14/S15/S16 实际等级 L1 < L3
- **exit 1**，stdout 含逐步缺口清单，每行格式：
  ```
  [BLOCKED] <步骤号> <接缝/L0原因> 实际 <Lx> < 承诺 <Ly>
  ```
- 禁止写任何 DB 数据（decisions 表保持不变）

### 场景 B：全达标 → 放行

```
node scripts/release-gate.mjs --rtm scripts/__tests__/__fixtures__/rtm-all-pass.md
```

- 所有接缝步实际 ≥ L3，无非预期 L0 步骤
- **exit 0**，stdout 含 `[PASS]` 放行摘要
- 向 decisions 表写入记录：
  ```json
  {
    "category": "release-gate",
    "path_id": "<pathId>",
    "verdict": "PASS",
    "gaps": [],
    "written_at": "<ISO8601>"
  }
  ```

### 场景 C：RTM 缺失 → 诚实报错

```
node scripts/release-gate.mjs --path nonexistent-path
```

- pathId 找不到对应 RTM（文档缺失且 DB 无记录）
- **exit 2**，stdout 含 `[NO_RTM] 无账可查：<pathId>`
- 禁止写任何数据，禁止 exit 0

---

## 交付物清单

| 文件 | 动作 | 说明 |
|------|------|------|
| `scripts/release-gate.mjs` | 新建 | 主查账脚本，Node.js ESM |
| `scripts/__tests__/release-gate.test.mjs` | 新建 | 测试套件（failing-first，vitest/node:test） |
| `scripts/__tests__/__fixtures__/rtm-with-gaps.md` | 新建 | 含缺口 RTM fixture（S1 实际 L1，承诺 L3 接缝步） |
| `scripts/__tests__/__fixtures__/rtm-all-pass.md` | 新建 | 全达标 RTM fixture（所有接缝步实际 L3） |
| `packages/brain/src/routes/release-gate.js` | 新建 | Brain API GET 端点（只读查账） |
| `packages/brain/src/routes.js` | 修改 | 注册 `/api/brain/release-gate/:pathId` 路由 |

---

## Invariant 约束（来自 PRD，合同强制）

| ID | 约束 | 违反后果 |
|----|------|---------|
| INV-01 | release-gate.mjs 只读 RTM；唯一写操作是 exit 0 时写 decisions 表 | 任何 RTM 文档写操作 = 合同违规 |
| INV-02 | 接缝步实际等级 < L3 → 必须 exit 1，禁止宽松模式或 --force 旗帜 | exit 0 = 合同违规 |
| INV-03 | 非接缝步若实际等级 = L0（且承诺等级 ≠ L0）→ exit 1 输出步骤号 | 漏检 = 合同违规 |
| INV-04 | pathId 找不到 RTM → exit 2，严禁 exit 0 | exit 0 = 合同违规 |
| INV-05 | 测试先写 failing（红灯），再实现脚本使其通过（绿灯） | 跳过红灯 = 合同违规 |
| INV-06 | decisions 写库格式：`{ category, path_id, verdict, gaps, written_at }` | 字段缺失 = 合同违规 |
| INV-07 | Brain API 端点只接受 GET；POST/PUT/PATCH → 405 | 非 405 = 合同违规 |

---

## E2E 验收

### CLI 路：当前 path4 实际状态（应 exit 1）

```bash
node scripts/release-gate.mjs --path path4-customer-service
echo "Exit code: $?"
# 期望：exit 1
# 期望 stdout 含：[BLOCKED] S1 接缝步 实际 L1 < 承诺 L3
# 期望 stdout 含：[BLOCKED] S3 接缝步 实际 L1 < 承诺 L3
# 期望 stdout 含：[BLOCKED] S6 接缝步 实际 L1 < 承诺 L3
# 期望 stdout 含：[BLOCKED] S14 接缝步 实际 L2 < 承诺 L3
# 期望 stdout 含：[BLOCKED] S15 接缝步 实际 L1 < 承诺 L3
# 期望 stdout 含：[BLOCKED] S16 接缝步 实际 L1 < 承诺 L3
```

### CLI 路：全达标 fixture（应 exit 0）

```bash
node scripts/release-gate.mjs --rtm scripts/__tests__/__fixtures__/rtm-all-pass.md
echo "Exit code: $?"
# 期望：exit 0
# 期望 stdout 含：[PASS]
# 期望 DB：SELECT verdict FROM decisions WHERE category='release-gate' ORDER BY written_at DESC LIMIT 1 = 'PASS'
```

### CLI 路：RTM 缺失（应 exit 2）

```bash
node scripts/release-gate.mjs --path nonexistent-path-xyz
echo "Exit code: $?"
# 期望：exit 2
# 期望 stdout 含：[NO_RTM]
```

### API 路：只读查账

```bash
curl -s http://localhost:5221/api/brain/release-gate/path4-customer-service | jq '.verdict'
# 期望：HTTP 200，JSON 含 verdict 字段（值为 "BLOCKED"）
# 期望：JSON 含 gaps 数组（含 S1/S3/S6/S14/S15/S16）
```

### API 路：拒绝写操作

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5221/api/brain/release-gate/path4-customer-service
# 期望：405
```

---

## 非功能约束

- **NFR01 性能**：CLI 单次查账 < 2s（纯文件 IO，无网络）
- **NFR02 无副作用**：exit 1 / exit 2 时禁止写任何数据（decisions 表、文件系统均不写）
- **NFR03 输出格式**：每行 `[BLOCKED] <步骤号> <接缝/L0原因> 实际 <Lx> < 承诺 <Ly>`
- **NFR04 依赖约束**：仅依赖 Node.js 内置模块 + 现有 Brain API 客户端，禁止引入新 npm 依赖
- **NFR05 Brain API 鉴权**：沿用现有 Brain API 中间件，无需额外鉴权

---

## RTM 解析规则

脚本通过以下规则解析 Markdown 表格中的 RTM：

| 字段 | 解析逻辑 |
|------|---------|
| 步骤号 | 第一列 `**S<n>**` 或 `S<n>` |
| 实际等级 | "实际等级"列提取 `L0/L1/L2/L3` |
| 承诺等级 | "承诺等级"列提取 `L0/L1/L2/L3` |
| 接缝步标注 | 承诺等级列含 `（接缝步` 或 `(接缝步` 关键字 |

---

## 评审意见槽位

（首轮，无 reviewer feedback）
