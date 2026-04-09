# Sprint Contract Draft (Round 1)

> Sprint: harness-self-check-v1  
> PRD: Harness Pipeline 自检：三处系统性缺陷修复  
> Proposer: d462e6b3

---

## Feature 1: Reviewer 新增 CI 白名单强制检查

**行为描述**:  
Reviewer 在审查合同时，若发现任何 Feature 的验证命令含有 `grep`/`ls`/`cat`/`sed`/`echo`，
则该合同**必须**判定为 REVISION，禁止 APPROVED。
只允许 `node`/`npm`/`curl`/`bash`/`psql` 出现在 Test 字段。

**硬阈值**:
- `harness-contract-reviewer/SKILL.md` 的 REVISION 条件中，明确列出 "Test 命令含 grep/ls/cat/sed/echo → REVISION" 规则
- `harness-contract-reviewer/SKILL.md` 的 APPROVED 条件中，明确要求 "Test 命令只使用 node/npm/curl/bash/psql"
- 原有"全是 curl"弱检查保留，新增白名单检查作为独立条目

**验证命令**:
```bash
# Happy path: Reviewer SKILL.md 含有白名单关键词
node -e "
  const c = require('fs').readFileSync(
    'packages/workflows/skills/harness-contract-reviewer/SKILL.md', 'utf8'
  );
  if (!c.includes('grep') || !c.includes('REVISION')) {
    throw new Error('FAIL: 未找到 grep 相关 REVISION 规则');
  }
  if (!c.includes('node') && !c.includes('npm') && !c.includes('psql')) {
    throw new Error('FAIL: 未找到 CI 白名单允许工具');
  }
  console.log('PASS: Reviewer SKILL.md 含有 CI 白名单规则');
"

# 边界路径: APPROVED 条件必须包含白名单限制
node -e "
  const c = require('fs').readFileSync(
    'packages/workflows/skills/harness-contract-reviewer/SKILL.md', 'utf8'
  );
  const approvedSection = c.split('**APPROVED 条件**')[1];
  if (!approvedSection) throw new Error('FAIL: 找不到 APPROVED 条件区块');
  if (!approvedSection.includes('node') && !approvedSection.includes('psql')) {
    throw new Error('FAIL: APPROVED 条件未列出白名单工具');
  }
  console.log('PASS: APPROVED 条件包含白名单约束');
"
```

---

## Feature 2: contract-dod-ws{N}.md 路径统一到 sprint_dir

**行为描述**:  
Proposer 把 `contract-dod-ws{N}.md` 写入 `${SPRINT_DIR}/contract-dod-ws{N}.md`（而非仓库根目录）。  
Generator 从 `${CONTRACT_BRANCH}:${SPRINT_DIR}/contract-dod-ws{N}.md` 读取。  
CI `harness-dod-integrity` job 也从 `${SPRINT_DIR}/contract-dod-ws${WS_INDEX}.md` 获取合同 DoD。

**硬阈值**:
- Proposer SKILL.md 中 `cat > "contract-dod-ws1.md"` 改为 `cat > "${SPRINT_DIR}/contract-dod-ws1.md"`
- Proposer SKILL.md `git add` 行中 `contract-dod-ws*.md` 改为 `${SPRINT_DIR}/contract-dod-ws*.md`
- Generator SKILL.md `git show "...:contract-dod-ws${WS_IDX}.md"` 改为 `git show "...:${SPRINT_DIR}/contract-dod-ws${WS_IDX}.md"`
- ci.yml `git show "...:contract-dod-ws${WS_INDEX}.md"` 改为 `git show "...:${SPRINT_DIR}/contract-dod-ws${WS_INDEX}.md"`

**验证命令**:
```bash
# Happy path: Proposer SKILL.md 已使用 sprint_dir 前缀
node -e "
  const c = require('fs').readFileSync(
    'packages/workflows/skills/harness-contract-proposer/SKILL.md', 'utf8'
  );
  if (c.includes('cat > \"contract-dod-ws')) {
    throw new Error('FAIL: Proposer 仍在使用根目录路径（无 SPRINT_DIR 前缀）');
  }
  if (!c.includes('SPRINT_DIR}/contract-dod-ws')) {
    throw new Error('FAIL: Proposer 未使用 SPRINT_DIR 前缀');
  }
  console.log('PASS: Proposer 已使用 SPRINT_DIR/contract-dod-ws 路径');
"

# Generator 路径验证
node -e "
  const c = require('fs').readFileSync(
    'packages/workflows/skills/harness-generator/SKILL.md', 'utf8'
  );
  const lines = c.split('\n').filter(l => l.includes('contract-dod-ws'));
  const badLines = lines.filter(l => !l.includes('SPRINT_DIR') && !l.includes('sprint_dir'));
  if (badLines.length > 0) {
    throw new Error('FAIL: Generator 有 ' + badLines.length + ' 行未使用 SPRINT_DIR 前缀: ' + badLines[0]);
  }
  console.log('PASS: Generator 所有 contract-dod 引用均含 SPRINT_DIR');
"

# CI yml 路径验证
node -e "
  const c = require('fs').readFileSync('.github/workflows/ci.yml', 'utf8');
  const lines = c.split('\n').filter(l => l.includes('contract-dod-ws'));
  const badLines = lines.filter(l => !l.includes('SPRINT_DIR') && !l.includes('sprint_dir'));
  if (badLines.length > 0) {
    throw new Error('FAIL: ci.yml 有 ' + badLines.length + ' 行未使用 SPRINT_DIR: ' + badLines[0]);
  }
  console.log('PASS: ci.yml 所有 contract-dod 引用均含 SPRINT_DIR');
"

# 边界：git add 行也必须使用 sprint_dir
node -e "
  const c = require('fs').readFileSync(
    'packages/workflows/skills/harness-contract-proposer/SKILL.md', 'utf8'
  );
  const addLines = c.split('\n').filter(l => l.includes('git add') && l.includes('contract-dod'));
  if (addLines.some(l => !l.includes('SPRINT_DIR'))) {
    throw new Error('FAIL: git add 行未使用 SPRINT_DIR 前缀');
  }
  console.log('PASS: git add 行使用 SPRINT_DIR 前缀');
"
```

