# Sprint Contract Draft (Round 1)

## Feature 1: Proposer 为 harness 本身生成合同草案

**行为描述**:
Proposer 读取 sprint-prd.md 后，输出一份 contract-draft.md 文件到 sprint_dir。该文件包含：每个 PRD 功能点的行为描述、硬阈值、可直接执行的验证命令。合同末尾包含 `## Workstreams` 区块，定义独立可并行的工作流，每个 workstream 带 DoD 条目。同时为每个 workstream 输出独立的 contract-dod-ws{N}.md 文件。

**硬阈值**:
- contract-draft.md 存在于 sprint_dir 且不为空（>200 字节）
- 合同中每个 Feature 区块包含 `**验证命令**:` 子节，内含至少 1 个 bash 代码块
- 合同包含 `## Workstreams` 区块，且 workstream_count >= 2
- 每个 workstream 有 `**DoD**:` 子节，含至少 1 个 `[BEHAVIOR]` 条目
- 每个 workstream 对应的 contract-dod-ws{N}.md 文件存在且内容与合同 DoD 一致

**验证命令**:
```bash
# Happy path：contract-draft.md 存在且有实质内容
node -e "
  const fs = require('fs');
  const c = fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
  if (c.length < 200) throw new Error('FAIL: 合同内容不足200字节，实际 ' + c.length);
  if (!c.includes('## Feature')) throw new Error('FAIL: 缺少 Feature 区块');
  if (!c.includes('**验证命令**')) throw new Error('FAIL: 缺少验证命令子节');
  if (!c.includes('## Workstreams')) throw new Error('FAIL: 缺少 Workstreams 区块');
  const wsMatch = c.match(/workstream_count:\s*(\d+)/);
  if (!wsMatch || parseInt(wsMatch[1]) < 2) throw new Error('FAIL: workstream_count 不存在或 < 2');
  console.log('PASS: 合同结构完整，workstream_count=' + wsMatch[1]);
"

# 边界：每个 workstream 的 DoD 文件存在且含 [BEHAVIOR] 条目
node -e "
  const fs = require('fs');
  const dir = 'sprints/harness-self-check-v2';
  const draft = fs.readFileSync(dir + '/contract-draft.md', 'utf8');
  const wsCount = parseInt(draft.match(/workstream_count:\s*(\d+)/)[1]);
  for (let i = 1; i <= wsCount; i++) {
    const dodFile = dir + '/contract-dod-ws' + i + '.md';
    const content = fs.readFileSync(dodFile, 'utf8');
    if (!content.includes('[BEHAVIOR]')) throw new Error('FAIL: ' + dodFile + ' 缺少 [BEHAVIOR] 条目');
    if (!content.includes('Test:')) throw new Error('FAIL: ' + dodFile + ' 缺少 Test 字段');
  }
  console.log('PASS: ' + wsCount + ' 个 DoD 文件全部含 [BEHAVIOR] + Test 字段');
"
```

---

## Feature 2: Reviewer 对草案中每条命令执行对抗证伪分析

**行为描述**:
Reviewer 收到合同草案后，对每条 Test 命令逐一构造"最懒假实现"，输出三元组：`命令 / 最懒假实现 / 能否绕过 + 理由`。任意命令被判定为"能否绕过: YES"时，整份草案判定为 REVISION。Reviewer 不以主观判断替代证伪构造。

**硬阈值**:
- contract-review-feedback.md 存在且包含 `## 证伪分析` 区块
- 每条 Test 命令均有对应三元组输出（`命令：` / `最懒假实现：` / `能否绕过：` / `理由：`）
- 至少 1 条命令被判定为 `能否绕过：YES`（第 1 轮）
- 判定 YES 时整体结论为 REVISION

**验证命令**:
```bash
# Happy path：feedback 文件存在且包含完整证伪分析结构
node -e "
  const fs = require('fs');
  const c = fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
  if (!c.includes('## 证伪分析')) throw new Error('FAIL: 缺少证伪分析区块');
  const cmdCount = (c.match(/命令：/g) || []).length;
  const fakeCount = (c.match(/最懒假实现：/g) || []).length;
  const bypassCount = (c.match(/能否绕过：/g) || []).length;
  if (cmdCount < 2) throw new Error('FAIL: 三元组数量不足，命令条数=' + cmdCount);
  if (cmdCount !== fakeCount || cmdCount !== bypassCount) throw new Error('FAIL: 三元组不完整 cmd=' + cmdCount + ' fake=' + fakeCount + ' bypass=' + bypassCount);
  console.log('PASS: 证伪分析包含 ' + cmdCount + ' 组完整三元组');
"

# 边界：第 1 轮至少 1 条 YES，且整体结论为 REVISION
node -e "
  const fs = require('fs');
  const c = fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
  const yesCount = (c.match(/能否绕过：\s*YES/gi) || []).length;
  if (yesCount < 1) throw new Error('FAIL: 第 1 轮应至少 1 条 YES，实际 ' + yesCount);
  if (!c.includes('REVISION')) throw new Error('FAIL: 存在 YES 但整体结论未标记 REVISION');
  console.log('PASS: ' + yesCount + ' 条命令被证伪，整体结论为 REVISION');
"
```

