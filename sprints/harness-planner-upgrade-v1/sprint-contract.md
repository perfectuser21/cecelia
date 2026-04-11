# Sprint Contract Draft (Round 3)

> 基于 Round 2 Reviewer 反馈修订。修复全部 4 个必须修改项 + 采纳可选改进（DoD 引用 Feature 命令编号避免重复维护）。

---

## Feature 1: 自动上下文采集（Step 0 增强）

**行为描述**:
Planner 在 Step 0 自动调用 Brain API (`curl localhost:5221/api/brain/context`)，获取 OKR 进度、活跃任务、最近 PR、有效决策，无需用户额外提供信息。SKILL.md 的 Step 0 包含该 API 调用指令。

**硬阈值**:
- SKILL.md 的执行流程 Step 0 包含 `curl localhost:5221/api/brain/context` 调用
- Step 0 包含对 OKR、任务、PR、决策四类信息的采集说明
- 不包含需要用户交互才能填写的占位符（如 `[请用户确认]`）

**验证命令**:
```bash
# F1-C1: Step 0 包含 Brain context API 调用
node -e "
  const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');
  if(!c.includes('curl localhost:5221/api/brain/context')){
    console.error('FAIL: Step 0 缺少 brain/context API 调用');process.exit(1)
  }
  console.log('PASS: Step 0 包含 brain/context API 调用');
"

# F1-C2: 无用户交互占位符
node -e "
  const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');
  const placeholders=['请用户确认','请用户提供','等待用户','用户输入','[TBD]','[TODO]'];
  for(const p of placeholders){
    if(c.includes(p)){console.error('FAIL: 包含用户交互占位符: '+p);process.exit(1)}
  }
  console.log('PASS: 无用户交互占位符');
"
```

---

## Feature 2: 结构化 PRD 模板（spec-kit 级别）

**行为描述**:
SKILL.md 的 PRD 输出模板包含 8 个结构化章节：User Stories（P1/P2/P3 优先级）、验收场景（Given-When-Then 格式）、功能需求编号（FR-xxx）、成功标准编号（SC-xxx）、显式假设列表、边界情况、范围限定（在范围/不在范围）、预期受影响文件。

**硬阈值**:
- 执行流程区域内包含全部 8 个 PRD 结构要素
- User Stories 以 Given-When-Then 格式定义验收场景
- 功能需求用 FR-001 格式编号
- 成功标准用 SC-001 格式编号
- 假设列表和边界情况作为独立章节存在（不是散落在其他章节的描述文字）
- 范围限定章节明确区分"在范围"和"不在范围"

**验证命令**:
```bash
# F2-C1: PRD 模板包含全部 8 个必需结构（修复 Round 2 反馈 #2 + #4）
node -e "
  const fs=require('fs');
  const content=fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');
  const idx=content.indexOf('执行流程');
  if(idx===-1){console.error('FAIL: 找不到执行流程');process.exit(1)}
  const tpl=content.substring(idx);
  const checks=[
    ['User Stories',/User Stor(y|ies)/],
    ['Given-When-Then',/Given.*When.*Then/s],
    ['FR- 编号',/FR-\d{3}/],
    ['SC- 编号',/SC-\d{3}/],
    ['假设章节标题',/##\s*(显式)?假设/],
    ['边界情况章节标题',/##\s*边界(情况)?/],
    ['范围限定',/##\s*范围/],
    ['预期受影响文件',/受影响文件/]
  ];
  let fail=false;
  for(const [name,re] of checks){
    if(!re.test(tpl)){
      console.error('FAIL: 执行流程区缺少 '+name);
      fail=true;
    }
  }
  if(fail) process.exit(1);
  console.log('PASS: PRD 模板包含全部 8 个必需结构');
"

# F2-C2: PRD 模板不含用户交互占位符
node -e "
  const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');
  const idx=c.indexOf('执行流程');
  const tpl=c.substring(idx);
  if(/\[请用户|等待用户|用户确认\]/.test(tpl)){
    console.error('FAIL: PRD 模板含用户交互占位符');process.exit(1)
  }
  console.log('PASS: PRD 模板无用户交互占位符');
"
```

---

## Feature 3: AI 自决策歧义消解（替代 spec-kit 的 /clarify）

**行为描述**:
Planner 在写 PRD 前执行 9 类歧义自检扫描（功能范围、数据模型、UX 流程、非功能需求、集成点、边界情况、约束、术语、完成信号）。无法推断的项标记 `[ASSUMPTION: ...]` 写入假设列表。只有影响方向性决策的歧义才向用户提问（预期 0-1 个）。

**硬阈值**:
- SKILL.md 包含 9 类歧义自检的完整列表
- 包含 `[ASSUMPTION: ...]` 标记说明
- 明确说明无法推断项的处理方式（写入假设列表）

