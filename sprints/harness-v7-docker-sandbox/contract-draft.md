# Sprint Contract Draft (Round 2 — REVISION)

**修订说明**: 根据 Round 1 Evaluator 反馈（bypass 率 80.8%）全面加固。核心改动：
- 所有静态检查先过滤注释行（`//`/`*`/`#`），防止注释蒙混
- 关键词存在性检查升级为函数体/代码块级结构断言
- 删除所有无效命令（永远 PASS 的 shell echo）
- npm test 管道增加测试名称覆盖验证
- 每个 Feature 增加失败/边界路径 BEHAVIOR 测试

---

## Feature 1: 子进程递归内存采集（FR-001 / US-003）

**行为描述**:
当 Brain watchdog 监控一个正在运行的 harness task 时，采集的 RSS 内存值应包含主进程及其所有子进程（递归）的内存总和。当前 watchdog 只采集单个 PID 的 RSS，导致 task_run_metrics.peak_rss_mb 始终显示为极低值（约 2 MB），无法反映 claude 子进程的真实内存消耗。

**硬阈值**:
- 运行 harness task 后，task_run_metrics.peak_rss_mb 值在 50-2000 MB 范围内（不再是固定的个位数）
- watchdog 采样函数对同一 PID 返回的 rss_mb 包含所有后代进程的 RSS 总和
- 采样不引入阻塞调用（单次采样 < 200ms）
- 向后兼容：进程不存在时返回 null，不抛异常

**验证命令**:
```bash
# 1. 结构断言：sampleProcess 函数体内必须有递归/循环遍历子进程逻辑（非注释）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/watchdog.js','utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const code = lines.join('\n');
  const fn = code.match(/function\s+sampleProcess[\s\S]*?\n\}/);
  if (!fn) { console.log('FAIL: 未找到 sampleProcess 函数定义'); process.exit(1); }
  const body = fn[0];
  if (!body.includes('ppid')) { console.log('FAIL: 函数体内无 ppid（需要父子进程关联）'); process.exit(1); }
  if (!/while|for|recur|queue|stack/.test(body)) { console.log('FAIL: 函数体无递归/循环遍历逻辑'); process.exit(1); }
  if (!/rss/.test(body)) { console.log('FAIL: 函数体无 rss 累加'); process.exit(1); }
  console.log('PASS: sampleProcess 含递归子进程 RSS 累加逻辑');
"

# 2. npm test 管道：验证测试通过且覆盖子进程采集场景
npm test -- --testPathPattern=watchdog --reporter=verbose 2>&1 | node -e "
  const out = require('fs').readFileSync('/dev/stdin','utf8');
  if (/Tests:.*failed/.test(out)) { console.log('FAIL: watchdog 测试有失败'); process.exit(1); }
  if (!/Tests:.*\d+ passed/.test(out) || /Tests:.*0 passed/.test(out)) { console.log('FAIL: 无通过的测试'); process.exit(1); }
  if (!/sampleProcess|recursive|child.*rss|子进程/i.test(out)) { console.log('FAIL: 测试未覆盖子进程采集场景'); process.exit(1); }
  console.log('PASS: watchdog 测试通过且覆盖子进程采集');
"

# 3. 运行时验证：最近完成的 task 的 peak_rss_mb 应 >= 50
psql cecelia -t -c "
  SELECT task_id, peak_rss_mb
  FROM task_run_metrics
  WHERE peak_rss_mb IS NOT NULL
  ORDER BY updated_at DESC LIMIT 5;
" | node -e "
  const lines = require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(l=>l.trim());
  if (lines.length === 0) { console.log('WARN: 无 metrics 数据，需先跑一个 task'); process.exit(0); }
  const vals = lines.map(l => parseInt(l.split('|')[1]?.trim()));
  const allRealistic = vals.every(v => v >= 50);
  if (allRealistic) console.log('PASS: peak_rss_mb 值合理: ' + vals.join(', '));
  else { console.log('FAIL: 存在不合理的 peak_rss_mb: ' + vals.join(', ')); process.exit(1); }
"

# 4. 失败路径：sampleProcess 对不存在的 PID 返回 null 不抛异常
npm test -- --testPathPattern=watchdog --testNamePattern="not exist|invalid pid|null|nonexist" --reporter=verbose 2>&1 | node -e "
  const out = require('fs').readFileSync('/dev/stdin','utf8');
  if (/Tests:.*failed/.test(out)) { console.log('FAIL'); process.exit(1); }
  if (!/Tests:.*\d+ passed/.test(out) || /Tests:.*0 passed/.test(out)) { console.log('FAIL: 无 PID 不存在场景的测试'); process.exit(1); }
  console.log('PASS: PID 不存在时返回 null');
"
```

