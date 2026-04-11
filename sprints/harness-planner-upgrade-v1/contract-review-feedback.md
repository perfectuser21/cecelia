# Contract Review Feedback (Round 1)

**PRD**: `sprints/harness-planner-upgrade-v1/sprint-prd.md`
**合同草案**: `sprints/harness-planner-upgrade-v1/contract-draft.md`
**审查分支**: `cp-harness-propose-r1-f5ff09e7`

## Triple 分析摘要

| DoD# | 检查内容 | can_bypass | 原因 |
|------|----------|------------|------|
| 1 | 版本号 5.0.0 | **Y** | `includes('5.0.0')` 匹配全文，changelog 文本可绕过 |
| 2 | Brain API 调用 | N | 精确字符串匹配 |
| 3 | 6 个结构化章节 | **Y** | 全文匹配，changelog 中写关键词可绕过 |
| 4 | 9 类歧义 + ASSUMPTION | N | 9 个分类名同时出现在 changelog 极不自然 |
| 5 | OKR 对齐 | **Y** | 缺少"推进"字段和假设 fallback 检查 |
| 6 | 无用户交互占位符 | N | 负向检查，不可绕过 |

覆盖率: 6/6 = 100% | can_bypass: Y = 3/6 = 50%

## 必须修改项

### 1. [命令太弱] DoD#1 — 版本号检查用 `includes` 可被 changelog 文本绕过

**原始命令**:
```bash
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('5.0.0')){process.exit(1)}console.log('OK')"
```

**假实现片段**（proof-of-falsification）:
```yaml
# frontmatter 仍为 version: 4.1.0，但 changelog 含：
changelog:
  - 5.0.0: placeholder entry
# includes('5.0.0') 命中 changelog 文本 → 命令 PASS，但版本未实际升级
```

**建议修复命令**:
```bash
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/^version:\s*(.+)$/m);if(!m||m[1].trim()!=='5.0.0'){console.error('FAIL: version='+((m&&m[1])||'missing'));process.exit(1)}console.log('PASS')"
```

### 2. [DoD 遗漏] Feature 1 — PRD 硬阈值"不读代码实现细节"边界声明无 DoD 检查

PRD Feature 1 硬阈值第 3 条："Step 0 明确标注'不读代码实现细节'的边界"。验证命令区有对应检查（F1-C2），但 **6 条 DoD 中没有任何一条覆盖此要求**。DoD#2 只检查 `curl localhost:5221/api/brain/context`，遗漏了边界声明。

**原始命令**: （缺失，DoD 无此检查）

**假实现片段**（proof-of-falsification）:
```markdown
### Step 0: 上下文采集
curl localhost:5221/api/brain/context
# 但同时保留了旧的 ls/cat 代码探索指令，无"不读代码实现细节"边界声明
# DoD#2 仍然 PASS
```

**建议修复命令**: 新增 DoD 条目或合并到 DoD#2：
```bash
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('curl localhost:5221/api/brain/context')){console.error('FAIL: no Brain API');process.exit(1)}if(!c.includes('不读代码实现')&&!c.includes('不读实现细节')&&!c.includes('不探索代码实现')){console.error('FAIL: no boundary statement');process.exit(1)}console.log('PASS')"
```

### 3. [DoD 遗漏] Feature 3 — PRD 硬阈值"方向性决策才提问"原则未验证

PRD Feature 3 硬阈值第 3 条："明确说明'只有影响方向性决策的歧义才提问'的原则"。DoD#4 只检查 9 类关键词和 ASSUMPTION 标记，未检查此原则是否存在于 SKILL.md 中。

**原始命令**: （缺失）

**假实现片段**（proof-of-falsification）:
```markdown
# SKILL.md 包含 9 类歧义分类和 [ASSUMPTION: ...] 标记
# 但无"方向性决策"/"只有影响方向性"等提问控制原则
# 结果 Planner 可能对每个歧义都停下来问用户 → 违反 PRD 的 AI-Native 目标
# DoD#4 仍然 PASS
```

**建议修复命令**: 扩展 DoD#4 Test：
```bash
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const k=['功能范围','数据模型','UX','非功能需求','集成点','边界','约束','术语','完成信号'];let m=k.filter(x=>!c.includes(x));if(m.length>0){console.error('MISS:'+m);process.exit(1)}if(!c.includes('ASSUMPTION')){console.error('NO ASSUMPTION');process.exit(1)}if(!c.includes('方向性')){console.error('NO 方向性决策原则');process.exit(1)}console.log('PASS')"
```

### 4. [DoD 遗漏] Feature 4 — "预期推进"字段和"对不上 KR 写入假设列表"说明未验证

PRD Feature 4 硬阈值要求三个字段（KR 编号、当前进度、**预期推进**）和"对不上 KR 时写入假设列表"的说明。DoD#5 只检查 `OKR 对齐`、`KR`、`进度`，遗漏了"推进"和假设 fallback。

**原始命令**:
```bash
node -e "const c=...;if(!c.includes('OKR 对齐')){...}if(!c.includes('KR')||!c.includes('进度')){...}"
```

**假实现片段**（proof-of-falsification）:
```markdown
## OKR 对齐
- KR: {对应 KR 编号}
- 当前进度: {百分比}
# 缺少"预期推进"字段，缺少"对不上 KR 时写入假设列表"说明
# DoD#5 仍然 PASS
```

**建议修复命令**:
```bash
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('OKR 对齐')){console.error('NO OKR');process.exit(1)}if(!c.includes('KR')||!c.includes('进度')||!c.includes('推进')){console.error('INCOMPLETE: need KR+进度+推进');process.exit(1)}console.log('PASS')"
```

### 5. [命令太弱] DoD#3 — 6 个结构检查匹配全文而非模板区域

**原始命令**:
```bash
node -e "const c=...;const r=[/User Stor/,/Given.*When.*Then/s,/FR-\d{3}/,/SC-\d{3}/,/假设/,/边界/];..."
```

**假实现片段**（proof-of-falsification）:
```yaml
changelog:
  - 5.0.0: 新增 User Story, Given-When-Then, FR-001, SC-001, 假设, 边界
# 模板正文无任何结构化章节，但全部 6 个 regex 在 changelog 行命中
```

**建议修复命令**: 限制匹配范围到 `执行流程` 之后：
```bash
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const tpl=c.substring(c.indexOf('执行流程'));if(!tpl){console.error('NO 执行流程');process.exit(1)}const r=[/User Stor/,/Given.*When.*Then/s,/FR-\d{3}/,/SC-\d{3}/,/假设/,/边界/];let f=0;r.forEach((x,i)=>{if(!x.test(tpl)){console.error('MISS:'+i);f=1}});if(f)process.exit(1);console.log('PASS')"
```

## 可选改进

- 扩展验证命令区的 F1-C2 regex `### Step 0[\s\S]*?### Step 1` 对 v5.0 步骤重编号不够鲁棒，建议改用更宽松的区域定位
- 考虑加一条负向检查：确认 v4.1 旧 Step 0（纯 `ls`/`cat` 代码探索模式）已被替换，而非追加内容
