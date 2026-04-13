# Sprint Contract Draft (Round 4)

> **R4 变更摘要**: 针对 R3 评审 3 个必须修改项 + 2 个可选改进全部整合。
> 核心修复：(1) Feature 3 Commands 3-4/3-5 过滤注释行（与 1/4 一致）
> (2) Feature 2 新增重试机制验证命令 2-3 (3) Feature 2 新增 merge 失败回写 Brain 验证命令 2-4
> (4) Feature 6 Command 6-1 改用 lines.search(/curl[^;]*health/) 替代 indexOf('health')
> (5) Feature 3 Commands 3-1/3-3 移除 "do not"，只保留肯定表达

---

## Feature 1: Post-Merge 自动部署（Brain 重启 + Health Gate + 回退）

**行为描述**:
当 Harness PR merge 到 main 且变更涉及 `packages/brain/` 时，自动触发 Brain 进程重启。重启后轮询 health check 端点，通过后标记部署成功。若 health check 连续失败超过阈值，自动回退到上一个已知正常的 commit 并重启。整个过程通过 `scripts/post-merge-deploy.sh` 脚本执行。

**硬阈值**:
- `scripts/post-merge-deploy.sh` 文件存在且可执行
- 脚本（排除注释行后）包含：health check 轮询（curl + 循环结构）、Brain 重启命令（pm2 restart 或 systemctl restart 或 brain-reload）、回退机制（git revert 或 git reset）
- Health check 超时阈值 <= 60 秒
- Dashboard 构建在 `apps/dashboard` 变更时条件触发（if 分支内）

**验证命令**:
```bash
# 命令 1-1: 脚本存在且可执行
node -e "
  const fs=require('fs');
  const st=fs.statSync('scripts/post-merge-deploy.sh');
  if(!(st.mode & 0o111)) throw new Error('FAIL: 脚本不可执行');
  console.log('PASS: post-merge-deploy.sh 存在且可执行');
"
```

```bash
# 命令 1-2: 功能性结构校验（排除注释行）
node -e "
  const lines=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  if(!/curl[^;]*health/.test(lines))
    throw new Error('FAIL: 无 curl health check 调用（排除注释后）');
  if(!/while\b|for\b/.test(lines))
    throw new Error('FAIL: 无循环轮询结构（排除注释后）');
  if(!/git\s+(revert|reset)/.test(lines))
    throw new Error('FAIL: rollback 无 git revert/reset（排除注释后）');
  if(!/pm2\s+restart|systemctl\s+restart|brain-reload/.test(lines))
    throw new Error('FAIL: 无 Brain 重启命令（排除注释后）');
  console.log('PASS: 部署脚本功能性结构完整（注释已排除）');
"
```

```bash
# 命令 1-3: Health check 超时阈值 <= 60 秒
node -e "
  const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');
  const m=c.match(/(?:timeout|TIMEOUT|max_wait|MAX_WAIT|HEALTH_TIMEOUT)[^=]*=\s*(\d+)/);
  if(!m) throw new Error('FAIL: 未找到超时阈值变量');
  if(parseInt(m[1])>60) throw new Error('FAIL: 超时阈值 '+m[1]+' 超过 60 秒');
  console.log('PASS: Health check 超时阈值 = '+m[1]+'s，<= 60s');
"
```

```bash
# 命令 1-4: Dashboard 条件构建（if 分支结构校验）
node -e "
  const lines=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  if(!/if[\s\S]{0,200}apps\/dashboard[\s\S]{0,300}(npm run build|npx vite build|pnpm.*build)/.test(lines))
    throw new Error('FAIL: dashboard 构建不在 if 条件分支内');
  console.log('PASS: Dashboard 条件构建结构正确');
"
```

---

## Feature 2: PR 自动 Merge

**行为描述**:
Harness 模式创建的 PR（通过 `harness` label 或 `cp-*` 分支前缀识别）在 CI 全部 pass 后自动 merge 到 main。非 Harness PR 不受影响，仍需人工 review。包含重试机制（失败后至少 1 次重试）。merge 失败时（如冲突），将失败状态回写 Brain 任务。

**硬阈值**:
- CI workflow 中包含 auto-merge step，仅对 harness label 的 PR 触发
- auto-merge 使用 `gh pr merge` 命令
- 包含重试机制（失败后至少 1 次重试）
- merge 失败时回写 Brain 任务状态（curl PATCH 在 auto-merge failure 路径内）

