# Sprint Contract Draft (Round 2)

> **被测对象**: harness-contract-proposer v4.4.0 + harness-contract-reviewer v4.4.0
> **验证目标**: Reviewer 的对抗证伪机制（Step 2）是否真正有效——能否识别弱命令并触发 REVISION
> **第二轮改动说明**: 根据 Round 1 Reviewer 证伪反馈，全面废弃 `accessSync`（touch 绕过）和纯 `includes`（echo 绕过），改用正则计数、块级结构验证、轮次标记区分等强验证手段。

---

## Feature 1: Proposer 为 harness 本身生成合同草案

**行为描述**:
给定一份 sprint-prd.md，Proposer 在 `sprints/harness-self-check-v2/` 目录下输出 `contract-draft.md`，内容覆盖 PRD 中每个 Feature 的行为描述、硬阈值和可执行验证命令，并包含 `## Workstreams` 区块。同时为每个 workstream 输出独立的 `contract-dod-ws{N}.md` 文件，每个文件包含至少 1 条 `[BEHAVIOR]` DoD 条目。

**硬阈值**:
- `contract-draft.md` 包含 >= 4 个 `## Feature` 二级标题
- `contract-draft.md` 包含 >= 8 个 ` ```bash ` 代码块（每 Feature 至少 2 条命令）
- `contract-draft.md` 包含 >= 2 个 `[BEHAVIOR]` 字符串
- `contract-draft.md` 包含 `## Workstreams` 区块
- 每个 `contract-dod-ws{N}.md` 文件含 >= 1 个 `[BEHAVIOR]` 条目

**验证命令**:
```bash
# 验证 1：结构完整性——Feature 数量 + 命令块数量 + BEHAVIOR 条目数
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
const features = (c.match(/^## Feature \d+/gm) || []).length;
if (features < 4) throw new Error('FAIL: Feature数量不足，期望>=4，实际=' + features);
const bashBlocks = (c.match(/^\`\`\`bash/gm) || []).length;
if (bashBlocks < 8) throw new Error('FAIL: 验证命令块不足，期望>=8，实际=' + bashBlocks);
const behaviors = (c.match(/\[BEHAVIOR\]/g) || []).length;
if (behaviors < 2) throw new Error('FAIL: [BEHAVIOR]条目不足，期望>=2，实际=' + behaviors);
if (!c.includes('## Workstreams')) throw new Error('FAIL: 缺少 ## Workstreams 区块');
console.log('PASS: ' + features + '个Feature，' + bashBlocks + '个命令块，' + behaviors + '个BEHAVIOR条目，Workstreams区块存在');
"
```

```bash
# 验证 2：每个 contract-dod-ws 文件均含 [BEHAVIOR] 条目（非空文件检查）
node -e "
const fs = require('fs');
const dir = 'sprints/harness-self-check-v2';
const files = fs.readdirSync(dir).filter(f => f.startsWith('contract-dod-ws') && f.endsWith('.md'));
if (files.length < 1) throw new Error('FAIL: 无 contract-dod-ws 文件');
let passed = 0;
files.forEach(f => {
  const c = fs.readFileSync(dir + '/' + f, 'utf8');
  const behaviors = (c.match(/\[BEHAVIOR\]/g) || []).length;
  if (behaviors < 1) throw new Error('FAIL: ' + f + ' 缺少[BEHAVIOR]条目（实际=' + behaviors + '），空文件无效');
  passed++;
});
console.log('PASS: ' + passed + '个DoD文件，每个均含[BEHAVIOR]条目');
"
```

---

## Feature 2: Reviewer 对草案中每条命令执行对抗证伪分析

**行为描述**:
Reviewer 收到合同草案后，对每条 Test 命令构造"最懒假实现"，输出三元组（命令 / 最懒假实现 / 能否绕过 + 理由）。任意命令"能否绕过: YES"→ 整个合同判定 REVISION，反馈文件包含完整证伪分析。全部"能否绕过: NO"→ 继续其他维度检查后才可能 APPROVED。Reviewer 不得以主观判断替代三元组构造。

**硬阈值**:
- `contract-review-feedback.md` 包含 >= 3 个**完整三元组块**（同一分隔符区间内同时包含"命令："、"最懒假实现："、"能否绕过："三行）
- Round 1 反馈中"能否绕过：YES"出现次数 >= 1（证伪机制触发）
- "判决"字段（文件前 30 行内）为 "REVISION" 或 "APPROVED"（不能为空）
- Reviewer 不能将"REVISION"判决夹藏于正文中——必须出现在头部元数据区

**验证命令**:
```bash
# 验证 1：三元组完整性（块级计数，非关键词计数）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const blocks = c.split('---');
let validTriples = 0;
blocks.forEach(block => {
  const hasCmd = block.includes('命令：');
  const hasLazy = block.includes('最懒假实现：');
  const hasBypass = /能否绕过[：:]\s*(YES|NO)/.test(block);
  if (hasCmd && hasLazy && hasBypass) validTriples++;
});
if (validTriples < 3) throw new Error('FAIL: 完整三元组数量不足，期望>=3，实际=' + validTriples + '（关键词出现不等于三元组完整）');
const yesCount = (c.match(/能否绕过[：:]\s*YES/g) || []).length;
if (yesCount < 1) throw new Error('FAIL: 无YES三元组，证伪机制未触发（yesCount=' + yesCount + '）');
console.log('PASS: ' + validTriples + '个完整三元组，' + yesCount + '个YES（证伪机制已触发）');
"
```

