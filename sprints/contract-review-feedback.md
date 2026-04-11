# Contract Review Feedback (Round 3)

> 审查: Sprint Contract Draft (Round 3) — Pipeline 步骤详情 Input/Prompt/Output 三栏视图
> 覆盖率: 11/11 命令已分析（100%），5 条 can_bypass: Y

## 整体评价

合同质量明显高于前两轮。API 验证命令（Feature 1/2/4）字段级检查严格，包含多轮标签唯一性、边界空 UUID 等场景。Workstreams 区块完整，边界清晰，DoD 格式正确，使用 CI 白名单工具。

以下 3 项是**必须修改的命令问题**，均可快速修复。

---

## 必须修改项

### 1. [命令太弱] Feature 1 — created_at 排序验证漏检 null 值

**原始命令**:
```bash
# 升序验证: steps 按 created_at 排列
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    for (let i = 1; i < d.steps.length; i++) {
      const prev = d.steps[i-1].created_at;
      const curr = d.steps[i].created_at;
      if (prev && curr && new Date(prev) > new Date(curr)) {
        throw new Error('FAIL: ...');
      }
    }
    console.log('PASS: ...');
  "
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：steps 不返回 created_at 字段
const steps = [
  { step: 1, task_id: 'x', task_type: 'planner', label: 'Planner', status: 'completed' },
  { step: 2, task_id: 'y', task_type: 'propose', label: 'Propose R1', status: 'completed' }
];
// prev=undefined, curr=undefined → if(undefined && undefined) 为 false → 跳过检查 → PASS
// 即使乱序也能通过
```

**建议修复命令**:
```bash
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (d.steps.length < 2) { console.log('PASS: 不足 2 步，跳过排序检查'); process.exit(0); }
    d.steps.forEach((s, i) => {
      if (!s.created_at) throw new Error('FAIL: steps['+i+'] 缺少 created_at');
    });
    for (let i = 1; i < d.steps.length; i++) {
      if (new Date(d.steps[i-1].created_at) > new Date(d.steps[i].created_at)) {
        throw new Error('FAIL: steps[' + (i-1) + '].created_at > steps[' + i + '].created_at');
      }
    }
    console.log('PASS: ' + d.steps.length + ' 个步骤 created_at 均存在且升序');
  "
```

---

### 2. [命令太弱] Feature 2 — 边界测试 curl -sf 在 HTTP 错误时静默失败

**原始命令**:
```bash
# 边界: 不存在的 planner_task_id 返回空 steps
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!Array.isArray(d.steps)) throw new Error('FAIL: 无效 ID 时 steps 应为数组');
    if (d.steps.length > 0) throw new Error('FAIL: 无效 ID 返回了 ' + d.steps.length + ' 个步骤');
    console.log('PASS: 不存在的 planner_task_id 返回空 steps 数组');
  "
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：API 对无效 ID 返回 404
app.get('/api/brain/harness/pipeline-detail', (req, res) => {
  if (!findTask(req.query.planner_task_id)) return res.status(404).json({ error: 'not found' });
  // ...
});
// curl -sf 在 HTTP 404 时不输出任何内容 → node -e 的 stdin 为空
// → JSON.parse('') → SyntaxError（不是预期的 "steps 应为数组" 错误信息）
// → 命令"失败"但原因不对，且错误信息误导
```

**建议修复命令**:
```bash
node -e "
  const http = require('http');
  http.get('http://localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000', (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      if (res.statusCode !== 200) throw new Error('FAIL: 无效 ID 应返回 200，实际 ' + res.statusCode);
      const d = JSON.parse(body);
      if (!Array.isArray(d.steps)) throw new Error('FAIL: 无效 ID 时 steps 应为数组');
      if (d.steps.length > 0) throw new Error('FAIL: 无效 ID 返回了 ' + d.steps.length + ' 个步骤');
      console.log('PASS: 不存在的 planner_task_id 返回 200 + 空 steps 数组');
    });
  });
"
```

---

### 3. [命令太弱] Feature 4 — 模板变量正则只匹配全大写，遗漏小写变量

**原始命令**:
```bash
# 负向验证: prompt 不应包含未替换的模板变量
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    d.steps.forEach(s => {
      if (s.prompt_content) {
        if (/\\\$\{[A-Z_]+\}/.test(s.prompt_content) || /\{[A-Z_]+\}/.test(s.prompt_content)) {
          throw new Error('FAIL: ...');
        }
      }
    });
    console.log('PASS: ...');
  "
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：prompt 中留下了小写未替换变量
const prompt_content = "/harness-planner\ntask_id={task_id}\nsprint_dir={sprint_dir}";
// 正则 /\{[A-Z_]+\}/ 只匹配 {TASK_ID} 不匹配 {task_id}
// → 检测不到 → PASS
```

**建议修复命令**:
```bash
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    d.steps.forEach(s => {
      if (s.prompt_content) {
        const m = s.prompt_content.match(/\{[a-zA-Z_]+\}/g);
        if (m) {
          // 过滤掉 JSON 格式中的正常大括号（如 prompt 中可能包含 JSON 示例）
          const suspicious = m.filter(v => /^\\{(task_id|sprint_dir|planner_branch|propose_branch|TASK_ID|SPRINT_DIR)\\}$/.test(v));
          if (suspicious.length > 0) throw new Error('FAIL: step ' + s.step + ' prompt 含未替换模板变量: ' + suspicious.join(', '));
        }
      }
    });
    console.log('PASS: 所有 prompt 无未替换的已知模板变量');
  "
```

---

## 可选改进

1. **Feature 1 硬阈值缺少 `created_at`/`completed_at` 字段**：硬阈值列了 7 个字段但验证命令（Triple 1.1）的 `required` 数组只检查了 5 个（缺 `created_at`、`completed_at`）。建议补上。

2. **Feature 3 前端验证全部是静态文本匹配**：注释 `// useState expanded monospace 暂无数据` 就能通过所有检查。建议至少对手风琴逻辑加一个 AST-level 检查（如 `node -e` 用正则验证 `useState` 在函数体内而非注释中），或在 Workstream 2 DoD 中增加 `manual:chrome:` 类型的验证条目。

3. **Feature 1 DoD Test 命令缺少 created_at 排序检查**：Feature 1 的"验证命令"区域有升序检查，但 Workstream 1 的 DoD 条目中没有对应的 Test 命令来验证排序。
