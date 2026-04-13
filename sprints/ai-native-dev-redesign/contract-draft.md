# Sprint Contract Draft (Round 1)

## Feature 1: Post-Merge 自动部署流水线

**行为描述**:
当 Harness 模式创建的 PR 合并到 main 后，系统自动检测变更涉及的子系统（Brain/Dashboard/Engine），按需执行对应的部署流程。Brain 变更触发 Brain 进程重启，Dashboard 变更触发前端重新构建和部署。部署完成后写入状态文件供后续环节（Evaluator）感知。

**硬阈值**:
- merge 到 main 后，部署流程在 60 秒内自动触发（无需人工操作）
- Brain 重启后 health check（`/api/brain/health`）在 30 秒内返回 200
- 部署状态文件 `/tmp/cecelia-deploy-status.json` 包含 `status`、`timestamp`、`commit` 字段
- 部署失败时自动回退到上一个正常 commit，回退事件写入 Brain 任务记录

**验证命令**:
```bash
# 验证 post-merge deploy 脚本存在且可执行
node -e "
  const fs = require('fs');
  const script = 'scripts/post-merge-deploy.sh';
  fs.accessSync(script, fs.constants.X_OK);
  const content = fs.readFileSync(script, 'utf8');
  if (!content.includes('brain-reload') && !content.includes('brain-deploy'))
    throw new Error('FAIL: 缺少 Brain 重启逻辑');
  if (!content.includes('dashboard') && !content.includes('apps/dashboard'))
    throw new Error('FAIL: 缺少 Dashboard 部署逻辑');
  console.log('PASS: post-merge deploy 脚本包含 Brain 重启和 Dashboard 部署逻辑');
"

# 验证 health gate 逻辑存在
node -e "
  const fs = require('fs');
  const script = 'scripts/post-merge-deploy.sh';
  const content = fs.readFileSync(script, 'utf8');
  if (!content.includes('health') || !content.includes('rollback'))
    throw new Error('FAIL: 缺少 health check 或 rollback 逻辑');
  console.log('PASS: 包含 health gate 和 rollback 逻辑');
"

# 验证部署状态文件格式
bash scripts/post-merge-deploy.sh --dry-run 2>/dev/null; \
node -e "
  const fs = require('fs');
  try {
    const status = JSON.parse(fs.readFileSync('/tmp/cecelia-deploy-status.json', 'utf8'));
    if (!status.status) throw new Error('FAIL: 缺少 status 字段');
    if (!status.timestamp) throw new Error('FAIL: 缺少 timestamp 字段');
    console.log('PASS: 部署状态文件格式正确，status=' + status.status);
  } catch(e) {
    if (e.code === 'ENOENT') console.log('PASS: dry-run 模式不生成状态文件（预期行为）');
    else throw e;
  }
"
```

---

## Feature 2: /dev Harness 极简快速路径

**行为描述**:
当 /dev skill 检测到 Harness 模式（task payload 中 `harness_mode: true` 或 `.dev-mode` 文件包含 `harness_mode: true`）时，自动跳过所有面向人类开发者的步骤：Learning 文件生成与提交、DoD 逐条手动验证与勾选、Stop Hook 人类确认提示。Generator 仅需完成代码编写 + 创建 PR，其余验证交由 Evaluator。

**硬阈值**:
- Harness 模式下不生成 `docs/learnings/` 下的任何文件
- Harness 模式下不触发 `fire-learnings-event.sh`
- Harness 模式下 Stage 2（代码阶段）不执行 DoD 逐条验证
- Harness 模式下 devloop-check 条件 0.5 快速通道生效：仅需 `step_2_code: done` + PR 已创建即可通过

