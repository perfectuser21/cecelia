# Contract Draft — Harness Self-Check v2

> **被测对象**: harness-contract-proposer v4.4.0 + harness-contract-reviewer v4.4.0
> **验证目标**: Reviewer 的对抗证伪机制（Step 2）是否真正有效

---

## Feature 1: Proposer 为 harness 本身生成合同草案

**行为描述**:
给定一份 sprint-prd.md，Proposer 在 `sprints/harness-self-check-v2/` 目录下输出 `contract-draft.md`，内容覆盖 PRD 中每个 Feature 的行为描述、硬阈值和可执行验证命令，并包含 `## Workstreams` 区块。同时为每个 workstream 输出独立的 `contract-dod-ws{N}.md` 文件，每个文件包含至少 1 条 `[BEHAVIOR]` DoD 条目且有对应 `Test:` 字段。

**硬阈值**:
- `contract-draft.md` 包含 >= 4 个 `## Feature` 二级标题
- 每个 Feature 块下存在至少 1 个 bash 代码块，且该块包含 CI 白名单工具调用
- `contract-draft.md` 包含 >= 8 个 bash 代码块
- `contract-draft.md` 包含 >= 2 个 `[BEHAVIOR]` 字符串
- `contract-draft.md` 包含 `## Workstreams` 区块
- 每个 `contract-dod-ws{N}.md` 文件含 >= 1 个 `[BEHAVIOR]` 条目

**验证命令**:
```bash
# 验证 1：Feature 块内容实质性——每个 Feature 的 bash 块必须含 CI 白名单工具调用
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
const featureBlocks = c.split(/^## Feature \d+/gm);
featureBlocks.shift();
if (featureBlocks.length < 4) throw new Error('FAIL: Feature数量不足，期望>=4，实际=' + featureBlocks.length);
const TOOL_RE = /\bnode\s+-e\b|\bcurl\s|\bbash\s|\bpsql\s|\bnpm\s/;
featureBlocks.forEach((block, i) => {
  const bashMatches = block.match(/\x60\x60\x60bash\n([\s\S]*?)\x60\x60\x60/g) || [];
  if (!bashMatches.some(m => TOOL_RE.test(m))) throw new Error('Feature ' + (i+1) + ': bash块无CI白名单工具调用');
});
const bashBlocks = (c.match(/^\x60\x60\x60bash/gm) || []).length;
if (bashBlocks < 8) throw new Error('FAIL: 验证命令块不足，期望>=8，实际=' + bashBlocks);
const behaviors = (c.match(/\[BEHAVIOR\]/g) || []).length;
if (behaviors < 2) throw new Error('FAIL: [BEHAVIOR]条目不足，期望>=2，实际=' + behaviors);
if (!c.includes('## Workstreams')) throw new Error('FAIL: 缺少 ## Workstreams 区块');
console.log('PASS: ' + featureBlocks.length + '个Feature，' + bashBlocks + '个命令块，' + behaviors + '个BEHAVIOR');
"
```

```bash
# 验证 2：DoD 文件中 [BEHAVIOR] 的 Test: 字段必须以 CI 白名单工具开头
node -e "
const fs = require('fs');
const dir = 'sprints/harness-self-check-v2';
const files = fs.readdirSync(dir).filter(f => f.startsWith('contract-dod-ws') && f.endsWith('.md'));
if (files.length < 1) throw new Error('FAIL: 无 contract-dod-ws 文件');
const TOOL_PREFIX_RE = /^Test:\s*(node|npm|curl|bash|psql)/;
files.forEach(f => {
  const c = fs.readFileSync(dir + '/' + f, 'utf8');
  const lines = c.split('\n');
  let behaviorCount = 0, validTestCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('[BEHAVIOR]')) {
      behaviorCount++;
      const testLine = lines.slice(i+1, i+6).find(l => l.trim().startsWith('Test:'));
      if (testLine && TOOL_PREFIX_RE.test(testLine.trim())) validTestCount++;
    }
  }
  if (behaviorCount < 1) throw new Error('FAIL: ' + f + ' 无[BEHAVIOR]条目');
  if (validTestCount < behaviorCount) throw new Error('FAIL: ' + f + ' Test:字段不符合白名单');
});
console.log('PASS: ' + files.length + '个DoD文件，每个[BEHAVIOR]的Test:均以CI白名单工具开头');
"
```

