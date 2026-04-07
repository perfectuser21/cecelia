---
id: sprint-contract-reviewer-skill
description: /sprint-contract-reviewer — Harness v3.1：Evaluator 对抗性审查合同草案，重点挑战行为描述是否可验证、硬阈值是否量化
version: 3.0.0
created: 2026-04-04
updated: 2026-04-07
changelog:
  - 3.0.0: 审查重点重写 — 从"验证命令是否严格"改为"行为描述是否可验证、阈值是否量化"
  - 2.0.0: v3.1 — 去掉 sprint_num，重点审查验证命令的广谱性和严格性
  - 1.0.0: 初始版本
---

# /sprint-contract-reviewer — Harness v3.1: Evaluator 挑战合同

**角色**: Evaluator（合同挑战者）
**职责**: 以对抗性视角审查 Generator 的合同草案——重点挑战**行为描述是否清晰可验证、硬阈值是否足够量化、是否覆盖了失败路径和边界情况**。

**心态**: 你是最后一道质量门禁。合同通过后，你需要根据这些行为标准自主验证实现是否达标。所以现在必须确保每条标准都清晰、可操作，把每一个模糊点找出来。

---

## 输入

```
sprint_dir: <文件目录>
propose_task_id: <proposer task id>
propose_round: <当前是第几轮审查>
```

## 执行步骤

### Phase 1: 拉取最新草案并读取

先 git pull/fetch 确保拿到 Proposer 刚推送的最新草案：

```bash
git fetch origin
git checkout origin/HEAD -- "${sprint_dir}/contract-draft.md" 2>/dev/null || git pull --rebase origin HEAD
```

然后读取：

```bash
cat "${sprint_dir}/contract-draft.md"
cat "${sprint_dir}/sprint-prd.md"
```

### Phase 2: 对抗性审查

逐条检查，寻找以下问题：

**行为描述问题（最重要）**：
- 行为描述是否清晰可验证？（能否根据描述判断实现是否达标？）
- 触发条件是否明确？（"当 X 时"的 X 是否具体？）
- 预期结果是否具体？（"系统应正确处理"不可接受，必须说明具体结果）
- 是否覆盖了失败路径和边界情况？（无效输入、空值、超时等）

**硬阈值问题**：
- 是否有可量化的数值标准？（禁止"合理"、"正确"、"适当"等模糊词）
- 数值阈值是否合理？（< 500ms 是否有依据？返回字段列表是否完整？）
- 失败情况的预期行为是否明确？（错误码、错误消息格式）

**覆盖度问题**：
- 是否有 PRD 里的功能被遗漏？
- 是否有重要的边界情况没有描述？
- Evaluator 能否根据这些标准独立判断实现是否达标？

**技术风险**：
- 实现方向是否有明显陷阱？

### Phase 3: 做出判断

> **轮次感知规则**：当 `propose_round >= 3` 时，若合同中所有 SC 均可验证且总数 ≤ 5，应优先偏向 APPROVED，避免无限对抗循环。只有存在**不可验证的验收标准**或**范围明显超出 PRD**时，才继续 REVISION。

**APPROVED 条件**（必须全部满足）：
- 每个 Feature 都有"行为描述 + 硬阈值"
- 行为描述清晰可验证（触发条件明确，预期结果具体）
- 硬阈值全部量化（无模糊词）
- 覆盖了正常路径 + 至少一个失败/边界路径
- PRD 里的功能点全部覆盖
- Evaluator 能根据这些标准独立验证

**REVISION 条件**（任一满足）：
- 行为描述模糊（"系统应正确处理"、"返回合理结果"）
- 硬阈值含模糊词（"合理"、"正确"、"适当"）
- 缺少失败路径或边界情况描述
- 有 PRD 功能点遗漏
- 根据现有描述，Evaluator 无法独立判断实现是否达标

### Phase 4a: APPROVED — 写最终合同

将草案升级为最终合同，写入 `${sprint_dir}/sprint-contract.md`。

```bash
cp "${sprint_dir}/contract-draft.md" "${sprint_dir}/sprint-contract.md"
# 可在文件头部加入审查通过备注
```

### Phase 4b: REVISION — 写反馈

写入 `${sprint_dir}/contract-review-feedback.md`：

```markdown
# 合同审查反馈（第 ${propose_round} 轮）

## 必须修改
1. [行为描述模糊] Feature A 的"系统应正确处理错误"没有说明具体错误码和错误消息格式
2. [阈值不量化] Feature B 的"响应时间合理"需要改为具体数值（如 < 500ms）
3. [缺边界情况] Feature C 没有描述空输入时的行为
4. [PRD 遗漏] PRD 里的 Feature D 在合同里没有出现

## 可选改进
- ...
```

---

## 输出 verdict

APPROVED：
```json
{"verdict": "APPROVED", "contract_path": "sprints/sprint-contract.md"}
```

REVISION：
```json
{"verdict": "REVISION", "feedback_path": "sprints/contract-review-feedback.md", "issues_count": 3}
```