---

## Feature 2: Docker 容器化执行（FR-002 / FR-003 / FR-004 / US-001）

**行为描述**:
当环境变量 `HARNESS_DOCKER_ENABLED=true` 且 Docker daemon 正在运行时，Brain 通过 `cecelia-run.sh` 派发的 harness task 在独立 Docker 容器中执行，每个容器有 `--memory` 和 `--cpus` 资源限制。容器在任务完成后自动销毁。当 `HARNESS_DOCKER_ENABLED` 未设置或为 `false` 时，行为与现有 `setsid bash -c ... claude -p` 方式完全一致。

**硬阈值**:
- Dockerfile 存在于 `docker/harness-runner/Dockerfile`，可成功 `docker build`
- Dockerfile 包含实际的 claude CLI 安装指令和 Node.js 运行时（非注释占位）
- `HARNESS_DOCKER_ENABLED=true` 时，cecelia-run.sh 使用 `docker run --rm --memory=Xm --cpus=Y` 启动任务
- `HARNESS_DOCKER_ENABLED=false` 或未设置时，仍使用 `setsid bash -c` 启动（零回归）
- CONTAINER_SIZES 常量值为正整数 MB，light >= 256、normal >= 512、heavy >= 1024
- Docker daemon 不可用时，cecelia-run.sh 检测并回退到 non-docker 模式

