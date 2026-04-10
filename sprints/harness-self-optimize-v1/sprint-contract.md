# Sprint Contract Draft (Round 1)

## Feature 1: Harness 合同 CI 校验 Job

**行为描述**:
当 PR 中包含 `DoD.md` 或 `contract-dod-ws*.md` 文件变更时，CI 自动触发 `harness-contract-lint` job。该 job 校验三项规则：(1) 每个 `[BEHAVIOR]` 条目的 `Test:` 字段仅使用白名单工具（node/npm/curl/bash/psql）；(2) 每个 `[BEHAVIOR]` 条目的 `Test:` 字段非空；(3) 所有 DoD 条目在 push 时已勾选 `[x]`。校验失败时 job 返回非零退出码，并输出违规条目清单（含行号）。

**硬阈值**:
- 含白名单违规工具（如 `grep`/`ls`/`cat`/`sed`/`echo`）的 `Test:` 字段 → job 红灯
- `Test:` 字段为空的 `[BEHAVIOR]` 条目 → job 红灯
- 存在未勾选 `[ ]` 的 DoD 条目 → job 红灯
- 合规文件 → job 绿灯（exit 0）

**验证命令**:
```bash
# Happy path: 合规 DoD 文件通过校验
node -e "
  const fs = require('fs');
  const tmp = '/tmp/test-dod-valid.md';
  fs.writeFileSync(tmp, '- [x] [BEHAVIOR] 任务列表返回正确格式\n  Test: curl -sf localhost:5221/api/brain/tasks | node -e \"process.exit(0)\"\n- [x] [ARTIFACT] 配置文件存在\n  Test: node -e \"require(\\\"fs\\\").accessSync(\\\"config.json\\\")\"');
  const { execSync } = require('child_process');
  try {
    execSync('node scripts/harness-contract-lint.mjs ' + tmp, { stdio: 'pipe' });
    console.log('PASS: 合规 DoD 文件通过校验');
  } catch(e) {
    console.log('FAIL: 合规文件不应失败'); process.exit(1);
  }
"

# 失败路径: 白名单违规 → 红灯
node -e "
  const fs = require('fs');
  const tmp = '/tmp/test-dod-invalid.md';
  fs.writeFileSync(tmp, '- [x] [BEHAVIOR] 检查输出\n  Test: grep -c pattern file.txt');
  const { execSync } = require('child_process');
  try {
    execSync('node scripts/harness-contract-lint.mjs ' + tmp, { stdio: 'pipe' });
    console.log('FAIL: 白名单违规应被拦截'); process.exit(1);
  } catch(e) {
    console.log('PASS: 白名单违规被正确拦截');
  }
"

# 失败路径: 未勾选条目 → 红灯
node -e "
  const fs = require('fs');
  const tmp = '/tmp/test-dod-unchecked.md';
  fs.writeFileSync(tmp, '- [ ] [BEHAVIOR] 未验证行为\n  Test: curl -sf localhost:5221/api/brain/tasks');
  const { execSync } = require('child_process');
  try {
    execSync('node scripts/harness-contract-lint.mjs ' + tmp, { stdio: 'pipe' });
    console.log('FAIL: 未勾选条目应被拦截'); process.exit(1);
  } catch(e) {
    console.log('PASS: 未勾选条目被正确拦截');
  }
"
```

---

## Feature 2: Reviewer Triple 覆盖率提升 + 证伪留痕

**行为描述**:
Reviewer 审查合同草案时，Triple 分析必须覆盖至少 80% 的验证命令（原 60%）。每个判定为 `can_bypass: Y` 的 triple 必须附带可执行的假实现代码片段（proof-of-falsification），不能仅用文字描述。Reviewer 输出的 REVISION 反馈中，每个 issue 必须包含三部分：原始命令、假实现片段、建议修复命令。

**硬阈值**:
- Reviewer SKILL.md 中覆盖率阈值 >= 0.8（原 0.6）
- 每个 `can_bypass: Y` triple 包含 `proof:` 字段，值为可执行代码片段（非纯文字描述）
- REVISION 输出中每个 issue 包含 `原始命令` / `假实现片段` / `建议修复命令` 三段

**验证命令**:
```bash
# 验证 SKILL.md 覆盖率阈值已更新为 0.8
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md', 'utf8');
  if (content.includes('0.8') || content.includes('80%')) {
    console.log('PASS: 覆盖率阈值已提升至 80%');
  } else {
    console.log('FAIL: 未找到 80% 覆盖率阈值'); process.exit(1);
  }
"

# 验证 SKILL.md 包含 proof-of-falsification 要求
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md', 'utf8');
  const hasProof = content.includes('proof-of-falsification') || content.includes('假实现代码片段') || content.includes('proof:');
  const hasTriple = content.includes('原始命令') && content.includes('建议修复');
  if (hasProof && hasTriple) {
    console.log('PASS: 证伪留痕格式要求已写入');
  } else {
    console.log('FAIL: 缺少证伪留痕格式要求'); process.exit(1);
  }
"
```

---

## Feature 3: Report 任务失败重试机制

**行为描述**:
当 harness-watcher 创建 `harness_report` 任务后，自动监听该任务状态。若 report 任务在 5 分钟内未变为 `completed`，自动重新创建一次 `harness_report` 任务（最多重试 2 次，总共 3 次机会）。若 3 次均失败，创建 P1 告警任务，包含 sprint_dir 和失败原因。

**硬阈值**:
- 重试上限：2 次（首次 + 2 次重试 = 总共 3 次机会）
- 超时阈值：5 分钟（300 秒）
- 3 次失败后必须创建 P1 告警任务
- 告警任务 payload 包含 `sprint_dir` 和 `failure_reason` 字段

