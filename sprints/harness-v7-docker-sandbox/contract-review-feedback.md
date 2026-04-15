# Contract Review Feedback (Round 1)

## 摘要

**判定**: REVISION
**bypass 率**: 80.8%（21/26 条命令可被假实现蒙混过关）
**核心问题**: 绝大多数验证命令是字符串存在性检查（`includes()`/`regex.test()`），注释或空壳代码即可通过。缺少失败路径测试、npm test 管道验证太弱、UI 功能无渲染测试。

---

## 必须修改项

### 1. [命令太弱] Feature 1 — DoD BEHAVIOR 测试只检查关键词存在

**原始命令**:
```bash
manual:node -e "const c=require('fs').readFileSync('packages/brain/src/watchdog.js','utf8');if(!c.includes('ppid')||!c.includes('children')||!c.includes('recursive'))process.exit(1);console.log('PASS')"
```

**假实现片段**（proof-of-falsification）:
```javascript
// watchdog.js 加注释即可通过
// TODO: implement recursive children ppid scanning
function sampleProcessDarwin(pid) { return { rss_mb: 2 }; }
```

**建议修复命令**:
```bash
manual:node -e "const c=require('fs').readFileSync('packages/brain/src/watchdog.js','utf8');const fn=c.match(/function\s+sampleProcess[\s\S]*?\n\}/);if(!fn)process.exit(1);const body=fn[0];if(!body.includes('ppid')){console.log('FAIL: 函数体内无 ppid');process.exit(1)}if(!/while|for|recur|queue|stack/.test(body)){console.log('FAIL: 无递归/循环遍历');process.exit(1)}console.log('PASS')"
```

### 2. [命令太弱] Feature 1 — npm test 管道只检查 FAIL 不存在

**原始命令**:
```bash
npm test -- --testPathPattern=watchdog --reporter=verbose 2>&1 | node -e "
  const out = require('fs').readFileSync('/dev/stdin','utf8');
  if (/FAIL/.test(out) && !/PASS/.test(out)) { console.log('FAIL'); process.exit(1); }
  console.log('PASS');
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 空测试套件——输出含 PASS，不含 FAIL
describe('watchdog', () => {
  it('placeholder', () => expect(true).toBe(true));
});
```

**建议修复命令**:
```bash
npm test -- --testPathPattern=watchdog --reporter=verbose 2>&1 | node -e "
  const out = require('fs').readFileSync('/dev/stdin','utf8');
  if (/Tests:.*failed/.test(out)) { console.log('FAIL: 测试失败'); process.exit(1); }
  if (!/Tests:.*\d+ passed/.test(out) || /Tests:.*0 passed/.test(out)) { console.log('FAIL: 无通过的测试'); process.exit(1); }
  if (!/sampleProcess|recursive|child.*rss/i.test(out)) { console.log('FAIL: 测试未覆盖子进程采集'); process.exit(1); }
  console.log('PASS');
"
```

### 3. [命令无效] Feature 2 — 环境变量关闭测试永远 PASS

**原始命令**:
```bash
HARNESS_DOCKER_ENABLED=false bash -c 'echo "PASS: 环境变量关闭时不触发 docker 逻辑"'
```

**假实现片段**（proof-of-falsification）:
```bash
# 这个命令永远输出 PASS，无论 cecelia-run.sh 内容如何
# bash -c 'echo PASS' 不执行任何验证逻辑
```

**建议修复命令**:
```bash
# 删除此无效命令，用静态分析替代
node -e "
  const c = require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('#'));
  const code = lines.join('\n');
  // 验证存在 if/else 条件分支
  if (!/if.*HARNESS_DOCKER_ENABLED/.test(code) && !/\$\{?HARNESS_DOCKER_ENABLED/.test(code)) {
    console.log('FAIL: 无 HARNESS_DOCKER_ENABLED 条件分支'); process.exit(1);
  }
  // 验证 else/false 路径走 setsid
  if (!/else[\s\S]*setsid|false.*setsid|setsid.*fallback/.test(code)) {
    console.log('FAIL: 回退路径未连接到 setsid'); process.exit(1);
  }
  console.log('PASS: 条件分支和回退路径正确');
"
```

### 4. [命令太弱] Feature 2 — 所有 DoD 测试为字符串存在性检查

**原始命令**（5 条 DoD 中的 4 条）:
```bash
# 2.1 Dockerfile: includes('FROM') + includes('claude')
# 2.2 cecelia-run: includes('docker run') + includes('--memory')
# 2.4 CONTAINER_SIZES: regex match 但不验证值
# 2.5 docker info + fallback: includes()
```

**假实现片段**（proof-of-falsification）:
```dockerfile
# docker/harness-runner/Dockerfile
FROM ubuntu:22.04
# TODO: install claude CLI and node runtime
RUN echo "placeholder"
# 通过 includes('FROM') + includes('claude') 检查
```

