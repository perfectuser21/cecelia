# Contract Review Feedback (Round 3)

> **Evaluator 审查轮次**: R3 → R4
> **覆盖率**: 18/18 = 100%（阈值 80%）
> **绕过率**: 5/18 = 28%
> **判定**: REVISION — 3 个必须修改项 + 2 个可选改进

---

## 必须修改项

### 1. [命令太弱] Feature 3 — Commands 3-4/3-5 未过滤注释行（与 Feature 1/4 不一致）

**原始命令**（3-4）:
```bash
node -e "
  const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');
  if(!/harness.*mode|_harness_mode|HARNESS_MODE/.test(c))
    throw new Error('FAIL: devloop-check.sh 无 harness 模式检测');
  console.log('PASS: devloop-check.sh 包含 harness 模式检测');
"
```

**原始命令**（3-5）:
```bash
node -e "
  const c=require('fs').readFileSync('packages/engine/hooks/stop.sh','utf8');
  if(!/harness.*mode|_harness_mode|HARNESS_MODE/.test(c))
    throw new Error('FAIL: stop.sh 无 harness 模式检测');
  console.log('PASS: stop.sh 包含 harness 模式检测');
"
```

**假实现片段**（proof-of-falsification）:
```bash
#!/bin/bash
# _harness_mode detection — TODO: implement later
# This script uses HARNESS_MODE for pipeline automation
echo "Normal devloop-check flow"
read -p "确认继续？(y/n) " confirm
# 实际上没有任何 harness 模式条件分支
# 但 regex /harness.*mode|_harness_mode|HARNESS_MODE/ 匹配到注释中的文本
```

**建议修复命令**（3-4）:
```bash
node -e "
  const lines=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  if(!/harness.*mode|_harness_mode|HARNESS_MODE/.test(lines))
    throw new Error('FAIL: devloop-check.sh 无 harness 模式检测（排除注释后）');
  console.log('PASS: devloop-check.sh 包含 harness 模式检测');
"
```

**建议修复命令**（3-5）:
```bash
node -e "
  const lines=require('fs').readFileSync('packages/engine/hooks/stop.sh','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  if(!/harness.*mode|_harness_mode|HARNESS_MODE/.test(lines))
    throw new Error('FAIL: stop.sh 无 harness 模式检测（排除注释后）');
  console.log('PASS: stop.sh 包含 harness 模式检测');
"
```

**同步更新 Workstream 3 DoD**: Commands 3-4/3-5 对应的 DoD Test 字段也需同步修改。

---

### 2. [PRD 遗漏] Feature 2 — 缺少重试机制验证命令

**PRD 硬阈值原文**:
> 包含重试机制（失败后至少 1 次重试）

合同 Feature 2 只有 2 条验证命令（2-1 检测 auto-merge step 存在，2-2 检测 harness label 限制），**无任何命令验证重试逻辑**。

**假实现片段**（proof-of-falsification）:
```yaml
# CI 中的 auto-merge step — 无重试，单次失败即放弃
auto-merge:
  if: contains(github.event.pull_request.labels.*.name, 'harness')
  steps:
    - run: gh pr merge ${{ github.event.pull_request.number }} --merge
# 命令 2-1 和 2-2 都能通过，但 merge 失败时不会重试
```

**建议新增命令**（2-3）:
```bash
node -e "
  const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  if(!/retry|RETRY|attempt|ATTEMPT|for\s+i\s+in|while.*merge/.test(lines))
    throw new Error('FAIL: auto-merge 无重试机制');
  console.log('PASS: auto-merge 包含重试逻辑');
"
```

**同步更新 Workstream 2 DoD**: 新增 DoD 条目：
```
- [ ] [BEHAVIOR] auto-merge 包含重试机制（至少 1 次重试）
  Test: node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/retry|RETRY|attempt|ATTEMPT|for\s+i\s+in|while.*merge/.test(lines))throw new Error('FAIL');console.log('PASS')"
```

