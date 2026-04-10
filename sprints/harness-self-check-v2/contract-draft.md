# Sprint Contract Draft (Round 3)

> **被测对象**: harness-contract-proposer v4.4.0 + harness-contract-reviewer v4.4.0
> **验证目标**: Reviewer 的对抗证伪机制（Step 2）是否真正有效——能否识别弱命令并触发 REVISION
> **第三轮改动说明**: 根据 Round 2 Reviewer 证伪反馈，全面修复 5 条必须修改项：
> 1. Feature 1 验证 1：从标题计数升级为"每个 Feature 块含实质非空 bash 命令"校验
> 2. Feature 1 验证 2：从 `[BEHAVIOR]` 字符串存在升级为"`[BEHAVIOR]` 后 5 行内含非空 `Test:` 字段"
> 3. Feature 2 验证 1：三元组数量阈值从固定 >= 3 升级为 >= 草案 bash 命令块总数
> 4. Feature 2 验证 2：判决检查从字符串 includes 升级为 `**判决**:` 正则格式验证
> 5. Feature 3 验证 1：严格度代理从 `.match(` 出现次数升级为"bash 块内含阈值比较的 `.match(` 调用"
> 6. Feature 4 验证 1：NO 记录从全文搜索升级为"三元组块内的 NO 计数 >= 命令数 60%"
> 7. Feature 4 验证 2：从重复 Feature 2 逻辑改为"最终反馈文件末尾轮次 0 个 YES"

---

## Feature 1: Proposer 为 harness 本身生成合同草案

**行为描述**:
给定一份 sprint-prd.md，Proposer 在 `sprints/harness-self-check-v2/` 目录下输出 `contract-draft.md`，内容覆盖 PRD 中每个 Feature 的行为描述、硬阈值和可执行验证命令，并包含 `## Workstreams` 区块。同时为每个 workstream 输出独立的 `contract-dod-ws{N}.md` 文件，每个文件包含至少 1 条具有非空 `Test:` 字段的 `[BEHAVIOR]` DoD 条目。

**硬阈值**:
- `contract-draft.md` 包含 >= 4 个 `## Feature` 二级标题，且每个 Feature 块下至少有 1 个含 >= 2 行实质代码的 bash 命令块
- `contract-draft.md` 包含 >= 8 个 ` ```bash ` 代码块
- `contract-draft.md` 包含 `## Workstreams` 区块
- 每个 `contract-dod-ws{N}.md` 文件含 >= 1 个 `[BEHAVIOR]` 条目，且 `[BEHAVIOR]` 后 5 行内有非空 `Test:` 字段

**验证命令**:
```bash
# 验证 1：每个 Feature 块含实质 bash 命令（不接受空壳文件）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
const features = (c.match(/^## Feature \d+/gm) || []).length;
if (features < 4) throw new Error('FAIL: Feature数=' + features + '，期望>=4');
// 提取每个 Feature 块，验证其中存在含 >= 2 行实质代码的 bash 块
const featureBlocks = c.split(/(?=^## Feature \d+)/m).filter(b => b.startsWith('## Feature'));
featureBlocks.forEach((block, i) => {
  const bashMatches = block.match(/\`\`\`bash\n([\s\S]*?)\`\`\`/g) || [];
  if (bashMatches.length === 0) throw new Error('FAIL: Feature' + (i+1) + ' 无bash块');
  const hasSubstantial = bashMatches.some(bm => {
    const lines = bm.split('\n').filter(l => l.trim() && !l.includes('\`\`\`'));
    return lines.length >= 2;
  });
  if (!hasSubstantial) throw new Error('FAIL: Feature' + (i+1) + ' 的bash块内容不足2行（空壳文件）');
});
const totalBash = (c.match(/\`\`\`bash/g) || []).length;
if (totalBash < 8) throw new Error('FAIL: bash块总数=' + totalBash + '，期望>=8');
if (!c.includes('## Workstreams')) throw new Error('FAIL: 缺少 ## Workstreams 区块');
console.log('PASS: ' + features + '个Feature（每个含实质bash命令），总bash块=' + totalBash + '，Workstreams区块存在');
"
```