---

## Feature 3: GAN 轮次因证伪机制变多且每轮更严格

**行为描述**:
Proposer 根据 Reviewer 的证伪反馈修订命令后再次提交。Reviewer 对修订版重新执行证伪分析。GAN 至少经历 2 个完整轮次（Round 1 REVISION + Round 2 对修订版再审）。修订后的 Test 命令相比前一轮更严格（增加了更多断言条件或结构校验）。

**硬阈值**:
- 至少存在 2 份 contract-draft.md（Round 1 和 Round 2，可通过 git log 或文件头 Round 标记区分）
- Round 2 的 Test 命令在 Round 1 被标记 YES 的位置上有可观测的增强（更多断言/结构校验）
- 最终 APPROVED 的合同中所有命令均通过 `能否绕过: NO` 验证

**验证命令**:
```bash
# Happy path：最终合同 sprint-contract.md 存在且包含 Workstreams
node -e "
  const fs = require('fs');
  const c = fs.readFileSync('sprints/harness-self-check-v2/sprint-contract.md', 'utf8');
  if (c.length < 200) throw new Error('FAIL: 最终合同内容不足');
  if (!c.includes('## Workstreams')) throw new Error('FAIL: 最终合同缺少 Workstreams');
  if (!c.includes('**验证命令**')) throw new Error('FAIL: 最终合同缺少验证命令');
  console.log('PASS: 最终合同结构完整');
"

# 边界：git log 中至少 2 轮 contract draft commit
bash -c "
  cd sprints/harness-self-check-v2 2>/dev/null || true
  ROUND_COMMITS=\$(git log --all --oneline --grep='round-' -- sprints/harness-self-check-v2/contract-draft.md 2>/dev/null | wc -l | tr -d ' ')
  if [ \"\$ROUND_COMMITS\" -lt 2 ]; then
    echo \"FAIL: GAN 轮次不足 2 轮，实际 commit 数=\$ROUND_COMMITS\"
    exit 1
  fi
  echo \"PASS: 找到 \$ROUND_COMMITS 轮 contract draft commit\"
"
```

---

## Feature 4: 最终产出可观察的验证报告

**行为描述**:
GAN 结束后，sprint_dir 下存在完整的产物链：sprint-prd.md（PRD）、contract-draft.md（最后一轮草案）、contract-review-feedback.md（各轮反馈含证伪分析）、sprint-contract.md（最终 APPROVED 合同）。从这些文件可以完整还原对抗过程。

**硬阈值**:
- sprint_dir 下同时存在以下 4 种文件：sprint-prd.md、contract-draft.md、contract-review-feedback.md、sprint-contract.md
- contract-review-feedback.md 中可追踪到"哪条命令被证伪 → 修订后是否通过"
- sprint-contract.md 中所有命令在最终审查中均标记为 `能否绕过: NO`

**验证命令**:
```bash
# Happy path：4 个核心产物文件全部存在且非空
node -e "
  const fs = require('fs');
  const dir = 'sprints/harness-self-check-v2';
  const files = ['sprint-prd.md', 'contract-draft.md', 'contract-review-feedback.md', 'sprint-contract.md'];
  const results = [];
  for (const f of files) {
    const path = dir + '/' + f;
    const stat = fs.statSync(path);
    if (stat.size < 100) throw new Error('FAIL: ' + f + ' 文件太小（' + stat.size + ' 字节）');
    results.push(f + '=' + stat.size + 'B');
  }
  console.log('PASS: 4 个核心产物全部存在 — ' + results.join(', '));
"

# 边界：feedback 中包含可追踪的证伪 → 修订链
node -e "
  const fs = require('fs');
  const c = fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
  if (!c.includes('## 必须修改项')) throw new Error('FAIL: feedback 缺少必须修改项区块');
  const suggestions = (c.match(/\*\*建议\*\*/g) || []).length;
  if (suggestions < 1) throw new Error('FAIL: feedback 中无具体修改建议');
  console.log('PASS: feedback 包含 ' + suggestions + ' 条修改建议，可追踪修订链');
"
```

---

## Workstreams

workstream_count: 3

### Workstream 1: Proposer 合同生成验证

