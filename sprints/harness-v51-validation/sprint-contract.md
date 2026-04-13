# Sprint Contract Draft (Round 1)

## Feature 1: Health 端点新增 pipeline_version 字段

**行为描述**:
当任意客户端（Evaluator Agent、运维工具、巡检脚本）调用 `GET /api/brain/health` 时，返回的 JSON 响应中包含顶层字段 `pipeline_version`，值为字符串 `"5.1"`。该字段为硬编码常量，不依赖数据库、环境变量或外部配置。Health 端点原有字段（status, uptime, active_pipelines, evaluator_stats, tick_stats, organs, timestamp）的结构和语义保持不变。

**硬阈值**:
- 响应 JSON 包含顶层字段 `pipeline_version`，类型为字符串
- `pipeline_version` 的值严格等于 `"5.1"`
- 原有字段 `status`、`uptime`、`active_pipelines`、`evaluator_stats`、`tick_stats`、`organs`、`timestamp` 全部存在且类型不变
- HTTP 状态码保持 200

**验证命令**:
```bash
# Happy path：pipeline_version 字段存在且值为 "5.1"
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (h.pipeline_version !== '5.1') throw new Error('FAIL: pipeline_version=' + JSON.stringify(h.pipeline_version) + ', 期望 \"5.1\"');
    console.log('PASS: pipeline_version = \"5.1\"');
  "

# 回归验证：原有字段全部存在且类型正确
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const required = ['status','uptime','active_pipelines','evaluator_stats','tick_stats','organs','timestamp'];
    const missing = required.filter(k => !(k in h));
    if (missing.length > 0) throw new Error('FAIL: 缺少字段: ' + missing.join(', '));
    if (typeof h.status !== 'string') throw new Error('FAIL: status 类型错误');
    if (typeof h.uptime !== 'number') throw new Error('FAIL: uptime 类型错误');
    if (typeof h.active_pipelines !== 'number') throw new Error('FAIL: active_pipelines 类型错误');
    if (typeof h.organs !== 'object') throw new Error('FAIL: organs 类型错误');
    console.log('PASS: 全部 ' + required.length + ' 个原有字段存在且类型正确');
  "

# 类型验证：pipeline_version 必须是字符串，不是数字
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (typeof h.pipeline_version !== 'string') throw new Error('FAIL: pipeline_version 类型为 ' + typeof h.pipeline_version + ', 期望 string');
    console.log('PASS: pipeline_version 是字符串类型');
  "
```

---

## Workstreams

workstream_count: 1

### Workstream 1: Health 端点新增 pipeline_version 字段

**范围**: `packages/brain/src/routes/goals.js` — health 端点路由处理函数中 `res.json()` 返回对象新增 `pipeline_version: '5.1'` 字段
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] `GET /api/brain/health` 返回 JSON 包含 `pipeline_version` 字段，值为字符串 `"5.1"`
  Test: manual:curl -sf localhost:5221/api/brain/health | node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(h.pipeline_version!=='5.1')throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] Health 端点原有字段（status, uptime, active_pipelines, evaluator_stats, tick_stats, organs, timestamp）保持不变
  Test: manual:curl -sf localhost:5221/api/brain/health | node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const r=['status','uptime','active_pipelines','evaluator_stats','tick_stats','organs','timestamp'];const m=r.filter(k=>!(k in h));if(m.length)throw new Error('FAIL:'+m);console.log('PASS')"
