# Sprint Contract: Sprint 2 — Evaluator 实战验证

**生成者**: Generator (Sprint 2)
**任务**: 确保 sprint-evaluator skill 能被 headless session 正确执行
**评估轮次**: R1
**状态**: APPROVED

---

## 验收条件

### SC-1: sprint-evaluator skill 已部署到 headless account 目录

- **验证命令**:
  ```bash
  node -e "require('fs').accessSync(require('os').homedir()+'/.claude-account1/skills/sprint-evaluator/SKILL.md');console.log('PASS')"
  ```
- **预期结果**: 输出 `PASS`（无异常退出）

### SC-2: sprint-generator skill 已部署到 headless account 目录

- **验证命令**:
  ```bash
  node -e "require('fs').accessSync(require('os').homedir()+'/.claude-account1/skills/sprint-generator/SKILL.md');console.log('PASS')"
  ```
- **预期结果**: 输出 `PASS`（无异常退出）

### SC-3: deploy-workflow-skills.sh 存在且可执行

- **验证命令**:
  ```bash
  node -e "require('fs').accessSync('packages/workflows/scripts/deploy-workflow-skills.sh',require('fs').constants.X_OK);console.log('PASS')"
  ```
- **预期结果**: 输出 `PASS`

### SC-4: skills-index.md 包含 sprint-evaluator 和 sprint-generator 条目

- **验证命令**:
  ```bash
  node -e "const c=require('fs').readFileSync('.agent-knowledge/skills-index.md','utf8');if(!c.includes('sprint-evaluator')||!c.includes('sprint-generator'))process.exit(1);console.log('PASS')"
  ```
- **预期结果**: 输出 `PASS`

### SC-5: skills-index.md 任务路由表包含 sprint_evaluate / sprint_generate

- **验证命令**:
  ```bash
  node -e "const c=require('fs').readFileSync('.agent-knowledge/skills-index.md','utf8');if(!c.includes('sprint_evaluate')||!c.includes('sprint_generate'))process.exit(1);console.log('PASS')"
  ```
- **预期结果**: 输出 `PASS`

### SC-6: deploy-local.sh 在 packages/workflows/skills/ 变更时调用 deploy-workflow-skills

- **验证命令**:
  ```bash
  node -e "const c=require('fs').readFileSync('scripts/deploy-local.sh','utf8');if(!c.includes('deploy-workflow-skills'))process.exit(1);console.log('PASS')"
  ```
- **预期结果**: 输出 `PASS`

---

## 不验证项

- sprint-evaluator skill 内容正确性（那是 Sprint 3+ 的事）
- Brain 完整的 sprint 循环运行（Sprint 3 验证）
