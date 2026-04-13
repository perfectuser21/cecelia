# Contract Review Feedback (Round 2)

> R2 草案比 R1 有显著改进：ENOENT 漏洞已修复、关键词匹配已升级为功能性结构校验、时序问题已重设计。
> 但仍有 7/16 条验证命令可被假实现绕过（43.75%），且存在 2 个 PRD 承诺的行为未被任何命令覆盖。

---

## 必须修改项

### 1. [命令太弱] Feature 1 命令 2 — regex 匹配注释/死代码

**原始命令**:
```bash
node -e "
  const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');
  if(!/curl[^;]*health/.test(c)) throw new Error('FAIL: 无 curl health check 调用');
  if(!/while\b|for\b/.test(c)) throw new Error('FAIL: 无循环轮询结构');
  if(!/git\s+(revert|reset)/.test(c)) throw new Error('FAIL: rollback 无 git revert/reset');
  if(!/pm2\s+restart|systemctl\s+restart|brain-reload|pkill.*node/.test(c)) throw new Error('FAIL: 无 Brain 重启命令');
  ..."
```

**假实现片段**（proof-of-falsification）:
```bash
#!/bin/bash
# post-merge-deploy.sh — 假实现
# curl http://localhost:5221/health  （注释中含关键词）
# while true; do break; done  （注释中含循环）
# git revert HEAD  （注释中含 rollback）
# pm2 restart brain  （注释中含重启）
echo "deployed"
```

**建议修复命令**:
```bash
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
> 注意：同时从白名单中移除 `pkill.*node`——它会杀死所有 Node 进程，应限制为 `pm2 restart|systemctl restart|brain-reload`。

### 2. [命令太弱] Feature 2 命令 1 — 距离启发式无法验证条件分支

**原始命令**:
```bash
node -e "
  ...
  const dashIdx=c.indexOf('apps/dashboard');
  const buildIdx=c.indexOf('build',dashIdx);
  if(buildIdx<0 || buildIdx-dashIdx>500)
    throw new Error('FAIL: dashboard 检测与构建命令距离过远，可能非条件触发');
  ..."
```

**假实现片段**（proof-of-falsification）:
```bash
#!/bin/bash
echo "Checking apps/dashboard changes..."  # dashIdx 在这里
npm run build  # buildIdx 距离 < 500，但不在 if 分支内——无条件执行
```

**建议修复命令**:
```bash
node -e "
  const lines=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  // 必须有 if + apps/dashboard + then + build 的结构
  if(!/if[\s\S]{0,200}apps\/dashboard[\s\S]{0,300}(npm run build|npx vite build|pnpm.*build)/.test(lines))
    throw new Error('FAIL: dashboard 构建不在 if 条件分支内');
  console.log('PASS: Dashboard 条件构建结构正确');
"
```

### 3. [PRD 遗漏] Feature 3 — 未验证跳过 fire-learnings-event

**原始命令**: 命令 3-1 只验证了跳过 Learning 文件写入

**假实现片段**（proof-of-falsification）:
```markdown
<!-- 04-ship.md 假实现 -->
## Harness 模式
如果 harness_mode=true，skip Learning 文件生成。

## 4.1 写 Learning（仍然调用 fire-learnings-event）
bash skills/dev/scripts/fire-learnings-event.sh --branch ...
```
上述实现通过命令 3-1（含 harness+skip+learning），也通过命令 3-2（fire-learnings-event 存在），但 fire-learnings-event 在 harness 模式下仍会被调用——违反行为描述。

**建议修复命令**（追加为命令 3-3）:
```bash
node -e "
  const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');
  // harness 条件分支必须同时覆盖 fire-learnings-event 的跳过
  if(!/harness[\s\S]{0,500}(skip|跳过)[\s\S]{0,200}fire-learnings-event/i.test(c) &&
     !/harness[\s\S]{0,500}(skip|跳过)[\s\S]{0,200}(learning|Learning)[\s\S]{0,200}fire-learnings/i.test(c))
    throw new Error('FAIL: harness 模式未明确跳过 fire-learnings-event');
  console.log('PASS: harness 模式跳过 fire-learnings-event');
"
```

### 4. [PRD 遗漏] Feature 4 — ci-passed 汇总 job 处理跳过的 job 未验证

**原始命令**: 无（硬阈值中声明但无验证命令）

**假实现片段**（proof-of-falsification）:
```yaml
# ci.yml — 假实现：pr-size-check 被跳过，但 ci-passed 依赖它且无 if: always()
pr-size-check:
  if: "!contains(github.event.pull_request.labels.*.name, 'harness')"
  ...

ci-passed:
  needs: [secrets-scan, pr-size-check, ...]  # pr-size-check 被跳过 → ci-passed 永远不运行
  # 缺少 if: always()
```

**建议修复命令**（追加为命令 4-3）:
```bash
node -e "
  const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');
  // ci-passed job 必须有 if: always()，否则被跳过的依赖会导致它不运行
  if(!/ci-passed:[\s\S]{0,200}if:\s*always\(\)/.test(c))
    throw new Error('FAIL: ci-passed 缺少 if: always()，被跳过的 job 会阻塞合并');
  console.log('PASS: ci-passed 有 if: always()');
"
```
> 注：当前 ci.yml 已有 `if: always()`（第 567 行），但合同必须验证 Generator 不会破坏它。

### 5. [命令太弱] Feature 4 命令 1+2 — 全文 regex 误配风险

**原始命令 4-1**:
```bash
node -e "
  const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');
  if(!/if:[\s\S]{0,100}(harness|contains.*label)/.test(c) && ...)
    throw new Error('FAIL');