```javascript
// executor.js
const CONTAINER_SIZES = { light: 0, normal: 0, heavy: 0 };
// 通过 regex 检查，但值为 0 无实际意义
```

**建议修复命令**:

Dockerfile 验证改为检查实际安装指令：
```bash
node -e "
  const c = require('fs').readFileSync('docker/harness-runner/Dockerfile','utf8');
  if (!c.includes('FROM')) process.exit(1);
  if (!/RUN.*install.*claude|COPY.*claude|claude.*--version/.test(c)) {
    console.log('FAIL: Dockerfile 未实际安装 claude CLI'); process.exit(1);
  }
  if (!/node|NODE_VERSION|nvm/.test(c)) {
    console.log('FAIL: Dockerfile 缺少 Node.js'); process.exit(1);
  }
  console.log('PASS');
"
```

CONTAINER_SIZES 验证改为检查值合理性：
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/executor.js','utf8');
  const m = c.match(/CONTAINER_SIZES\s*=\s*\{[\s\S]*?\}/);
  if (!m) { console.log('FAIL: 无 CONTAINER_SIZES'); process.exit(1); }
  const obj = m[0];
  if (!/light.*[1-9]\d{1,}/.test(obj) || !/normal.*[1-9]\d{2,}/.test(obj) || !/heavy.*[1-9]\d{2,}/.test(obj)) {
    console.log('FAIL: CONTAINER_SIZES 值不合理（应为正整数 MB）'); process.exit(1);
  }
  console.log('PASS');
"
```

docker info 回退验证改为排除注释：
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('#'));
  const code = lines.join('\n');
  if (!/docker info|docker version/.test(code)) {
    console.log('FAIL: 无 docker 可用性检测（非注释代码）'); process.exit(1);
  }
  console.log('PASS');
"
```

### 5. [命令太弱] Feature 3 — 三池常量 regex 匹配过于宽松

**原始命令**:
```bash
node -e "
  const c = readFile('slot-allocator.js') + readFile('executor.js') + readFile('tick.js');
  const hasPoolA = /Pool.?A|POOL_A|foreground.*2048|2048.*foreground/i.test(c);
  ...
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// executor.js 加注释
// Pool A: foreground 2048 MB
// Pool B: harness 6144 MB  
// Pool C: other 4096 MB
// TOTAL_CONTAINER_MEMORY_MB = 12288
// 实际调度逻辑仍用旧的 MAX_SEATS=16
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/slot-allocator.js','utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const code = lines.join('\n');
  if (!/TOTAL_CONTAINER_MEMORY_MB\s*=\s*12288/.test(code)) {
    console.log('FAIL: TOTAL_CONTAINER_MEMORY_MB 未在非注释代码中定义'); process.exit(1);
  }
  if (!/2048/.test(code) || !/6144/.test(code) || !/4096/.test(code)) {
    console.log('FAIL: 三池大小未在非注释代码中定义'); process.exit(1);
  }
  if (!/available.*memory|memory.*available|remain|capacity/.test(code)) {
    console.log('FAIL: 无可用内存检查逻辑'); process.exit(1);
  }
  console.log('PASS');
"
```

### 6. [命令太弱] Feature 4 — HTTP 200 检查 + 响应结构验证太浅

**原始命令**:
```bash
# 命令 1: 只检查 HTTP 200
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/pipeline-health")
# 命令 2: 只检查 pipelines 是数组 + failure_rate/summary 存在
```

**假实现片段**（proof-of-falsification）:
```javascript
// 硬编码空响应通过两个检查
app.get('/api/brain/harness/pipeline-health', (req, res) => {
  res.json({ pipelines: [], failure_rate: 0, summary: {} });
});
// 无 DB 查询、无 stuck 检测、无真实逻辑
```

**建议修复命令**:
```bash
# 合并为一条完整验证
curl -sf localhost:5221/api/brain/harness/pipeline-health | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (!Array.isArray(d.pipelines)) { console.log('FAIL: 缺少 pipelines 数组'); process.exit(1); }
  if (!('failure_rate' in d)) { console.log('FAIL: 缺少 failure_rate'); process.exit(1); }
  // 验证每个 pipeline 元素结构
  d.pipelines.forEach((p, i) => {
    if (!p.pipeline_id || !('pipeline_stuck' in p) || !p.last_activity) {
      console.log('FAIL: pipeline[' + i + '] 缺少必要字段 (pipeline_id/pipeline_stuck/last_activity)');
      process.exit(1);
    }
  });
  console.log('PASS: ' + d.pipelines.length + ' pipelines');
"
```

### 7. [命令太弱] Feature 4 — ops.js stuck 检测验证只查字符串

