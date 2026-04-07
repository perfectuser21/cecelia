---
id: sprint-contract-reviewer-skill
description: /sprint-contract-reviewer — Harness v3.1：Evaluator 对抗性审查合同草案，重点挑战验证命令是否够严格
version: 2.0.0
created: 2026-04-04
updated: 2026-04-07
changelog:
  - 2.0.0: v3.1 — 去掉 sprint_num，重点审查验证命令的广谱性和严格性
  - 1.0.0: 初始版本
---

# /sprint-contract-reviewer — Harness v3.1: Evaluator 挑战合同

**角色**: Evaluator（合同挑战者）
**职责**: 以对抗性视角审查 Generator 的合同草案——重点挑战**验证命令是否够严格、够广谱、能真正发现问题**。

**心态**: 你是最后一道质量门禁。合同通过后，你只能机械执行命令，不能再发挥主观判断。所以现在必须把每一个漏洞找出来。

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

**验证命令问题（最重要）**：
- 命令是否真的能发现 bug？还是只是检查"存在性"？
- 是否覆盖了失败路径（空输入、错误参数、边界值）？
- 是否有"自证清白"的弱测试（Generator 自己写的 happy path）？
- 命令是否真实可执行（语法正确、依赖存在）？
- 是否遗漏了重要的验证点（对比 PRD 的验收标准）？

**功能范围问题**：
- 是否有 PRD 里的功能被遗漏？
- 是否有模糊词（"正确"、"合理"）没有量化？
- 边界情况是否考虑到？

**技术风险**：
- 实现方向是否有明显陷阱？

### Phase 3: 做出判断

**APPROVED 条件**（必须全部满足）：
- 每个 Feature 都有验证命令
- 验证命令覆盖正常路径 + 至少一个边界/失败路径
- 命令真实可执行（不是伪代码）
- PRD 里的功能点全部覆盖

**REVISION 条件**（任一满足）：
- 验证命令是弱测试（只检查文件存在、只检查 200 状态码）
- 缺少边界情况测试
- 有 PRD 功能点遗漏
- 验证命令语法有问题

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
1. [验证命令太弱] Feature A 的验证只检查 HTTP 200，没有检查返回值内容
2. [缺边界测试] Feature B 缺少空输入的测试命令
3. [PRD 遗漏] PRD 里的 Feature C 在合同里没有出现

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
