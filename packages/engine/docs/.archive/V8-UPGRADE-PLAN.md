---
id: v8-upgrade-plan
version: 1.0.0
created: 2026-01-20
updated: 2026-01-20
changelog:
  - 1.0.0: 初始版本 - 完整诊断 + 升级计划
---

# ZenithJoy Engine v8.0 升级计划

> 从 v7.44.9（严谨但累）→ v8.0.0（严谨且自动）

---

## 一、当前状态诊断（七层模型）

### 系统全景

```
         第 0 层 Code
              │
         ████████████ 95%
              │
    ─────────┼─────────
   第 7 层 │ │ │ 第 1 层
   治理层  │ │ │ L1 单测
   ███░░░░ │ │ │ ████░░░░
   30%     │ │ │ 40%
           │ │ │
    ───────┼─┼─┼───────
           │ │ │
 第 6 层   │ │ │   第 2 层
 AI 执行   │ │ │   Hooks
 █████░░░░ │ │ │   █████████
 50%       │ │ │   90%
           │ │ │
    ───────┼─┼─┼───────
           │ │ │
   第 5 层 │ │ │ 第 3 层
   Release │ │ │ Workflow
   ████████│ │ │ ████████
   85%     │ │ │ 85%
           │ │ │
    ─────────┼─────────
              │
         ██░░░░░░░░░░ 20%
              │
         第 4 层 回归层
           ⚠️ 关键缺口
```

### 各层详细状态

| 层级 | 名称 | 完成度 | 状态说明 |
|------|------|--------|----------|
| 0 | Code | 95% | calculator 模块完整，代码规范 |
| 1 | L1 单测 | 40% | 业务代码 88 用例，**hooks 0 测试** |
| 2 | Hooks 规则 | 90% | 7 个 hooks，50+ 次迭代修复 |
| 3 | Workflow | 85% | /dev 11 步流程完整 |
| 4 | 回归层 | **20%** | **无 FEATURES.md，无 qa 入口** |
| 5 | Release | 85% | CHANGELOG 1100+ 行，版本管理成熟 |
| 6 | AI 执行 | 50% | 有 Subagent Loop，但无循环上限 |
| 7 | 治理层 | 30% | LEARNINGS.md 700+ 行，但缺 registry |

### 关键缺口

1. **不知道全量边界** - 没有 FEATURES.md
2. **Hooks 没有回归保护** - 7 个 hook 0 个测试
3. **本地/CI 不一致** - 没有统一 qa 入口
4. **PR 阶段太重** - L2/L3 强制每个 PR
5. **无循环上限** - AI 可能无限修复

---

## 二、v8.0 升级目标

### 核心转变

```
FROM: 一次做到 90% 再提交（人肉严谨）
TO:   先做到可跑 + 最小测试 → CI 全量回归 → 迭代修到绿（机器收敛）
```

### 最终形态

**日常 PR → develop**:
```
AI 写代码 → npm run qa → PR → CI 全量 L1
→ 自动修到绿 → 验收包 → 低风险自动合并
```

**交付 develop → main**:
```
触发 release-check → 自动补齐 L2/L3
→ 风险高才叫人抽查 → 发版
```

---

## 三、分阶段执行计划

### Phase 0: 补齐回归层骨架（1 天）

