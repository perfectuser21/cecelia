# Contract Review Feedback (Round 2)

## 必须修改项

### 1. [命令太弱] WS1-D5 — 不存在 pipeline 的 DoD 命令接受任意非 200 为 PASS

**原始命令**:
```bash
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000" -o /tmp/htest.json && node -e "..." || echo "PASS:返回非200"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：endpoint 没处理 not-found，直接抛 500
router.get('/harness/pipeline-detail', async (req, res) => {
  const rows = await db.query('SELECT * FROM tasks WHERE id = $1', [req.query.planner_task_id]);
  // rows[0] 为 undefined → TypeError: Cannot read property 'payload' of undefined
  const payload = rows[0].payload;
  res.json({ steps: buildSteps(payload) });
});
// curl -sf 遇到 500 → exit 1 → || echo "PASS:返回非200" → 假 PASS
// 更严重：Brain 服务宕机 → curl 连接失败 → 同样假 PASS
```

**建议修复命令**:
```bash
# 方案：用 Feature 级 F1-cmd2 的 fallback 逻辑替换
STATUS=$(curl -s -o /tmp/htest.json -w "%{http_code}" "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000") && node -e "
  if ('$STATUS' === '404') { console.log('PASS:返回404'); process.exit(0); }
  const d=JSON.parse(require('fs').readFileSync('/tmp/htest.json','utf8'));
  if(!Array.isArray(d.steps)||d.steps.length!==0) throw new Error('FAIL:期望空steps,实际'+d.steps.length);
  console.log('PASS:空steps数组');
" || { echo "FAIL:期望空steps或404,实际HTTP $STATUS"; exit 1; }
```

**说明**: Feature 级 F1-cmd2 已经有正确的 404 专项 fallback，但 DoD 简化版丢失了这个逻辑。DoD 是 CI 实际执行的命令，必须至少和 Feature 级一样严格。

### 2. [PRD 遗漏] Feature 3 页面可访问性验证未纳入 WS2 DoD

**原始命令**: F3-cmd2 在 Feature 部分存在但 WS2 DoD 中完全缺失

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：组件返回 null，但 TypeScript 编译通过、代码模式匹配通过
// HarnessPipelineDetailPage.tsx
export default function HarnessPipelineDetailPage() {
  // steps.map(s => ...) — 代码存在但在 if(false) 分支
  const unused = false;
  if (unused) {
    return <div>Input Prompt Output 暂无数据 {steps.map(s => s)}</div>;
  }
  return null; // 实际渲染空白
}
// WS2-D2 (代码模式) 会 PASS，因为关键词在代码中存在
// WS2-D3 (TS编译) 会 PASS
// 但页面实际是空白的
```

**建议修复命令**:
```bash
# 新增 WS2 DoD 条目: [BEHAVIOR] 页面 HTTP 可访问
# Test:
curl -s -o /dev/null -w "%{http_code}" "http://localhost:5211/harness/pipeline/98503cee-f277-4690-8254-fb9058b5dee3" | node -e "
  const code = require('fs').readFileSync('/dev/stdin','utf8').trim();
  if (code !== '200') throw new Error('FAIL: 页面返回 HTTP ' + code);
  console.log('PASS: 页面返回 200');
"
```

**说明**: 虽然 SPA 的 curl 测试只验证 HTML shell，但至少能确认路由存在、dev server 正常、页面不是 404。当前 WS2 DoD 完全没有运行时测试，全靠静态代码检查，风险偏高。

## 可选改进

- **手风琴模式无验证**: PRD 明确要求"同时只能展开一个步骤"，但无 playwright 测试。建议在 WS2 DoD 新增 `[BEHAVIOR]` 条目，用 `node -e` 检查组件代码中包含 accordion/exclusive expand 逻辑（如 state 变量名、条件渲染逻辑）。
- **阶段时间线横条保留无验证**: PRD 要求保留现有时间线横条，可在 WS2-D2 代码模式检查中增加时间线相关组件/className 的匹配。