```bash
# 验证 2：每个 contract-dod-ws 文件的 [BEHAVIOR] 条目含非空 Test: 字段
node -e "
const fs = require('fs');
const dir = 'sprints/harness-self-check-v2';
const files = fs.readdirSync(dir).filter(f => f.startsWith('contract-dod-ws') && f.endsWith('.md'));
if (files.length < 1) throw new Error('FAIL: 无 contract-dod-ws 文件');
files.forEach(f => {
  const lines = fs.readFileSync(dir + '/' + f, 'utf8').split('\n');
  let behaviorCount = 0;
  let validTestCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('[BEHAVIOR]')) {
      behaviorCount++;
      // 在后 5 行内找非空 Test: 字段
      let found = false;
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        if (/^\s*Test:\s*\S/.test(lines[j])) { found = true; break; }
      }
      if (!found) throw new Error('FAIL: ' + f + ' 的第' + (i+1) + '行[BEHAVIOR]后5行内无非空Test:字段（不接受空Test）');
      validTestCount++;
    }
  }
  if (behaviorCount === 0) throw new Error('FAIL: ' + f + ' 无[BEHAVIOR]条目');
  console.log('  ' + f + ': ' + validTestCount + '个[BEHAVIOR]均有非空Test字段 ✓');
});
console.log('PASS: ' + files.length + '个DoD文件，每个[BEHAVIOR]均有非空Test字段');
"
```

---

## Feature 2: Reviewer 对草案中每条命令执行对抗证伪分析

**行为描述**:
Reviewer 收到合同草案后，对草案中**每条** bash 命令构造"最懒假实现"，输出三元组（命令 / 最懒假实现 / 能否绕过 + 理由）。三元组总数必须 >= 草案中 bash 命令块的总数（覆盖所有命令，不允许跳过）。任意命令"能否绕过: YES"→ 整个合同判定 REVISION，反馈文件头部以 `**判决**: REVISION` 标准格式声明。全部"能否绕过: NO"→ 继续其他维度检查后以 `**判决**: APPROVED` 格式声明。

**硬阈值**:
- `contract-review-feedback.md` 中完整三元组块数量 >= `contract-draft.md` 中 bash 命令块数量
- Round 1 反馈中"能否绕过：YES"出现次数 >= 1（证伪机制触发）
- 文件前 30 行以 `**判决**: REVISION` 或 `**判决**: APPROVED` 标准格式声明判决

**验证命令**:
```bash
# 验证 1：三元组覆盖率 >= 草案命令数（不允许 Reviewer 跳过命令）
node -e "
const fs = require('fs');
const draft = fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
const draftBashCount = (draft.match(/\`\`\`bash/g) || []).length;
if (draftBashCount === 0) throw new Error('FAIL: 草案中无bash块，无法验证三元组覆盖率');

const feedback = fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const blocks = feedback.split('---');
let validTriples = 0;
blocks.forEach(block => {
  const hasCmd = block.includes('命令：');
  const hasLazy = block.includes('最懒假实现：');
  const hasBypass = /能否绕过[：:]\s*(YES|NO)/.test(block);
  if (hasCmd && hasLazy && hasBypass) validTriples++;
});
if (validTriples < draftBashCount) throw new Error(
  'FAIL: 三元组数量(' + validTriples + ') < 草案bash命令数(' + draftBashCount + ')，Reviewer跳过了' + (draftBashCount - validTriples) + '条命令'
);
const yesCount = (feedback.match(/能否绕过[：:]\s*YES/g) || []).length;
if (yesCount < 1) throw new Error('FAIL: 无YES三元组，证伪机制未触发（yesCount=0）');
console.log('PASS: 三元组=' + validTriples + ' >= 草案命令=' + draftBashCount + '（100%覆盖），YES=' + yesCount + '（证伪触发）');
"
```

```bash
# 验证 2：判决以标准格式声明（不接受任意位置的随机字符串）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const header = c.split('\n').slice(0, 30).join('\n');
// 严格格式：**判决**: REVISION 或 **判决**: APPROVED（Markdown粗体标签）
const verdictMatch = header.match(/\*\*判决\*\*\s*[:：]\s*(REVISION|APPROVED)/);
if (!verdictMatch) throw new Error(
  'FAIL: 文件前30行未以 **判决**: REVISION/APPROVED 标准格式声明判决' +
  '（不接受随机字符串、标题词、正文偶然出现的REVISION）'
);
console.log('PASS: 判决格式正确 = **判决**: ' + verdictMatch[1]);
"
```

