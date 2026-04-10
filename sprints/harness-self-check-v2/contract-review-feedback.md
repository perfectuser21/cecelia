# Contract Review Feedback (Round 2)

**判决**: REVISION
**轮次**: R2（针对 cp-harness-propose-r2-d6098a64 草案）
**发现问题**: 7 条命令"能否绕过: YES"，2 条命令"能否绕过: NO"

R2 草案相比 R1 有明显进步：废弃了 `accessSync`，引入块级三元组验证，升级为正则计数。但以下命令仍可被最懒假实现绕过，判决为 **REVISION**。

---

## 对抗证伪分析

---

### Feature 1 — 验证 1（结构计数）

命令：`node -e "const features=(c.match(/^## Feature \d+/gm)||[]).length; if(features<4) throw..."`

最懒假实现：创建 contract-draft.md，内容只有裸标记行——

```
## Feature 1
## Feature 2
## Feature 3
## Feature 4
```bash
```
```bash
```
（重复8次，内容为空）
[BEHAVIOR]
[BEHAVIOR]
## Workstreams
```

能否绕过：YES — 命令逐个正则计数关键词，不检查每个 Feature 块是否包含实质内容（硬阈值、行为描述、验证命令）。空壳文件满足全部 4 个条件。

---

### Feature 1 — 验证 2（DoD 文件 [BEHAVIOR] 存在）

命令：`if(!(d.match(/\[BEHAVIOR\]/g)||[]).length) throw new Error('FAIL:'+f+'无BEHAVIOR')`

最懒假实现：创建 `contract-dod-ws1.md`，内容只有一行：

```
[BEHAVIOR]
```

能否绕过：YES — 命令只检查 `[BEHAVIOR]` 字符串出现次数 >= 1，不验证：(1) 是否有 `- [ ]` 格式；(2) 是否有 `Test:` 字段；(3) Test 命令是否可执行；(4) 是否有行为描述。单个字符串即可绕过。

---

### Feature 2 — 验证 1（三元组块级计数 + YES >= 1）

命令：`blocks.forEach(block => { hasCmd=block.includes('命令：'); hasLazy=block.includes('最懒假实现：'); hasBypass=/能否绕过[：:]\s*(YES|NO)/.test(block); if(hasCmd&&hasLazy&&hasBypass) validTriples++; })`

最懒假实现：创建 feedback 文件，含3个 `---` 分隔的块，每块写如下占位内容：

```
命令：echo foo
最懒假实现：不做任何事
能否绕过：YES，理由：太弱
```

能否绕过：YES — 命令只验证三个关键词同时出现在一个 `---` 块中，不验证：(1) "命令：" 后面是否对应草案中的真实命令；(2) "最懒假实现：" 后面是否有实质推理；(3) 三元组数量是否等于草案中的验证命令总数（可以只写3个三元组，草案有8条命令全部跳过）。

---

### Feature 2 — 验证 2（判决在文件头部）

命令：`const header = c.split('\n').slice(0, 30).join('\n'); const hasRevision = header.includes('REVISION');`

最懒假实现：文件第一行写 `# REVISION`（不需要任何格式，任何含"REVISION"字符串的行都满足）。

能否绕过：YES — 命令只做字符串存在性检查，不验证：(1) 判决是否以标准格式声明（如 `**判决**: REVISION`）；(2) 判决后是否有对应的证据摘要；(3) 字符串是否出现在元数据区（可以是标题中偶然出现的词）。

---

### Feature 3 — 验证 1（accessSync=0 且 .match() >= 4）

命令：`const r2AccessSync=(r2.match(/accessSync/g)||[]).length; if(r2AccessSync>0)throw...; const r2Regex=(r2.match(/\.match\(/g)||[]).length; if(r2Regex<4)throw...`

最懒假实现：在 R2 草案文件的任意位置（包括注释或描述段落）插入4行：

```
（结果.match(1)、结果.match(2)、结果.match(3)、结果.match(4)）
```

能否绕过：YES — 命令用 `.match(` 出现次数作为"命令严格度"的代理指标，但：(1) `.match(` 可以出现在描述文字、注释中而非验证命令里；(2) 出现4次 `.match(` 不等于4条严格命令（可以是4个毫无实际意义的正则）；(3) 未检查这4个 `.match(` 调用是否真正计数了关键属性。