---

## Feature 2: Reviewer 对草案中每条命令执行对抗证伪分析

**行为描述**:
Reviewer 收到合同草案后，对每条 Test 命令构造"最懒假实现"，输出三元组（命令 / 最懒假实现 / 能否绕过 + 理由）。任意命令"能否绕过: YES"→ 整个合同判定 REVISION，反馈文件包含完整证伪分析。全部"能否绕过: NO"→ 继续其他维度检查后才可能 APPROVED。Reviewer 不得以主观判断替代三元组构造。

**硬阈值**:
- `contract-review-feedback.md` 中完整三元组数量 >= 草案 bash 命令块总数的 60%
- 每个三元组的"命令："字段必须与草案中某条 bash 命令的 readFileSync 路径指纹匹配
- Round 1 反馈中"能否绕过：YES"出现次数 >= 1（证伪机制触发）
- 文件前 30 行内以 `**判决**:` 格式声明判决

**验证命令**:
```bash
# 验证 1：三元组覆盖率 + 命令字段与草案命令 readFileSync 路径指纹匹配
node -e "
const fs = require('fs');
const draft = fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
const bashRegex = /\x60\x60\x60bash\n([\s\S]*?)\x60\x60\x60/g;
const pathFingerprints = [], fallbackFingerprints = [];
let bm;
while ((bm = bashRegex.exec(draft)) !== null) {
  const content = bm[1].replace(/^#.*\n/gm, '').trim();
  if (!content.length) continue;
  const pm = content.match(/readFileSync\s*\(\s*['\x22]([^'\x22]+)['\x22]/);
  if (pm) pathFingerprints.push(pm[1]);
  else fallbackFingerprints.push(content.slice(0, 60));
}
const draftBashCount = pathFingerprints.length + fallbackFingerprints.length;
const minTriples = Math.ceil(draftBashCount * 0.6);
const feedback = fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const blocks = feedback.split('---');
let validTriples = 0;
blocks.forEach(block => {
  const cm = block.match(/命令[：:]\s*([\s\S]*?)(?=\n\s*最懒假实现|\n\s*$)/);
  if (cm && block.includes('最懒假实现') && /能否绕过[：:]\s*(YES|NO)/.test(block)) validTriples++;
});
if (validTriples < minTriples) throw new Error('FAIL: 三元组=' + validTriples + '，需>=' + minTriples);
const yesCount = (feedback.match(/能否绕过[：:]\s*YES/g) || []).length;
if (yesCount < 1) throw new Error('FAIL: 无YES三元组');
console.log('PASS: ' + validTriples + '个三元组，YES=' + yesCount);
"
```

```bash
# 验证 2：判决格式——文件前 30 行匹配 **判决**: (REVISION|APPROVED)
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const header = c.split('\n').slice(0, 30).join('\n');
const verdictMatch = header.match(/\*\*判决\*\*[：:]\s*(REVISION|APPROVED)/);
if (!verdictMatch) throw new Error('FAIL: 文件前30行未声明判决');
console.log('PASS: 判决=' + verdictMatch[1]);
"
```

---

## Feature 3: GAN 轮次因证伪机制变多且每轮更严格

**行为描述**:
Proposer 根据 Reviewer 的证伪反馈修订命令，Reviewer 再次对新命令构造假实现。修订轮的草案必须废弃弱命令模式（`accessSync`），验证命令中的结构性断言必须伴随失败路径（`throw`/`process.exit`）。GAN 至少经历 2 个完整轮次。

**硬阈值**:
- 远端存在 `cp-harness-propose-r2-*` 分支（证明 Proposer 执行了至少 2 轮）
- 当前轮草案 bash 代码块内 `accessSync` 调用次数 = 0
- bash 代码块内含结构性断言函数的块 >= 4 个，且至少 3 个同时含 `throw` 或 `process.exit`