**验证命令**:
```bash
# 命令 2-1: CI 中存在 auto-merge step（排除注释行）
node -e "
  const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  if(!/auto-merge|auto_merge/.test(lines))
    throw new Error('FAIL: CI 无 auto-merge step');
  if(!/gh\s+pr\s+merge/.test(lines))
    throw new Error('FAIL: auto-merge 未使用 gh pr merge');
  console.log('PASS: CI auto-merge step 存在');
"
```

```bash
# 命令 2-2: auto-merge 仅对 harness label 触发
node -e "
  const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  if(!/auto.merge[\s\S]{0,500}(harness|contains.*label.*harness)/.test(lines) &&
     !/(harness|contains.*label.*harness)[\s\S]{0,500}auto.merge/.test(lines))
    throw new Error('FAIL: auto-merge 未限制为 harness label');
  console.log('PASS: auto-merge 限定 harness label');
"
```

```bash
# 命令 2-3: auto-merge 包含重试机制 — R4 新增（必须修改项 2）
node -e "
  const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  if(!/retry|RETRY|attempt|ATTEMPT|for\s+i\s+in|while.*merge/.test(lines))
    throw new Error('FAIL: auto-merge 无重试机制');
  console.log('PASS: auto-merge 包含重试逻辑');
"
```

```bash
# 命令 2-4: merge 失败时回写 Brain 任务状态 — R4 新增（必须修改项 3）
node -e "
  const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  if(!/auto.merge[\s\S]{0,2000}curl[\s\S]{0,100}(PATCH|patch)[\s\S]{0,200}(brain|tasks)/.test(lines) &&
     !/auto.merge[\s\S]{0,2000}(fail|error)[\s\S]{0,500}(brain|tasks|回写)/.test(lines))
    throw new Error('FAIL: auto-merge 失败后无 Brain 回写逻辑');
  console.log('PASS: auto-merge 失败有 Brain 回写');
"
```

---

## Feature 3: /dev Skill Harness 极简路径

**行为描述**:
当 /dev skill 以 Harness 模式启动（task_type 为 harness_generator 或检测到 harness 标记）时，跳过面向人类的交互步骤：Learning 文件生成、fire-learnings-event 事件、DoD 手动验证勾选、devloop-check 交互式确认、Stop Hook 用户确认。非 Harness 模式保持完整 4-Stage Pipeline 不变。

**硬阈值**:
- `04-ship.md` 包含 harness_mode 检测变量
- harness 路径跳过 Learning 文件写入 + fire-learnings-event 调用
- 非 harness 路径保留完整 Learning 流程（docs/learnings + fire-learnings-event）
- `devloop-check.sh`（排除注释行后）在 harness 模式下跳过交互确认
- `stop.sh`（排除注释行后）在 harness 模式下跳过用户确认

**验证命令**:
```bash
# 命令 3-1: 04-ship.md harness 双路径结构校验 — R4 修复：移除 "do not"（可选改进 2）
node -e "
  const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');
  if(!/harness_mode|harness.mode|HARNESS_MODE/.test(c))
    throw new Error('FAIL: 04-ship.md 无 harness_mode 检测');
  const hasSkipPath=/harness[\s\S]{0,500}(skip|跳过|不执行|省略|omit)[\s\S]{0,200}(learning|Learning)/i.test(c);
  const hasNormalPath=/docs\/learnings/.test(c) && /fire-learnings-event/.test(c);
  if(!hasSkipPath)
    throw new Error('FAIL: 无 harness 跳过 Learning 的明确指令');
  if(!hasNormalPath)
    throw new Error('FAIL: 非 harness 路径的 Learning 流程不完整');
  console.log('PASS: 04-ship.md harness 双路径结构完整');
"
```

```bash
# 命令 3-2: fire-learnings-event.sh 脚本存在（非 harness 路径必须调用）
node -e "
  require('fs').accessSync('packages/engine/skills/dev/scripts/fire-learnings-event.sh');
  console.log('PASS: fire-learnings-event.sh 存在');
"
```

```bash
# 命令 3-3: harness 模式明确跳过 fire-learnings-event — R4 修复：移除 "do not"（可选改进 2）
node -e "
  const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');
  if(!/harness[\s\S]{0,500}(skip|跳过|省略|omit)[\s\S]{0,200}fire-learnings-event/i.test(c) &&
     !/harness[\s\S]{0,500}(skip|跳过|省略|omit)[\s\S]{0,200}(learning|Learning)[\s\S]{0,200}fire-learnings/i.test(c))
    throw new Error('FAIL: harness 模式未明确跳过 fire-learnings-event');
  console.log('PASS: harness 模式跳过 fire-learnings-event');
"
```