| 任务 | 产出 | 验收标准 | 优先级 |
|------|------|----------|--------|
| **0.1** 创建 FEATURES.md | Feature Registry | 能一句话说清"全量=什么" | P0 |
| **0.2** 添加 npm run qa | package.json | 本地跑 qa = CI 同类结论 | P0 |
| **0.3** 3 个 hook 最小测试 | tests/hooks/*.test.ts | 改 hook 一行 CI 能发现 | P0 |

**Phase 0 完成标志**: 有最小回归网，不再蒙眼过马路

---

### Phase 1: PR Gate 分层（2-4 天）

| 任务 | 产出 | 验收标准 | 优先级 |
|------|------|----------|--------|
| **1.1** pr-gate-v2 双模式 | --mode=pr / --mode=release | PR 不因缺截图被卡 | P0 |
| **1.2** 删除 pr-gate.sh | - | 无引用，无副作用 | P1 |
| **1.3** 删除 subagent-quality-gate.sh | - | Subagent 机制简化 | P1 |
| **1.4** 更新 SKILL.md 流程图 | skills/dev/SKILL.md | 文档与实现一致 | P1 |

**PR 模式检查项（轻）**:
- [x] .dod.md 存在（允许未全勾）
- [x] L1 通过（typecheck + test + build）
- [x] 分支命名正确

**Release 模式检查项（重）**:
- [x] DoD 全勾
- [x] Evidence 引用有效
- [x] L2 证据文件齐
- [x] 版本/CHANGELOG 合规

**Phase 1 完成标志**: 阻断点减少，PR 效率提升 50%

---

### Phase 2: 夜间无人值守（2-5 天）

| 任务 | 产出 | 验收标准 | 优先级 |
|------|------|----------|--------|
| **2.1** 验收包生成 | acceptance.md/json | 早上只看一页决定 merge | P0 |
| **2.2** 循环上限 8 次 | 止损机制 | 不会通宵死循环 | P0 |
| **2.3** 风险分级规则 | Low/Med/High | 低风险自动合并 | P1 |

**风险分级规则（初版）**:

| 风险 | 条件 | 策略 |
|------|------|------|
| **High** | 改 hooks/CI/发布脚本/权限 | 停在 PR，@人看 acceptance |
| **Med** | 改核心模块，有新增测试 | 自动合并，早上抽查 acceptance |
| **Low** | 只改 docs/tests/非核心 | 自动合并 develop |

**Phase 2 完成标志**: 晚上跑，早上只看一页

---

### Phase 3: L2/L3 自动化（按需）

| 任务 | 产出 | 验收标准 | 优先级 |
|------|------|----------|--------|
| **3.1** API 自动验证 | curl + schema 断言 | L2 大部分自动生成 | P2 |
| **3.2** release-check 脚本 | scripts/release-check.sh | 发版前一个命令 | P2 |
| **3.3** CI release workflow | .github/workflows/release.yml | 手动触发检查 | P2 |

**Phase 3 完成标志**: Release 也能 80% 自动化

---

## 四、需要改的文件清单

### 新建

| 文件 | 说明 |
|------|------|
| `FEATURES.md` | Feature Registry，定义全量边界 |
| `tests/hooks/branch-protect.test.ts` | Hook 最小测试 |
| `tests/hooks/pr-gate.test.ts` | Hook 最小测试 |
| `tests/hooks/project-detect.test.ts` | Hook 最小测试 |
| `scripts/release-check.sh` | Release 阶段检查 |

### 修改

| 文件 | 操作 |
|------|------|
| `package.json` | 添加 `"qa"` script |
| `hooks/pr-gate-v2.sh` | 添加 `--mode` 参数支持 |
| `skills/dev/SKILL.md` | 更新流程图，Step 7 简化 |
| `skills/dev/steps/07-quality.md` | PR 只需 L1，L2/L3 移到 release |
| `.claude/settings.json` | 删除 subagent-quality-gate 配置 |

### 删除

| 文件 | 说明 |
|------|------|
| `hooks/pr-gate.sh` | 被 v2 替代 |
| `hooks/subagent-quality-gate.sh` | 复杂度过高 |

---

## 五、版本号规划

| 版本 | 内容 | 里程碑 |
|------|------|--------|
| 7.44.9 | 当前版本 | - |
| **8.0.0** | Phase 0 完成 | 回归层骨架 |
| 8.1.0 | Phase 1 完成 | PR Gate 分层 |
| 8.2.0 | Phase 2 完成 | 夜间无人值守 |
| 8.3.0 | Phase 3 完成 | L2/L3 自动化 |

---

## 六、简化前后对比

| 指标 | v7.x（当前） | v8.0（目标） |
|------|-------------|-------------|
| PR 阶段 Hooks | 3 个阻断 | 2 个阻断 |
| PR 阶段检查项 | L1+L2+L3 | 只 L1 |
| 预计 PR 耗时 | 35-150min | 20-90min |
| Subagent 机制 | 强制 | 删除 |
| 证据链要求 | 每 PR | 只 Release |
| 人工介入 | 每 PR | 只高风险 |
| 全量边界 | 不明确 | FEATURES.md 定义 |
| Hook 回归 | 0 测试 | 3 个最小测试 |

---

## 七、执行顺序（完整任务列表）

```
Phase 0 (Day 1)
├── 0.1 创建 FEATURES.md
├── 0.2 添加 npm run qa
└── 0.3 补 3 个 hook 测试
    ├── branch-protect.test.ts
    ├── pr-gate.test.ts
    └── project-detect.test.ts

Phase 1 (Day 2-4)
├── 1.1 pr-gate-v2 双模式
├── 1.2 删除 pr-gate.sh
├── 1.3 删除 subagent-quality-gate.sh
└── 1.4 更新 SKILL.md

Phase 2 (Day 5-7)
├── 2.1 验收包生成
├── 2.2 循环上限
└── 2.3 风险分级

Phase 3 (按需)
├── 3.1 API 自动验证
├── 3.2 release-check.sh
└── 3.3 CI release workflow
```

---

## 八、验收标准（整体）

v8.0 发布前必须满足：

- [ ] FEATURES.md 存在，列出 8+ 条 Committed features
- [ ] `npm run qa` 可执行且与 CI 一致
- [ ] 3 个核心 hook 有最小测试
- [ ] pr-gate-v2 支持 --mode=pr/--mode=release
- [ ] 删除 pr-gate.sh 和 subagent-quality-gate.sh
- [ ] 文档与实现一致

---

## 九、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 删除 Hook 后 PR 质量下降 | Medium | CI 仍然全量 L1，release 才检查 L2/L3 |
| 低风险自动合并出问题 | Low | 风险分级规则谨慎，初期 Med 也人工看 |
| Hook 测试不够全面 | Low | 先最小测试，后续补充 |

---

## 十、附录：七层模型定义

| 层级 | 名称 | 说明 |
|------|------|------|
| 0 | Code | 具体代码逻辑 |
| 1 | L1 单测 | 自动化测试覆盖 |
| 2 | Hooks 规则 | AI 行为约束 |
| 3 | Workflow | 开发流程 DSL |
| 4 | 回归层 | 全量边界 + 回归网 |
| 5 | Release | 版本管理 + 发布 |
| 6 | AI 执行 | 自动修复循环 |
| 7 | 治理层 | 系统管理系统 |

---

*Generated: 2026-01-20*
*Based on: ZenithJoy Engine v7.44.9 診断*