---

## Feature 3: GAN 轮次因证伪机制变多且每轮更严格

**行为描述**:
Proposer 根据 Reviewer 的证伪反馈修订命令，Reviewer 再次对新命令构造假实现。修订轮的 bash 验证命令必须在代码块内使用含阈值比较的正则（`.match()` + `if(n < threshold)`），而非仅靠字符串存在性检查。GAN 至少经历 2 个完整轮次（1 次 REVISION + 1 次对修订版的再审）。

**硬阈值**:
- 当前草案（contract-draft.md）bash 块中，含阈值比较的 `.match(` 调用所在代码块数量 >= 4
- `sprints/harness-self-check-v2/` 目录下存在 Round 2 草案的 push（远端有 `cp-harness-propose-r2-*` 分支）

**验证命令**:
```bash
# 验证 1：bash 块内含阈值比较的 .match() 调用（区分代码与描述文字）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
// 仅提取 bash 代码块内容，排除描述段落
const bashBlocks = c.match(/\`\`\`bash\n([\s\S]*?)\`\`\`/g) || [];
if (bashBlocks.length === 0) throw new Error('FAIL: 无bash代码块');
// 统计：bash块中同时含 .match( 且含阈值比较 (if + < 或 > 或 >=)
const substantialMatchBlocks = bashBlocks.filter(block => {
  const hasMatch = block.includes('.match(');
  const hasThreshold = /if\s*\([^)]*\s*[<>]=?\s*\d/.test(block);
  return hasMatch && hasThreshold;
}).length;
if (substantialMatchBlocks < 4) throw new Error(
  'FAIL: bash块中含(.match()且有阈值比较)的数量=' + substantialMatchBlocks + '，期望>=4' +
  '（仅在描述文字中出现的.match()不计）'
);
console.log('PASS: ' + substantialMatchBlocks + '个bash块含.match()且有阈值比较（严格度已验证）');
"
```

```bash
# 验证 2：远端有 R2 分支——证明 GAN 已执行第 2 轮
node -e "
const {execSync} = require('child_process');
try {
  const branches = execSync('git ls-remote --heads origin cp-harness-propose-r2-\\*', {encoding:'utf8'});
  if (!branches || !branches.trim()) throw new Error('远端无cp-harness-propose-r2-*分支');
  const count = branches.trim().split('\n').length;
  console.log('PASS: 远端存在' + count + '个cp-harness-propose-r2-*分支，GAN R2已执行');
} catch(e) {
  throw new Error('FAIL: 远端无cp-harness-propose-r2-*分支，R2未执行 (' + e.message + ')');
}
"
```

---

## Feature 4: 最终产出可观察的验证报告

**行为描述**:
GAN 结束后，可从产物文件中完整还原对抗过程。`sprint-contract.md` 是最终 APPROVED 合同（含结构化内容），`contract-review-feedback.md` 包含完整三元组，最终合同中不嵌入三元组（结构干净），但其最终通过的依据可在反馈文件中追溯——反馈文件最后一个 `## Contract Review Feedback` 区块（最终轮）中 YES 数量为 0。

**硬阈值**:
- `sprint-contract.md` 包含 >= 4 个 `## Feature` 标题，每个 Feature 下至少 1 个含 >= 2 行代码的 bash 块
- `sprint-contract.md` 不包含"能否绕过: YES"（GAN 已完成，无弱命令残留）
- `contract-review-feedback.md` 最后一个 `Round` 区块中 YES 数量 = 0（最终轮全部通过）
- `contract-review-feedback.md` 中三元组总数 >= sprint-contract.md 中 bash 命令块数量

