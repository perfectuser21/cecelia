# Sprint Contract Draft (Round 3)

> **被测对象**: harness-contract-proposer v4.4.0 + harness-contract-reviewer v4.4.0
> **验证目标**: Reviewer 的对抗证伪机制（Step 2）是否真正有效——能否识别弱命令并触发 REVISION
> **第三轮改动说明**: 根据 Round 2 Reviewer 证伪反馈（7/9 命令可绕过），全面重写验证命令：
> - 废弃纯计数验证（标题数/关键词数），改为**块级内容实质性校验**（每个 Feature 块必须含非空描述+命令块）
> - 废弃单一 `[BEHAVIOR]` 字符串检查，改为**格式链验证**（`- [ ] [BEHAVIOR]` + 紧随 `Test:` 行）
> - 三元组验证从任意阈值(>=3)改为**与草案命令数挂钩**（三元组数 >= bash块数 × 60%）
> - 判决检测从字符串存在改为**正则格式匹配**（`**判决**:` 或 `**判决**：`）
> - `.match(` 计数从全文搜索改为**仅统计 ```bash 块内出现**
> - "能否绕过：NO" 从全文搜索改为**块级三元组内匹配**（同块含"命令："+"能否绕过：NO"）

---

## Feature 1: Proposer 为 harness 本身生成合同草案

**行为描述**:
给定一份 sprint-prd.md，Proposer 在 `sprints/harness-self-check-v2/` 目录下输出 `contract-draft.md`，内容覆盖 PRD 中每个 Feature 的行为描述、硬阈值和可执行验证命令，并包含 `## Workstreams` 区块。同时为每个 workstream 输出独立的 `contract-dod-ws{N}.md` 文件，每个文件包含格式正确的 `[BEHAVIOR]` DoD 条目（含 `Test:` 字段）。

**硬阈值**:
- `contract-draft.md` 包含 >= 4 个 `## Feature` 二级标题，且**每个 Feature 块内含至少 1 个非空 ```bash 代码块**（长度 >= 30 字符）
- `contract-draft.md` 包含 `## Workstreams` 区块
- 每个 `contract-dod-ws{N}.md` 文件中，每条 `[BEHAVIOR]` 条目后紧跟 `Test:` 行且 Test 值非空

**验证命令**:
```bash
# 验证 1：每个 Feature 块必须含实质内容（非空描述 + 至少1个有内容的 bash 块）
# 防御：纯标题空壳文件无法通过——拆分为 Feature 块后逐块验证内容长度和命令块存在
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
const featureSections = c.split(/^## Feature \d+/m).slice(1);
if (featureSections.length < 4) throw new Error('FAIL: Feature块数量不足，期望>=4，实际=' + featureSections.length);
featureSections.forEach((section, i) => {
  const textLen = section.replace(/\`\`\`[\s\S]*?\`\`\`/g, '').trim().length;
  if (textLen < 50) throw new Error('FAIL: Feature ' + (i+1) + ' 描述文本不足50字符（实际=' + textLen + '），空壳块');
  const bashBlocks = section.match(/\`\`\`bash\n([\s\S]*?)\`\`\`/g) || [];
  const nonEmptyBash = bashBlocks.filter(b => b.replace(/\`\`\`bash\n?|\`\`\`/g, '').trim().length >= 30);
  if (nonEmptyBash.length < 1) throw new Error('FAIL: Feature ' + (i+1) + ' 无有效bash命令块（需>=30字符内容）');
});
if (!c.includes('## Workstreams')) throw new Error('FAIL: 缺少 ## Workstreams 区块');
console.log('PASS: ' + featureSections.length + '个Feature，每个含实质描述+有效命令块，Workstreams存在');
"
```