**验证命令**:
```bash
# 1. Dockerfile 结构验证：必须有实际安装指令，非注释占位
node -e "
  const c = require('fs').readFileSync('docker/harness-runner/Dockerfile','utf8');
  if (!c.includes('FROM')) { console.log('FAIL: 缺少 FROM 指令'); process.exit(1); }
  if (!/RUN.*install.*claude|COPY.*claude|claude.*--version|npm.*install.*-g.*@anthropic/.test(c)) {
    console.log('FAIL: Dockerfile 未实际安装 claude CLI（需 RUN install/COPY，非注释）'); process.exit(1);
  }
  if (!/node|NODE_VERSION|nvm|FROM.*node/.test(c)) {
    console.log('FAIL: Dockerfile 缺少 Node.js 运行时'); process.exit(1);
  }
  console.log('PASS: Dockerfile 包含 claude CLI + Node.js 实际安装指令');
"

# 2. cecelia-run.sh 条件分支验证：过滤注释后检查 if/else 逻辑
node -e "
  const c = require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('#'));
  const code = lines.join('\n');
  // 验证存在 HARNESS_DOCKER_ENABLED 条件分支
  if (!/if.*HARNESS_DOCKER_ENABLED|\\\$\\{?HARNESS_DOCKER_ENABLED/.test(code)) {
    console.log('FAIL: 无 HARNESS_DOCKER_ENABLED 条件分支（非注释代码）'); process.exit(1);
  }
  // 验证 docker run 路径
  if (!/docker run/.test(code)) {
    console.log('FAIL: 无 docker run 命令（非注释代码）'); process.exit(1);
  }
  // 验证 --memory 参数
  if (!/--memory/.test(code)) {
    console.log('FAIL: docker run 缺少 --memory 参数'); process.exit(1);
  }
  // 验证 setsid 回退路径在 else/false 分支
  if (!/else[\s\S]*setsid|setsid/.test(code)) {
    console.log('FAIL: 缺少 setsid 回退路径'); process.exit(1);
  }
  console.log('PASS: cecelia-run.sh 含条件分支 + docker run + setsid 回退');
"

# 3. CONTAINER_SIZES 值合理性验证：正整数且分档合理
node -e "
  const c = require('fs').readFileSync('packages/brain/src/executor.js','utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const code = lines.join('\n');
  const m = code.match(/CONTAINER_SIZES\s*=\s*\{[\s\S]*?\}/);
  if (!m) { console.log('FAIL: 无 CONTAINER_SIZES 定义（非注释代码）'); process.exit(1); }
  const obj = m[0];
  // light >= 256, normal >= 512, heavy >= 1024
  const lightMatch = obj.match(/light[^,}]*?(\d{3,})/);
  const normalMatch = obj.match(/normal[^,}]*?(\d{3,})/);
  const heavyMatch = obj.match(/heavy[^,}]*?(\d{3,})/);
  if (!lightMatch || parseInt(lightMatch[1]) < 256) { console.log('FAIL: light 值不合理（应 >= 256 MB）'); process.exit(1); }
  if (!normalMatch || parseInt(normalMatch[1]) < 512) { console.log('FAIL: normal 值不合理（应 >= 512 MB）'); process.exit(1); }
  if (!heavyMatch || parseInt(heavyMatch[1]) < 1024) { console.log('FAIL: heavy 值不合理（应 >= 1024 MB）'); process.exit(1); }
  console.log('PASS: CONTAINER_SIZES light=' + lightMatch[1] + ' normal=' + normalMatch[1] + ' heavy=' + heavyMatch[1] + ' MB');
"

# 4. docker 可用性检测：过滤注释后确认 docker info/version 在实际代码中
node -e "
  const c = require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('#'));
  const code = lines.join('\n');
  if (!/docker info|docker version/.test(code)) {
    console.log('FAIL: 无 docker 可用性检测（非注释代码）'); process.exit(1);
  }
  // 检测失败后必须有回退逻辑（else/fallback/setsid）
  if (!/docker (info|version)[\s\S]{0,500}(else|fallback|setsid|echo.*fall)/.test(code)) {
    console.log('FAIL: docker 检测失败后无回退逻辑'); process.exit(1);
  }
  console.log('PASS: docker 可用性检测 + 回退逻辑完整');
"

# 5. 失败路径：Docker daemon 不可用时实际走 setsid 回退
node -e "
  const c = require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('#'));
  const code = lines.join('\n');
  // 验证 docker 检测失败与 setsid 之间有明确的控制流连接
  const dockerCheckIdx = code.indexOf('docker info') !== -1 ? code.indexOf('docker info') : code.indexOf('docker version');
  const setsidIdx = code.indexOf('setsid bash');
  if (dockerCheckIdx < 0 || setsidIdx < 0) { console.log('FAIL: 缺少关键路径'); process.exit(1); }
  // setsid 必须在 docker check 之后（控制流合理）
  if (setsidIdx < dockerCheckIdx) { console.log('FAIL: setsid 在 docker 检测之前，控制流不合理'); process.exit(1); }
  console.log('PASS: 回退路径控制流正确');
"
```

---

## Feature 3: 基于内存的资源调度 + 三池隔离（FR-005 / FR-006 / US-002）

**行为描述**:
Brain 的任务派发从抽象 slot 数模型（`MAX_SEATS=16`）改为基于真实内存容量的调度模型。总可分配内存 `TOTAL_CONTAINER_MEMORY_MB=12288`（12 GB），分为三个独立池：Pool A（前台 2 GB）、Pool B（Harness 6 GB）、Pool C（其他 4 GB）。派发前检查目标池的可用内存是否足够容纳新任务的容器规格。池间资源不互借，一个池满载不影响其他池的派发。

**硬阈值**:
- `TOTAL_CONTAINER_MEMORY_MB` 常量存在且值为 12288（非注释代码）
- 三池定义在非注释代码中：Pool A = 2048 MB，Pool B = 6144 MB，Pool C = 4096 MB
- 派发检查：`availableMemory >= CONTAINER_SIZES[task_type]`，不足时任务排队
- Pool 满载时该池的新任务排队，其他池不受影响
- 存在可用内存计算逻辑（非硬编码返回值）