```bash
# 命令 3-4: devloop-check.sh harness 模式跳过交互 — R4 修复：过滤注释行（必须修改项 1）
node -e "
  const lines=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  if(!/harness.*mode|_harness_mode|HARNESS_MODE/.test(lines))
    throw new Error('FAIL: devloop-check.sh 无 harness 模式检测（排除注释后）');
  console.log('PASS: devloop-check.sh 包含 harness 模式检测');
"
```

```bash
# 命令 3-5: stop.sh harness 模式跳过用户确认 — R4 修复：过滤注释行（必须修改项 1）
node -e "
  const lines=require('fs').readFileSync('packages/engine/hooks/stop.sh','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  if(!/harness.*mode|_harness_mode|HARNESS_MODE/.test(lines))
    throw new Error('FAIL: stop.sh 无 harness 模式检测（排除注释后）');
  console.log('PASS: stop.sh 包含 harness 模式检测');
"
```

---

## Feature 4: CI Harness 模式优化

**行为描述**:
CI workflow 对带 `harness` label 的 PR 跳过非关键 job（如 Learning Format Gate、PR Size Check），缩短 CI 反馈周期。核心 job（brain-unit、brain-integration、eslint、secrets-scan、e2e-smoke）不受影响，始终执行。ci-passed 汇总 job 使用 `if: always()` 确保被跳过的 job 不会阻塞合并判定。

**硬阈值**:
- CI 包含 harness 条件跳过逻辑（排除注释行后）
- 核心 job（brain-unit、brain-integration、eslint、secrets-scan、e2e-smoke）不被 harness skip 影响
- ci-passed job 包含 `if: always()`

**验证命令**:
```bash
# 命令 4-1: CI 包含 harness 条件跳过（排除注释行）
node -e "
  const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  if(!/if:[\s\S]{0,100}(harness|contains.*label)/.test(lines))
    throw new Error('FAIL: CI 无 harness 条件跳过（排除注释后）');
  console.log('PASS: CI 包含 harness 条件跳过');
"
```

```bash
# 命令 4-2: 核心 job 不受 harness skip 影响（排除注释行）
node -e "
  const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  const required=['brain-unit','brain-integration','eslint','secrets-scan','e2e-smoke'];
  for(const job of required){
    const re=new RegExp(job+':[\\\\s\\\\S]{0,500}(harness.*skip|!contains.*harness)','i');
    if(re.test(lines))
      throw new Error('FAIL: 核心 job '+job+' 被 harness skip 条件影响');
  }
  console.log('PASS: 核心 CI job 不受 harness skip 影响');
"
```

```bash
# 命令 4-3: ci-passed 有 if: always()
node -e "
  const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');
  if(!/ci-passed:[\s\S]{0,200}if:\s*always\(\)/.test(c))
    throw new Error('FAIL: ci-passed 缺少 if: always()，被跳过的 job 会阻塞合并');
  console.log('PASS: ci-passed 有 if: always()');
"
```

---

## Feature 5: 失败回写 Brain

**行为描述**:
CI 失败、merge 失败、部署失败等异常事件自动回写 Brain 任务状态。devloop-check 在 harness 模式下检测到失败时，通过 `curl -X PATCH /api/brain/tasks/{task_id}` 回写 `status=failed` 和 `error_message`。

**硬阈值**:
- `devloop-check.sh`（排除注释行后）包含 `curl -X PATCH /api/brain/tasks` 回写逻辑
- 回写逻辑在 harness 条件守卫内（_harness_mode 检查在 curl PATCH 之前 2000 字符内）
- `post-merge-deploy.sh` 部署失败时也有 Brain 回写

**验证命令**:
```bash
# 命令 5-1: devloop-check harness 失败回写（两步验证 + 2000字符窗口）
node -e "
  const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');
  if(!/curl[\s\S]{0,100}-X\s*PATCH[\s\S]{0,200}api\/brain\/tasks/.test(c))
    throw new Error('FAIL: 缺少 curl PATCH /api/brain/tasks 回写');
  const patchIdx=c.indexOf('PATCH');
  const beforePatch=c.substring(Math.max(0,patchIdx-2000),patchIdx);
  if(!/_harness_mode.*==.*true|harness_mode.*true/.test(beforePatch))
    throw new Error('FAIL: curl PATCH 之前 2000 字符内无 harness 条件检查');
  console.log('PASS: devloop-check harness 失败回写链路完整');
"
```

```bash
# 命令 5-2: post-merge-deploy.sh 部署失败回写
node -e "
  const lines=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  if(!/curl[\s\S]{0,100}-X\s*PATCH[\s\S]{0,200}api\/brain\/tasks/.test(lines))
    throw new Error('FAIL: post-merge-deploy.sh 缺少失败回写 Brain');
  console.log('PASS: 部署脚本包含 Brain 失败回写');
"
```