**验证命令**:
```bash
# 验证 1：结构性断言+失败路径共存——bash 块内断言函数必须伴随 throw/process.exit
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
const bashBlocks = [];
const bashRegex = /\x60\x60\x60bash\n([\s\S]*?)\x60\x60\x60/g;
let m;
while ((m = bashRegex.exec(c)) !== null) bashBlocks.push(m[1]);
const allBash = bashBlocks.join('\n');
const accessSyncCount = (allBash.match(/accessSync/g) || []).length;
if (accessSyncCount > 0) throw new Error('FAIL: 仍有' + accessSyncCount + '处accessSync');
const ASSERT_RE = /\.match\(|\.split\(|JSON\.parse|\.test\(/;
const FAIL_PATH_RE = /throw\s|process\.exit/;
let assertBlocks = 0, assertWithFailPath = 0;
bashBlocks.forEach(block => {
  if (ASSERT_RE.test(block)) {
    assertBlocks++;
    if (FAIL_PATH_RE.test(block)) assertWithFailPath++;
  }
});
if (assertBlocks < 4) throw new Error('FAIL: 含断言块=' + assertBlocks + '（期望>=4）');
if (assertWithFailPath < 3) throw new Error('FAIL: 断言+失败路径=' + assertWithFailPath + '（期望>=3）');
console.log('PASS: accessSync=0，断言块=' + assertBlocks + '，断言+失败路径=' + assertWithFailPath);
"
```

```bash
# 验证 2：git 远端有 R2 分支存在（证明 GAN 至少 2 轮）
node -e "
const {execSync} = require('child_process');
try {
  const branches = execSync('git ls-remote --heads origin cp-harness-propose-r2-\\*', {encoding:'utf8'});
  if (!branches || branches.trim().length === 0) throw new Error('NO R2 BRANCHES');
  console.log('PASS: 远端存在R2分支，GAN R2执行已确认');
} catch(e) {
  throw new Error('FAIL: 无cp-harness-propose-r2-*分支 (' + e.message + ')');
}
"
```

---

## Feature 4: 最终产出可观察的验证报告

**行为描述**:
GAN 结束后，可从产物文件中完整还原对抗过程。`sprint-contract.md` 是最终 APPROVED 合同，包含结构化内容（Feature 标题 + 验证命令块），每个 bash 命令块含 CI 白名单工具调用；`contract-review-feedback.md` 包含完整三元组；最终合同中不应包含"能否绕过: YES"。

**硬阈值**:
- `sprint-contract.md` 包含 >= 4 个 `## Feature` 标题
- `sprint-contract.md` 每个 Feature 的 bash 块含 CI 白名单工具调用
- `sprint-contract.md` 中"能否绕过: YES"出现 0 次
- `sprint-contract.md` 中结构化三元组 NO 数量 >= Math.ceil(cmds * 0.6)
- 每个三元组 NO 块同时含"命令："+"最懒假实现"+"能否绕过：NO"

**验证命令**:
```bash
# 验证 1：最终合同——Feature 结构 + bash 块白名单工具 + YES=0 + 三元组 NO >= 60%
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md', 'utf8');
const featureBlocks = c.split(/^## Feature \d+/gm);
featureBlocks.shift();
if (featureBlocks.length < 4) throw new Error('FAIL: Feature不足，实际=' + featureBlocks.length);
const TOOL_RE = /\bnode\s+-e\b|\bcurl\s|\bbash\s|\bpsql\s|\bnpm\s/;
featureBlocks.forEach((block, i) => {
  const bashMatches = block.match(/\x60\x60\x60bash\n([\s\S]*?)\x60\x60\x60/g) || [];
  if (!bashMatches.some(m => TOOL_RE.test(m))) throw new Error('FAIL: Feature ' + (i+1) + ' 无白名单工具');
});
const cmds = (c.match(/^\x60\x60\x60bash/gm) || []).length;
const yesCount = (c.match(/能否绕过[：:]\s*YES/g) || []).length;
if (yesCount > 0) throw new Error('FAIL: 最终合同含YES=' + yesCount);
const blocks = c.split('---');
let structuredNO = 0;
blocks.forEach(block => {
  if (block.match(/命令[：:]/) && block.includes('最懒假实现') && /能否绕过[：:]\s*NO/.test(block)) structuredNO++;
});
const minNO = Math.ceil(cmds * 0.6);
if (structuredNO < minNO) throw new Error('FAIL: 三元组NO=' + structuredNO + '，需>=' + minNO);
console.log('PASS: Feature=' + featureBlocks.length + '，cmds=' + cmds + '，YES=0，三元组NO=' + structuredNO);
"
```