---

### 3. [缺失边界] Feature 2 — 缺少 merge 失败回写 Brain 验证

**PRD 行为描述原文**:
> merge 失败时（如冲突），将失败状态回写 Brain 任务

Feature 5 的 Command 5-1 验证了 `devloop-check.sh` 的回写，Command 5-2 验证了 `post-merge-deploy.sh` 的回写。但 **CI workflow 中 merge 失败后的 Brain 回写完全未验证**。

**假实现片段**（proof-of-falsification）:
```yaml
auto-merge:
  steps:
    - run: gh pr merge ${{ github.event.pull_request.number }} --merge
    # merge 失败时（exit code 非零），step 直接失败
    # 没有 failure 回写 Brain，任务永远卡在 in_progress
```

**建议新增命令**（2-4）:
```bash
node -e "
  const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  if(!/auto.merge[\s\S]{0,2000}curl[\s\S]{0,100}(PATCH|patch)[\s\S]{0,200}(brain|tasks)/.test(lines) &&
     !/auto.merge[\s\S]{0,2000}(fail|error)[\s\S]{0,500}(brain|tasks|回写)/.test(lines))
    throw new Error('FAIL: auto-merge 失败后无 Brain 回写逻辑');
  console.log('PASS: auto-merge 失败有 Brain 回写');
"
```

**同步更新 Workstream 2 DoD**: 新增 DoD 条目：
```
- [ ] [BEHAVIOR] merge 失败时回写 Brain 任务状态（curl PATCH 在 auto-merge failure 路径内）
  Test: node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/auto.merge[\s\S]{0,2000}curl[\s\S]{0,100}(PATCH|patch)[\s\S]{0,200}(brain|tasks)/.test(lines)&&!/auto.merge[\s\S]{0,2000}(fail|error)[\s\S]{0,500}(brain|tasks)/.test(lines))throw new Error('FAIL');console.log('PASS')"
```

---

## 可选改进

### 1. [命令脆弱] Feature 6 — Command 6-1 indexOf('health') 可能误匹配

**问题**: `lines.indexOf('health')` 会匹配变量名 `HEALTH_TIMEOUT=30`（在文件顶部），导致 `afterHealth` 起点过早，后续 1000 字符窗口内的任何 curl PATCH 都能通过。

**建议**: 改用 `lines.search(/curl[^;]*health/)` 与 Command 1-2 保持一致：
```bash
node -e "
  const lines=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  const healthIdx=lines.search(/curl[^;]*health/);
  const afterHealth=lines.substring(healthIdx);
  if(!/curl[\s\S]{0,1000}(deployed|DEPLOYED|deploy_success)/.test(afterHealth) &&
     !/curl[\s\S]{0,1000}PATCH[\s\S]{0,200}status/.test(afterHealth))
    throw new Error('FAIL: health check 之后 1000 字符内无部署成功回写');
  console.log('PASS: 部署成功后有状态回写');
"
```

### 2. [语义歧义] Feature 3 — Commands 3-1/3-3 的 "do not" 选项

**问题**: Regex `(skip|跳过|不执行|do not)` 中的 "do not" 可匹配反义表达。"In harness mode, do not skip Learning files" 会通过检查但含义相反。

**建议**: 移除 "do not"，只保留肯定表达：`(skip|跳过|不执行|省略|omit)`。

---

## 总结

| 维度 | 评价 |
|------|------|
| 命令覆盖率 | 优秀（100%） |
| 命令工具选择 | 优秀（全部使用 CI 白名单 node -e） |
| 注释过滤一致性 | **需修复**（3-4/3-5 遗漏） |
| PRD→合同映射 | **需修复**（Feature 2 重试+回写遗漏） |
| Workstream 结构 | 优秀（边界清晰、无交集、DoD 格式正确） |
| R3 改进质量 | 良好（R2 的 10 项反馈全部整合） |
