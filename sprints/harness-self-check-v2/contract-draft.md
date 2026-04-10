# Sprint Contract Draft (Round 3)

> **被测对象**: harness-contract-proposer v4.4.0 + harness-contract-reviewer v4.4.0
> **验证目标**: Reviewer 的对抗证伪机制（Step 2）是否真正有效——能否识别弱命令并触发 REVISION
> **第三轮改动说明**: 根据 Round 2 Reviewer 证伪反馈的 5 条必须修改项 + 2 条可选改进，全面升级：(1) Feature 块内容实质性验证（非空 bash 块 + 行数检查）；(2) DoD 文件 [BEHAVIOR]+Test: 联合校验；(3) 三元组数量与草案命令数挂钩（覆盖率 >= 60%）；(4) .match() 必须出现在 bash 代码块内且伴随阈值比较；(5) NO 记录必须在三元组块结构内（非描述文字）；(6) 判决格式改为严格正则；(7) 去重 Feature 4 验证 2。

---

## Feature 1: Proposer 为 harness 本身生成合同草案

**行为描述**:
给定一份 sprint-prd.md，Proposer 在 `sprints/harness-self-check-v2/` 目录下输出 `contract-draft.md`，内容覆盖 PRD 中每个 Feature 的行为描述、硬阈值和可执行验证命令，并包含 `## Workstreams` 区块。同时为每个 workstream 输出独立的 `contract-dod-ws{N}.md` 文件，每个文件包含至少 1 条 `[BEHAVIOR]` DoD 条目且有对应 `Test:` 字段。

**硬阈值**:
- `contract-draft.md` 包含 >= 4 个 `## Feature` 二级标题
- 每个 Feature 块下存在至少 1 个**非空** bash 代码块（命令行数 >= 2）
- `contract-draft.md` 包含 >= 8 个 ` ```bash ` 代码块
- `contract-draft.md` 包含 >= 2 个 `[BEHAVIOR]` 字符串
- `contract-draft.md` 包含 `## Workstreams` 区块
- 每个 `contract-dod-ws{N}.md` 文件含 >= 1 个 `[BEHAVIOR]` 条目，且每个 `[BEHAVIOR]` 后有 `Test:` 字段

**验证命令**:
```bash
# 验证 1：Feature 块内容实质性——每个 Feature 标题下必须有至少 1 个非空 bash 块（命令行数 >= 2）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
const featureBlocks = c.split(/^## Feature \d+/gm);
featureBlocks.shift(); // 移除第一个空块（Feature 标题之前的内容）
if (featureBlocks.length < 4) throw new Error('FAIL: Feature数量不足，期望>=4，实际=' + featureBlocks.length);
let allValid = true;
const errors = [];
featureBlocks.forEach((block, i) => {
  const bashMatches = block.match(/\x60\x60\x60bash\n([\s\S]*?)\x60\x60\x60/g) || [];
  if (bashMatches.length < 1) { errors.push('Feature ' + (i+1) + ': 无bash块'); allValid = false; return; }
  const hasSubstantial = bashMatches.some(m => {
    const lines = m.split('\n').filter(l => l.trim() && !l.startsWith('\x60') && !l.startsWith('#'));
    return lines.length >= 2;
  });
  if (!hasSubstantial) { errors.push('Feature ' + (i+1) + ': bash块无实质命令（非注释非空行<2）'); allValid = false; }
});
if (!allValid) throw new Error('FAIL: ' + errors.join('; '));
const bashBlocks = (c.match(/^\x60\x60\x60bash/gm) || []).length;
if (bashBlocks < 8) throw new Error('FAIL: 验证命令块不足，期望>=8，实际=' + bashBlocks);
const behaviors = (c.match(/\[BEHAVIOR\]/g) || []).length;
if (behaviors < 2) throw new Error('FAIL: [BEHAVIOR]条目不足，期望>=2，实际=' + behaviors);
if (!c.includes('## Workstreams')) throw new Error('FAIL: 缺少 ## Workstreams 区块');
console.log('PASS: ' + featureBlocks.length + '个Feature（每个有实质命令），' + bashBlocks + '个命令块，' + behaviors + '个BEHAVIOR，Workstreams存在');
"
```