**验证命令**:
```bash
# F3-C1: 9 类歧义自检存在
node -e "
  const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');
  const categories=['功能范围','数据模型','UX','非功能','集成点','边界','约束','术语','完成信号'];
  let missing=[];
  for(const cat of categories){
    if(!c.includes(cat)) missing.push(cat);
  }
  if(missing.length>0){
    console.error('FAIL: 缺少歧义自检类别: '+missing.join(', '));process.exit(1)
  }
  console.log('PASS: 9 类歧义自检全部存在');
"

# F3-C2: ASSUMPTION 标记机制
node -e "
  const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');
  if(!c.includes('[ASSUMPTION')){
    console.error('FAIL: 缺少 [ASSUMPTION] 标记机制');process.exit(1)
  }
  if(!c.includes('假设列表')||!c.includes('假设')){
    console.error('FAIL: 缺少无法推断项写入假设列表的说明');process.exit(1)
  }
  console.log('PASS: ASSUMPTION 标记 + 假设列表处理机制存在');
"
```

---

## Feature 4: OKR 对齐检查

**行为描述**:
PRD 顶部包含 `## OKR 对齐` 章节，标明对应 KR 编号、当前 KR 进度、本次任务预期推进量。如果任务与活跃 KR 对不上，在假设列表中标注（fallback 行为）。

**硬阈值**:
- `## OKR 对齐` 章节存在
- 章节内包含独立的 KR 字段（不是 OKR 子串误匹配）、进度字段、推进字段
- 章节内包含对不上 KR 时写入假设列表的 fallback 说明

**验证命令**:
```bash
# F4-C1: OKR 对齐章节含独立 KR + 进度 + 推进（修复 Round 2 反馈 #1）
node -e "
  const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');
  const idx=c.indexOf('## OKR 对齐');
  if(idx===-1){console.error('FAIL: 缺少 ## OKR 对齐');process.exit(1)}
  const nextH2=c.indexOf('\n## ',idx+5);
  const sec=c.substring(idx,nextH2>0?nextH2:c.length);
  if(!/KR[\s\-:]/.test(sec)){console.error('FAIL: OKR 对齐章节内无独立 KR 字段（非 OKR 子串）');process.exit(1)}
  if(!sec.includes('进度')){console.error('FAIL: OKR 对齐章节内无进度字段');process.exit(1)}
  if(!sec.includes('推进')){console.error('FAIL: OKR 对齐章节内无推进字段');process.exit(1)}
  console.log('PASS: OKR 对齐章节含 KR + 进度 + 推进');
"

# F4-C2: OKR 对齐 fallback — 对不上 KR 时写入假设（修复 Round 2 反馈 #3）
node -e "
  const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');
  const idx=c.indexOf('## OKR 对齐');
  if(idx===-1){console.error('FAIL: 缺少 ## OKR 对齐');process.exit(1)}
  const nextH2=c.indexOf('\n## ',idx+5);
  const sec=c.substring(idx,nextH2>0?nextH2:c.length);
  if(!sec.includes('假设')){console.error('FAIL: OKR 对齐缺少对不上 KR 时写入假设的 fallback');process.exit(1)}
  console.log('PASS: OKR 对齐含 fallback → 假设列表');
"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: harness-planner SKILL.md v5.0 升级

**范围**: `packages/workflows/skills/harness-planner/SKILL.md` 单文件改动——Step 0 增强 Brain API 采集、PRD 模板结构化（8 章节）、歧义自检 9 类、OKR 对齐章节（含 fallback）
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `packages/workflows/skills/harness-planner/SKILL.md` 文件存在且版本号为 5.0
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('5.0')){process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] Step 0 包含 Brain context API 自动采集指令
  Test: 引用 F1-C1 命令
- [ ] [BEHAVIOR] PRD 模板包含全部 8 个结构化章节（User Stories/Given-When-Then/FR-xxx/SC-xxx/假设/边界/范围/受影响文件）
  Test: 引用 F2-C1 命令
- [ ] [BEHAVIOR] 9 类歧义自检完整覆盖 + ASSUMPTION 标记机制
  Test: 引用 F3-C1 + F3-C2 命令
- [ ] [BEHAVIOR] OKR 对齐章节含独立 KR 字段 + 进度 + 推进 + fallback 假设
  Test: 引用 F4-C1 + F4-C2 命令
- [ ] [BEHAVIOR] 全文无用户交互占位符
  Test: 引用 F1-C2 命令

---

## Round 3 修订说明

| # | Reviewer 反馈 | 修复措施 |
|---|---|---|
| 1 | Feature 4 `includes('KR')` 被 OKR 子串满足 | F4-C1 改为提取 `## OKR 对齐` 章节后用 `/KR[\s\-:]/` 正则匹配独立 KR 字段 |
| 2 | Feature 2 `/假设/` `/边界/` 正则过宽 | F2-C1 改为 `/##\s*(显式)?假设/` 和 `/##\s*边界(情况)?/` 匹配章节标题 |
| 3 | Feature 4 缺少 KR 对不上 → 假设列表 fallback 验证 | 新增 F4-C2 验证 OKR 对齐章节内包含"假设"fallback |
| 4 | Feature 2 遗漏"范围限定"检查 | F2-C1 checks 数组新增 `['范围限定', /##\s*范围/]` + `['预期受影响文件', /受影响文件/]` |
| 可选 | DoD 与 Feature 命令重复维护 | DoD Test 字段引用 Feature 命令编号，避免两份同步 |
