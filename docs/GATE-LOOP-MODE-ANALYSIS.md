# Gate 循环模式对比分析

## 背景

Gate Subagent 审核机制存在两种可能的循环模式：
- **模式 A（Subagent 自己改）**：Subagent 审核 → 不通过 → Subagent 自己修改 → 再审核 → 直到通过
- **模式 B（主 Agent 改）**：主 Agent 写 → Subagent 审核 → 不通过 → 主 Agent 修改 → 再审核 → 直到通过

本文档记录深度分析过程和最终决策。

---

## 十维度对比分析

### 1. 职责分离（Separation of Concerns）

| 模式 | 职责划分 | 独立性 | 评分 |
|------|----------|--------|------|
| **A** | Subagent 既审核又修改 | ❌ 既当运动员又当裁判 | 1/5 |
| **B** | 主 Agent 写，Subagent 审核 | ✅ 完全独立 | 5/5 |

**分析**：
- 模式 A：Subagent 既审核又修改，缺乏独立性，类似"自己给自己打分"
- 模式 B：职责清晰，审核和修改完全分离，符合软件工程最佳实践

**结论**：模式 B 胜出

---

### 2. 错误处理（Error Handling）

| 模式 | 错误边界 | 调试难度 | 评分 |
|------|----------|----------|------|
| **A** | Subagent 内部循环，外部不可见 | ❌ 难以追踪 | 2/5 |
| **B** | 主 Agent 控制循环，每轮可见 | ✅ 易于追踪 | 5/5 |

**分析**：
- 模式 A：Subagent 内部循环，主 Agent 只看到最终结果（PASS），中间过程黑盒
- 模式 B：主 Agent 控制循环，每轮审核结果和修复动作都可见

**示例**（模式 B）：
```
Attempt 1: gate:prd FAIL → 修复 "缺少非目标章节" → 再审核
Attempt 2: gate:prd FAIL → 修复 "成功标准不具体" → 再审核
Attempt 3: gate:prd PASS → 生成 gate 文件
```

**结论**：模式 B 胜出

---

### 3. 可控性与安全（Control & Safety）

| 模式 | 循环次数控制 | 死循环风险 | 评分 |
|------|--------------|-----------|------|
| **A** | Subagent 内部控制 | ⚠️ 可能无限循环 | 2/5 |
| **B** | 主 Agent 硬编码 MAX_GATE_ATTEMPTS=20 | ✅ 固定上限 | 5/5 |

**分析**：
- 模式 A：如果 Subagent 判断标准有 bug，可能一直 FAIL → 改 → FAIL，外部无法控制
- 模式 B：主 Agent 硬编码最大 3 轮，超过直接抛异常，绝不死循环

**代码示例**（模式 B）：
```javascript
const MAX_GATE_ATTEMPTS = 20;  // 硬编码，不可突破
let attempts = 0;

while (attempts < MAX_GATE_ATTEMPTS) {
  // ...审核和修复...
  attempts++;
}

if (attempts >= MAX_GATE_ATTEMPTS) {
  throw new Error("gate:prd 审核失败，已重试 20 次");
}
```

**结论**：模式 B 胜出

---

### 4. 性能（Performance）

| 模式 | API 调用次数 | 总耗时 | 评分 |
|------|--------------|--------|------|
| **A** | 1 次（Subagent 内部循环） | ✅ 稍快（约 30-40 秒） | 4/5 |
| **B** | N 次（每轮审核 1 次） | ⚠️ 稍慢（约 45-60 秒，N=3） | 3/5 |

**分析**：
- 模式 A：一次 Subagent 调用，内部循环，减少 API round-trip
- 模式 B：每轮审核都需要调用一次 Subagent，增加 round-trip

**实际影响**：
- 差距：约 15-20 秒（假设平均 2 轮）
- 场景：本地开发，用户等待时间可接受
- 权衡：牺牲少量性能，换取可控性和调试性

**结论**：模式 A 小胜，但差距不足以抵消其他劣势

---

### 5. 可调试性（Debuggability）

| 模式 | 中间状态 | 日志可见性 | 评分 |
|------|----------|-----------|------|
| **A** | ❌ 不可见（Subagent 内部） | ❌ 只看到最终结果 | 1/5 |
| **B** | ✅ 每轮都可见 | ✅ 每次修复都有记录 | 5/5 |