```bash
# 验证 2：DoD 文件格式完整性——每个 contract-dod-ws 文件中 [BEHAVIOR] 后必须有 Test: 字段
node -e "
const fs = require('fs');
const dir = 'sprints/harness-self-check-v2';
const files = fs.readdirSync(dir).filter(f => f.startsWith('contract-dod-ws') && f.endsWith('.md'));
if (files.length < 1) throw new Error('FAIL: 无 contract-dod-ws 文件');
let passed = 0;
files.forEach(f => {
  const c = fs.readFileSync(dir + '/' + f, 'utf8');
  const lines = c.split('\n');
  let behaviorCount = 0;
  let behaviorWithTest = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('[BEHAVIOR]')) {
      behaviorCount++;
      // 检查后续 5 行内是否有 Test: 字段（含非空值）
      const next5 = lines.slice(i+1, i+6).join('\n');
      if (/Test:\s*\S+/.test(next5)) behaviorWithTest++;
    }
  }
  if (behaviorCount < 1) throw new Error('FAIL: ' + f + ' 无[BEHAVIOR]条目');
  if (behaviorWithTest < behaviorCount) throw new Error('FAIL: ' + f + ' 有' + behaviorCount + '个[BEHAVIOR]但只有' + behaviorWithTest + '个含Test:字段');
  passed++;
});
console.log('PASS: ' + passed + '个DoD文件，每个[BEHAVIOR]均有对应Test:字段');
"
```

---

## Feature 2: Reviewer 对草案中每条命令执行对抗证伪分析

**行为描述**:
Reviewer 收到合同草案后，对每条 Test 命令构造"最懒假实现"，输出三元组（命令 / 最懒假实现 / 能否绕过 + 理由）。任意命令"能否绕过: YES"→ 整个合同判定 REVISION，反馈文件包含完整证伪分析。全部"能否绕过: NO"→ 继续其他维度检查后才可能 APPROVED。Reviewer 不得以主观判断替代三元组构造。

**硬阈值**:
- `contract-review-feedback.md` 中完整三元组数量 >= 草案 bash 命令块总数的 60%（三元组覆盖率与草案命令挂钩，不使用固定阈值）
- 每个三元组的"命令："行至少包含草案中某条命令的关键词片段（非纯占位 echo foo）
- Round 1 反馈中"能否绕过：YES"出现次数 >= 1（证伪机制触发）
- 文件前 30 行内以 `**判决**:` 格式声明判决（严格正则，非任意字符串包含）

**验证命令**:
```bash
# 验证 1：三元组覆盖率——数量 >= 草案命令块数 * 60%，且每个三元组命令行非占位
node -e "
const fs = require('fs');
const draft = fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
const draftBashCount = (draft.match(/^\x60\x60\x60bash/gm) || []).length;
const minTriples = Math.ceil(draftBashCount * 0.6);
const feedback = fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const blocks = feedback.split('---');
let validTriples = 0;
let placeholderTriples = 0;
blocks.forEach(block => {
  const cmdMatch = block.match(/命令[：:]\s*(.+)/);
  const hasLazy = block.includes('最懒假实现');
  const hasBypass = /能否绕过[：:]\s*(YES|NO)/.test(block);
  if (cmdMatch && hasLazy && hasBypass) {
    validTriples++;
    const cmdText = cmdMatch[1].trim();
    // 占位检测：如果命令行是纯 echo/placeholder，标记为占位
    if (/^echo\s|^placeholder|^fake/i.test(cmdText)) placeholderTriples++;
  }
});
if (validTriples < minTriples) throw new Error('FAIL: 三元组数=' + validTriples + '，需>=' + minTriples + '（草案' + draftBashCount + '条命令*60%），覆盖率不足');
if (placeholderTriples > validTriples * 0.3) throw new Error('FAIL: 占位三元组过多（' + placeholderTriples + '/' + validTriples + '），命令行应引用草案真实命令');
const yesCount = (feedback.match(/能否绕过[：:]\s*YES/g) || []).length;
if (yesCount < 1) throw new Error('FAIL: 无YES三元组，证伪机制未触发');
console.log('PASS: ' + validTriples + '个有效三元组（>=' + minTriples + '），占位' + placeholderTriples + '个，YES=' + yesCount);
"
```

