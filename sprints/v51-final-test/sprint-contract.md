# Sprint Contract Draft (Round 1)

## Feature 1: Health 端点新增 harness_version 字段

**行为描述**:
调用 `GET /api/brain/health` 时，响应 JSON 中包含 `harness_version` 字段，值为字符串 `"5.1"`。该字段与现有字段（status、uptime、active_pipelines、evaluator_stats、tick_stats、organs、timestamp 等）并列返回，不影响任何已有字段的值或结构。

**硬阈值**:
- 响应 JSON 顶层包含 `harness_version` 字段
- `harness_version` 值严格等于字符串 `"5.1"`（不是数字 5.1）
- 原有字段 `status`、`uptime`、`organs`、`timestamp` 均存在且类型不变

**验证命令**:
```bash
# Happy path: harness_version 字段存在且值为 "5.1"
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (h.harness_version !== '5.1') throw new Error('FAIL: harness_version 期望 \"5.1\"，实际 ' + JSON.stringify(h.harness_version));
    console.log('PASS: harness_version = \"5.1\"');
  "

# 回归验证: 现有字段保持不变
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const required = ['status','uptime','active_pipelines','evaluator_stats','tick_stats','organs','timestamp'];
    const missing = required.filter(k => !(k in h));
    if (missing.length > 0) throw new Error('FAIL: 缺少字段 ' + missing.join(', '));
    if (typeof h.status !== 'string') throw new Error('FAIL: status 类型错误');
    if (typeof h.uptime !== 'number') throw new Error('FAIL: uptime 类型错误');
    if (typeof h.organs !== 'object') throw new Error('FAIL: organs 类型错误');
    console.log('PASS: 全部 ' + required.length + ' 个现有字段存在且类型正确');
  "
```

---

## Workstreams

workstream_count: 1

### Workstream 1: Health 端点新增 harness_version 字段

**范围**: `packages/brain/src/routes/goals.js` 中 `/health` 路由的响应对象，新增 `harness_version: "5.1"` 字段
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] `GET /api/brain/health` 响应包含 `harness_version` 字段，值为字符串 `"5.1"`
  Test: curl -sf localhost:5221/api/brain/health | node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(h.harness_version!=='5.1') throw new Error('FAIL'); console.log('PASS')"
- [ ] [BEHAVIOR] Health 端点现有字段（status/uptime/organs/timestamp 等）保持不变
  Test: curl -sf localhost:5221/api/brain/health | node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); const r=['status','uptime','organs','timestamp']; const m=r.filter(k=>!(k in h)); if(m.length) throw new Error('FAIL: missing '+m); console.log('PASS')"