**分析**：
- 模式 A：主 Agent 只看到 "PASS" 或 "FAIL 3 次后放弃"，不知道中间改了什么
- 模式 B：每轮审核反馈和修复动作都在主 Agent 的上下文中，可以查看完整对话历史

**调试场景**：
- 用户报告："gate:dod 一直过不了"
- 模式 A：无法看到中间改了什么，只能重新运行
- 模式 B：查看对话历史，看到每轮的 Required Fixes 和 Edit 操作，快速定位问题

**结论**：模式 B 胜出

---

### 6. Hook 配合（Hook Integration）

| 模式 | Hook 拦截 | 权限检查 | 评分 |
|------|-----------|---------|------|
| **A** | ⚠️ Subagent 修改可能被 Hook 拦截 | ❌ 需要特殊权限 | 2/5 |
| **B** | ✅ 主 Agent 修改，统一权限 | ✅ 无需特殊处理 | 5/5 |

**分析**：
- 模式 A：Subagent 调用 Edit/Write 时，会触发 PreToolUse Hook（如 branch-protect.sh），可能被拦截
- 模式 B：主 Agent 修改，与正常开发流程一致，无需特殊处理

**实际案例**：
- branch-protect.sh 检查：是否在 cp-* 分支、是否有 PRD/DoD
- 模式 A：Subagent 可能没有这些上下文，被 Hook 误拦截
- 模式 B：主 Agent 本身就在 cp-* 分支，有完整上下文，不会被拦截

**结论**：模式 B 胜出

---

### 7. 实际场景模拟

#### 场景 1：PRD 缺少"非目标"章节

**模式 A**：
```
用户：/dev 开始
主 Agent：写 PRD → 启动 gate:prd Subagent
Subagent：审核 → FAIL（缺少非目标）→ 自己修改 PRD → 再审核 → PASS → 返回主 Agent
主 Agent：收到 PASS，生成 gate 文件
```
❌ **问题**：主 Agent 不知道 PRD 被改了，后续可能有不一致

**模式 B**：
```
用户：/dev 开始
主 Agent：写 PRD → 启动 gate:prd Subagent
Subagent：审核 → 返回 FAIL + Required Fixes: "缺少非目标章节，建议添加 ## 非目标"
主 Agent：Edit PRD，添加非目标章节 → 再次启动 Subagent
Subagent：审核 → PASS
主 Agent：生成 gate 文件
```
✅ **优势**：主 Agent 掌控全流程，知道改了什么

---

#### 场景 2：DoD 验收项不具体

**模式 A**：
```
主 Agent：写 DoD → 启动 gate:dod Subagent
Subagent：审核 → FAIL（验收项太模糊）→ 自己改具体 → 再审核 → PASS
主 Agent：继续 Step 5
```
❌ **问题**：DoD 被 Subagent 改了，但主 Agent 后续写代码时可能不知道

**模式 B**：
```
主 Agent：写 DoD → 启动 gate:dod Subagent
Subagent：审核 → 返回 FAIL + Required Fixes: "验收项太模糊，建议改为..."
主 Agent：Edit DoD，修改验收项 → 再次启动 Subagent
Subagent：审核 → PASS
主 Agent：继续 Step 5，基于最新 DoD 写代码
```
✅ **优势**：主 Agent 知道 DoD 的最新版本，写代码时对齐

---

#### 场景 3：测试覆盖不足

**模式 A**：
```
主 Agent：写测试 → 启动 gate:test Subagent
Subagent：审核 → FAIL（缺少边界用例）→ 自己补测试 → 再审核 → PASS
主 Agent：继续 Step 7
```
❌ **问题**：测试文件被 Subagent 改了，但主 Agent 不知道具体补了什么测试

**模式 B**：
```
主 Agent：写测试 → 启动 gate:test Subagent
Subagent：审核 → 返回 FAIL + Required Fixes: "缺少边界用例，建议补充空输入测试"
主 Agent：Edit 测试文件，补充边界用例 → 再次启动 Subagent
Subagent：审核 → PASS
主 Agent：继续 Step 7
```
✅ **优势**：主 Agent 知道补了什么测试，后续维护更清晰