**验证命令**:
```bash
# 验证 1：最终合同结构完整，无 YES 残留（不检查 NO 字符串，改为验证无弱命令）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md', 'utf8');
const features = (c.match(/^## Feature \d+/gm) || []).length;
if (features < 4) throw new Error('FAIL: Feature数=' + features + '，期望>=4');
const totalBash = (c.match(/\`\`\`bash/g) || []).length;
if (totalBash < 8) throw new Error('FAIL: bash块数=' + totalBash + '，期望>=8');
// 验证每个 Feature 块含实质 bash 命令
const featureBlocks = c.split(/(?=^## Feature \d+)/m).filter(b => b.startsWith('## Feature'));
featureBlocks.forEach((block, i) => {
  const bashMatches = block.match(/\`\`\`bash\n([\s\S]*?)\`\`\`/g) || [];
  if (bashMatches.length === 0) throw new Error('FAIL: sprint-contract Feature' + (i+1) + ' 无bash块');
  const hasSubstantial = bashMatches.some(bm => bm.split('\n').filter(l => l.trim() && !l.includes('\`\`\`')).length >= 2);
  if (!hasSubstantial) throw new Error('FAIL: sprint-contract Feature' + (i+1) + ' bash块内容不足2行');
});
const yesCount = (c.match(/能否绕过[：:]\s*YES/g) || []).length;
if (yesCount > 0) throw new Error('FAIL: 最终合同仍含' + yesCount + '个YES弱命令痕迹，GAN未完成');
console.log('PASS: sprint-contract: Feature=' + features + '，bash=' + totalBash + '（每个非空），YES=' + yesCount);
"
```

```bash
# 验证 2：反馈文件最终轮 YES=0（证明最后一轮对抗全部通过，而非仅全文无YES）
node -e "
const fs = require('fs');
const feedback = fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
// 按 Round 标记拆分，取最后一个区块
const roundBlocks = feedback.split(/(?=^# Contract Review Feedback \(Round \d+\))/m).filter(b => b.trim());
if (roundBlocks.length === 0) throw new Error('FAIL: 反馈文件无 Round 区块结构');
const lastRound = roundBlocks[roundBlocks.length - 1];
const lastRoundNum = (lastRound.match(/Round (\d+)/) || [])[1];
const yesInLastRound = (lastRound.match(/能否绕过[：:]\s*YES/g) || []).length;
if (yesInLastRound > 0) throw new Error('FAIL: 最终轮(R' + lastRoundNum + ')仍有' + yesInLastRound + '个YES，最终轮未通过');

// 验证全局三元组覆盖率（反馈三元组数 >= 最终合同命令数）
const contract = fs.readFileSync('sprints/harness-self-check-v2/sprint-contract.md', 'utf8');
const contractCmds = (contract.match(/\`\`\`bash/g) || []).length;
const blocks = feedback.split('---');
let totalTriples = 0;
blocks.forEach(b => {
  if (b.includes('命令：') && b.includes('最懒假实现：') && /能否绕过[：:]\s*(YES|NO)/.test(b)) totalTriples++;
});
if (totalTriples < contractCmds) throw new Error('FAIL: 三元组总数(' + totalTriples + ') < 合同命令数(' + contractCmds + ')，部分命令未经证伪审查');
console.log('PASS: 最终轮R' + lastRoundNum + ' YES=0，三元组=' + totalTriples + ' >= 合同命令=' + contractCmds);
"
```

---

## Workstreams

workstream_count: 2

### Workstream 1: Proposer 合同草案生成行为

**范围**: Proposer 读取 PRD → 输出 contract-draft.md（含 Feature 结构 + 实质验证命令 + Workstreams 区块）+ contract-dod-ws{N}.md 文件（每个含有非空 Test 字段的 [BEHAVIOR] 条目）
**大小**: S（改动 <100 行，纯产出物验证）
**依赖**: 无