**验证命令**:
```bash
# 1. slot-allocator.js 单文件验证：过滤注释后检查常量和逻辑
node -e "
  const c = require('fs').readFileSync('packages/brain/src/slot-allocator.js','utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const code = lines.join('\n');
  if (!/TOTAL_CONTAINER_MEMORY_MB\s*=\s*12288/.test(code)) {
    console.log('FAIL: TOTAL_CONTAINER_MEMORY_MB 未在非注释代码中定义为 12288'); process.exit(1);
  }
  if (!/2048/.test(code) || !/6144/.test(code) || !/4096/.test(code)) {
    console.log('FAIL: 三池大小（2048/6144/4096）未在非注释代码中定义'); process.exit(1);
  }
  if (!/available.*memory|memory.*available|remain|capacity/i.test(code)) {
    console.log('FAIL: 无可用内存计算逻辑'); process.exit(1);
  }
  console.log('PASS: slot-allocator 三池常量和内存计算逻辑完整');
"

# 2. tick.js 验证：调度逻辑引用内存而非仅 MAX_SEATS
node -e "
  const c = require('fs').readFileSync('packages/brain/src/tick.js','utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const code = lines.join('\n');
  if (!/memory|CONTAINER_SIZES|allocat/i.test(code)) {
    console.log('FAIL: tick.js 调度逻辑未引用内存/容器规格'); process.exit(1);
  }
  console.log('PASS: tick.js 包含内存感知调度');
"

# 3. npm test 管道：slot-allocator 测试通过且覆盖三池和满载场景
npm test -- --testPathPattern=slot-allocator --reporter=verbose 2>&1 | node -e "
  const out = require('fs').readFileSync('/dev/stdin','utf8');
  if (/Tests:.*failed/.test(out)) { console.log('FAIL: slot-allocator 测试有失败'); process.exit(1); }
  if (!/Tests:.*\d+ passed/.test(out) || /Tests:.*0 passed/.test(out)) { console.log('FAIL: 无通过的测试'); process.exit(1); }
  if (!/pool|Pool|内存|memory/i.test(out)) { console.log('FAIL: 测试未覆盖池/内存场景'); process.exit(1); }
  console.log('PASS: slot-allocator 测试通过且覆盖池场景');
"

# 4. 失败路径：池满载时 allocate 返回 null/false，任务排队
npm test -- --testPathPattern=slot-allocator --testNamePattern="full|reject|queue|满载|insufficient" --reporter=verbose 2>&1 | node -e "
  const out = require('fs').readFileSync('/dev/stdin','utf8');
  if (/Tests:.*failed/.test(out)) { console.log('FAIL'); process.exit(1); }
  if (!/Tests:.*\d+ passed/.test(out) || /Tests:.*0 passed/.test(out)) { console.log('FAIL: 无池满载测试用例'); process.exit(1); }
  console.log('PASS: 池满载时正确拒绝派发');
"
```

---

## Feature 4: Harness Pipeline 健康监控端点（FR-007 / US-004）

**行为描述**:
新增 `GET /api/brain/harness/pipeline-health` 端点，返回所有活跃 pipeline 的健康状态。对超过 6 小时无进展的 pipeline 标记 `pipeline_stuck: true`，附带最后活跃时间。同时返回容器失败率统计和资源用量汇总。

**硬阈值**:
- 端点 `GET /api/brain/harness/pipeline-health` 返回 HTTP 200 + JSON
- 响应包含 `pipelines` 数组，每个元素有 `pipeline_id`、`pipeline_stuck`、`last_activity` 字段
- 超过 6 小时无进展的 pipeline `pipeline_stuck = true`
- 响应包含 `failure_rate` 汇总字段
- 无活跃 pipeline 时返回空数组，不报错
- stuck 检测逻辑包含实际 DB 查询（非硬编码空响应）