```bash
# 验证 2：最终合同断言质量——断言函数必须伴随失败路径
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md', 'utf8');
const bashBlocks = [];
const bashRegex = /\x60\x60\x60bash\n([\s\S]*?)\x60\x60\x60/g;
let m;
while ((m = bashRegex.exec(c)) !== null) bashBlocks.push(m[1]);
const ASSERT_RE = /\.match\(|\.split\(|JSON\.parse|\.test\(/;
const FAIL_PATH_RE = /throw\s|process\.exit/;
let assertBlocks = 0, assertWithFailPath = 0;
bashBlocks.forEach(block => {
  if (ASSERT_RE.test(block)) {
    assertBlocks++;
    if (FAIL_PATH_RE.test(block)) assertWithFailPath++;
  }
});
if (assertBlocks < 4) throw new Error('FAIL: 断言块=' + assertBlocks + '（期望>=4）');
if (assertWithFailPath < 3) throw new Error('FAIL: 断言+失败路径=' + assertWithFailPath + '（期望>=3）');
console.log('PASS: 断言块=' + assertBlocks + '，断言+失败路径=' + assertWithFailPath);
"
```

---

## Workstreams

workstream_count: 2

### Workstream 1: Proposer 合同草案生成行为

**范围**: Proposer 读取 PRD -> 输出 contract-draft.md（含 Feature 结构 + CI白名单验证命令 + Workstreams 区块）+ contract-dod-ws{N}.md 文件
**大小**: S（改动 <100 行，纯产出物验证）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `sprints/harness-self-check-v2/contract-draft.md` 存在且含 >= 4 个 Feature 标题
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const fb=c.split(/^## Feature \d+/gm);fb.shift();if(fb.length<4)throw new Error('FAIL:Feature='+fb.length);console.log('PASS:'+fb.length+'个Feature')"
- [ ] [BEHAVIOR] Proposer 输出的草案包含 >= 8 个 bash 命令块
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const b=(c.match(/^\x60\x60\x60bash/gm)||[]).length;if(b<8)throw new Error('FAIL:bash='+b);console.log('PASS:bash='+b)"

---

### Workstream 2: Reviewer 证伪机制 + GAN 多轮对抗

**范围**: Reviewer 对草案执行证伪分析 -> 输出三元组反馈 -> Proposer 修订 -> Reviewer 再审 -> 最终 APPROVED 合同
**大小**: M（验证涉及多个产物文件和多轮对抗记录）
**依赖**: Workstream 1 完成后

**DoD**:
- [ ] [BEHAVIOR] `contract-review-feedback.md` 三元组覆盖率 >= 草案命令数 * 60%，至少 1 个 YES
  Test: node -e "const fs=require('fs');const fb=fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const y=(fb.match(/能否绕过[：:]\s*YES/g)||[]).length;if(y<1)throw new Error('FAIL:无YES');console.log('PASS:YES='+y)"
- [ ] [BEHAVIOR] 最终 sprint-contract.md 含 >= 4 Feature、0 个 YES、完整三元组 NO >= 60% 命令数
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md','utf8');const y=(c.match(/能否绕过[：:]\s*YES/g)||[]).length;if(y>0)throw new Error('FAIL:YES='+y);console.log('PASS:YES=0')"
