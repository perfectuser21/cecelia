# Thickness Guide — Thin / Thickness / Maturity 详细标准

## Thin Feature 定义

**Thin = 让 Journey 这一步从"完全没有"变成"端到端贯穿但极其简陋"**

> thin ≠ dryrun + 全 mock + 不部署  
> thin = 真跑全链（真 API / 真 DB / 部署在能访问的地方）+ 丑（单号、UI 简陋、0 错误处理）  
> CI smoke 可以 dryrun，但**客户视角必须真跑**。

合格 thin Feature 必须**同时**满足：

1. **可被 smoke 验证** — 有可执行命令证明跑通，smoke 跑真链路（允许最后一步 dryrun 不污染公网）
2. **不依赖未做的 Feature** — 上游未做 → mock 输出；已做的上下游必须真接，不能再 mock
3. **明确允许丑** — UI 临时、错误处理 0、性能不管、单号不矩阵
4. **范围 < 1 周工作量** — 超了说明做的不是 thin
5. **客户视角真跑通** — 客户用真账号走一遍，看到真实结果
6. **LEAD 客户机自验通过** — Lead 在真客户机（ZenithJoy 默认 `xian-pc`）从客户视角走完 5+ 步。证据归档到 `.agent-knowledge/<journey-id>/lead-acceptance-<sprint>.md`。未自验 = sprint 不能交付。

**反例（不是合格 thin）**：
- "完整画像表单（10 字段 + 校验 + 美化 UI）" → medium
- "发布抖音 dryrun，不点最后按钮" → 半个 thin
- "AI 生成（含 prompt 工程 + 风格控制 + A/B）" → thick

**正例（合格 thin）**：
- "画像表单（3 字段，存真 DB，丑 UI）"
- "AI 生成（接真 Claude API，硬编码 prompt，返回一段文本）"
- "发布抖音（真发到公网，单账号，0 错误处理）"

---

## Thickness 4 阶段升级标准

| 阶段 | 升级硬指标（必须全部满足） |
|------|--------------------------|
| `thin` | 端到端能跑，smoke 通过，客户视角真跑通 |
| `medium` | 真实数据替代所有 mock，有基本错误处理（不崩溃） |
| `thick` | 核心场景完整，UI 可面客户，常见错误已处理 |
| `mature` | 边界情况覆盖，监控告警就位，性能优化，回滚预案 |

**唯一升级路径：thin → medium → thick → mature，逐级全升，不允许跳级。**

升级靠真实反馈（用户痛点 / 客户需求），不靠时间表。没人用的 Feature 永远 thin 也 OK。

**禁止的妥协方案**（必须当场拒绝）：
- ❌ "压缩 medium" / "灰度版 medium" / "过渡态" — 不存在中间态
- ❌ "如果 X 条件满足可以跳级" — 不存在跳级豁免
- ❌ "客户要求得急可以先做 thick" — 正确响应是按 thin 标准做（更快上线）
- ❌ "10 个客户在用没出过 bug，所以可以跳" — bug 数 ≠ medium 标准

加厚纪律 — 必须先减肥再增肌：
1. **commit 1**：`remove old <thickness> implementation` —— 删旧 mock/hardcode/stub
2. **commit 2**：`implement <new-thickness> for <feature>` —— 写新实现

---

## Maturity 5 阶段（Journey 整体进度）

| 阶段 | 进入条件 | Feature thickness 上限 |
|------|---------|----------------------|
| `not_started` | 默认 | thin |
| `skeleton` | 所有 Step 至少 1 个 thin Feature + E2E smoke 全绿 | medium |
| `mvp` | ≥50% Feature → medium + 可面客户演示 | thick |
| `production` | ≥80% Feature → thick + 真实客户在用 | mature |
| `mature` | 完整监控/回滚/SLA | mature |

**纪律**：按顺序进，不允许跳级。Feature thickness 不能超过 Journey Maturity 对应上限（单 Feature 完美但 Journey 骨架未通 = 浪费）。