---

#### 场景 4：审计报告证据不足

**模式 A**：
```
主 Agent：写审计报告 → 启动 gate:audit Subagent
Subagent：审核 → FAIL（缺少文件引用）→ 自己补证据 → 再审核 → PASS
```
❌ **问题**：Subagent 补的证据可能不准确（它没有运行实际命令）

**模式 B**：
```
主 Agent：写审计报告 → 启动 gate:audit Subagent
Subagent：审核 → 返回 FAIL + Required Fixes: "缺少文件引用，建议执行 cat xxx 验证"
主 Agent：Bash cat xxx，获取真实输出 → Edit 审计报告，补充证据 → 再次启动 Subagent
Subagent：审核 → PASS
```
✅ **优势**：主 Agent 可以运行实际命令，获取真实证据

---

#### 场景 5：QA 决策不合理

**模式 A**：
```
主 Agent：生成 QA-DECISION.md → 启动 gate:qa Subagent
Subagent：审核 → FAIL（Priority 不合理）→ 自己改 Priority → 再审核 → PASS
```
❌ **问题**：Priority 被 Subagent 改了，但主 Agent 不知道，后续测试策略可能有误

**模式 B**：
```
主 Agent：生成 QA-DECISION.md → 启动 gate:qa Subagent
Subagent：审核 → 返回 FAIL + Required Fixes: "Priority 应为 P1，因为涉及 API 变更"
主 Agent：Edit QA-DECISION.md，修改 Priority → 再次启动 Subagent
Subagent：审核 → PASS
主 Agent：基于正确的 Priority 调整测试策略
```
✅ **优势**：主 Agent 知道 QA 决策的修正，后续流程对齐

---

### 8. 长期维护（Long-term Maintenance）

| 模式 | 逻辑复杂度 | 未来扩展性 | 评分 |
|------|-----------|-----------|------|
| **A** | ❌ Subagent 内部循环复杂 | ⚠️ 难以扩展 | 2/5 |
| **B** | ✅ 主 Agent 统一循环模板 | ✅ 易于扩展 | 5/5 |

**分析**：
- 模式 A：每个 Subagent 都要实现自己的循环逻辑，代码重复
- 模式 B：主 Agent 有统一的循环模板，所有 Gate 复用

**扩展场景**：
- 需要新增 gate:security 审核
- 模式 A：需要在 Subagent 内部实现完整的循环 + 修复逻辑
- 模式 B：主 Agent 复用现有模板，Subagent 只需返回 PASS/FAIL + Required Fixes

**结论**：模式 B 胜出

---

### 9. 用户体验（User Experience）

| 模式 | 进度可见性 | 信任度 | 评分 |
|------|-----------|--------|------|
| **A** | ❌ 黑盒处理，看不到中间过程 | ⚠️ 不知道改了什么 | 2/5 |
| **B** | ✅ 每轮修复都可见 | ✅ 清楚知道每步做了什么 | 5/5 |

**分析**：
- 模式 A：用户只看到 "gate:prd 审核中..." → "PASS"，不知道中间发生了什么
- 模式 B：用户看到 "审核 FAIL → 修复 X → 再审核 → PASS"，完整透明

**用户视角**：
```
模式 A：
  [等待中] gate:prd 审核...
  [✅] gate:prd 通过

模式 B：
  [审核] gate:prd FAIL：缺少非目标章节
  [修复] 添加 ## 非目标 章节
  [审核] gate:prd FAIL：成功标准不具体
  [修复] 补充具体的验证方法
  [审核] gate:prd PASS
  [✅] gate:prd 通过
```

**结论**：模式 B 胜出

---

### 10. 风险评估（Risk Assessment）

| 模式 | 失控风险 | 数据一致性风险 | 评分 |
|------|---------|---------------|------|
| **A** | ⚠️ Subagent 可能改错 | ⚠️ 主 Agent 不知道改了什么 | 2/5 |
| **B** | ✅ 主 Agent 掌控全局 | ✅ 所有修改都在主 Agent 上下文 | 5/5 |

**分析**：
- 模式 A：Subagent 自己改文件，可能改错（如删除重要内容），主 Agent 无法验证
- 模式 B：主 Agent 根据反馈修改，每次 Edit 都有上下文，可以验证