```bash
# 验证 2：判决以标准格式声明——文件前 30 行必须匹配 **判决**: (REVISION|APPROVED) 正则
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const header = c.split('\n').slice(0, 30).join('\n');
const verdictMatch = header.match(/\*\*判决\*\*[：:]\s*(REVISION|APPROVED)/);
if (!verdictMatch) throw new Error('FAIL: 文件前30行未以 **判决**: REVISION/APPROVED 格式声明判决');
console.log('PASS: 判决格式正确，值=' + verdictMatch[1]);
"
```

---

## Feature 3: GAN 轮次因证伪机制变多且每轮更严格

**行为描述**:
Proposer 根据 Reviewer 的证伪反馈修订命令，Reviewer 再次对新命令构造假实现。修订轮的草案必须减少可被绕过的弱命令模式（如 `accessSync`），增加实质性验证（正则计数 + 阈值比较出现在 bash 代码块内）。GAN 至少经历 2 个完整轮次（1 次 REVISION + 1 次对修订版的再审）。

**硬阈值**:
- `sprints/harness-self-check-v2/` 目录下存在 Round 2 草案的 push（`cp-harness-propose-r2-*` 分支存在，由 git remote 可查）
- Round 2 草案中 `accessSync` 调用次数 = 0（已废弃弱命令模式）
- 草案 bash 代码块内（非描述文字中）`.match(` 调用次数 >= 4，且至少 3 处伴随阈值比较（`if(` 或 `throw`）

