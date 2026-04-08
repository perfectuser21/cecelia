---
id: sprint-contract-reviewer-skill
description: /sprint-contract-reviewer — Harness v3.1：Evaluator 对抗性审查合同草案，重点挑战验证命令是否够严格、能否检测出错误实现
version: 4.0.0
created: 2026-04-04
updated: 2026-04-08
changelog:
  - 4.0.0: 修正 v3.0 错误 — 审查重点恢复为"验证命令够不够严格"（而非"行为描述是否可验证"）
  - 3.0.0: 审查重点错误改为"行为描述是否可验证、阈值是否量化"（已废弃：移除了对命令严格性的挑战）
  - 2.0.0: v3.1 — 重点审查验证命令的广谱性和严格性
  - 1.0.0: 初始版本
---

# /sprint-contract-reviewer — Harness v3.1: Evaluator 挑战验证命令

**角色**: Evaluator（合同挑战者）
**职责**: 以对抗性视角审查 Generator 的合同草案——重点挑战**验证命令是否足够严格、是否广谱覆盖、是否能检测出错误实现**。

**心态**: 你即将执行这些命令来验证实现。站在"寻找合同漏洞"的角度：哪些命令太弱，能被错误实现蒙混过关？哪些边界没测？哪些工具选择不对？

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

### Phase 2: 对抗性审查——挑战验证命令

逐条检查验证命令，寻找以下问题：

**命令严格性问题（最重要）**：
- 命令是否能检测出错误实现？（一个空实现能通过这个命令吗？）
- 命令只测了 happy path，没测失败路径吗？
- 命令用了弱验证（如只检查 HTTP 200，不检查响应体内容）吗？
- 命令能否被"假实现"蒙混过关？（比如只检查字段存在，不检查字段值正确）

**广谱性问题**：
- 全是 curl 命令，UI 功能没用 playwright 验证吗？
- DB 状态变更没用 psql 验证 DB 实际记录吗？
- 业务逻辑没用 npm test 验证单元行为吗？
- 只测了 API 层，没测数据一致性（API vs DB）吗？

**覆盖度问题**：
- PRD 里的功能点，合同里有没有对应的验证命令？
- 有没有重要边界情况（空输入、并发、超时）没有对应命令？
- Feature 数量是否匹配 PRD 功能数量？

**命令可执行性问题**：
- 命令里有没有需要手动替换的占位符（如 `{task_id}`）？
- 命令依赖的服务/端口假设是否合理（Brain 在 5221，Dashboard 在 5211）？
- 命令的 exit code 语义是否正确（成功=0，失败=非零）？

### Phase 3: 做出判断

**APPROVED 条件**（必须全部满足）：
- 每个 Feature 都有可直接执行的验证命令（无占位符）
- 命令覆盖 happy path + 至少一个失败/边界路径
- 命令足够严格，能检测出错误实现（非空校验、非 HTTP 200 校验）
- 命令广谱：根据任务类型使用了合适的工具（不全是 curl）
- PRD 里的功能点全部有对应命令
- Evaluator 能无脑执行这些命令并得到明确的 PASS/FAIL 信号

**REVISION 条件**（任一满足）：
- 有验证命令含占位符（如 `{task_id}`，无法直接执行）
- 命令只测 happy path，无失败路径
- 命令太弱（只查 HTTP 状态码，不验证响应体）
- 有 PRD 功能点没有对应命令
- 全是 curl，没有 psql/playwright/npm test 等广谱工具
- 命令 exit code 语义不清晰

### Phase 4a: APPROVED — 写最终合同

```bash
cp "${sprint_dir}/contract-draft.md" "${sprint_dir}/sprint-contract.md"
git add "${sprint_dir}/sprint-contract.md"
git commit -m "chore(harness): contract approved round ${propose_round}"
git push origin HEAD
```

### Phase 4b: REVISION — 写反馈

写入 `${sprint_dir}/contract-review-feedback.md`：

```markdown
# 合同审查反馈（第 ${propose_round} 轮）

## 必须修改
1. [命令太弱] Feature A 的验证命令只检查 HTTP 200，未验证响应体字段
2. [缺失边界] Feature B 没有测试空输入/无效参数时的行为
3. [工具不对] Feature C 是 UI 功能，应用 playwright 验证，不能只用 curl
4. [有占位符] Feature D 的命令含 `{task_id}`，无法直接执行
5. [PRD 遗漏] PRD 里的 Feature E 在合同里没有验证命令

## 可选改进
- ...
```

```bash
git add "${sprint_dir}/contract-review-feedback.md"
git commit -m "chore(harness): contract revision feedback round ${propose_round}"
git push origin HEAD
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
