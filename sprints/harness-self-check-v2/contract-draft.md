# Sprint Contract Draft (Round 1)

> **被测对象**: harness-contract-proposer v4.4.0 + harness-contract-reviewer v4.4.0
> **验证目标**: Reviewer 的对抗证伪机制（Step 2）是否真正有效——能否识别弱命令并触发 REVISION

---

## Feature 1: Proposer 为 harness 本身生成合同草案

**行为描述**:
给定一份 sprint-prd.md，Proposer 在 `sprints/harness-self-check-v2/` 目录下输出 `contract-draft.md`，内容覆盖 PRD 中每个 Feature 的行为描述、硬阈值和可执行验证命令，并包含 `## Workstreams` 区块。同时为每个 workstream 输出独立的 `contract-dod-ws{N}.md` 文件。

**硬阈值**:
- `contract-draft.md` 存在且非空（> 100 字节）
- 文件包含 `## Workstreams` 区块
- 文件包含至少 2 个 `[BEHAVIOR]` DoD 条目
- 每个 Feature 有至少 2 条验证命令
- 每个 workstream 存在对应 `contract-dod-ws{N}.md` 文件

**验证命令**:
```bash
# 验证 1：contract-draft.md 文件存在（Happy path）
node -e "require('fs').accessSync('sprints/harness-self-check-v2/contract-draft.md'); console.log('PASS: contract-draft.md 存在')"

# 验证 2：文件包含 Workstreams 区块（边界检查）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8');
if (!c.includes('## Workstreams')) throw new Error('FAIL: 缺少 ## Workstreams 区块');
if (!c.includes('[BEHAVIOR]')) throw new Error('FAIL: 缺少 [BEHAVIOR] DoD 条目');
console.log('PASS: 包含 Workstreams 区块和 BEHAVIOR 条目');
"

# 验证 3：至少存在 1 个 contract-dod-ws 文件（DoD 唯一来源）
node -e "
const fs = require('fs');
const files = fs.readdirSync('sprints/harness-self-check-v2').filter(f => f.startsWith('contract-dod-ws'));
if (files.length < 1) throw new Error('FAIL: 无 contract-dod-ws 文件，期望至少 1 个，实际 0 个');
console.log('PASS: 找到 ' + files.length + ' 个 contract-dod-ws 文件');
"
```

---

## Feature 2: Reviewer 对草案中每条命令执行对抗证伪分析

**行为描述**:
Reviewer 收到合同草案后，对每条 Test 命令逐一构造"最懒假实现"，输出三元组（命令 / 最懒假实现 / 能否绕过 + 理由）。任意命令"能否绕过: YES"→ 整个合同判定 REVISION，反馈文件 `contract-review-feedback.md` 包含完整证伪分析。全部"能否绕过: NO"→ 继续其他维度检查后才可能 APPROVED。

**硬阈值**:
- `contract-review-feedback.md` 存在（Round 1 REVISION 场景）或 `sprint-contract.md` 存在（APPROVED 场景）
- 反馈文件包含 `最懒假实现` 字符串（证明执行了证伪分析）
- 反馈文件包含 `能否绕过` 字符串（三元组格式）
- Round 1 至少包含 1 个 `能否绕过：YES` 或 `能否绕过: YES`（PRD 成功标准 1）
- 反馈包含 `REVISION` 判决（对应 YES 的触发）

**验证命令**:
```bash
# 验证 1：反馈文件存在（Happy path）
node -e "require('fs').accessSync('sprints/harness-self-check-v2/contract-review-feedback.md'); console.log('PASS: contract-review-feedback.md 存在')"

# 验证 2：反馈包含完整三元组格式（关键格式检查）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const hasLazy = c.includes('最懒假实现');
const hasBypass = c.includes('能否绕过');
if (!hasLazy) throw new Error('FAIL: 缺少\"最懒假实现\"——未执行证伪分析');
if (!hasBypass) throw new Error('FAIL: 缺少\"能否绕过\"——三元组格式不完整');
console.log('PASS: 反馈包含完整三元组格式');
"

# 验证 3：Round 1 反馈包含至少 1 个 YES（PRD 成功标准 1）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const hasYes = c.includes('能否绕过：YES') || c.includes('能否绕过: YES');
if (!hasYes) throw new Error('FAIL: Round 1 未发现任何可绕过命令，证伪机制未触发');
console.log('PASS: Round 1 发现至少 1 条可绕过命令，证伪机制有效');
"
```

---

## Feature 3: GAN 轮次因证伪机制变多且每轮更严格

**行为描述**:
Proposer 根据 Reviewer 的证伪反馈修订验证命令，Reviewer 再次对新命令构造假实现。GAN 至少经历 2 个完整轮次（Round 1 REVISION + Round 2 对修订版重新证伪）。修订轮的命令相比前一轮更严格（体现在 Reviewer 的三元组分析中：原来 YES 的命令变成 NO）。

**硬阈值**:
- `contract-draft.md`（Round 1）和修订版合同草案均存在于 sprint 目录
- Round 2 的证伪分析中，Round 1 被标记 YES 的命令在 Round 2 中变为 NO
- 最终 APPROVED 合同中所有命令均通过"能否绕过: NO"验证

**验证命令**:
```bash
# 验证 1：sprint 目录下存在最终 APPROVED 合同（GAN 完成的证明）
node -e "require('fs').accessSync('sprints/harness-self-check-v2/sprint-contract.md'); console.log('PASS: sprint-contract.md 存在，GAN 已达成 APPROVED')"

# 验证 2：最终合同包含"能否绕过: NO"记录（所有命令均通过证伪）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md', 'utf8');
if (!c.includes('能否绕过')) throw new Error('FAIL: 最终合同未包含证伪分析记录');
console.log('PASS: 最终合同包含证伪分析记录');
"

# 验证 3：contract-review-feedback.md 包含 REVISION 关键字（证明至少经历 1 轮 REVISION）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
if (!c.includes('REVISION')) throw new Error('FAIL: 未找到 REVISION 记录，GAN 未触发多轮');
console.log('PASS: 反馈包含 REVISION，GAN 触发了多轮对抗');
"
```