**验证命令**:
```bash
# 验证 1：命令严格度提升——bash 代码块内 .match() 伴随阈值比较，排除描述文字中的假计数
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
// 提取所有 bash 代码块内容
const bashBlocks = [];
const bashRegex = /\x60\x60\x60bash\n([\s\S]*?)\x60\x60\x60/g;
let m;
while ((m = bashRegex.exec(c)) !== null) bashBlocks.push(m[1]);
const allBash = bashBlocks.join('\n');
// 验证 accessSync 已废弃
const accessSyncCount = (allBash.match(/accessSync/g) || []).length;
if (accessSyncCount > 0) throw new Error('FAIL: bash块中仍有' + accessSyncCount + '处accessSync');
// 验证 .match() 在 bash 块内的使用量
const matchCount = (allBash.match(/\.match\(/g) || []).length;
if (matchCount < 4) throw new Error('FAIL: bash块内.match()=' + matchCount + '（期望>=4），严格度不足');
// 验证 .match() 伴随阈值比较（同一 bash 块中有 if( 或 throw）
let matchWithThreshold = 0;
bashBlocks.forEach(block => {
  const blockMatches = (block.match(/\.match\(/g) || []).length;
  if (blockMatches > 0 && (/if\s*\(/.test(block) || /throw\s/.test(block))) {
    matchWithThreshold += blockMatches;
  }
});
if (matchWithThreshold < 3) throw new Error('FAIL: 伴随阈值比较的.match()仅' + matchWithThreshold + '处（期望>=3）');
console.log('PASS: accessSync=0，bash块内.match()=' + matchCount + '，伴随阈值比较=' + matchWithThreshold);
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
GAN 结束后，可从产物文件中完整还原对抗过程。`sprint-contract.md` 是最终 APPROVED 合同，必须包含结构化内容（Feature 标题 + 验证命令块）；`contract-review-feedback.md` 包含完整三元组；最终合同中不应包含"能否绕过: YES"（所有命令已通过验证）。"能否绕过: NO"记录必须出现在结构化三元组块内（同一 `---` 分隔区间内同时含"命令："和"能否绕过：NO"），而非描述文字中。

**硬阈值**:
- `sprint-contract.md` 包含 >= 4 个 `## Feature` 标题
- `sprint-contract.md` 包含 >= 8 个 ` ```bash ` 代码块
- `sprint-contract.md` 中"能否绕过: YES"出现 0 次（GAN 已完成）
- `sprint-contract.md` 中结构化三元组块内的"能否绕过: NO"出现 >= 1 次（有明确通过证明，非描述文字）
- `contract-review-feedback.md` 中三元组覆盖率与草案命令数挂钩（>= 60%）

**验证命令**:
```bash
# 验证 1：最终合同结构 + NO 记录在三元组块内（非描述文字）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md', 'utf8');
const features = (c.match(/^## Feature \d+/gm) || []).length;
if (features < 4) throw new Error('FAIL: sprint-contract.md Feature数不足，期望>=4，实际=' + features);
const cmds = (c.match(/^\x60\x60\x60bash/gm) || []).length;
if (cmds < 8) throw new Error('FAIL: 验证命令块不足，期望>=8，实际=' + cmds);
const yesCount = (c.match(/能否绕过[：:]\s*YES/g) || []).length;
if (yesCount > 0) throw new Error('FAIL: 最终合同仍含' + yesCount + '个YES，GAN未完成');
// NO 必须在三元组块内（同一 --- 块中同时含 命令： 和 能否绕过：NO）
const blocks = c.split('---');
let structuredNO = 0;
blocks.forEach(block => {
  if (block.includes('命令') && /能否绕过[：:]\s*NO/.test(block)) structuredNO++;
});
if (structuredNO < 1) throw new Error('FAIL: 无结构化三元组内的NO记录（仅描述文字中的NO不算），缺少证伪通过证明');
console.log('PASS: ' + features + '个Feature，' + cmds + '条命令，YES=0，结构化NO=' + structuredNO);
"
```

```bash
# 验证 2：反馈文件三元组覆盖率与草案命令数挂钩
node -e "
const fs = require('fs');
const draft = fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
const draftBashCount = (draft.match(/^\x60\x60\x60bash/gm) || []).length;
const minTriples = Math.ceil(draftBashCount * 0.6);
const feedback = fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const blocks = feedback.split('---');
let triples = 0;
blocks.forEach(b => {
  if (b.match(/命令[：:]/) && b.includes('最懒假实现') && /能否绕过[：:]\s*(YES|NO)/.test(b)) triples++;
});
if (triples < minTriples) throw new Error('FAIL: 三元组=' + triples + '，需>=' + minTriples + '（草案' + draftBashCount + '条*60%）');
const yes = (feedback.match(/能否绕过[：:]\s*YES/g) || []).length;
if (yes < 1) throw new Error('FAIL: 无YES记录，证伪机制从未触发');
console.log('PASS: 三元组=' + triples + '（>=' + minTriples + '），YES=' + yes);
"
```

---

## Workstreams

workstream_count: 2

### Workstream 1: Proposer 合同草案生成行为

**范围**: Proposer 读取 PRD -> 输出 contract-draft.md（含 Feature 结构 + 验证命令 + Workstreams 区块）+ contract-dod-ws{N}.md 文件
**大小**: S（改动 <100 行，纯产出物验证）
**依赖**: 无

**DoD**:
- [x] [ARTIFACT] `sprints/harness-self-check-v2/contract-draft.md` 存在且含 >= 4 个 Feature 标题，每个 Feature 有实质命令
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const fb=c.split(/^## Feature \d+/gm);fb.shift();if(fb.length<4)throw new Error('FAIL:Feature='+fb.length);fb.forEach((b,i)=>{if(!/\x60\x60\x60bash\n[\s\S]*?\S[\s\S]*?\x60\x60\x60/.test(b))throw new Error('FAIL:Feature '+(i+1)+'无实质bash块')});console.log('PASS:'+fb.length+'个Feature均有实质命令')"
- [x] [BEHAVIOR] Proposer 输出的草案包含 >= 8 个 bash 命令块，且每个 contract-dod-ws 文件中 [BEHAVIOR] 后有 Test: 字段
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const b=(c.match(/^\x60\x60\x60bash/gm)||[]).length;if(b<8)throw new Error('FAIL:bash='+b);const dods=fs.readdirSync('sprints/harness-self-check-v2').filter(f=>f.startsWith('contract-dod-ws'));dods.forEach(f=>{const d=fs.readFileSync('sprints/harness-self-check-v2/'+f,'utf8');const lines=d.split('\n');let beh=0,ok=0;for(let i=0;i<lines.length;i++){if(lines[i].includes('[BEHAVIOR]')){beh++;if(/Test:\s*\S+/.test(lines.slice(i+1,i+6).join('\n')))ok++}}if(beh<1)throw new Error('FAIL:'+f+'无BEHAVIOR');if(ok<beh)throw new Error('FAIL:'+f+'有'+beh+'个BEHAVIOR但'+ok+'个有Test:')});console.log('PASS:bash='+b+'，DoD文件='+dods.length+'（格式完整）')"

---

### Workstream 2: Reviewer 证伪机制 + GAN 多轮对抗

**范围**: Reviewer 对草案执行证伪分析 -> 输出三元组反馈 -> Proposer 修订 -> Reviewer 再审 -> 最终 APPROVED 合同
**大小**: M（验证涉及多个产物文件和多轮对抗记录）
**依赖**: Workstream 1 完成后

**DoD**:
- [x] [BEHAVIOR] `contract-review-feedback.md` 三元组覆盖率 >= 草案命令数 * 60%，且至少 1 个 YES（R1 证伪触发），判决格式为 `**判决**: X`
  Test: node -e "const fs=require('fs');const d=fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const bc=(d.match(/^\x60\x60\x60bash/gm)||[]).length;const min=Math.ceil(bc*0.6);const fb=fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const bks=fb.split('---');let t=0;bks.forEach(b=>{if(b.match(/命令[：:]/)&&b.includes('最懒假实现')&&/能否绕过[：:]\s*(YES|NO)/.test(b))t++});if(t<min)throw new Error('FAIL:三元组='+t+'<'+min);const y=(fb.match(/能否绕过[：:]\s*YES/g)||[]).length;if(y<1)throw new Error('FAIL:无YES');const hdr=fb.split('\n').slice(0,30).join('\n');if(!/\*\*判决\*\*[：:]\s*(REVISION|APPROVED)/.test(hdr))throw new Error('FAIL:判决格式错误');console.log('PASS:三元组='+t+'(>='+min+'),YES='+y)"
- [x] [BEHAVIOR] GAN 至少 2 轮——远端存在 `cp-harness-propose-r2-*` 分支
  Test: node -e "const {execSync}=require('child_process');const o=execSync('git ls-remote --heads origin cp-harness-propose-r2-\\*',{encoding:'utf8'});if(!o||!o.trim())throw new Error('FAIL:无R2分支');console.log('PASS:R2分支存在='+o.trim().split('\n').length+'个')"
- [x] [BEHAVIOR] 最终 `sprint-contract.md` 含 >= 4 个 Feature、>= 8 命令块、0 个 YES、结构化三元组内 >= 1 个 NO
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md','utf8');const f=(c.match(/^## Feature \d+/gm)||[]).length;const b=(c.match(/^\x60\x60\x60bash/gm)||[]).length;const y=(c.match(/能否绕过[：:]\s*YES/g)||[]).length;if(f<4)throw new Error('FAIL:Feature='+f);if(b<8)throw new Error('FAIL:bash='+b);if(y>0)throw new Error('FAIL:YES='+y);const bks=c.split('---');let sno=0;bks.forEach(bk=>{if(bk.includes('命令')&&/能否绕过[：:]\s*NO/.test(bk))sno++});if(sno<1)throw new Error('FAIL:无结构化NO');console.log('PASS:Feature='+f+',bash='+b+',YES=0,结构化NO='+sno)"