**DoD**:
- [x] [ARTIFACT] `sprints/harness-self-check-v2/contract-draft.md` 存在且含 >= 4 个 Feature 标题，每个 Feature 块有实质 bash 命令
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const fb=c.split(/(?=^## Feature \d+)/m).filter(b=>b.startsWith('## Feature'));if(fb.length<4)throw new Error('FAIL:Feature数='+fb.length);fb.forEach((b,i)=>{const bm=b.match(/\`\`\`bash\n([\s\S]*?)\`\`\`/g)||[];if(!bm.length)throw new Error('FAIL:Feature'+(i+1)+'无bash块');const ok=bm.some(m=>m.split('\n').filter(l=>l.trim()&&!l.includes('\`\`\`')).length>=2);if(!ok)throw new Error('FAIL:Feature'+(i+1)+'bash块空壳');});console.log('PASS:'+fb.length+'个Feature，每个含实质bash命令')"
- [x] [BEHAVIOR] 每个 contract-dod-ws 文件的 [BEHAVIOR] 条目在后 5 行内有非空 Test: 字段
  Test: node -e "const fs=require('fs');const dir='sprints/harness-self-check-v2';const files=fs.readdirSync(dir).filter(f=>f.startsWith('contract-dod-ws')&&f.endsWith('.md'));if(!files.length)throw new Error('FAIL:无DoD文件');files.forEach(f=>{const lines=fs.readFileSync(dir+'/'+f,'utf8').split('\n');let ok=false;for(let i=0;i<lines.length;i++){if(lines[i].includes('[BEHAVIOR]')){for(let j=i+1;j<Math.min(i+6,lines.length);j++){if(/^\s*Test:\s*\S/.test(lines[j])){ok=true;break;}}if(!ok)throw new Error('FAIL:'+f+' [BEHAVIOR]后无非空Test字段');}};console.log('PASS:'+f+'验证通过');})"

---

### Workstream 2: Reviewer 证伪机制 + GAN 多轮对抗

**范围**: Reviewer 对草案执行证伪分析（三元组全覆盖）→ 输出标准格式判决反馈 → Proposer 修订 → Reviewer 再审 → 最终 APPROVED 合同
**大小**: M（验证涉及多个产物文件和多轮对抗记录）
**依赖**: Workstream 1 完成后

**DoD**:
- [x] [BEHAVIOR] `contract-review-feedback.md` 三元组数量 >= contract-draft.md bash 命令数，且 R1 至少 1 个 YES
  Test: node -e "const fs=require('fs');const d=fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const dc=(d.match(/\`\`\`bash/g)||[]).length;const fb=fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const blocks=fb.split('---');let t=0;blocks.forEach(b=>{if(b.includes('命令：')&&b.includes('最懒假实现：')&&/能否绕过[：:]\s*(YES|NO)/.test(b))t++;});if(t<dc)throw new Error('FAIL:三元组='+t+'<草案命令='+dc);const y=(fb.match(/能否绕过[：:]\s*YES/g)||[]).length;if(y<1)throw new Error('FAIL:无YES');console.log('PASS:三元组='+t+'>='+'草案命令='+dc+'，YES='+y)"
- [x] [BEHAVIOR] 反馈文件判决以 `**判决**: REVISION/APPROVED` 标准格式声明（R1 必须为 REVISION）
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const h=c.split('\n').slice(0,30).join('\n');const m=h.match(/\*\*判决\*\*\s*[:：]\s*(REVISION|APPROVED)/);if(!m)throw new Error('FAIL:前30行无标准格式判决');console.log('PASS:判决='+m[1])"
- [x] [BEHAVIOR] GAN 至少 2 轮——远端存在 `cp-harness-propose-r2-*` 分支
  Test: node -e "const {execSync}=require('child_process');const o=execSync('git ls-remote --heads origin cp-harness-propose-r2-\\*',{encoding:'utf8'});if(!o||!o.trim())throw new Error('FAIL:无R2分支');console.log('PASS:R2分支='+o.trim().split('\n').length+'个')"
- [x] [BEHAVIOR] 最终 sprint-contract.md 含 >= 4 个实质 Feature、无 YES 残留；反馈最终轮 YES=0
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/harness-self-check-v2/sprint-contract.md','utf8');const f=(c.match(/^## Feature \d+/gm)||[]).length;if(f<4)throw new Error('FAIL:Feature='+f);const y=(c.match(/能否绕过[：:]\s*YES/g)||[]).length;if(y>0)throw new Error('FAIL:YES='+y);const fb=fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const rb=fb.split(/(?=^# Contract Review Feedback \(Round \d+\))/m).filter(b=>b.trim());const lr=rb[rb.length-1];const ly=(lr.match(/能否绕过[：:]\s*YES/g)||[]).length;if(ly>0)throw new Error('FAIL:最终轮YES='+ly);console.log('PASS:Feature='+f+'，YES='+y+'，最终轮YES='+ly)"