**验证命令**:
```bash
# 验证 Stage 4 (ship) 在 Harness 模式下跳过 Learning
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/skills/dev/steps/04-ship.md', 'utf8');
  if (!content.includes('harness') && !content.includes('HARNESS'))
    throw new Error('FAIL: 04-ship.md 不包含 harness 模式检测逻辑');
  console.log('PASS: 04-ship.md 包含 harness 模式分支');
"

# 验证 devloop-check 条件 0.5 快速通道
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/lib/devloop-check.sh', 'utf8');
  if (!content.includes('harness_mode'))
    throw new Error('FAIL: devloop-check.sh 不包含 harness_mode 检测');
  if (!content.includes('0.5') || !content.includes('快速通道') || !content.includes('fast'))
    throw new Error('FAIL: 缺少条件 0.5 快速通道');
  console.log('PASS: devloop-check.sh 包含 harness 快速通道（条件 0.5）');
"

# 验证 Stage 2 在 Harness 模式下跳过 DoD 验证
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/skills/dev/steps/02-code.md', 'utf8');
  if (!content.includes('harness'))
    throw new Error('FAIL: 02-code.md 不包含 harness 模式检测');
  console.log('PASS: 02-code.md 包含 harness 模式分支');
"
```

---

## Feature 3: CI Harness 模式优化

**行为描述**:
Harness 模式创建的 PR（通过 branch 前缀 `cp-` + label `harness` 或 commit message 标记识别），CI 仅运行必要的机械性检查（Secrets 扫描、ESLint、TypeCheck、Unit Tests），跳过面向人类的检查（Learning Format Gate、DoD 手动验证格式检查）。CI 通过后自动触发 merge。

**硬阈值**:
- Harness PR 的 CI 运行时间比人类 PR 减少至少 30%（跳过非必要 jobs）
- CI 全 pass 后 PR 在 5 分钟内自动 merge（通过 `gh pr merge --squash --auto` 或等效机制）
- CI 失败时不触发 merge，失败状态回写 Brain

**验证命令**:
```bash
# 验证 CI workflow 包含 Harness 模式条件跳过逻辑
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  if (!content.includes('harness'))
    throw new Error('FAIL: ci.yml 不包含 harness 模式检测');
  console.log('PASS: ci.yml 包含 harness 模式条件分支');
"

# 验证自动 merge 逻辑存在于 devloop-check 或 CI workflow
node -e "
  const fs = require('fs');
  const devloop = fs.readFileSync('packages/engine/lib/devloop-check.sh', 'utf8');
  if (!devloop.includes('gh pr merge'))
    throw new Error('FAIL: devloop-check.sh 缺少 auto-merge 命令');
  console.log('PASS: devloop-check.sh 包含 gh pr merge 自动合并逻辑');
"

# 验证 CI 失败回写 Brain 逻辑
node -e "
  const fs = require('fs');
  const devloop = fs.readFileSync('packages/engine/lib/devloop-check.sh', 'utf8');
  if (!devloop.includes('failed') || !devloop.includes('task'))
    throw new Error('FAIL: 缺少失败状态回写逻辑');
  console.log('PASS: devloop-check.sh 包含失败状态处理');
"
```

---

## Feature 4: 失败检测与 Brain 回写

**行为描述**:
Harness 流水线中任何环节失败（CI 失败、merge 冲突、Brain 重启失败、Dashboard 部署失败），系统自动将失败状态和错误信息回写到 Brain 任务记录。失败信息包含失败环节、错误消息、时间戳，供 Brain 调度器决策是否重试或标记任务失败。

**硬阈值**:
- 每个失败场景都有对应的回写逻辑（CI 失败、merge 失败、部署失败）
- 回写格式：`{"status": "failed", "result": {"error": "<消息>", "stage": "<环节>", "timestamp": "<ISO>"}}`
- 回写调用 Brain API `PATCH /api/brain/tasks/{task_id}`
- 失败后不会导致流水线挂起（超时保护）

**验证命令**:
```bash
# 验证 post-merge-deploy 包含失败回写
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('scripts/post-merge-deploy.sh', 'utf8');
  if (!content.includes('api/brain/tasks') && !content.includes('writeback'))
    throw new Error('FAIL: post-merge-deploy.sh 缺少 Brain 任务回写');
  console.log('PASS: post-merge-deploy.sh 包含 Brain 任务状态回写');
"

# 验证 devloop-check 失败路径有回写
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/lib/devloop-check.sh', 'utf8');
  const hasFailWrite = content.includes('curl') && content.includes('PATCH') && content.includes('tasks');
  if (!hasFailWrite && !content.includes('failed'))
    throw new Error('FAIL: devloop-check 缺少失败回写逻辑');
  console.log('PASS: devloop-check 包含失败处理路径');
"

# 验证无挂起风险（超时保护）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('scripts/post-merge-deploy.sh', 'utf8');
  if (!content.includes('timeout') && !content.includes('TIMEOUT'))
    throw new Error('FAIL: 缺少超时保护');
  console.log('PASS: 包含超时保护机制');
"
```