**验证命令**:
```bash
# 验证重试逻辑存在且常量正确
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const hasRetry = /MAX_REPORT_RETRIES\s*=\s*2/.test(code) || /max_report_retries.*2/i.test(code) || code.includes('retry') && code.includes('report');
  const hasTimeout = /REPORT_TIMEOUT.*300|5\s*\*\s*60\s*\*\s*1000|300000/.test(code);
  if (!hasRetry) { console.log('FAIL: 缺少 report 重试逻辑或常量'); process.exit(1); }
  if (!hasTimeout) { console.log('FAIL: 缺少 5 分钟超时常量'); process.exit(1); }
  console.log('PASS: 重试逻辑和超时常量存在');
"

# 验证告警任务创建逻辑
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const hasAlert = code.includes('P1') && (code.includes('alert') || code.includes('告警'));
  const hasSprintDir = code.includes('sprint_dir') && code.includes('failure_reason');
  if (!hasAlert) { console.log('FAIL: 缺少 P1 告警任务创建'); process.exit(1); }
  if (!hasSprintDir) { console.log('FAIL: 告警 payload 缺少 sprint_dir 或 failure_reason'); process.exit(1); }
  console.log('PASS: 告警逻辑正确，含 sprint_dir 和 failure_reason');
"

# 单元测试验证重试行为
npm test -- --testPathPattern='harness-watcher' 2>/dev/null && echo "PASS: 单元测试通过" || echo "FAIL: 单元测试失败"
```

---

## Workstreams

workstream_count: 2

### Workstream 1: CI 校验 + Reviewer 强化（Feature 1 + Feature 2）

**范围**: 新增 `scripts/harness-contract-lint.mjs` CI lint 脚本 + `.github/workflows/ci.yml` 新增 `harness-contract-lint` job + 修改 `packages/workflows/skills/harness-contract-reviewer/SKILL.md` 覆盖率阈值和证伪格式
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [x] [ARTIFACT] `scripts/harness-contract-lint.mjs` 存在且可执行
  Test: node -e "require('fs').accessSync('scripts/harness-contract-lint.mjs'); console.log('PASS')"
- [x] [BEHAVIOR] lint 脚本对白名单违规工具（grep/ls/cat/sed/echo）返回非零退出码
  Test: node -e "const fs=require('fs');const tmp='/tmp/test-lint-wl.md';fs.writeFileSync(tmp,'- [x] [BEHAVIOR] x\n  Test: grep -c foo bar');const{execSync}=require('child_process');try{execSync('node scripts/harness-contract-lint.mjs '+tmp,{stdio:'pipe'});console.log('FAIL');process.exit(1)}catch(e){console.log('PASS')}"
- [x] [BEHAVIOR] lint 脚本对空 Test 字段返回非零退出码
  Test: node -e "const fs=require('fs');const tmp='/tmp/test-lint-empty.md';fs.writeFileSync(tmp,'- [x] [BEHAVIOR] x\n  Test:');const{execSync}=require('child_process');try{execSync('node scripts/harness-contract-lint.mjs '+tmp,{stdio:'pipe'});console.log('FAIL');process.exit(1)}catch(e){console.log('PASS')}"
- [x] [BEHAVIOR] lint 脚本对未勾选条目返回非零退出码
  Test: node -e "const fs=require('fs');const tmp='/tmp/test-lint-uc.md';fs.writeFileSync(tmp,'- [ ] [BEHAVIOR] x\n  Test: curl -sf localhost:5221');const{execSync}=require('child_process');try{execSync('node scripts/harness-contract-lint.mjs '+tmp,{stdio:'pipe'});console.log('FAIL');process.exit(1)}catch(e){console.log('PASS')}"
- [x] [ARTIFACT] `.github/workflows/ci.yml` 包含 `harness-contract-lint` job，条件触发于 DoD/contract 文件变更
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('harness-contract-lint'))process.exit(1);console.log('PASS')"
- [x] [BEHAVIOR] Reviewer SKILL.md 覆盖率阈值 >= 80%，含 proof-of-falsification 格式要求
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!(c.includes('0.8')||c.includes('80%')))process.exit(1);if(!c.includes('proof-of-falsification'))process.exit(1);console.log('PASS')"

### Workstream 2: Report 重试机制（Feature 3）

**范围**: 修改 `packages/brain/src/harness-watcher.js` 新增 report 任务状态监听 + 超时重试 + P1 告警 + 单元测试
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [x] [BEHAVIOR] harness-watcher 创建 report 任务后监听状态，5 分钟超时自动重试（最多 2 次）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!/MAX_REPORT_RETRIES\s*=\s*2/.test(c)&&!c.includes('report_retry'))process.exit(1);if(!/300000|5\s*\*\s*60\s*\*\s*1000/.test(c))process.exit(1);console.log('PASS')"
- [x] [BEHAVIOR] 3 次 report 失败后创建 P1 告警任务，payload 含 sprint_dir 和 failure_reason
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('sprint_dir')||!c.includes('failure_reason'))process.exit(1);if(!(c.includes('P1')&&(c.includes('alert')||c.includes('告警'))))process.exit(1);console.log('PASS')"
- [x] [ARTIFACT] 单元测试文件存在，覆盖重试和告警场景
  Test: node -e "const g=require('fs').readdirSync('packages/quality/tests/harness').filter(f=>f.includes('watcher'));if(g.length===0)process.exit(1);console.log('PASS: '+g.join(','))"
- [x] [BEHAVIOR] 单元测试通过
  Test: npm test -- --testPathPattern='harness-watcher'