**范围**: 验证 Proposer 读取 PRD 后能正确输出 contract-draft.md + contract-dod-ws{N}.md，结构完整（Feature 区块 + 验证命令 + Workstreams + DoD）
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] contract-draft.md 存在于 sprint_dir 且包含所有 PRD 功能点对应的 Feature 区块
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');if(!c.includes('## Feature 1')||!c.includes('## Feature 2')||!c.includes('## Feature 3')||!c.includes('## Feature 4'))throw new Error('FAIL: 缺少 Feature 区块');console.log('PASS: 4 个 Feature 区块全部存在')"
- [ ] [BEHAVIOR] 合同中每个 Feature 包含可执行的 bash 验证命令（非占位符），且合同包含 Workstreams 区块
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const cmdBlocks=(c.match(/```bash/g)||[]).length;if(cmdBlocks<4)throw new Error('FAIL: bash 代码块不足 4 个，实际 '+cmdBlocks);if(!c.includes('workstream_count:'))throw new Error('FAIL: 缺少 workstream_count');console.log('PASS: '+cmdBlocks+' 个 bash 代码块 + workstream_count 存在')"
- [ ] [ARTIFACT] 每个 workstream 的 contract-dod-ws{N}.md 文件存在且含 [BEHAVIOR] + Test 字段
  Test: node -e "const fs=require('fs');for(let i=1;i<=3;i++){const f='sprints/harness-self-check-v2/contract-dod-ws'+i+'.md';const c=fs.readFileSync(f,'utf8');if(!c.includes('[BEHAVIOR]'))throw new Error('FAIL: '+f+' 缺少 [BEHAVIOR]');if(!c.includes('Test:'))throw new Error('FAIL: '+f+' 缺少 Test')}console.log('PASS: 3 个 DoD 文件结构正确')"

### Workstream 2: Reviewer 对抗证伪机制验证

**范围**: 验证 Reviewer 对每条 Test 命令执行证伪分析，输出完整三元组，发现弱命令时触发 REVISION
**大小**: M（100-300行）
**依赖**: Workstream 1 完成后

**DoD**:
- [ ] [BEHAVIOR] Reviewer 输出的 feedback 包含完整证伪分析区块，每条命令有 `命令：/最懒假实现：/能否绕过：/理由：` 四元组
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const cmds=(c.match(/命令：/g)||[]).length;const fakes=(c.match(/最懒假实现：/g)||[]).length;const bypasses=(c.match(/能否绕过：/g)||[]).length;const reasons=(c.match(/理由：/g)||[]).length;if(cmds<2||cmds!==fakes||cmds!==bypasses||cmds!==reasons)throw new Error('FAIL: 四元组不完整 cmd='+cmds+' fake='+fakes+' bypass='+bypasses+' reason='+reasons);console.log('PASS: '+cmds+' 组完整四元组')"
- [ ] [BEHAVIOR] 第 1 轮 Reviewer 至少发现 1 条 `能否绕过：YES` 并整体判定 REVISION
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const yes=(c.match(/能否绕过：\s*YES/gi)||[]).length;if(yes<1)throw new Error('FAIL: 无 YES 判定');if(!c.includes('REVISION'))throw new Error('FAIL: 缺少 REVISION 判定');console.log('PASS: '+yes+' 条 YES + REVISION')"

### Workstream 3: GAN 多轮演化与最终产物完整性

**范围**: 验证 GAN 至少 2 轮对抗、命令逐轮增强、最终产物链完整可追溯
**大小**: M（100-300行）
**依赖**: Workstream 2 完成后

**DoD**:
- [ ] [BEHAVIOR] GAN 至少经历 2 个完整轮次（git log 中至少 2 次 contract draft commit）
  Test: bash -c "COUNT=$(git log --all --oneline --grep='round-' -- sprints/harness-self-check-v2/contract-draft.md 2>/dev/null | wc -l | tr -d ' ');if [ \"$COUNT\" -lt 2 ];then echo \"FAIL: 轮次不足，实际=$COUNT\";exit 1;fi;echo \"PASS: $COUNT 轮 contract draft\""
- [ ] [ARTIFACT] sprint_dir 下 4 个核心产物文件全部存在且非空（sprint-prd.md / contract-draft.md / contract-review-feedback.md / sprint-contract.md）
  Test: node -e "const fs=require('fs');const dir='sprints/harness-self-check-v2';['sprint-prd.md','contract-draft.md','contract-review-feedback.md','sprint-contract.md'].forEach(f=>{const s=fs.statSync(dir+'/'+f);if(s.size<100)throw new Error('FAIL: '+f+' 太小 '+s.size+'B')});console.log('PASS: 4 个核心产物全部存在且非空')"
- [ ] [BEHAVIOR] 最终合同 sprint-contract.md 包含验证命令和 Workstreams 区块
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md','utf8');if(!c.includes('**验证命令**'))throw new Error('FAIL: 缺少验证命令');if(!c.includes('## Workstreams'))throw new Error('FAIL: 缺少 Workstreams');console.log('PASS: 最终合同结构完整')"
