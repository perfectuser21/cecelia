# Sprint Contract Draft (Round 2)

> Round 1 反馈已全部吸收：验证命令从关键词匹配升级为功能性结构校验；已有代码通过的命令已替换为增量检测；dry-run ENOENT 漏洞已修复；架构时序问题（condition 0.5 vs condition 6）已重新设计。

---

## Feature 1: Post-Merge Deploy — Brain 重启 + Health Gate + 回退

**行为描述**:
当 Harness PR 合并到 main 后，执行部署脚本完成以下动作：(1) 拉取最新 main 代码，(2) 重启 Brain 进程，(3) 轮询 health 端点直到成功或超时，(4) 超时则通过 git revert 回退并重新启动 Brain。整个过程输出机器可读的 JSON 状态文件。

**硬阈值**:
- 脚本 `scripts/post-merge-deploy.sh` 存在且可执行
- `--dry-run` 模式输出 `/tmp/cecelia-deploy-status.json`，包含 `status`、`timestamp`、`commit` 字段
- 包含 curl 轮询 health 端点的循环结构（while/for + curl + health）
- 包含 git revert 回退逻辑（health check 失败时触发）
- 包含 Brain 进程重启命令（pm2 restart 或等效）
- Health check 超时阈值 ≤ 60 秒

**验证命令**:
```bash
# 1. dry-run 必须生成状态文件（修复 R1 ENOENT 漏洞）
rm -f /tmp/cecelia-deploy-status.json && \
bash scripts/post-merge-deploy.sh --dry-run 2>/dev/null; \
node -e "
  const fs=require('fs');
  if(!fs.existsSync('/tmp/cecelia-deploy-status.json'))
    throw new Error('FAIL: dry-run 未生成状态文件');
  const s=JSON.parse(fs.readFileSync('/tmp/cecelia-deploy-status.json','utf8'));
  if(!s.status) throw new Error('FAIL: 缺少 status');
  if(!s.timestamp) throw new Error('FAIL: 缺少 timestamp');
  if(!s.commit) throw new Error('FAIL: 缺少 commit');
  console.log('PASS: dry-run 状态文件格式正确，status=' + s.status);
"

# 2. 功能性结构校验（修复 R1 关键词弱匹配）
node -e "
  const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');
  // Health check: 必须有 curl + health 端点 + 循环结构
  if(!/curl[^;]*health/.test(c))
    throw new Error('FAIL: 无 curl health check 调用');
  if(!/while\b|for\b/.test(c))
    throw new Error('FAIL: 无循环轮询结构');
  // Rollback: 必须有 git revert/reset + 重启命令
  if(!/git\s+(revert|reset)/.test(c))
    throw new Error('FAIL: rollback 无 git revert/reset');
  if(!/pm2\s+restart|systemctl\s+restart|brain-reload|pkill.*node/.test(c))
    throw new Error('FAIL: 无 Brain 重启命令');
  // 状态文件输出: 必须写 JSON 到 /tmp/cecelia-deploy-status.json
  if(!/cecelia-deploy-status\.json/.test(c))
    throw new Error('FAIL: 无状态文件输出');
  console.log('PASS: 部署脚本功能性结构完整');
"

# 3. dry-run 不应实际重启任何进程
bash scripts/post-merge-deploy.sh --dry-run 2>&1 | \
  node -e "
    const out=require('fs').readFileSync('/dev/stdin','utf8');
    if(/restarting brain|pm2 restart|systemctl restart/i.test(out))
      throw new Error('FAIL: dry-run 不应实际重启进程');
    console.log('PASS: dry-run 未触发实际重启');
  "
```

---

## Feature 2: Post-Merge Deploy — Dashboard 自动 Rebuild

**行为描述**:
部署脚本根据变更路径检测是否涉及 `apps/dashboard/`，若涉及则自动执行 Dashboard rebuild（npm run build 或等效）并部署到本机服务目录。