```bash
# 验证 2：每个 contract-dod-ws 文件中 [BEHAVIOR] 条目必须有格式正确的 Test: 行
# 防御：单行 "[BEHAVIOR]" 无法绕过——验证 "- [ ] [BEHAVIOR]" 格式 + 紧随非空 Test: 行
node -e "
const fs = require('fs');
const dir = 'sprints/harness-self-check-v2';
const files = fs.readdirSync(dir).filter(f => f.startsWith('contract-dod-ws') && f.endsWith('.md'));
if (files.length < 1) throw new Error('FAIL: 无 contract-dod-ws 文件');
let totalBehaviors = 0;
files.forEach(f => {
  const lines = fs.readFileSync(dir + '/' + f, 'utf8').split('\n');
  let behaviorCount = 0;
  lines.forEach((line, idx) => {
    if (/^- \[[ x]\] \[BEHAVIOR\]/.test(line)) {
      behaviorCount++;
      const nextLine = (lines[idx + 1] || '').trim();
      if (!/^Test:\s*.{10,}/.test(nextLine)) throw new Error('FAIL: ' + f + ' 第' + (idx+1) + '行 [BEHAVIOR] 后缺少有效 Test: 行（下一行: \"' + nextLine.slice(0,40) + '\")');
    }
  });
  if (behaviorCount < 1) throw new Error('FAIL: ' + f + ' 无格式正确的 [BEHAVIOR] 条目（需 \"- [ ] [BEHAVIOR]\" 格式）');
  totalBehaviors += behaviorCount;
});
console.log('PASS: ' + files.length + '个DoD文件，共' + totalBehaviors + '个[BEHAVIOR]条目，每个含有效Test:行');
"
```

---

## Feature 2: Reviewer 对草案中每条命令执行对抗证伪分析

**行为描述**:
Reviewer 收到合同草案后，对每条 Test 命令构造"最懒假实现"，输出三元组（命令 / 最懒假实现 / 能否绕过 + 理由）。任意命令"能否绕过: YES"→ 整个合同判定 REVISION，反馈文件包含完整证伪分析。全部"能否绕过: NO"→ 继续其他维度检查后才可能 APPROVED。Reviewer 不得以主观判断替代三元组构造。

**硬阈值**:
- `contract-review-feedback.md` 中三元组数量 >= 草案中 bash 命令块数量的 60%（三元组与命令数挂钩，非任意固定值）
- 每个三元组的"命令："行后有 >= 10 字符的实质命令内容（非空占位）
- Round 1 反馈中"能否绕过：YES"出现次数 >= 1（证伪机制触发）
- 判决以结构化格式声明：`**判决**: REVISION` 或 `**判决**: APPROVED`

**验证命令**:
```bash
# 验证 1：三元组数量与草案命令数挂钩 + 每个三元组命令行有实质内容
# 防御：占位三元组无法绕过——命令行必须 >=10字符实质内容；三元组数量动态绑定草案命令数
node -e "
const fs = require('fs');
const draft = fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
const draftBashCount = (draft.match(/\`\`\`bash/g) || []).length;
const minTriples = Math.ceil(draftBashCount * 0.6);
const feedback = fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const blocks = feedback.split('---');
let validTriples = 0;
blocks.forEach(block => {
  const cmdMatch = block.match(/命令[：:]\s*(.+)/);
  const hasLazy = /最懒假实现[：:]/.test(block);
  const hasBypass = /能否绕过[：:]\s*(YES|NO)/.test(block);
  if (cmdMatch && hasLazy && hasBypass) {
    const cmdContent = cmdMatch[1].replace(/\`/g, '').trim();
    if (cmdContent.length >= 10) validTriples++;
  }
});
if (validTriples < minTriples) throw new Error('FAIL: 有效三元组=' + validTriples + '，需>=' + minTriples + '（草案bash块=' + draftBashCount + '的60%），三元组覆盖不足');
const yesCount = (feedback.match(/能否绕过[：:]\s*YES/g) || []).length;
if (yesCount < 1) throw new Error('FAIL: 无YES，证伪机制未触发');
console.log('PASS: 有效三元组=' + validTriples + '/' + minTriples + '需要，YES=' + yesCount + '，证伪机制已触发');
"
```

