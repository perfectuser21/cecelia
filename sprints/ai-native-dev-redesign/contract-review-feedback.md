# Contract Review Feedback (Round 1)

## 必须修改项

### 1. [命令太弱] 全局问题 — 所有验证命令都是纯文本匹配（includes），无功能性验证

**原始命令**（代表性示例）:
```bash
node -e "
  const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');
  if(!c.includes('health')&&!c.includes('rollback'))throw new Error('FAIL');
  console.log('PASS')
"
```

**假实现片段**（proof-of-falsification）:
```bash
#!/bin/bash
# scripts/post-merge-deploy.sh — 假实现
# health check TODO (以后再做)
# rollback 占位符
echo "brain-reload: not implemented"
echo "dashboard: not implemented"
echo "cecelia-deploy-status: placeholder"
TIMEOUT=30  # 未使用
echo "--max-time placeholder"
exit 0
```
上述假实现包含所有合同检查的关键词（`health`/`rollback`/`brain-reload`/`dashboard`/`cecelia-deploy-status`/`timeout`/`max-time`），但没有任何实际部署逻辑。全部 12 个 Feature 验证命令 + 11 个 Workstream DoD Test 全部 PASS。

**建议修复命令**:
验证命令应检查**功能性结构**而非关键词。示例：
```bash
# 验证 health check 是实际循环轮询，不是注释
node -e "
  const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');
  // 必须包含 curl + health 端点 + 循环结构
  if(!/curl.*health/.test(c)) throw new Error('FAIL: 无 curl health check');
  if(!/while|for/.test(c)) throw new Error('FAIL: 无循环轮询结构');
  if(!/git revert|git checkout/.test(c)) throw new Error('FAIL: rollback 无 git 操作');
  console.log('PASS');
"
```

---

### 2. [已有代码已通过] Feature 2 + Feature 3 — 现有代码已满足 4 个验证命令，Generator 无需改动

**原始命令**:
```bash
# Feature 2 - devloop-check 条件 0.5
node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');if(!c.includes('harness_mode'))throw ..."
# Feature 2 - 02-code.md
node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/02-code.md','utf8');if(!c.includes('harness'))throw ..."
# Feature 3 - ci.yml
node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('harness'))throw ..."
# Feature 3 - auto-merge
node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');if(!c.includes('gh pr merge'))throw ..."
```

**假实现片段**（proof-of-falsification）:
```javascript
// 不需要假实现 — 现有代码已原样通过：
// devloop-check.sh 行 104: if [[ "$_harness_mode" == "true" ]]; then
// devloop-check.sh 行 127: gh pr merge "$_h_pr" --squash --auto
// 02-code.md 行 19: ## 0. Harness 模式检测（harness_mode）
// ci.yml 行 446: harness-dod-integrity:
// Generator 无需写任何代码，这 4 个命令全部 PASS
```

**建议修复命令**:
Feature 2/3 的验证命令必须检测**本次 Sprint 新增的变更**。具体建议：

对于 Feature 2（/dev Harness 极简路径）：
- 04-ship.md 是唯一需要新增 harness 逻辑的文件。验证应更严格：
```bash
node -e "
  const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');
  if(!/harness_mode/.test(c)) throw new Error('FAIL: 04-ship.md 无 harness_mode 检测');
  if(!/[跳过skip].*[Ll]earning/.test(c)) throw new Error('FAIL: 无跳过 Learning 的条件分支');
  console.log('PASS');
"
```

对于 Feature 3（CI 优化）：
- 应验证 CI 有**条件跳过**非必要 job 的新逻辑（而非仅检查 harness 关键词已存在）：
```bash
node -e "
  const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');
  // 验证 Learning Format Gate 或其他非必要 job 在 harness PR 上有 skip 条件
  if(!/if:.*harness|skip.*harness|harness.*skip/.test(c)) throw new Error('FAIL: 无 harness 条件跳过');
  console.log('PASS');
"
```

---

### 3. [命令太弱] Feature 1 WS1 — dry-run ENOENT 自动 PASS，格式验证被完全绕过

**原始命令**:
```bash
bash scripts/post-merge-deploy.sh --dry-run 2>/dev/null; \
node -e "
  try {
    const status = JSON.parse(fs.readFileSync('/tmp/cecelia-deploy-status.json', 'utf8'));
    ...
  } catch(e) {
    if (e.code === 'ENOENT') console.log('PASS: dry-run 模式不生成状态文件（预期行为）');
    else throw e;
  }
"
```