---

## Feature 4: 最终产出可观察的验证报告

**行为描述**:
GAN 结束后，`sprints/harness-self-check-v2/` 目录下存在完整的产物文件集合，包括最终合同、各轮反馈、各轮草案。从这些文件可以明确判断：Reviewer 在 Round 1 发现了弱命令（至少 1 个 YES），并且最终合同中所有命令均已强化（全部 NO）。

**硬阈值**:
- `sprint-contract.md` 存在且包含 `## Workstreams` 区块
- `contract-review-feedback.md` 存在且包含完整证伪三元组
- `contract-draft.md` 存在（Round 1 草案）
- `contract-dod-ws1.md` 至少存在 1 个 workstream DoD 文件

**验证命令**:
```bash
# 验证 1：所有关键产物文件均存在（批量检查）
node -e "
const fs = require('fs');
const required = [
  'sprints/harness-self-check-v2/sprint-contract.md',
  'sprints/harness-self-check-v2/contract-review-feedback.md',
  'sprints/harness-self-check-v2/contract-draft.md',
  'sprints/harness-self-check-v2/contract-dod-ws1.md'
];
const missing = required.filter(f => { try { fs.accessSync(f); return false; } catch { return true; } });
if (missing.length > 0) throw new Error('FAIL: 缺少文件: ' + missing.join(', '));
console.log('PASS: 所有 ' + required.length + ' 个产物文件均存在');
"

# 验证 2：最终合同非空且结构完整
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md', 'utf8');
if (c.length < 200) throw new Error('FAIL: sprint-contract.md 内容过短（< 200字节），疑似空壳文件');
if (!c.includes('## Workstreams')) throw new Error('FAIL: 最终合同缺少 Workstreams 区块');
console.log('PASS: 最终合同内容完整（' + c.length + ' 字节），包含 Workstreams 区块');
"

# 验证 3：从反馈文件可判断 Round 1 发现弱命令（可观察性验证）
node -e "
const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8');
const yesCount = (c.match(/能否绕过[：:]\s*YES/g) || []).length;
if (yesCount === 0) throw new Error('FAIL: 反馈中无 YES 记录，无法确认 Round 1 发现了弱命令');
console.log('PASS: 反馈中发现 ' + yesCount + ' 个 YES 记录，Reviewer 证伪机制有效触发');
"
```

---

## Workstreams

workstream_count: 2

### Workstream 1: Proposer 合同草案生成（本轮）

**范围**: Proposer 读取 PRD + 两个 SKILL.md → 输出 `contract-draft.md` + `contract-dod-ws{N}.md` → push 到 propose branch
**大小**: M（约 150 行输出文件）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `sprints/harness-self-check-v2/contract-draft.md` 存在，包含 4 个 Feature 和 ## Workstreams 区块
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');if(!c.includes('## Workstreams')||!c.includes('Feature 1'))throw new Error('FAIL: 结构不完整');console.log('PASS')"
- [ ] [ARTIFACT] `sprints/harness-self-check-v2/contract-dod-ws1.md` 存在，包含至少 1 个 [BEHAVIOR] 条目
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-dod-ws1.md','utf8');if(!c.includes('[BEHAVIOR]'))throw new Error('FAIL: 缺少 BEHAVIOR 条目');console.log('PASS')"
- [ ] [BEHAVIOR] propose branch 成功 push 到 origin，可被 Reviewer 拉取
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');if(c.trim().length<500)throw new Error('FAIL: 文件内容过少，疑似未完整生成');console.log('PASS: 草案内容充分（'+c.length+'字节）')"

### Workstream 2: Reviewer 对抗轮次执行 + 最终产物验证

**范围**: Reviewer 对 Round 1 草案执行证伪分析 → REVISION → Proposer 修订 → Reviewer 重审 → APPROVED → 最终合同落地
**大小**: M（多轮文件产出）
**依赖**: Workstream 1 完成后

**DoD**:
- [ ] [ARTIFACT] `sprints/harness-self-check-v2/contract-review-feedback.md` 存在，包含三元组（命令/最懒假实现/能否绕过）
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');if(!c.includes('最懒假实现')||!c.includes('能否绕过'))throw new Error('FAIL: 三元组格式不完整');console.log('PASS')"
- [ ] [BEHAVIOR] Round 1 反馈中包含至少 1 个"能否绕过: YES"，证明证伪机制有效触发
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const n=(c.match(/能否绕过[：:]\s*YES/g)||[]).length;if(n<1)throw new Error('FAIL: 无YES记录，证伪机制未触发');console.log('PASS: '+n+'个YES')"
- [ ] [ARTIFACT] `sprints/harness-self-check-v2/sprint-contract.md` 存在，内容 > 200 字节，包含 Workstreams 区块
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md','utf8');if(c.length<200||!c.includes('## Workstreams'))throw new Error('FAIL');console.log('PASS: 最终合同完整（'+c.length+'字节）')"
- [ ] [BEHAVIOR] 最终合同中所有命令均通过"能否绕过: NO"验证（有明确记录）
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md','utf8');const yes=(c.match(/能否绕过[：:]\s*YES/g)||[]).length;if(yes>0)throw new Error('FAIL: 最终合同仍含'+yes+'个YES，GAN未完成');console.log('PASS: 无YES记录，所有命令已通过证伪')"
