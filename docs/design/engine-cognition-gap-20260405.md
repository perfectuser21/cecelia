# Engine 认知升级 + 现状对比 + 下一步 To-Do

> 生成于 2026-04-05 | 背景：Alex 与 Claude 对话后整理

---

## 一、认知演进：我原来以为 vs 现在知道

### 原来的认知

```
Engine = /dev 这个 skill
```

以为只要跑 /dev，CI 过了，merge main 就完事了。

### 现在的认知

```
Engine = 开发质量防线
  ├─ Hooks（守门员，每次动代码都在跑）
  ├─ Skills（/dev 只是入口，背后是 4-Stage Pipeline）
  ├─ DevGate 脚本（CI 门禁，不是可选的）
  ├─ CI 4层（L1-L4，每层卡不同问题）
  └─ Deploy（merge main 之后还有发布这件事）
```

**关键认知转变**：

| 原来以为 | 现在知道 |
|---------|---------|
| CI 过 = 完成 | CI 过 = 代码质量 OK，发布是另一件事 |
| merge main = 上线 | merge main = 代码进主线，上线需要额外判断 |
| /dev 是一个 skill | /dev 是 4-Stage Pipeline 的入口，背后有 hooks/devloop-check/branch-protect |
| 发布只有一条路 | 应该有 Fast Lane（低风险直接上）和 Safe Lane（高风险过 staging） |
| 上线完就结束了 | 上线后还需要 smoke check + 持续 probe 监控 |

---

## 二、Engine 现状（代码里真实存在什么）

### 已有的（骨架完整）

**开发层**
- `packages/engine/hooks/` — 6个 hook（branch-protect / stop-dev / bash-guard / credential-guard / session-start / stop-architect）
- `packages/engine/skills/dev` — /dev 4-Stage Pipeline（Stage 0~4）
- `devloop-check.sh` — Stop Hook 的核心状态机（7条件判断）
- `branch-protect.sh` — 每次 Write/Edit 前的守门员

**验证层（CI）**
- L1: 分支命名 / CI 审计 / secrets 扫描
- L2: 版本一致性（Engine 5文件同步）
- L3: 单元测试 / TypeCheck / 覆盖率
- L4: E2E / DoD 验证 / RCI 覆盖率

**发布层**
- `scripts/brain-deploy.sh` — Docker 部署脚本 ✅
- `scripts/brain-rollback.sh` — 回滚脚本 ✅
- `scripts/verify-deployment.sh` — health check 脚本 ✅
- `.github/workflows/deploy.yml` — merge main 后自动触发 ✅
- `deploy.yml` risk_gate job — Fast/Safe Lane 风险分级判断 ✅（PR #1897）
- `[SAFE-DEPLOY]` bypass 机制 ✅（PR #1897）

**Production 验证层**
- `deploy.yml` smoke check — deploy 后自动健康检测 ✅
- `deploy.yml` auto rollback — smoke check 失败后自动触发回滚 ✅

**监控层（部分）**
- Capability Probe（10项，每小时自动跑）✅
- 飞书告警 ✅
- 手动回滚脚本 ✅

---

### 缺的（结构性空白）

**已完成：发布决策层（PR #1897）** ✅

```
现在：merge main → risk_gate 判断风险 → Fast/Safe Lane → deploy production
```

- `deploy.yml` 加入 risk_level 检测：改动 `packages/brain/` 核心文件 → high，其余 → low
- risk_gate job：Safe Lane（high 风险）时阻断 auto deploy，等待人工确认
- deploy job 依赖 risk_gate，确保顺序执行
- `[SAFE-DEPLOY]` bypass 机制：紧急情况可跳过风险门禁

**已确认存在：Production 验证层** ✅

`deploy.yml` 原本已有 smoke check + 自动 rollback，之前误以为缺失。

| 剩余缺失能力 | 影响 |
|---------|------|
| Staging 环境 | 高风险改动（Brain core/schema/executor）没有独立验证缓冲区 |
| E2E / Golden Path 自动化 | 没有端到端验证套件，只有 unit test |
| Probe 失败 → 自动回滚 | probe 失败后只发告警，不会自动 rollback |

---

## 三、完整的目标全链路

