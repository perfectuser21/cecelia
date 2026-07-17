# Sprint PRD — 建制W8: 发布准入查账脚本（RTM Release Gate）

## 元数据
- task_id: f284c0a2-f2ed-4dfc-bd61-ce5416d93c8c
- sprint_dir: sprints/07162100-release-gate-rtm
- journey_type: tooling
- target_environment: local_cli
- created: 2026-07-17

## 背景与目标

W1（599338ce）已产出 `docs/rtm/path4-customer-service.md`（16 步 RTM，接缝步 S1/S3/S6/S14/S15/S16 实际等级 L1，承诺 L3）。在宣布 ability 可用之前，需要一个查账脚本强制核验 RTM 等级，防止在接缝步未达 L3 的情况下误放行。

本 sprint 交付三件：
1. `scripts/release-gate.mjs`：CLI 查账脚本，读 RTM 文档或 DB，逐步核对接缝步等级
2. Brain API 端点：`GET /api/brain/release-gate/:pathId`（只读查账，不改数据）
3. 测试套件：`scripts/__tests__/release-gate.test.mjs`（含 failing-first 两路 fixture）

---

## Golden Path（核心场景）

**场景 A：含低等级接缝步 → 拦截**
用户运行 `node scripts/release-gate.mjs --path path4-customer-service` →
脚本读取 `docs/rtm/path4-customer-service.md` →
检测接缝步 S1/S3/S6/S14/S15/S16 实际等级 L1 < L3 →
**exit 1**，输出包含步骤号的缺口清单（例：`[BLOCKED] S1 接缝步实际 L1 < L3`）

**场景 B：全步达标 → 放行**
输入全 L3 达标 fixture →
脚本核对所有接缝步 ≥ L3，所有步骤无 L0 →
**exit 0**，输出放行摘要 + 写入 decisions 表（`category=release-gate, verdict=PASS`）

**场景 C：RTM 缺失 → 诚实报错**
输入不存在的 pathId →
脚本无法定位 RTM 文档/DB 记录 →
**exit 2**，输出 `[NO_RTM] 无账可查：path4-xxx`，禁默认放行

---

## Invariant 约束

1. **INV-01 查账不改数据**：`release-gate.mjs` 只读 RTM，唯一写操作是写 decisions 表（`verdict=PASS` 时），禁止修改 RTM 文档或 journey_steps 表
2. **INV-02 接缝步强制 L3**：接缝步实际等级 < L3 → 必须 exit 1，不得有任何"宽松模式"或"--force"旗帜
3. **INV-03 任意步 L0 即拦截**：非接缝步若实际等级 = L0（且承诺等级 ≠ L0）→ exit 1 输出步骤号
4. **INV-04 RTM 缺失 exit 2**：pathId 找不到对应 RTM（文档缺失且 DB 无记录）→ exit 2，严禁默认放行（exit 0）
5. **INV-05 test 先 failing**：两路测试用 fixture 构造，必须先写 failing test，再实现脚本使其通过
6. **INV-06 decisions 写库格式**：`{ category: "release-gate", path_id: <pathId>, verdict: "PASS"|"BLOCKED"|"NO_RTM", gaps: [...], written_at: ISO8601 }`
7. **INV-07 Brain API 只读**：`GET /api/brain/release-gate/:pathId` 返回 JSON 查账结果，不接受 POST/PUT/PATCH 方法

---

## 累积 FR

| # | FR | 验收断言 |
|---|-----|---------|
| FR01 | `scripts/release-gate.mjs` 存在且可用 `node` 直接执行 | `node scripts/release-gate.mjs --help` exit 0 |
| FR02 | 含接缝步 L1 的 fixture → exit 1 + 清单含步骤号 | `test: exit code === 1 && stdout includes "S1"` |
| FR03 | 全 L3 达标 fixture → exit 0 + 放行摘要 | `test: exit code === 0 && stdout includes "PASS"` |
| FR04 | RTM 缺失 → exit 2 + 含 `[NO_RTM]` 文字 | `test: exit code === 2 && stdout includes "[NO_RTM]"` |
| FR05 | exit 0 时向 decisions 表写入 verdict=PASS 记录 | DB 验证：`SELECT verdict FROM decisions WHERE category='release-gate' ORDER BY written_at DESC LIMIT 1` = 'PASS' |
| FR06 | `GET /api/brain/release-gate/path4-customer-service` 返回 `{ verdict, gaps, steps }` JSON | HTTP 200 + response.verdict 存在 |
| FR07 | Brain API 端点只读，POST/PUT 返回 405 | `curl -X POST .../release-gate/path4` → 405 |
| FR08 | 接缝步识别来源于 RTM 文档"接缝步定义"标注（S1/S3/S6/S14/S15/S16 for Path4） | fixture test 验证 S14（L2<L3）被正确识别为缺口 |
| FR09 | 非接缝步 L0（承诺≠L0）→ exit 1 | fixture 含 S10-like 但承诺 L2 被强制设 L0 → exit 1 |
| FR10 | 所有步骤的实际等级须从 RTM 解析，禁止硬编码 Path4 步骤 | 通过 fixture 替换验证脚本不依赖 hardcoded path4 步骤名 |