---

### Feature 3 — 验证 2（R2 分支存在于远端）

命令：`execSync('git ls-remote --heads origin cp-harness-propose-r2-\\*', {encoding:'utf8'})`

最懒假实现：必须实际 push 一个 `cp-harness-propose-r2-*` 分支到远端，无法通过文件内容伪造。

能否绕过：NO — 验证远端 git 状态是二进制事实，不可伪造。这是本草案中最强的验证命令。✓

---

### Feature 4 — 验证 1（最终合同 Feature 数 + bash 数 + YES=0 + NO>=1）

命令：`const yesCount=(c.match(/能否绕过[：:]\s*YES/g)||[]).length; if(yesCount>0)throw...; const noCount=(c.match(/能否绕过[：:]\s*NO/g)||[]).length; if(noCount<1)throw...`

最懒假实现：创建 sprint-contract.md，在行为描述段落中插入一句话：

```
所有命令验证结果：能否绕过：NO（已完成证伪）
```

能否绕过：YES — 命令在整个文件全文搜索 "能否绕过：NO" 字符串，不验证：(1) 该字符串是否出现在结构化三元组中（而非描述文字）；(2) NO 记录的数量是否等于合同中的验证命令总数；(3) 最终合同是否实际经过 Reviewer 对每条命令的再次证伪。

---

### Feature 4 — 验证 2（反馈文件三元组 + YES >= 1）

命令：同 Feature 2 验证 1 的三元组块级计数逻辑。

最懒假实现：同 Feature 2 验证 1 分析。

能否绕过：YES — 同上，三元组内容与草案命令之间无对应性验证。

---

## 必须修改项

### 1. [命令太弱] Feature 1 验证 1 — 结构计数不验证内容实质性

**问题**: `^## Feature \d+` 计数只验证标题存在，不验证每个 Feature 块下是否有非空的硬阈值描述和可执行命令。  
**建议**: 在每个 Feature 标题后检查是否存在至少1个有内容的 ` ```bash ` 块（命令行数 >= 2），而非仅计数块的数量。

### 2. [命令太弱] Feature 1 验证 2 — DoD 格式验证不完整

**问题**: 只检查 `[BEHAVIOR]` 字符串出现，不检查 `Test:` 字段是否存在于 `[BEHAVIOR]` 条目之后。  
**建议**: 验证每个 DoD 文件中 `[BEHAVIOR]` 后紧接的行包含 `Test:`，且 Test 值不为空字符串。

### 3. [命令太弱] Feature 2 验证 1 — 三元组不验证对草案命令的覆盖性

**问题**: 三元组数量 >= 3 是任意阈值，与草案实际命令数量（8条）无对应关系。Reviewer 可以只写3个三元组而忽略另外5条命令。  
**建议**: 验证三元组数量 >= 草案中 bash 命令块的数量（至少与 Feature 命令数挂钩），或在每个三元组的"命令："行中能匹配草案命令的关键词。

### 4. [命令太弱] Feature 3 验证 1 — .match() 数量不等于命令严格度

**问题**: `.match(` 出现次数是技术实现指标而非验证严格性指标，可在描述文本中插入伪造。  
**建议**: 验证命令块内的 `.match(` 中包含具体阈值比较（如 `if(n<4)`），而非仅统计调用次数。

### 5. [命令太弱] Feature 4 验证 1 — NO 字符串全文搜索无法区分证伪记录与描述文字

**问题**: "能否绕过：NO"可在合同任意位置插入，一行描述文字即可满足。  
**建议**: 验证 sprint-contract.md 中 NO 记录出现在三元组块格式内（如块内同时含"命令："和"能否绕过：NO"），且 NO 数量 >= 验证命令总数的 60%。

## 可选改进

- Feature 2 验证 2（判决头部）：改为验证 `**判决**:\s*(REVISION|APPROVED)` 正则，而非任意含"REVISION"的字符串存在
- Feature 4 验证 2：与 Feature 2 验证 1 逻辑完全重复，可合并为单次验证