**假实现片段**（proof-of-falsification）:
```bash
#!/bin/bash
# scripts/post-merge-deploy.sh — dry-run 什么都不做
if [[ "$1" == "--dry-run" ]]; then
  echo "dry run mode"
  exit 0  # 不生成状态文件 → ENOENT → PASS
fi
```

**建议修复命令**:
dry-run 模式应仍然生成状态文件（status=dry_run），然后验证格式：
```bash
bash scripts/post-merge-deploy.sh --dry-run 2>/dev/null; \
node -e "
  const fs=require('fs');
  const status=JSON.parse(fs.readFileSync('/tmp/cecelia-deploy-status.json','utf8'));
  if(!status.status) throw new Error('FAIL: 缺少 status');
  if(!status.timestamp) throw new Error('FAIL: 缺少 timestamp');
  if(!status.commit) throw new Error('FAIL: 缺少 commit');
  console.log('PASS: 格式正确，status=' + status.status);
"
```

---

### 4. [缺失边界] Feature 4 WS3 — CI 失败回写仅检查关键词 'failed'，无实际 curl PATCH 验证

**原始命令**:
```bash
node -e "
  const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');
  if(!c.includes('PATCH')&&!c.includes('failed'))throw new Error('FAIL');
  console.log('PASS')
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// devloop-check.sh 行 202-211 已有 ci_conclusion != success 时的 "failed" 处理
// 但那里只输出 JSON {"status":"blocked","reason":"CI 失败"} 给本地 Stop Hook
// 没有 curl PATCH 回写 Brain。命令检查 includes('failed') 已被现有代码满足。
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');
  // 必须同时包含 curl + PATCH + /api/brain/tasks（完整回写链路）
  if(!/curl.*PATCH.*api\/brain\/tasks|curl.*-X\s+PATCH.*tasks/.test(c))
    throw new Error('FAIL: 缺少 curl PATCH /api/brain/tasks 回写链路');
  console.log('PASS');
"
```

---

### 5. [PRD 遗漏] PRD US-005/场景6 — Brain 重启失败自动回退没有独立验证

PRD 场景 6 要求：「重启后 health check 连续 3 次失败 → 自动回退到上一个已知正常的 commit」。合同中仅检查 `content.includes('rollback')` 关键词，没有验证：
- 回退命令是否是 `git revert` 或等效
- 回退后是否重新启动 Brain
- 回退事件是否写入 Brain 任务记录

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');
  // 回退必须包含 git 操作 + 重启 + 回写
  if(!/git\s+(revert|checkout|reset)/.test(c)) throw new Error('FAIL: rollback 无 git 操作');
  if(!/rollback.*restart|rollback[\s\S]{0,200}pm2|rollback[\s\S]{0,200}brain-reload/.test(c))
    throw new Error('FAIL: rollback 后无重启逻辑');
  console.log('PASS');
"
```

---

### 6. [Workstream 问题] WS2 devloop-check 条件 0.5 调用 post-merge-deploy — 架构不合理

**问题**: WS2 DoD 要求「devloop-check 条件 0.5 在 auto-merge 成功后调用 post-merge-deploy」。但现有条件 0.5（行 126-131）的设计是 `gh pr merge --auto` + `exit 0`——它在 PR 真正 merge 前就退出了。`--auto` 只是标记 auto-merge，实际 merge 发生在 CI 通过后。因此在条件 0.5 中调用 post-merge-deploy 时机不对（PR 尚未 merge）。

**建议**: post-merge-deploy 应由 GitHub webhook/CI post-merge job 或条件 5（PR 已合并检测到后）触发，而非条件 0.5。重新设计此 Workstream 的集成点。

---

## 可选改进

1. **Feature 粒度过粗**: Feature 1 包含了 Brain 重启 + Dashboard 部署 + Health Gate + Rollback + 状态文件 5 个独立功能。建议拆分为 2-3 个 Feature，各自有针对性验证。

2. **缺少端到端集成测试**: 所有验证都是文件内容检查，没有一个命令实际执行部署流程（即使是 dry-run）。建议至少有一个 `bash scripts/post-merge-deploy.sh --dry-run` 后检查输出的测试。

3. **WS3 大小估计可能偏小**: 声明 S（<100行），但需要在 post-merge-deploy.sh 和 devloop-check.sh 两个文件的多个失败路径中添加 curl PATCH 回写 + 超时保护。如果 devloop-check.sh 要新增 Brain 回写（当前没有），代码量可能接近 M。