---

## NFR

- **NFR01 性能**：单次 CLI 查账完成时间 < 2s（无网络 IO，纯文件读取）
- **NFR02 无副作用**：exit 1 / exit 2 时禁止写任何数据（decisions 表、文件系统均不写）
- **NFR03 输出格式**：缺口清单每行格式 `[BLOCKED] <步骤号> <接缝/L0原因> 实际 <Lx> < 承诺 <Ly>`
- **NFR04 依赖约束**：脚本仅依赖 Node.js 内置模块 + 现有 Brain API 客户端库，禁止引入新 npm 依赖
- **NFR05 Brain API 鉴权**：端点沿用现有 Brain API 中间件（无需额外鉴权）

---

## RTM 数据来源与接缝步定义（Path4）

脚本解析 `docs/rtm/path4-customer-service.md` 表格，识别规则：

| 字段 | 解析逻辑 |
|------|---------|
| 接缝步 | "承诺等级"列含 `L3（接缝步` 关键字 |
| 实际等级 | "实际等级"列提取 `L0/L1/L2/L3` |
| 步骤号 | 第一列 `S<n>` |

Path4 已知接缝步（来自 W1 RTM）：S1 / S3 / S6 / S14 / S15 / S16

当前差距（脚本应检出的缺口）：
- S1: L1 < L3
- S3: L1 < L3
- S6: L1 < L3
- S14: L2 < L3
- S15: L1 < L3
- S16: L1 < L3

---

## 测试策略（failing-first）

### Fixture A：含缺口 RTM（`__fixtures__/rtm-with-gaps.md`）
- 16 步表，S1 实际 L1，承诺 L3（接缝步）
- 断言：`exit code === 1`，stdout 含 `S1`，stdout 含 `[BLOCKED]`

### Fixture B：全达标 RTM（`__fixtures__/rtm-all-pass.md`）
- 16 步表，所有接缝步实际 L3，无 L0 步骤（除 S10 承诺即 L0）
- 断言：`exit code === 0`，stdout 含 `[PASS]`

### Fixture C：RTM 不存在
- 传入不存在的 pathId
- 断言：`exit code === 2`，stdout 含 `[NO_RTM]`

测试文件位置：`scripts/__tests__/release-gate.test.mjs`
Fixture 位置：`scripts/__tests__/__fixtures__/`

---

## 受影响文件（预计）

| 文件 | 动作 |
|------|------|
| `scripts/release-gate.mjs` | 新建：主查账脚本 |
| `scripts/__tests__/release-gate.test.mjs` | 新建：测试套件（failing-first） |
| `scripts/__tests__/__fixtures__/rtm-with-gaps.md` | 新建：含缺口 fixture |
| `scripts/__tests__/__fixtures__/rtm-all-pass.md` | 新建：全达标 fixture |
| `apps/api/src/routes/brain/release-gate.ts`（或现有 brain router 文件） | 新增 GET 端点 |
| `apps/api/src/routes/brain/index.ts`（或 router 注册文件） | 注册新端点 |

---

## E2E 验收（CLI + API 双路）

```bash
# CLI 路：含缺口（当前 path4 状态应 exit 1）
node scripts/release-gate.mjs --path path4-customer-service
# 期望：exit 1，输出包含 S1/S3/S6/S14/S15/S16 缺口清单

# CLI 路：全达标 fixture
node scripts/release-gate.mjs --rtm scripts/__tests__/__fixtures__/rtm-all-pass.md
# 期望：exit 0，输出 [PASS]

# API 路：只读查账
curl http://localhost:5221/api/brain/release-gate/path4-customer-service
# 期望：HTTP 200，JSON 含 verdict + gaps 数组

# API 路：POST 应被拒绝
curl -X POST http://localhost:5221/api/brain/release-gate/path4-customer-service
# 期望：HTTP 405
```

---

## 铁律备忘

- **纯查账不改数据**：RTM 文档与 journey_steps 表只读
- **RTM 缺失 exit 2**：任何 pathId 找不到 RTM → exit 2，绝不 exit 0
- **接缝步 < L3 不放行**：无宽松模式，无 --force，无环境降级
- **test 先 failing**：实现前所有测试必须先红灯，再绿灯

## journey_type: tooling
## target_environment: local_cli
## invariant数: 7
## 累积FR数: 10