**风险场景**：
- Subagent 误判：把"非目标"当成无用内容删除
- 模式 A：主 Agent 不知道，直接 PASS，后续 PRD 缺失重要信息
- 模式 B：主 Agent 看到 Required Fixes，发现不合理，可以拒绝修改

**结论**：模式 B 胜出

---

## 决策矩阵

| 维度 | 模式 A 评分 | 模式 B 评分 | 权重 |
|------|------------|------------|------|
| 1. 职责分离 | 1/5 | 5/5 | 高 |
| 2. 错误处理 | 2/5 | 5/5 | 高 |
| 3. 可控性与安全 | 2/5 | 5/5 | 高 |
| 4. 性能 | 4/5 | 3/5 | 中 |
| 5. 可调试性 | 1/5 | 5/5 | 高 |
| 6. Hook 配合 | 2/5 | 5/5 | 中 |
| 7. 实际场景 | 2/5 | 5/5 | 高 |
| 8. 长期维护 | 2/5 | 5/5 | 中 |
| 9. 用户体验 | 2/5 | 5/5 | 中 |
| 10. 风险评估 | 2/5 | 5/5 | 高 |

### 加权总分

**模式 A**：
- 高权重：(1+2+2+1+2+2) × 1.5 = 15
- 中权重：(4+2+2+2) × 1.0 = 10
- 总分：25 / 50 = **2.05 / 5**

**模式 B**：
- 高权重：(5+5+5+5+5+5) × 1.5 = 45
- 中权重：(3+5+5+5) × 1.0 = 18
- 总分：63 / 65 = **4.85 / 5**

---

## 最终决策

### 选择：模式 B（主 Agent 改 + 外部循环）

### 理由

1. **职责清晰**：Subagent 只审核，主 Agent 负责修复，符合单一职责原则
2. **可控性强**：主 Agent 硬编码 MAX_GATE_ATTEMPTS=20，绝不死循环
3. **可调试**：每轮审核和修复都在主 Agent 上下文，完整透明
4. **Hook 兼容**：主 Agent 修改，与正常开发流程一致
5. **长期可维护**：统一的循环模板，易于扩展新 Gate

### 权衡

**性能损失**：每轮审核需要一次 API 调用，约慢 15-20 秒
**可接受性**：本地开发，用户等待时间可接受，牺牲少量性能换取可控性和调试性

### 实施路径

1. ✅ 更新 `skills/gate/SKILL.md`，明确模式 B 定义
2. ✅ 更新所有 Gate 规则文件（dod.md, test.md, audit.md），添加"只审核"说明
3. ✅ 新建 `gates/qa.md` 和 `gates/learning.md`
4. ✅ 更新所有步骤文件（01-prd.md, 04-dod.md, 05-code.md, 06-test.md, 10-learning.md），添加循环控制代码
5. ✅ 修复 `scripts/gate/generate-gate-file.sh`，支持 qa|learning
6. ✅ 创建本文档，记录决策过程

---

## 附录：循环控制代码模板

```javascript
const MAX_GATE_ATTEMPTS = 20;  // 硬编码最大循环次数
let attempts = 0;

while (attempts < MAX_GATE_ATTEMPTS) {
  // 启动独立的 Gate Subagent（只审核）
  const result = await Skill({
    skill: "gate:xxx"
  });

  if (result.decision === "PASS") {
    // 审核通过，生成 gate 文件
    await Bash({ command: "bash scripts/gate/generate-gate-file.sh xxx" });
    break;
  }

  // FAIL: 主 Agent 根据反馈修改
  for (const fix of result.requiredFixes) {
    await Edit({
      file_path: fix.location,
      old_string: "...",  // 根据 fix.issue 定位
      new_string: "..."   // 根据 fix.suggestion 修复
    });
  }

  attempts++;
}

if (attempts >= MAX_GATE_ATTEMPTS) {
  throw new Error(`gate:xxx 审核失败，已重试 ${MAX_GATE_ATTEMPTS} 次`);
}
```

---

## 参考

- `skills/gate/SKILL.md` - Gate 核心定义
- `skills/dev/steps/*.md` - 各步骤循环逻辑
- 模式 B 深度分析报告（agentId: a63dd17）- 原始分析记录