"
```

**原始命令 4-2**:
```bash
node -e "
  ...
  const re=new RegExp(job+':[\\s\\S]{0,200}harness.*skip','i');
  if(re.test(c)) throw new Error('FAIL: 核心 job '+job+' 被影响');
"
```

**假实现片段**（proof-of-falsification）:
```yaml
# 命令 4-1 绕过：注释中含 if: contains label harness
# if: "!contains(github.event.pull_request.labels.*.name, 'harness')"

# 命令 4-2 绕过：brain-unit 后 250 字符处有 harness skip（超出 200 窗口）
brain-unit:
  needs: changes
  if: needs.changes.outputs.brain == 'true'  # 200字符以内无 harness
  # ... 50 extra characters of yaml steps ...
  # harness skip applied here  # 在 250 字符处，超出检测窗口
```

**建议修复命令**:
```bash
# 命令 4-1 修复：排除注释行
node -e "
  const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8')
    .split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');
  if(!/if:[\s\S]{0,100}(harness|contains.*label)/.test(lines))
    throw new Error('FAIL: CI 无 harness 条件跳过（排除注释后）');
  console.log('PASS: CI 包含 harness 条件跳过');
"

# 命令 4-2 修复：扩大核心 job 保护窗口到 500 字符
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

### 6. [命令太弱] Feature 5 命令 1 — 500 字符窗口对大脚本太窄

**原始命令**:
```bash
node -e "
  ...
  if(!/harness[\s\S]{0,500}curl[\s\S]{0,100}PATCH|_harness_mode[\s\S]{0,500}curl[\s\S]{0,100}PATCH/.test(c))
    throw new Error('FAIL: Brain 回写不在 harness 条件分支内');
"
```

**假实现片段**（proof-of-falsification）:
```bash
# devloop-check.sh 当前已有 326 行。新增 harness 失败回写逻辑后，
# _harness_mode 变量在第 85 行设置，curl PATCH 可能在第 250 行（某个函数内）
# 两者间距 > 500 字符，regex 匹配失败
_harness_mode="true"  # 行 85
# ... 600 字符的现有逻辑 ...
if [[ "$_harness_mode" == "true" ]]; then
  curl -X PATCH localhost:5221/api/brain/tasks/$TASK_ID  # 行 250
fi
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');
  // 分两步验证：(1) 存在 curl PATCH brain/tasks (2) 存在 harness 条件守卫
  if(!/curl[\s\S]{0,100}-X\s*PATCH[\s\S]{0,200}api\/brain\/tasks/.test(c))
    throw new Error('FAIL: 缺少 curl PATCH /api/brain/tasks 回写');
  // harness 守卫：_harness_mode 变量在 curl 之前被检查
  const patchIdx=c.indexOf('PATCH');
  const beforePatch=c.substring(Math.max(0,patchIdx-2000),patchIdx);
  if(!/_harness_mode.*==.*true|harness_mode.*true/.test(beforePatch))
    throw new Error('FAIL: curl PATCH 之前 2000 字符内无 harness 条件检查');
  console.log('PASS: devloop-check harness 失败回写链路完整');
"
```

### 7. [命令太弱] Feature 3 命令 1 — regex 可被注释/描述文本满足

**原始命令**:
```bash
node -e "
  ...
  if(!/harness[\s\S]{0,300}(skip|跳过)[\s\S]{0,100}(learning|Learning)/i.test(c) &&
     !/if.*harness[\s\S]{0,200}learning/i.test(c))
    throw new Error('FAIL');
"
```

**假实现片段**（proof-of-falsification）:
```markdown
<!-- 04-ship.md 中的纯描述文本 -->
> 注意：harness_mode 下应该 skip Learning 相关步骤
<!-- 但下方的实际步骤完全没有条件分支 -->
## 4.1 写 Learning
mkdir -p docs/learnings
git add "$LEARNING_FILE"
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');
  // 必须有代码块内的条件分支（不只是描述文本）
  // 检查 harness_mode 出现在代码块（``` 包裹）或条件指令中
  if(!/harness_mode|harness.mode|HARNESS_MODE/.test(c))
    throw new Error('FAIL: 04-ship.md 无 harness_mode 检测');
  // 必须同时有「harness 跳过」和「非 harness 保留」的双路径结构
  const hasSkipPath=/harness[\s\S]{0,500}(skip|跳过|不执行|do not)[\s\S]{0,200}(learning|Learning)/i.test(c);
  const hasNormalPath=/docs\/learnings/.test(c) && /fire-learnings-event/.test(c);
  if(!hasSkipPath)
    throw new Error('FAIL: 无 harness 跳过 Learning 的明确指令');
  if(!hasNormalPath)
    throw new Error('FAIL: 非 harness 路径的 Learning 流程不完整');
  console.log('PASS: 04-ship.md harness 双路径结构完整');
"
```

---

## 可选改进

1. **Feature 1 硬阈值**: "Health check 超时阈值 <= 60 秒"已声明但未被任何命令验证。建议增加：`node -e "const c=...readFileSync(...);const m=c.match(/(?:timeout|TIMEOUT|max_wait).*?(\d+)/);if(!m||parseInt(m[1])>60)throw new Error('FAIL')"`
2. **Feature 6 命令 1**: `afterMerge` 变量中的 harness 条件检查窗口 300 字符偏小，建议扩大到 1000。
3. **Workstream 2 DoD**: 缺少 Feature 4 中 ci-passed `if: always()` 保护的 DoD 条目——应新增一条 `[BEHAVIOR]` 确保 ci-passed 不被跳过的 job 阻塞。