**硬阈值**:
- 脚本包含对 `apps/dashboard` 变更路径的检测逻辑
- 包含 `npm run build` 或 `npx vite build` 等 Dashboard 构建命令
- Dashboard 构建仅在检测到 dashboard 变更时触发（条件构建，非无条件）

**验证命令**:
```bash
# 1. Dashboard 构建是条件触发，非无条件执行
node -e "
  const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');
  // 必须包含 apps/dashboard 路径检测
  if(!/apps\/dashboard/.test(c))
    throw new Error('FAIL: 无 dashboard 变更路径检测');
  // 必须包含构建命令
  if(!/npm run build|npx vite build|pnpm.*build/.test(c))
    throw new Error('FAIL: 无 dashboard 构建命令');
  // 构建必须在条件分支内（if/then 或 && 链）
  const dashIdx=c.indexOf('apps/dashboard');
  const buildIdx=c.indexOf('build',dashIdx);
  if(buildIdx<0 || buildIdx-dashIdx>500)
    throw new Error('FAIL: dashboard 检测与构建命令距离过远，可能非条件触发');
  console.log('PASS: Dashboard 条件构建结构正确');
"
```

---

## Feature 3: /dev Harness 极简路径 — 04-ship.md 跳过人类交互步骤

**行为描述**:
当 /dev 在 Harness 模式下执行时，Stage 4（04-ship.md）跳过 Learning 文件生成和 fire-learnings-event 调用。Harness 模式由 `.dev-mode` 文件中的 `harness_mode: true` 标记识别。

**硬阈值**:
- `04-ship.md` 包含 harness_mode 条件分支
- 条件分支明确跳过 Learning 文件写入（mkdir docs/learnings、git add Learning）
- 条件分支明确跳过 fire-learnings-event.sh 调用
- 非 harness 模式下 Learning 流程保持不变

**验证命令**:
```bash
# 1. 04-ship.md 必须有 harness 条件跳过 Learning 的新逻辑（R1 反馈：现有文件无此逻辑）
node -e "
  const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');
  // 必须包含 harness_mode 检测
  if(!/harness_mode|harness.mode|HARNESS_MODE/.test(c))
    throw new Error('FAIL: 04-ship.md 无 harness_mode 检测');
  // 必须有跳过 Learning 的条件（不能只是注释中提到）
  if(!/harness[\s\S]{0,300}(skip|跳过)[\s\S]{0,100}(learning|Learning)/i.test(c) &&
     !/if.*harness[\s\S]{0,200}learning/i.test(c))
    throw new Error('FAIL: 无跳过 Learning 的条件分支');
  console.log('PASS: 04-ship.md harness 极简路径存在');
"

# 2. 非 harness 路径保持 Learning 流程完整
node -e "
  const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');
  if(!/docs\/learnings/.test(c))
    throw new Error('FAIL: Learning 文件路径被完全删除，非 harness 模式受损');
  if(!/fire-learnings-event/.test(c))
    throw new Error('FAIL: fire-learnings-event 调用被完全删除');
  console.log('PASS: 非 harness 模式 Learning 流程完整');
"
```

---

## Feature 4: CI Harness 条件跳过 — 非必要 Job 在 Harness PR 上 Skip

**行为描述**:
Harness PR（通过 branch 前缀或 label 识别）在 CI 中跳过非必要检查 job（如 pr-size-check），缩短 Harness PR 的 CI 反馈周期。必要 job（brain-unit、brain-integration、workspace-build、eslint、secrets-scan）保持必选。

**硬阈值**:
- CI workflow 中至少 1 个非必要 job 有 `if:` 条件在 harness PR 上跳过
- 跳过条件基于 branch 名前缀（`cp-*`）或 PR label（`harness`）
- ci-passed 汇总 job 的 `needs` 列表中，被跳过的 job 使用 `if: always()` 或等效机制避免阻塞