```bash
# 验证 2：判决以结构化格式声明（正则匹配，非任意字符串包含）
# 防御：标题中偶然出现的 "REVISION" 无法绕过——必须匹配 "**判决**" + ": " + 判决值
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const header = c.split('\n').slice(0, 30).join('\n');
const verdictMatch = header.match(/\*\*判决\*\*[：:]\s*(REVISION|APPROVED)/);
if (!verdictMatch) throw new Error('FAIL: 前30行未找到结构化判决（需 \"**判决**: REVISION\" 或 \"**判决**: APPROVED\" 格式）');
console.log('PASS: 判决格式正确，值=' + verdictMatch[1]);
"
```

---

## Feature 3: GAN 轮次因证伪机制变多且每轮更严格

**行为描述**:
Proposer 根据 Reviewer 的证伪反馈修订命令，Reviewer 再次对新命令构造假实现。修订轮的草案必须减少可被绕过的弱命令模式（如 `accessSync`），在 ```bash 命令块内增加结构性断言（正则/JSON解析/块级拆分）。GAN 至少经历 2 个完整轮次（1 次 REVISION + 1 次对修订版的再审）。

**硬阈值**:
- 远端存在 `cp-harness-propose-r2-*` 分支（GAN 至少 2 轮）
- Round 2+ 草案的 ```bash 块内 `accessSync` 调用 = 0
- Round 2+ 草案的 ```bash 块内含 `.match(` 或 `.test(` 或 `JSON.parse` 的**命令块**数量 >= 4（仅统计 bash 块内，非全文）

**验证命令**:
```bash
# 验证 1：Round 2+ 草案 bash 块内无 accessSync + bash 块内结构性断言充足
# 防御：描述文本中插入 .match( 无法绕过——仅提取 ```bash 块内容后统计
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
const bashBlocks = c.match(/\`\`\`bash\n([\s\S]*?)\`\`\`/g) || [];
const bashContent = bashBlocks.join('\n');
const accessSyncCount = (bashContent.match(/accessSync/g) || []).length;
if (accessSyncCount > 0) throw new Error('FAIL: bash块内仍有' + accessSyncCount + '处accessSync（可被touch绕过）');
let structuralBlocks = 0;
bashBlocks.forEach(block => {
  if (/\.match\(|\.test\(|JSON\.parse|\.split\(/.test(block)) structuralBlocks++;
});
if (structuralBlocks < 4) throw new Error('FAIL: 含结构性断言(.match/.test/JSON.parse/.split)的bash块=' + structuralBlocks + '，需>=4');
console.log('PASS: accessSync=0，含结构性断言的bash块=' + structuralBlocks + '（命令严格度已提升）');
"
```

```bash
# 验证 2：git 远端有 R2 分支存在（证明 Proposer 执行了第2轮）
# 防御：git ls-remote 验证远端二进制事实，不可伪造 ✓
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
GAN 结束后，可从产物文件中完整还原对抗过程。`sprint-contract.md` 是最终 APPROVED 合同，每个 Feature 块必须含实质描述和命令块；`contract-review-feedback.md` 包含与草案命令数挂钩的完整三元组；最终合同不应包含"能否绕过: YES"，且"能否绕过: NO"必须出现在结构化三元组块内（非描述文字）。

**硬阈值**:
- `sprint-contract.md` 每个 Feature 块含实质内容（描述 >= 50 字符 + 至少 1 个非空 bash 块）
- `sprint-contract.md` 中"能否绕过：YES"出现 0 次
- `sprint-contract.md` 中"能否绕过：NO"出现在**结构化三元组块内**（同一 `---` 块含"命令："和"能否绕过：NO"）而非散落在描述中
- `contract-review-feedback.md` 中有效三元组数 >= 草案 bash 块数的 60%

**验证命令**:
```bash
# 验证 1：最终合同每个 Feature 块有实质内容 + 无 YES 残留 + NO 在三元组块内
# 防御：空壳文件+描述中插入 "能否绕过：NO" 均无法绕过——块级拆分验证内容实质性 + NO 必须与"命令："同块
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md', 'utf8');
const featureSections = c.split(/^## Feature \d+/m).slice(1);
if (featureSections.length < 4) throw new Error('FAIL: Feature块不足，期望>=4，实际=' + featureSections.length);
featureSections.forEach((s, i) => {
  const textLen = s.replace(/\`\`\`[\s\S]*?\`\`\`/g, '').trim().length;
  if (textLen < 50) throw new Error('FAIL: Feature ' + (i+1) + ' 描述不足50字符');
  const bashBlocks = (s.match(/\`\`\`bash\n([\s\S]*?)\`\`\`/g) || []).filter(b => b.replace(/\`\`\`bash\n?|\`\`\`/g,'').trim().length >= 30);
  if (bashBlocks.length < 1) throw new Error('FAIL: Feature ' + (i+1) + ' 无有效bash命令块');
});
const yesCount = (c.match(/能否绕过[：:]\s*YES/g) || []).length;
if (yesCount > 0) throw new Error('FAIL: 最终合同仍含' + yesCount + '个YES，GAN未完成');
const blocks = c.split('---');
let structuredNO = 0;
blocks.forEach(block => {
  if (/命令[：:]/.test(block) && /能否绕过[：:]\s*NO/.test(block)) structuredNO++;
});
if (structuredNO < 1) throw new Error('FAIL: 无结构化NO记录（需在同一---块内含\"命令：\"和\"能否绕过：NO\"）');
console.log('PASS: ' + featureSections.length + '个Feature有实质内容，YES=0，结构化NO=' + structuredNO);
"
```

```bash
# 验证 2：反馈文件三元组与草案命令数挂钩 + 每个三元组命令行有实质内容 + YES >= 1
# 防御：复用 Feature 2 验证 1 的加固逻辑，确保反馈文件独立可验证
node -e "
const fs = require('fs');
const draft = fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
const draftBashCount = (draft.match(/\`\`\`bash/g) || []).length;
const minTriples = Math.ceil(draftBashCount * 0.6);
const feedback = fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const blocks = feedback.split('---');
let validTriples = 0;
blocks.forEach(block => {
  const cmdMatch = block.match(/命令[：:]\s*(.+)/);
  const hasLazy = /最懒假实现[：:]/.test(block);
  const hasBypass = /能否绕过[：:]\s*(YES|NO)/.test(block);
  if (cmdMatch && hasLazy && hasBypass) {
    const cmdContent = cmdMatch[1].replace(/\`/g, '').trim();
    if (cmdContent.length >= 10) validTriples++;
  }
});
if (validTriples < minTriples) throw new Error('FAIL: 有效三元组=' + validTriples + '，需>=' + minTriples);
const yes = (feedback.match(/能否绕过[：:]\s*YES/g) || []).length;
if (yes < 1) throw new Error('FAIL: 无YES，证伪机制从未触发');
console.log('PASS: 有效三元组=' + validTriples + '/' + minTriples + '需要，YES=' + yes);
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
- [ ] [ARTIFACT] `sprints/harness-self-check-v2/contract-draft.md` 存在且每个 Feature 块含实质描述+有效命令块
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const ss=c.split(/^## Feature \d+/m).slice(1);if(ss.length<4)throw new Error('FAIL:Feature='+ss.length);ss.forEach((s,i)=>{const t=s.replace(/\`\`\`[\s\S]*?\`\`\`/g,'').trim().length;if(t<50)throw new Error('FAIL:Feature'+(i+1)+'描述='+t);const b=(s.match(/\`\`\`bash\n([\s\S]*?)\`\`\`/g)||[]).filter(x=>x.replace(/\`\`\`bash\n?|\`\`\`/g,'').trim().length>=30);if(b.length<1)throw new Error('FAIL:Feature'+(i+1)+'无有效bash块')});console.log('PASS:'+ss.length+'个Feature块内容完整')"
- [ ] [BEHAVIOR] 每个 contract-dod-ws 文件中 [BEHAVIOR] 条目后紧跟有效 Test: 行
  Test: node -e "const fs=require('fs');const dir='sprints/harness-self-check-v2';const files=fs.readdirSync(dir).filter(f=>f.startsWith('contract-dod-ws')&&f.endsWith('.md'));if(!files.length)throw new Error('FAIL:无DoD文件');let total=0;files.forEach(f=>{const lines=fs.readFileSync(dir+'/'+f,'utf8').split('\n');lines.forEach((l,i)=>{if(/^- \[[ x]\] \[BEHAVIOR\]/.test(l)){total++;const next=(lines[i+1]||'').trim();if(!/^Test:\s*.{10,}/.test(next))throw new Error('FAIL:'+f+' L'+(i+1)+' BEHAVIOR后无有效Test行')}})});if(!total)throw new Error('FAIL:无BEHAVIOR条目');console.log('PASS:'+total+'个BEHAVIOR条目，每个含有效Test行')"

---

### Workstream 2: Reviewer 证伪机制 + GAN 多轮对抗

**范围**: Reviewer 对草案执行证伪分析 → 输出三元组反馈 → Proposer 修订 → Reviewer 再审 → 最终 APPROVED 合同
**大小**: M（验证涉及多个产物文件和多轮对抗记录）
**依赖**: Workstream 1 完成后

**DoD**:
- [ ] [BEHAVIOR] `contract-review-feedback.md` 三元组数量与草案命令数挂钩（>=60%），每个三元组命令行 >=10 字符，且至少 1 个 YES
  Test: node -e "const fs=require('fs');const d=fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const bc=(d.match(/\`\`\`bash/g)||[]).length;const min=Math.ceil(bc*0.6);const fb=fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const blocks=fb.split('---');let t=0;blocks.forEach(b=>{const m=b.match(/命令[：:]\s*(.+)/);if(m&&/最懒假实现[：:]/.test(b)&&/能否绕过[：:]\s*(YES|NO)/.test(b)&&m[1].replace(/\`/g,'').trim().length>=10)t++});if(t<min)throw new Error('FAIL:三元组='+t+'/'+min);const y=(fb.match(/能否绕过[：:]\s*YES/g)||[]).length;if(y<1)throw new Error('FAIL:无YES');console.log('PASS:三元组='+t+'/'+min+'，YES='+y)"
- [ ] [BEHAVIOR] GAN 至少 2 轮——远端存在 `cp-harness-propose-r2-*` 分支
  Test: node -e "const {execSync}=require('child_process');const o=execSync('git ls-remote --heads origin cp-harness-propose-r2-\\*',{encoding:'utf8'});if(!o||!o.trim())throw new Error('FAIL:无R2分支');console.log('PASS:R2分支存在='+o.trim().split('\n').length+'个')"
- [ ] [BEHAVIOR] 最终 `sprint-contract.md` 每个 Feature 有实质内容，YES=0，NO 在结构化三元组块内
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md','utf8');const ss=c.split(/^## Feature \d+/m).slice(1);if(ss.length<4)throw new Error('FAIL:Feature='+ss.length);ss.forEach((s,i)=>{const t=s.replace(/\`\`\`[\s\S]*?\`\`\`/g,'').trim().length;if(t<50)throw new Error('Feature'+(i+1)+'描述不足')});const y=(c.match(/能否绕过[：:]\s*YES/g)||[]).length;if(y>0)throw new Error('FAIL:YES='+y);const blocks=c.split('---');let no=0;blocks.forEach(b=>{if(/命令[：:]/.test(b)&&/能否绕过[：:]\s*NO/.test(b))no++});if(no<1)throw new Error('FAIL:无结构化NO');console.log('PASS:Feature='+ss.length+'，YES=0，结构化NO='+no)"