```bash
# 验证 2：判决在文件头部明确声明（不接受正文偶然出现的 REVISION）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const header = c.split('\n').slice(0, 30).join('\n');
const hasRevision = header.includes('REVISION');
const hasApproved = header.includes('APPROVED');
if (!hasRevision && !hasApproved) throw new Error('FAIL: 文件前30行未声明判决（REVISION或APPROVED），无效反馈文件');
const verdict = hasRevision ? 'REVISION' : 'APPROVED';
console.log('PASS: 文件头部判决=' + verdict);
"
```

---

## Feature 3: GAN 轮次因证伪机制变多且每轮更严格

**行为描述**:
Proposer 根据 Reviewer 的证伪反馈修订命令，Reviewer 再次对新命令构造假实现。修订轮的草案必须减少可被绕过的弱命令模式（如 `accessSync`），增加正则计数或块级结构验证。GAN 至少经历 2 个完整轮次（1 次 REVISION + 1 次对修订版的再审）。

**硬阈值**:
- `sprints/harness-self-check-v2/` 目录下存在 Round 2 草案的 push（`cp-harness-propose-r2-*` 分支存在，由 git remote 可查）
- Round 2 草案中 `accessSync` 调用次数 < Round 1 草案中的 `accessSync` 调用次数（或 Round 1 > 0 而 Round 2 = 0）
- Round 2 草案中 `.match(` 正则验证调用次数 >= 4

**验证命令**:
```bash
# 验证 1：Round 2 草案比 Round 1 更严格（以 accessSync 减少为指标）
node -e "
const fs = require('fs');
// 当前文件就是 Round 2 草案（contract-draft.md 已被 Round 2 push 覆盖）
const r2 = fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
// 验证 Round 2 草案中 accessSync 使用量为 0
const r2AccessSync = (r2.match(/accessSync/g) || []).length;
if (r2AccessSync > 0) throw new Error('FAIL: Round2草案仍有' + r2AccessSync + '处accessSync（可被touch绕过），未改进');
// 验证 Round 2 草案有足够的正则计数验证
const r2Regex = (r2.match(/\.match\(/g) || []).length;
if (r2Regex < 4) throw new Error('FAIL: Round2草案正则验证（.match()）不足，期望>=4，实际=' + r2Regex);
console.log('PASS: Round2草案 accessSync=0，regex=' + r2Regex + '（命令严格度已提升）');
"
```

```bash
# 验证 2：git 远端有 R2 分支存在（证明 Proposer 执行了第2轮）
node -e "
const {execSync} = require('child_process');
try {
  const branches = execSync('git ls-remote --heads origin cp-harness-propose-r2-\\*', {encoding:'utf8'});
  if (!branches || branches.trim().length === 0) throw new Error('NO R2 BRANCHES');
  const count = branches.trim().split('\n').length;
  console.log('PASS: 远端存在' + count + '个cp-harness-propose-r2-*分支，GAN R2执行已确认');
} catch(e) {
  throw new Error('FAIL: 远端无cp-harness-propose-r2-*分支，R2未执行 (' + e.message + ')');
}
"
```

---

## Feature 4: 最终产出可观察的验证报告

**行为描述**:
GAN 结束后，可从产物文件中完整还原对抗过程。`sprint-contract.md` 是最终 APPROVED 合同，必须包含结构化内容（Feature 标题 + 验证命令块）；`contract-review-feedback.md` 包含完整三元组；最终合同中不应包含"能否绕过: YES"（所有命令已通过验证），但应包含"能否绕过: NO"记录（有明确通过证明）。