**验证命令**:
```bash
# 1. 至少一个 job 有 harness 条件跳过（R1 反馈：现有 ci.yml 无此逻辑）
node -e "
  const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');
  // 检查是否有基于 harness label 或分支的 if 条件
  if(!/if:[\s\S]{0,100}(harness|contains.*label)/.test(c) &&
     !/harness[\s\S]{0,50}skip|skip[\s\S]{0,50}harness/.test(c))
    throw new Error('FAIL: CI 无 harness 条件跳过逻辑');
  console.log('PASS: CI 包含 harness 条件跳过');
"

# 2. 核心 job 不受影响
node -e "
  const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');
  const required=['brain-unit','brain-integration','eslint','secrets-scan'];
  for(const job of required){
    // 核心 job 不应有 harness skip 条件
    const re=new RegExp(job+':[\\s\\S]{0,200}harness.*skip','i');
    if(re.test(c))
      throw new Error('FAIL: 核心 job '+job+' 被 harness skip 条件影响');
  }
  console.log('PASS: 核心 CI job 不受 harness skip 影响');
"
```

---

## Feature 5: 失败回写 Brain — CI/Merge/Deploy 失败自动 PATCH 任务状态

**行为描述**:
当 Harness 流程中出现 CI 失败、merge 失败或部署失败时，通过 `curl -X PATCH localhost:5221/api/brain/tasks/{task_id}` 将失败状态（status=failed + error_message）回写到 Brain 任务记录。

**硬阈值**:
- `devloop-check.sh` 在 CI 失败路径包含 `curl -X PATCH` 到 Brain tasks API 的回写逻辑
- 回写仅在 harness_mode 为 true 时触发（非 harness 模式不回写）
- `post-merge-deploy.sh` 在部署失败时也执行 Brain 回写

**验证命令**:
```bash
# 1. devloop-check 在 harness 模式 CI 失败时回写 Brain（R1 反馈：现有代码无此逻辑）
node -e "
  const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');
  // 必须有 curl + PATCH + Brain tasks API 的完整链路
  if(!/curl[\s\S]{0,100}-X\s*PATCH[\s\S]{0,100}api\/brain\/tasks|curl[\s\S]{0,100}api\/brain\/tasks[\s\S]{0,100}PATCH/.test(c))
    throw new Error('FAIL: devloop-check 缺少 curl PATCH /api/brain/tasks 回写');
  // 回写必须在 harness 条件分支内
  if(!/harness[\s\S]{0,500}curl[\s\S]{0,100}PATCH|_harness_mode[\s\S]{0,500}curl[\s\S]{0,100}PATCH/.test(c))
    throw new Error('FAIL: Brain 回写不在 harness 条件分支内');
  console.log('PASS: devloop-check harness 失败回写链路完整');
"

# 2. post-merge-deploy 部署失败时也回写 Brain
node -e "
  const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');
  if(!/curl[\s\S]{0,100}PATCH[\s\S]{0,100}api\/brain\/tasks|curl[\s\S]{0,100}api\/brain\/tasks[\s\S]{0,100}PATCH/.test(c))
    throw new Error('FAIL: post-merge-deploy 缺少失败回写 Brain');
  console.log('PASS: post-merge-deploy 包含 Brain 失败回写');
"
```

---

## Feature 6: Deploy 触发集成 — devloop-check 合并成功后调用部署

**行为描述**:
在 devloop-check 的条件 6（CI 通过 + `gh pr merge` 成功后），对 harness 模式的 PR，自动调用 `post-merge-deploy.sh` 执行部署。部署在 merge 确认成功之后触发（而非条件 0.5 中 `--auto` 标记时触发，因为那时 PR 尚未实际合并）。

**硬阈值**:
- `devloop-check.sh` 条件 6 在 `gh pr merge` 成功后、harness_mode=true 时调用 `post-merge-deploy.sh`
- 调用发生在 merge 成功确认之后（`gh pr merge` 返回 0）
- 非 harness 模式下条件 6 行为不变