---

## Feature 6: Evaluator 时序对齐

**行为描述**:
PR merge 后，部署脚本完成并通过 health check 后，发出信号通知 Evaluator 可以开始验证。Evaluator 必须在新代码生效后才运行验证命令。信号机制通过 Brain 任务状态回写实现（deployed 状态）。

**硬阈值**:
- `post-merge-deploy.sh` 在部署成功后回写 Brain 任务状态为 deployed（或等效状态）
- 回写逻辑在 health check 通过之后执行

**验证命令**:
```bash
# 命令 6-1: 部署成功后回写 deployed 状态 — R4 修复：改用 lines.search 替代 indexOf（可选改进 1）
node -e "
  const lines=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  const healthIdx=lines.search(/curl[^;]*health/);
  if(healthIdx<0) throw new Error('FAIL: 无 health check 调用');
  const afterHealth=lines.substring(healthIdx);
  if(!/curl[\s\S]{0,1000}(deployed|DEPLOYED|deploy_success)/.test(afterHealth) &&
     !/curl[\s\S]{0,1000}PATCH[\s\S]{0,200}status/.test(afterHealth))
    throw new Error('FAIL: health check 之后 1000 字符内无部署成功回写');
  console.log('PASS: 部署成功后有状态回写');
"
```

```bash
# 命令 6-2: health check 在回写之前（时序正确）
node -e "
  const lines=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  const healthIdx=lines.search(/curl[^;]*health/);
  const deployedIdx=lines.search(/deployed|deploy_success|status.*completed/);
  if(healthIdx<0) throw new Error('FAIL: 无 health check');
  if(deployedIdx<0) throw new Error('FAIL: 无 deployed 状态回写');
  if(deployedIdx<healthIdx)
    throw new Error('FAIL: deployed 回写在 health check 之前，时序错误');
  console.log('PASS: health check → deployed 时序正确');
"
```

---

## Workstreams

workstream_count: 3

### Workstream 1: 部署自动化脚本

**范围**: `scripts/post-merge-deploy.sh`（新建）— Brain 重启 + health gate + 回退 + Dashboard 条件构建 + Evaluator 信号回写。不涉及 CI 或 /dev skill。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `scripts/post-merge-deploy.sh` 存在且可执行
  Test: node -e "const fs=require('fs');const st=fs.statSync('scripts/post-merge-deploy.sh');if(!(st.mode & 0o111))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 脚本排除注释后包含 health check 轮询（curl+循环）、Brain 重启（pm2/systemctl/brain-reload）、回退（git revert/reset）
  Test: node -e "const lines=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/curl[^;]*health/.test(lines))throw new Error('FAIL: 无 health check');if(!/while\b|for\b/.test(lines))throw new Error('FAIL: 无循环');if(!/git\s+(revert|reset)/.test(lines))throw new Error('FAIL: 无 rollback');if(!/pm2\s+restart|systemctl\s+restart|brain-reload/.test(lines))throw new Error('FAIL: 无 restart');console.log('PASS')"
- [ ] [BEHAVIOR] Health check 超时阈值 <= 60 秒
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');const m=c.match(/(?:timeout|TIMEOUT|max_wait|MAX_WAIT|HEALTH_TIMEOUT)[^=]*=\s*(\d+)/);if(!m)throw new Error('FAIL: 无超时变量');if(parseInt(m[1])>60)throw new Error('FAIL: 超过60s');console.log('PASS: '+m[1]+'s')"
- [ ] [BEHAVIOR] Dashboard 构建在 if 条件分支内（非无条件执行）
  Test: node -e "const lines=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/if[\s\S]{0,200}apps\/dashboard[\s\S]{0,300}(npm run build|npx vite build|pnpm.*build)/.test(lines))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 部署失败时回写 Brain 任务（curl PATCH /api/brain/tasks）
  Test: node -e "const lines=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/curl[\s\S]{0,100}-X\s*PATCH[\s\S]{0,200}api\/brain\/tasks/.test(lines))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] Health check 通过后回写 deployed 状态，时序在 health check 之后
  Test: node -e "const lines=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');const h=lines.search(/curl[^;]*health/);const d=lines.search(/deployed|deploy_success|status.*completed/);if(h<0)throw new Error('FAIL: 无health');if(d<0)throw new Error('FAIL: 无deployed');if(d<h)throw new Error('FAIL: 时序错');console.log('PASS')"

### Workstream 2: CI Harness 优化 + PR 自动 Merge