---

## Feature 3: harness-planner 读取受影响文件后再写 PRD

**行为描述**:  
Planner 在写 PRD 之前，先读取与任务描述相关的现有文件（`ls` 目录 + `cat` 关键文件），
在 PRD 末尾附"预期受影响文件"小节（`## 预期受影响文件`），列出实际存在的文件路径。

**硬阈值**:
- `harness-planner/SKILL.md` 在 Step 1 之前或其中，包含读取/列出目录的步骤
- Planner 输出的 PRD 模板中包含 `## 预期受影响文件` 小节
- `harness-planner/SKILL.md` version bump 到 4.1.0

**验证命令**:
```bash
# Happy path: Planner SKILL.md 包含"预期受影响文件"模板
node -e "
  const c = require('fs').readFileSync(
    'packages/workflows/skills/harness-planner/SKILL.md', 'utf8'
  );
  if (!c.includes('预期受影响文件')) {
    throw new Error('FAIL: SKILL.md 未包含受影响文件小节模板');
  }
  console.log('PASS: Planner SKILL.md 含受影响文件小节');
"

# 边界: 必须有读文件的步骤（ls 或 cat 相关指令说明）
node -e "
  const c = require('fs').readFileSync(
    'packages/workflows/skills/harness-planner/SKILL.md', 'utf8'
  );
  const hasReadStep = c.includes('ls') || c.includes('cat') || c.includes('读取');
  if (!hasReadStep) {
    throw new Error('FAIL: Planner 无读取文件步骤');
  }
  console.log('PASS: Planner 包含读取文件步骤');
"

# 版本号验证
node -e "
  const c = require('fs').readFileSync(
    'packages/workflows/skills/harness-planner/SKILL.md', 'utf8'
  );
  if (!c.includes('4.1.0')) {
    throw new Error('FAIL: 版本号未升到 4.1.0');
  }
  console.log('PASS: 版本号已更新到 4.1.0');
"
```

---

## Workstreams

### WS1: Reviewer + Planner SKILL.md 更新（S）

**范围**: Feature 1 + Feature 3  
**文件**: `packages/workflows/skills/harness-contract-reviewer/SKILL.md`, `packages/workflows/skills/harness-planner/SKILL.md`  
**边界**: 仅修改这两个独立 SKILL.md 文件；不涉及 Proposer/Generator/CI  
**大小**: S（两个 Markdown 文件，各增加 2-5 行）

DoD:
- [ ] [ARTIFACT] harness-contract-reviewer/SKILL.md REVISION 条件新增一条：Test 命令含 grep/ls/cat/sed/echo → 必须 REVISION
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!c.includes('grep'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] Reviewer SKILL.md 的 APPROVED 条件明确列出允许工具白名单（node/npm/curl/bash/psql）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');const s=c.split('APPROVED 条件')[1]||'';if(!s.includes('node')||!s.includes('psql'))throw new Error('FAIL');console.log('PASS')"
- [ ] [ARTIFACT] harness-planner/SKILL.md 新增"预期受影响文件"PRD 模板小节
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('预期受影响文件'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] harness-planner/SKILL.md 在写 PRD 前有读取文件的步骤
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('ls')||!c.includes('cat'))throw new Error('FAIL');console.log('PASS')"

### WS2: contract-dod 路径三处统一（M）

**范围**: Feature 2  
**文件**: `packages/workflows/skills/harness-contract-proposer/SKILL.md`, `packages/workflows/skills/harness-generator/SKILL.md`, `.github/workflows/ci.yml`  
**边界**: 仅修改 contract-dod 文件路径（根目录 → SPRINT_DIR/），不改其他逻辑  
**大小**: M（跨 3 个文件的协调修改，每处 1-2 行）

DoD:
- [ ] [ARTIFACT] harness-contract-proposer/SKILL.md 中 contract-dod-ws 写入路径包含 ${SPRINT_DIR}/ 前缀
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(c.includes('cat > \"contract-dod-ws'))throw new Error('FAIL: 仍用根目录');console.log('PASS')"
- [ ] [ARTIFACT] harness-generator/SKILL.md 中 contract-dod-ws 读取路径包含 ${SPRINT_DIR}/
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');const lines=c.split('\n').filter(l=>l.includes('contract-dod-ws'));if(lines.some(l=>!l.includes('SPRINT_DIR')))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] ci.yml harness-dod-integrity job 从 SPRINT_DIR/contract-dod-ws 读取合同 DoD
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const lines=c.split('\n').filter(l=>l.includes('contract-dod-ws'));if(lines.some(l=>!l.includes('SPRINT_DIR')))throw new Error('FAIL');console.log('PASS')"
- [ ] [ARTIFACT] Proposer git add 行也使用 ${SPRINT_DIR}/contract-dod-ws* 路径
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');const addLines=c.split('\n').filter(l=>l.includes('git add')&&l.includes('contract-dod'));if(addLines.some(l=>!l.includes('SPRINT_DIR')))throw new Error('FAIL');console.log('PASS')"