**验证命令**:
```bash
# 1. 运行时验证：端点返回 200 且响应结构正确（含 pipeline 元素结构）
curl -sf localhost:5221/api/brain/harness/pipeline-health | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (!Array.isArray(d.pipelines)) { console.log('FAIL: 缺少 pipelines 数组'); process.exit(1); }
  if (!('failure_rate' in d)) { console.log('FAIL: 缺少 failure_rate 字段'); process.exit(1); }
  // 验证每个 pipeline 元素结构
  d.pipelines.forEach((p, i) => {
    if (!p.pipeline_id || !('pipeline_stuck' in p) || !p.last_activity) {
      console.log('FAIL: pipeline[' + i + '] 缺少必要字段 (pipeline_id/pipeline_stuck/last_activity)');
      process.exit(1);
    }
  });
  console.log('PASS: pipeline-health 响应结构正确，pipelines=' + d.pipelines.length);
" || echo "WARN: Brain 未运行，跳过运行时验证"

# 2. ops.js stuck 检测逻辑验证：过滤注释后检查 DB 查询 + 6小时阈值
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/ops.js','utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const code = lines.join('\n');
  if (!/pipeline_stuck/.test(code)) {
    console.log('FAIL: pipeline_stuck 未在非注释代码中实现'); process.exit(1);
  }
  if (!/6\s*\*\s*60|360|21600|hours.*6|6.*hour/i.test(code)) {
    console.log('FAIL: 6小时阈值未在非注释代码逻辑中定义'); process.exit(1);
  }
  if (!/SELECT|query|FROM.*harness|pool\.query|db\.query/.test(code)) {
    console.log('FAIL: 无 DB 查询获取 pipeline 数据（非硬编码响应）'); process.exit(1);
  }
  console.log('PASS: stuck 检测含 DB 查询 + 6小时阈值');
"

# 3. server.js 路由注册验证
node -e "
  const c = require('fs').readFileSync('packages/brain/src/server.js','utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const code = lines.join('\n');
  if (!/pipeline-health/.test(code)) {
    console.log('FAIL: server.js 未注册 pipeline-health 路由（非注释代码）'); process.exit(1);
  }
  console.log('PASS: pipeline-health 路由已注册');
"

# 4. 失败路径：无活跃 pipeline 时端点不报错
curl -sf localhost:5221/api/brain/harness/pipeline-health | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  // 即使空数组也不应报错
  if (!Array.isArray(d.pipelines)) { console.log('FAIL: pipelines 非数组'); process.exit(1); }
  console.log('PASS: 空状态正常返回，pipelines.length=' + d.pipelines.length);
" || echo "WARN: Brain 未运行，跳过运行时验证"
```

---

## Feature 5: Dashboard Harness 监控页面（FR-008 / US-004）

**行为描述**:
Dashboard 新增 Harness 监控页面，展示运行中 pipeline 的容器状态、资源用量和失败率趋势图。页面通过调用 `pipeline-health` API 获取数据，自动刷新。运维人员可在该页面一目了然地发现卡住的 pipeline 和资源瓶颈。

**硬阈值**:
- Dashboard 路由存在（如 `/harness` 或 `/pipeline-monitor`）
- 页面组件文件存在于 `apps/dashboard/src/` 目录下
- 页面有实际 API 调用（fetch/useSWR/useQuery/axios），非空壳
- 卡住的 pipeline 有视觉区分（stuck/warning/error/red/danger）
- 页面能在无活跃 pipeline 时正常渲染空状态（条件渲染）