**硬阈值**:
- `sprint-contract.md` 包含 >= 4 个 `## Feature` 标题
- `sprint-contract.md` 包含 >= 8 个 ` ```bash ` 代码块
- `sprint-contract.md` 中"能否绕过: YES"出现 0 次（GAN 已完成，所有命令通过）
- `sprint-contract.md` 中"能否绕过: NO"出现 >= 1 次（有明确通过记录）
- `contract-review-feedback.md` 中完整三元组数量 >= 3

**验证命令**:
```bash
# 验证 1：最终合同结构完整性（Feature数 + 命令块数 + 无YES残留）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md', 'utf8');
const features = (c.match(/^## Feature \d+/gm) || []).length;
if (features < 4) throw new Error('FAIL: sprint-contract.md Feature数不足，期望>=4，实际=' + features);
const cmds = (c.match(/^\`\`\`bash/gm) || []).length;
if (cmds < 8) throw new Error('FAIL: 验证命令块不足，期望>=8，实际=' + cmds);
const yesCount = (c.match(/能否绕过[：:]\s*YES/g) || []).length;
if (yesCount > 0) throw new Error('FAIL: 最终合同仍含' + yesCount + '个YES，GAN未完成');
const noCount = (c.match(/能否绕过[：:]\s*NO/g) || []).length;
if (noCount < 1) throw new Error('FAIL: 最终合同无NO记录，缺少证伪通过证明');
console.log('PASS: ' + features + '个Feature，' + cmds + '条命令，' + noCount + '个NO，0个YES——GAN完成');
"
```

```bash
# 验证 2：反馈文件结构有效（三元组计数 + YES >= 1）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const blocks = c.split('---');
let triples = 0;
blocks.forEach(b => {
  if (b.includes('命令：') && b.includes('最懒假实现：') && /能否绕过[：:]\s*(YES|NO)/.test(b)) triples++;
});
if (triples < 3) throw new Error('FAIL: 三元组数量不足，期望>=3，实际=' + triples);
const yes = (c.match(/能否绕过[：:]\s*YES/g) || []).length;
if (yes < 1) throw new Error('FAIL: 无YES记录，证伪机制从未触发');
console.log('PASS: ' + triples + '个三元组，' + yes + '个YES（可验证证伪机制有效）');
"
```

---

## Workstreams

workstream_count: 2

### Workstream 1: Proposer 合同草案生成行为

**范围**: Proposer 读取 PRD → 输出 contract-draft.md（含 Feature 结构 + 验证命令 + Workstreams 区块）+ contract-dod-ws{N}.md 文件
**大小**: S（改动 <100 行，纯产出物验证）
**依赖**: 无

**DoD**:
- [x] [ARTIFACT] `sprints/harness-self-check-v2/contract-draft.md` 存在且含 >= 4 个 Feature 标题
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const n=(c.match(/^## Feature \d+/gm)||[]).length;if(n<4)throw new Error('FAIL:Feature数='+n);console.log('PASS:'+n+'个Feature')"
- [x] [BEHAVIOR] Proposer 输出的草案包含 >= 8 个 bash 命令块，且每个 contract-dod-ws 文件含 [BEHAVIOR] 条目
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const b=(c.match(/^\`\`\`bash/gm)||[]).length;if(b<8)throw new Error('FAIL:bash块='+b);const dods=fs.readdirSync('sprints/harness-self-check-v2').filter(f=>f.startsWith('contract-dod-ws'));dods.forEach(f=>{const d=fs.readFileSync('sprints/harness-self-check-v2/'+f,'utf8');if(!(d.match(/\[BEHAVIOR\]/g)||[]).length)throw new Error('FAIL:'+f+'无BEHAVIOR');});console.log('PASS:bash='+b+'，DoD文件='+dods.length)"

---

### Workstream 2: Reviewer 证伪机制 + GAN 多轮对抗

**范围**: Reviewer 对草案执行证伪分析 → 输出三元组反馈 → Proposer 修订 → Reviewer 再审 → 最终 APPROVED 合同
**大小**: M（验证涉及多个产物文件和多轮对抗记录）
**依赖**: Workstream 1 完成后

**DoD**:
- [x] [BEHAVIOR] `contract-review-feedback.md` 包含 >= 3 个完整三元组块，且至少 1 个 YES（R1 证伪触发）
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const blocks=c.split('---');let t=0;blocks.forEach(b=>{if(b.includes('命令：')&&b.includes('最懒假实现：')&&/能否绕过[：:]\s*(YES|NO)/.test(b))t++;});if(t<3)throw new Error('FAIL:三元组='+t);const y=(c.match(/能否绕过[：:]\s*YES/g)||[]).length;if(y<1)throw new Error('FAIL:无YES');console.log('PASS:三元组='+t+'，YES='+y)"
- [x] [BEHAVIOR] GAN 至少 2 轮——远端存在 `cp-harness-propose-r2-*` 分支
  Test: node -e "const {execSync}=require('child_process');const o=execSync('git ls-remote --heads origin cp-harness-propose-r2-\\*',{encoding:'utf8'});if(!o||!o.trim())throw new Error('FAIL:无R2分支');console.log('PASS:R2分支存在='+o.trim().split('\n').length+'个')"
- [x] [BEHAVIOR] 最终 `sprint-contract.md` 含 >= 4 个 Feature、>= 8 命令块、0 个 YES、>= 1 个 NO
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md','utf8');const f=(c.match(/^## Feature \d+/gm)||[]).length;const b=(c.match(/^\`\`\`bash/gm)||[]).length;const y=(c.match(/能否绕过[：:]\s*YES/g)||[]).length;const n=(c.match(/能否绕过[：:]\s*NO/g)||[]).length;if(f<4)throw new Error('FAIL:Feature='+f);if(b<8)throw new Error('FAIL:bash='+b);if(y>0)throw new Error('FAIL:仍有'+y+'个YES');if(n<1)throw new Error('FAIL:无NO记录');console.log('PASS:Feature='+f+'，bash='+b+'，YES='+y+'，NO='+n)"