```
计划层     KR → Project → Scope → Initiative → PR
             ↓
开发层     worktree → feature branch → Task Card/DoD → /dev
           ├─ Standard Dev（单模块、边界清晰）
           └─ Adversarial Dev（跨模块、高耦合）
             ↓
验证层     quickcheck → CI（L1/L2/L3/L4）
             ↓
合并层     merge main
             ↓
发布决策   判断风险等级
           ├─ Fast Lane（低风险：配置/文档/UI）
           │   → deploy production → health check → smoke check → ✅
           │
           └─ Safe Lane（高风险：Brain core/schema/executor）
               → deploy staging → E2E/Golden Path → deploy production
               → health check → smoke check → ✅
             ↓
监控层     probe（持续）→ 异常告警 → 自动 rollback 触发
```

---

## 四、下一步 To-Do（按 ROI 排序）

### ✅ P0：发布决策层（已完成）

**To-Do 1：Fast/Safe Lane 判断逻辑** ✅ PR #1897
- `deploy.yml` 加入 risk_level 检测，基于改动路径自动判断风险等级
- `packages/brain/` 核心文件 → high → Safe Lane（阻断 auto deploy）
- 非核心路径 → low → Fast Lane（直接部署）
- `[SAFE-DEPLOY]` bypass 机制支持紧急绕过

**To-Do 2：Deploy 后自动 smoke check** ✅ 已确认存在
- `deploy.yml` 原本已有 smoke check + 自动 rollback 接入
- 之前误以为缺失，实际已完整

---

### 🟡 P1：监控闭环

**To-Do 3：Probe 失败 → 自动回滚**
- 当前：probe 失败 → 飞书告警 → 等人
- 目标：probe 失败 → 自动调用 `brain-rollback.sh`
- 落地位置：`packages/brain/src/` 的告警逻辑里加 rollback 触发

---

### 🟢 P2：验证层补强

**To-Do 4：Golden Path 测试套件**
- 覆盖最关键的 3-5 条用户路径（内容流水线 / Brain 调度 / 发布链路）
- 可以先在 CI L4 跑，不一定要依赖 staging 环境

**To-Do 5：Staging 环境**
- 成本最高，可以先用"Safe Lane = 手动确认再 deploy"临时替代
- 等系统更稳定再建真正的 staging

---

## 五、不需要补的

- Engine 开发层（/dev 4-Stage + hooks + CI）骨架已完整，不需要动
- 回滚脚本已有，不需要重写
- Probe 监控已有，只需要加自动触发

---

## 总结

**Engine 的开发质量防线（开发→CI）已经成熟。缺的不是一个层，是 merge main 之后的整整 4 个层：**

| 层次 | 核心问题 | 优先级 | 状态 |
|---------|---------|--------|------|
| 发布决策层 | 所有 PR 一视同仁，没有 Fast/Safe Lane | P0 | ✅ PR #1897 |
| Production 验证层 | deploy 后没有自动 smoke check + 失败自动回滚 | P0 | ✅ 已确认存在 |
| 监控闭环层 | probe 失败只发告警，不会自动恢复 | P1 | 待做 |
| Staging 缓冲层 | 高风险改动没有独立验证环境 | P2 | 待做 |
| E2E 验证层 | 没有端到端用户路径自动化测试 | P2 | 待做 |

这 5 项加起来，才是"merge main 之后"这整段的完整闭环。

---

## 执行记录

### 2026-04-05 — PR #1897 合并（发布决策层）

**PR 标题**：`feat(engine): [CONFIG] 发布决策层 Fast/Safe Lane 风险分级`

**完成内容**：
- `deploy.yml` 新增 risk_level 检测 job：扫描 git diff 改动路径，`packages/brain/` 核心文件判为 high，其余为 low
- 新增 risk_gate job：Safe Lane（high 风险）时阻断自动部署，deploy job 依赖 risk_gate
- `[SAFE-DEPLOY]` bypass 机制：PR 描述含该关键词时跳过风险门禁

**同步发现**：
- `deploy.yml` 原本已有 smoke check + 自动 rollback，Production 验证层实际已存在，之前属于认知误差

**影响**：P0 两项（发布决策层 + Production 验证层）均已关闭，剩余 P1/P2 共 3 项待后续迭代。