**范围**: `.github/workflows/ci.yml` 修改 — harness label 跳过非关键 job + auto-merge step（含重试 + 失败回写 Brain）+ ci-passed 保护。不涉及 /dev skill 或部署脚本。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] CI 包含 harness 条件跳过逻辑（排除注释行后可见）
  Test: node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/if:[\s\S]{0,100}(harness|contains.*label)/.test(lines))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 核心 job（brain-unit/brain-integration/eslint/secrets-scan/e2e-smoke）不被 harness skip 影响
  Test: node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');const r=['brain-unit','brain-integration','eslint','secrets-scan','e2e-smoke'];for(const j of r){if(new RegExp(j+':[\\\\s\\\\S]{0,500}(harness.*skip|!contains.*harness)','i').test(lines))throw new Error('FAIL: '+j);}console.log('PASS')"
- [ ] [BEHAVIOR] ci-passed job 包含 `if: always()`，防止被跳过的 job 阻塞合并
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/ci-passed:[\s\S]{0,200}if:\s*always\(\)/.test(c))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] auto-merge step 存在且使用 gh pr merge，限定 harness label
  Test: node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/gh\s+pr\s+merge/.test(lines))throw new Error('FAIL: 无 gh pr merge');if(!/auto.merge[\s\S]{0,500}harness|harness[\s\S]{0,500}auto.merge/.test(lines))throw new Error('FAIL: 未限定 harness');console.log('PASS')"
- [ ] [BEHAVIOR] auto-merge 包含重试机制（至少 1 次重试）
  Test: node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/retry|RETRY|attempt|ATTEMPT|for\s+i\s+in|while.*merge/.test(lines))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] merge 失败时回写 Brain 任务状态（curl PATCH 在 auto-merge failure 路径内）
  Test: node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/auto.merge[\s\S]{0,2000}curl[\s\S]{0,100}(PATCH|patch)[\s\S]{0,200}(brain|tasks)/.test(lines)&&!/auto.merge[\s\S]{0,2000}(fail|error)[\s\S]{0,500}(brain|tasks)/.test(lines))throw new Error('FAIL');console.log('PASS')"

### Workstream 3: /dev Skill Harness 极简路径 + 失败回写

**范围**: `packages/engine/skills/dev/steps/04-ship.md` + `packages/engine/lib/devloop-check.sh` + `packages/engine/hooks/stop.sh` — harness 模式条件分支。不涉及 CI 或部署脚本。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] 04-ship.md 包含 harness_mode 变量检测 + 跳过 Learning 路径 + 保留非 harness 完整 Learning 流程
  Test: node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');if(!/harness_mode|harness.mode|HARNESS_MODE/.test(c))throw new Error('FAIL: 无检测');const skip=/harness[\s\S]{0,500}(skip|跳过|不执行|省略|omit)[\s\S]{0,200}(learning|Learning)/i.test(c);const normal=/docs\/learnings/.test(c)&&/fire-learnings-event/.test(c);if(!skip)throw new Error('FAIL: 无跳过指令');if(!normal)throw new Error('FAIL: 非harness路径不完整');console.log('PASS')"
- [ ] [BEHAVIOR] harness 模式明确跳过 fire-learnings-event 调用
  Test: node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');if(!/harness[\s\S]{0,500}(skip|跳过|省略|omit)[\s\S]{0,200}fire-learnings-event/i.test(c)&&!/harness[\s\S]{0,500}(skip|跳过|省略|omit)[\s\S]{0,200}(learning|Learning)[\s\S]{0,200}fire-learnings/i.test(c))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] devloop-check.sh（排除注释后）包含 harness 模式检测
  Test: node -e "const lines=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/harness.*mode|_harness_mode|HARNESS_MODE/.test(lines))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] devloop-check.sh harness 失败回写 Brain（curl PATCH 在 _harness_mode 守卫内，2000 字符窗口）
  Test: node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');if(!/curl[\s\S]{0,100}-X\s*PATCH[\s\S]{0,200}api\/brain\/tasks/.test(c))throw new Error('FAIL: 无PATCH');const i=c.indexOf('PATCH');const b=c.substring(Math.max(0,i-2000),i);if(!/_harness_mode.*==.*true|harness_mode.*true/.test(b))throw new Error('FAIL: 无守卫');console.log('PASS')"
- [ ] [BEHAVIOR] stop.sh（排除注释后）包含 harness 模式检测
  Test: node -e "const lines=require('fs').readFileSync('packages/engine/hooks/stop.sh','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/harness.*mode|_harness_mode|HARNESS_MODE/.test(lines))throw new Error('FAIL');console.log('PASS')"