**原始命令**:
```bash
node -e "const c=require('fs').readFileSync('packages/brain/src/routes/ops.js','utf8');if(!c.includes('pipeline_stuck')&&!c.includes('6'))process.exit(1);console.log('PASS')"
```

**假实现片段**（proof-of-falsification）:
```javascript
// ops.js 加注释
// pipeline_stuck: detect pipelines idle > 6 hours
// 实际端点返回硬编码 { pipelines: [], pipeline_stuck: false }
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/ops.js','utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const code = lines.join('\n');
  if (!/pipeline_stuck/.test(code)) {
    console.log('FAIL: pipeline_stuck 未在代码中实现'); process.exit(1);
  }
  if (!/6\s*\*\s*60|360|21600|hours.*6|6.*hour/i.test(code)) {
    console.log('FAIL: 6小时阈值未在代码逻辑中定义'); process.exit(1);
  }
  if (!/SELECT|query|FROM.*harness|pipeline/.test(code)) {
    console.log('FAIL: 无 DB 查询获取 pipeline 数据'); process.exit(1);
  }
  console.log('PASS');
"
```

### 8. [工具不对] Feature 5 — UI 功能无渲染测试

**原始命令**:
```bash
# 4 条命令全是 node -e readFileSync + string check
# 无 playwright/browser 测试验证页面实际渲染
```

**假实现片段**（proof-of-falsification）:
```tsx
// harness-monitor.tsx
// 包含所有关键词但不渲染任何有意义的 UI
export default function HarnessMonitor() {
  // fetch pipeline-health API
  // handle empty state
  return <div className="empty">pipeline-health loading...</div>;
}
```

**建议修复命令**:

静态验证改为检查实际 React 组件逻辑：
```bash
node -e "
  const fs = require('fs');
  const files = fs.readdirSync('apps/dashboard/src', { recursive: true })
    .filter(f => /harness|pipeline/i.test(f) && /\.(tsx|jsx)$/.test(f));
  if (files.length === 0) { console.log('FAIL: 无监控组件'); process.exit(1); }
  const c = files.map(f => fs.readFileSync('apps/dashboard/src/' + f, 'utf8')).join('');
  // 必须有实际 API 调用
  if (!/fetch\(|useSWR|useQuery|axios/.test(c)) {
    console.log('FAIL: 组件无实际 API 调用'); process.exit(1);
  }
  // 必须有条件渲染（空状态处理）
  if (!/\.length\s*===\s*0|!.*\.length|\?.*empty|暂无|no.*pipeline/i.test(c)) {
    console.log('FAIL: 无空状态条件渲染'); process.exit(1);
  }
  // 必须有 stuck 视觉区分
  if (!/stuck|warning|error|red|danger/i.test(c)) {
    console.log('FAIL: 无 stuck pipeline 视觉区分'); process.exit(1);
  }
  console.log('PASS: ' + files.join(', '));
"
```

### 9. [缺失边界] 全局 — 无失败路径测试

**缺失测试场景**:
- Feature 1: 进程不存在时 sampleProcess 返回 null，不抛异常
- Feature 2: Docker daemon 不可用时实际回退执行（不只是字符串检查）
- Feature 3: 池满载时新任务排队（不只是 npm test，需要明确的测试用例名称验证）
- Feature 4: 无活跃 pipeline 时返回空数组不报错

**建议**: 每个 Feature 的 DoD 至少增加一条失败/边界路径的 BEHAVIOR 测试。例如：

Feature 1 增加：
```
- [ ] [BEHAVIOR] sampleProcess 对不存在的 PID 返回 null，不抛异常
  Test: npm test -- --testPathPattern=watchdog --testNamePattern="not exist|invalid pid|null"
```

Feature 3 增加：
```
- [ ] [BEHAVIOR] 池满载时 allocateSlot 返回 null/false，任务进入等待队列
  Test: npm test -- --testPathPattern=slot-allocator --testNamePattern="full|reject|queue"
```

### 10. [命令太弱] 全局 — 注释即可通过的系统性问题

**问题描述**: 合同中 21/26 条命令使用 `includes()` 或 `regex.test()` 检查整个文件内容，但未排除注释行。这是系统性缺陷。

**建议**: 所有静态代码检查命令应先过滤注释行：
```javascript
const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('#'));
const code = lines.join('\n');
```

---

## 可选改进

- Feature 3 验证命令拼接了 slot-allocator.js + executor.js + tick.js 三个文件的内容再 regex，应拆分为单文件检查，避免文件 A 的注释匹配到文件 B 的 regex
- Feature 5 可增加 Dashboard dev server 启动 + playwright 截图对比（`manual:chrome:localhost:5211/harness`），但考虑到 CI 环境限制，可标记为 P2
- Feature 1 的 psql 运行时测试有 `exit 0` 的 WARN 路径（无数据时），应改为明确的 SKIP（exit code 2）以区分 PASS/SKIP/FAIL