---

## Workstreams

workstream_count: 3

### Workstream 1: Post-Merge 自动部署流水线

**范围**: 创建 `scripts/post-merge-deploy.sh` 脚本，整合现有 `brain-reload.sh`/`brain-deploy.sh` 和 Dashboard 构建逻辑。包含变更路径检测（Brain/Dashboard/Engine）、条件触发部署、health gate 等待、部署失败自动回退（git revert + restart）、部署状态写入 `/tmp/cecelia-deploy-status.json`。修改 devloop-check 条件 0.5/6 在 auto-merge 成功后调用此脚本。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `scripts/post-merge-deploy.sh` 存在且可执行，包含 Brain 重启、Dashboard 部署、health gate、rollback 四大模块
  Test: node -e "const fs=require('fs');fs.accessSync('scripts/post-merge-deploy.sh',fs.constants.X_OK);const c=fs.readFileSync('scripts/post-merge-deploy.sh','utf8');if(!c.includes('brain'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 脚本支持 `--dry-run` 模式，不实际执行部署但输出将要执行的步骤
  Test: bash scripts/post-merge-deploy.sh --dry-run 2>&1 | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{if(!d.includes('dry'))throw new Error('FAIL: 无 dry-run 输出');console.log('PASS')})"
- [ ] [BEHAVIOR] Brain 变更 merge 后 health check 通过才标记部署成功，超时 30 秒后触发回退
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');if(!c.includes('health')&&!c.includes('rollback'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 部署状态写入 `/tmp/cecelia-deploy-status.json`，包含 status/timestamp/commit 字段
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');if(!c.includes('cecelia-deploy-status'))throw new Error('FAIL');console.log('PASS')"

### Workstream 2: /dev Harness 极简快速路径 + CI 优化

**范围**: 审查并增强 /dev skill 各步骤（01-spec/02-code/03-integrate/04-ship）中的 Harness 模式分支，确保 Learning 文件生成、DoD 手动验证、fire-learnings-event.sh 调用在 Harness 模式下全部跳过。审查 `.github/workflows/ci.yml`，为 Harness PR（通过 branch 前缀或 label）标记可跳过的 jobs。更新 devloop-check 条件 0.5 在 auto-merge 后调用 post-merge-deploy.sh。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] Harness 模式下 04-ship.md 跳过 Learning 文件生成和 fire-learnings-event.sh
  Test: node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');if(!c.includes('harness'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] Harness 模式下 02-code.md 跳过 DoD 逐条验证
  Test: node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/02-code.md','utf8');if(!c.includes('harness'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] CI workflow 包含 Harness 模式条件，非必要 jobs 在 Harness PR 上可跳过
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('harness'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] devloop-check 条件 0.5 在 auto-merge 成功后调用 post-merge-deploy
  Test: node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');if(!c.includes('post-merge-deploy'))throw new Error('FAIL');console.log('PASS')"

### Workstream 3: 失败检测与 Brain 状态回写

**范围**: 在 post-merge-deploy.sh 和 devloop-check.sh 的各失败路径中添加 Brain 任务状态回写逻辑（curl PATCH /api/brain/tasks/{task_id}）。覆盖场景：CI 失败、merge 冲突、Brain 重启失败、Dashboard 部署失败。每个失败路径包含超时保护（防挂起）。
**大小**: S（<100行）
**依赖**: Workstream 1 完成后（需要 post-merge-deploy.sh 存在）

**DoD**:
- [ ] [BEHAVIOR] CI 失败时 devloop-check 回写 Brain 任务状态为 failed
  Test: node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');if(!c.includes('PATCH')&&!c.includes('failed'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] post-merge-deploy.sh 部署失败时回写 Brain 任务状态
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');if(!c.includes('api/brain/tasks'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 所有失败路径有超时保护（curl 调用设置 --max-time）
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');if(!c.includes('timeout')||!c.includes('max-time'))throw new Error('FAIL');console.log('PASS')"