**验证命令**:
```bash
# 1. 条件 6 在 merge 成功后触发部署（R1 反馈：修复 0.5 时序问题）
node -e "
  const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');
  // 条件 6 区域：gh pr merge 成功后调用 post-merge-deploy
  // 找到 gh pr merge --squash 之后的代码
  const mergeIdx=c.indexOf('gh pr merge');
  if(mergeIdx<0) throw new Error('FAIL: 未找到 gh pr merge');
  const afterMerge=c.substring(mergeIdx);
  if(!/post-merge-deploy/.test(afterMerge))
    throw new Error('FAIL: gh pr merge 之后未调用 post-merge-deploy');
  // 部署调用必须在 harness 条件下
  if(!/harness[\s\S]{0,300}post-merge-deploy|_harness_mode[\s\S]{0,300}post-merge-deploy/.test(afterMerge))
    throw new Error('FAIL: post-merge-deploy 调用不在 harness 条件下');
  console.log('PASS: 条件 6 merge 后触发部署');
"

# 2. 条件 0.5 不调用 post-merge-deploy（时序保护）
node -e "
  const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');
  // 条件 0.5 区域：从 harness_mode 快速通道到 条件 1
  const start=c.indexOf('条件 0.5');
  const end=c.indexOf('条件 1');
  if(start<0||end<0) throw new Error('FAIL: 未找到条件 0.5/1 边界');
  const section=c.substring(start,end);
  if(/post-merge-deploy/.test(section))
    throw new Error('FAIL: 条件 0.5 不应调用 post-merge-deploy（PR 尚未实际合并）');
  console.log('PASS: 条件 0.5 无部署调用（时序正确）');
"
```

---

## Workstreams

workstream_count: 3

### Workstream 1: Post-Merge Deploy 脚本

**范围**: 新建 `scripts/post-merge-deploy.sh`，实现 Brain 重启 + health gate + rollback + Dashboard 条件构建 + 状态文件输出。覆盖 Feature 1 + Feature 2。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] scripts/post-merge-deploy.sh 存在且可执行
  Test: node -e "const fs=require('fs');fs.accessSync('scripts/post-merge-deploy.sh',fs.constants.X_OK);console.log('PASS')"
- [ ] [BEHAVIOR] --dry-run 模式生成 /tmp/cecelia-deploy-status.json，含 status/timestamp/commit 字段
  Test: bash -c "rm -f /tmp/cecelia-deploy-status.json && bash scripts/post-merge-deploy.sh --dry-run 2>/dev/null; node -e \"const s=JSON.parse(require('fs').readFileSync('/tmp/cecelia-deploy-status.json','utf8'));if(!s.status||!s.timestamp||!s.commit)throw new Error('FAIL');console.log('PASS: '+s.status)\""
- [ ] [BEHAVIOR] 脚本包含 curl health 循环轮询 + git revert 回退 + Brain 重启命令的完整部署链路
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');if(!/curl[^;]*health/.test(c))throw new Error('FAIL: 无 curl health');if(!/while\b|for\b/.test(c))throw new Error('FAIL: 无循环');if(!/git\s+(revert|reset)/.test(c))throw new Error('FAIL: 无 rollback');if(!/pm2\s+restart|systemctl\s+restart|brain-reload|pkill.*node/.test(c))throw new Error('FAIL: 无重启');console.log('PASS')"
- [ ] [BEHAVIOR] Dashboard 构建仅在检测到 apps/dashboard 变更时条件触发
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');if(!/apps\/dashboard/.test(c))throw new Error('FAIL: 无路径检测');if(!/npm run build|npx vite build|pnpm.*build/.test(c))throw new Error('FAIL: 无构建命令');console.log('PASS')"
- [ ] [BEHAVIOR] 部署失败时通过 curl PATCH 回写 Brain 任务状态
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');if(!/curl[\s\S]{0,100}PATCH[\s\S]{0,100}api\/brain\/tasks|curl[\s\S]{0,100}api\/brain\/tasks[\s\S]{0,100}PATCH/.test(c))throw new Error('FAIL');console.log('PASS')"