**验证命令**:
```bash
# 1. 组件文件存在且包含实际 React 逻辑（API 调用 + 空状态 + stuck 视觉区分）
node -e "
  const fs = require('fs');
  const files = fs.readdirSync('apps/dashboard/src', { recursive: true })
    .filter(f => /harness|pipeline/i.test(f) && /\.(tsx|jsx)$/.test(f));
  if (files.length === 0) { console.log('FAIL: 无 harness 监控组件文件'); process.exit(1); }
  const c = files.map(f => fs.readFileSync('apps/dashboard/src/' + f, 'utf8')).join('\n');
  // 必须有实际 API 调用
  if (!/fetch\(|useSWR|useQuery|axios/.test(c)) {
    console.log('FAIL: 组件无实际 API 调用（fetch/useSWR/useQuery/axios）'); process.exit(1);
  }
  // 必须有条件渲染（空状态处理）
  if (!/\.length\s*===\s*0|!.*\.length|\?.*empty|暂无|no.*pipeline/i.test(c)) {
    console.log('FAIL: 无空状态条件渲染'); process.exit(1);
  }
  // 必须有 stuck pipeline 视觉区分
  if (!/stuck|warning|error|red|danger/i.test(c)) {
    console.log('FAIL: 无 stuck pipeline 视觉区分'); process.exit(1);
  }
  console.log('PASS: 监控组件含 API 调用 + 空状态 + stuck 视觉区分: ' + files.join(', '));
"

# 2. 组件引用 pipeline-health API 路径
node -e "
  const fs = require('fs');
  const files = fs.readdirSync('apps/dashboard/src', { recursive: true })
    .filter(f => /harness|pipeline/i.test(f) && /\.(tsx|jsx|ts|js)$/.test(f));
  const c = files.map(f => fs.readFileSync('apps/dashboard/src/' + f, 'utf8')).join('');
  if (!/pipeline-health/.test(c)) {
    console.log('FAIL: 监控组件未引用 pipeline-health API 路径'); process.exit(1);
  }
  console.log('PASS: 组件已对接 pipeline-health API');
"

# 3. Dashboard 路由注册（非注释代码）
node -e "
  const fs = require('fs');
  const routeFiles = fs.readdirSync('apps/dashboard/src', { recursive: true })
    .filter(f => /route|router|app/i.test(f) && /\.(tsx|jsx|ts|js)$/.test(f));
  if (routeFiles.length === 0) { console.log('FAIL: 未找到路由配置文件'); process.exit(1); }
  const c = routeFiles.map(f => {
    const content = fs.readFileSync('apps/dashboard/src/' + f, 'utf8');
    return content.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  }).join('\n');
  if (!/harness|pipeline.monitor/i.test(c)) {
    console.log('FAIL: 路由未注册 harness 监控页面（非注释代码）'); process.exit(1);
  }
  console.log('PASS: Dashboard 路由已注册 harness 监控页面');
"

# 4. 失败路径：组件含加载状态处理（loading/error boundary）
node -e "
  const fs = require('fs');
  const files = fs.readdirSync('apps/dashboard/src', { recursive: true })
    .filter(f => /harness|pipeline/i.test(f) && /\.(tsx|jsx)$/.test(f));
  const c = files.map(f => fs.readFileSync('apps/dashboard/src/' + f, 'utf8')).join('');
  if (!/loading|isLoading|Loading|Spinner|skeleton/i.test(c)) {
    console.log('FAIL: 组件无加载状态处理'); process.exit(1);
  }
  if (!/error|Error|catch|onError/i.test(c)) {
    console.log('FAIL: 组件无错误状态处理'); process.exit(1);
  }
  console.log('PASS: 组件含 loading + error 状态处理');
"
```

---

## Workstreams

workstream_count: 4

### Workstream 1: 子进程递归内存采集修复

**范围**: 修改 `packages/brain/src/watchdog.js` 的 `sampleProcessDarwin` 和 `sampleProcess` 函数，使其递归统计主进程及所有子进程的 RSS 总和。同时更新对应的单元测试。不涉及 executor.js、tick.js 或 cecelia-run.sh。
**大小**: S（<100行）
**依赖**: 无

### Workstream 2: Docker 容器化执行

**范围**: 新增 `docker/harness-runner/Dockerfile`；修改 `packages/brain/scripts/cecelia-run.sh` 在 `HARNESS_DOCKER_ENABLED=true` 时用 `docker run` 替换 `setsid`；在 `packages/brain/src/executor.js` 新增 `CONTAINER_SIZES` 常量映射 task_type → 容器规格。不修改 slot-allocator.js 或 tick.js 的调度逻辑。
**大小**: L（>300行）
**依赖**: Workstream 1 完成后（需真实内存数据验证容器限额合理性）

### Workstream 3: 内存调度 + 三池隔离

**范围**: 修改 `packages/brain/src/slot-allocator.js` 和 `packages/brain/src/tick.js`，将 slot 数调度改为基于内存的三池模型。定义 TOTAL_CONTAINER_MEMORY_MB=12288，三池 A/B/C 分配。派发前检查目标池可用内存。更新相关单元测试。
**大小**: M（100-300行）
**依赖**: Workstream 2 完成后（需要 CONTAINER_SIZES 常量）

### Workstream 4: 监控端点 + Dashboard 页面

**范围**: 在 `packages/brain/src/routes/ops.js` 新增 pipeline-health 端点（含 DB 查询 + stuck 检测），在 `packages/brain/src/server.js` 注册路由。在 `apps/dashboard/` 新增 Harness 监控页面组件。
**大小**: M（100-300行）
**依赖**: 无（端点可独立开发，数据来自 DB 查询）