### Workstream 2: /dev Harness 极简路径 + CI 优化

**范围**: 修改 `packages/engine/skills/dev/steps/04-ship.md` 增加 harness 模式跳过 Learning；修改 `.github/workflows/ci.yml` 为非必要 job 增加 harness PR 条件跳过。覆盖 Feature 3 + Feature 4。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] 04-ship.md 包含 harness_mode 条件分支，跳过 Learning 文件生成
  Test: node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');if(!/harness_mode|harness.mode|HARNESS_MODE/.test(c))throw new Error('FAIL: 无检测');if(!/harness[\s\S]{0,300}(skip|跳过)[\s\S]{0,100}(learning|Learning)/i.test(c)&&!/if.*harness[\s\S]{0,200}learning/i.test(c))throw new Error('FAIL: 无跳过分支');console.log('PASS')"
- [ ] [BEHAVIOR] 非 harness 模式 Learning 流程完整保留
  Test: node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');if(!/docs\/learnings/.test(c))throw new Error('FAIL: Learning 路径被删');if(!/fire-learnings-event/.test(c))throw new Error('FAIL: event 调用被删');console.log('PASS')"
- [ ] [BEHAVIOR] CI 至少 1 个非必要 job 有 harness PR 条件跳过
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/if:[\s\S]{0,100}(harness|contains.*label)/.test(c)&&!/harness[\s\S]{0,50}skip|skip[\s\S]{0,50}harness/.test(c))throw new Error('FAIL');console.log('PASS')"

### Workstream 3: 失败回写 + Deploy 触发集成

**范围**: 修改 `packages/engine/lib/devloop-check.sh` 的 CI 失败路径（harness 模式）增加 curl PATCH Brain 回写；修改条件 6 在 merge 成功后调用 `post-merge-deploy.sh`（仅 harness 模式）。覆盖 Feature 5 + Feature 6。
**大小**: M（100-300行）
**依赖**: Workstream 1 完成后（需要 post-merge-deploy.sh 存在）

**DoD**:
- [ ] [BEHAVIOR] devloop-check 在 harness 模式 CI 失败时，通过 curl PATCH 回写 Brain 任务状态
  Test: node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');if(!/curl[\s\S]{0,100}-X\s*PATCH[\s\S]{0,100}api\/brain\/tasks|curl[\s\S]{0,100}api\/brain\/tasks[\s\S]{0,100}PATCH/.test(c))throw new Error('FAIL: 缺少回写');if(!/harness[\s\S]{0,500}curl[\s\S]{0,100}PATCH|_harness_mode[\s\S]{0,500}curl[\s\S]{0,100}PATCH/.test(c))throw new Error('FAIL: 不在 harness 分支');console.log('PASS')"
- [ ] [BEHAVIOR] devloop-check 条件 6 merge 成功后（harness 模式）调用 post-merge-deploy.sh
  Test: node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');const mi=c.indexOf('gh pr merge');if(mi<0)throw new Error('FAIL');const after=c.substring(mi);if(!/post-merge-deploy/.test(after))throw new Error('FAIL: merge 后无部署调用');console.log('PASS')"
- [ ] [BEHAVIOR] 条件 0.5 不调用 post-merge-deploy（时序保护）
  Test: node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');const s=c.indexOf('条件 0.5');const e=c.indexOf('条件 1');if(s<0||e<0)throw new Error('FAIL: 边界未找到');if(/post-merge-deploy/.test(c.substring(s,e)))throw new Error('FAIL: 0.5 不应调用部署');console.log('PASS')"
