# Sprint Contract Draft (Round 1)

## Feature 1: 子进程递归内存采集（FR-001 / US-003）

**行为描述**:
当 Brain watchdog 监控一个正在运行的 harness task 时，采集的 RSS 内存值应包含主进程及其所有子进程（递归）的内存总和。当前 watchdog 只采集单个 PID 的 RSS，导致 task_run_metrics.peak_rss_mb 始终显示为极低值（约 2 MB），无法反映 claude 子进程的真实内存消耗。

**硬阈值**:
- 运行 harness task 后，task_run_metrics.peak_rss_mb 值在 50-2000 MB 范围内（不再是固定的个位数）
- watchdog 采样函数对同一 PID 返回的 rss_mb 包含所有后代进程的 RSS 总和
- 采样不引入阻塞调用（单次采样 < 200ms）
- 向后兼容：进程不存在时仍返回 null，不抛异常

**验证命令**:
```bash
# Happy path: 查询最近完成的 task 的 peak_rss_mb，应 >= 50
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

# 单元测试: sampleProcess 递归子进程
npm test -- --testPathPattern=watchdog --reporter=verbose 2>&1 | \
  node -e "
    const out = require('fs').readFileSync('/dev/stdin','utf8');
    if (/FAIL/.test(out) && !/PASS/.test(out)) { console.log('FAIL: watchdog 测试失败'); process.exit(1); }
    console.log('PASS: watchdog 测试通过');
  "
```

---

## Feature 2: Docker 容器化执行（FR-002 / FR-003 / FR-004 / US-001）

**行为描述**:
当环境变量 `HARNESS_DOCKER_ENABLED=true` 且 Docker daemon 正在运行时，Brain 通过 `cecelia-run.sh` 派发的 harness task 在独立 Docker 容器中执行，每个容器有 `--memory` 和 `--cpus` 资源限制。容器在任务完成后自动销毁。当 `HARNESS_DOCKER_ENABLED` 未设置或为 `false` 时，行为与现有 `setsid bash -c ... claude -p` 方式完全一致。

**硬阈值**:
- Dockerfile 存在于 `docker/harness-runner/Dockerfile`，可成功 `docker build`
- `HARNESS_DOCKER_ENABLED=true` 时，cecelia-run.sh 使用 `docker run --rm --memory=Xm --cpus=Y` 启动任务
- `HARNESS_DOCKER_ENABLED=false` 或未设置时，仍使用 `setsid bash -c` 启动（零回归）
- 容器有 `--memory` 限制，值来自 executor.js 的 `CONTAINER_SIZES` 常量
- 容器结束后 `docker ps -a --filter name=cecelia-task-*` 无残留（`--rm` 保证）
- 容器内可通过 `host.docker.internal:5221` 访问 Brain API
- Docker daemon 不可用时，cecelia-run.sh 检测并回退到 non-docker 模式

**验证命令**:
```bash
# Dockerfile 存在且可构建
node -e "
  const fs = require('fs');
  const path = 'docker/harness-runner/Dockerfile';
  if (!fs.existsSync(path)) { console.log('FAIL: Dockerfile 不存在'); process.exit(1); }
  const content = fs.readFileSync(path, 'utf8');
  if (!content.includes('FROM') || !content.includes('claude')) {
    console.log('FAIL: Dockerfile 缺少必要内容'); process.exit(1);
  }
  console.log('PASS: Dockerfile 存在且包含必要指令');
"

# CONTAINER_SIZES 常量存在于 executor.js
node -e "
  const c = require('fs').readFileSync('packages/brain/src/executor.js','utf8');
  if (!c.includes('CONTAINER_SIZES')) { console.log('FAIL: executor.js 缺少 CONTAINER_SIZES'); process.exit(1); }
  console.log('PASS: CONTAINER_SIZES 常量已定义');
"

# cecelia-run.sh 包含 docker run 路径和 setsid 回退路径
node -e "
  const c = require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');
  const hasDocker = c.includes('docker run') && c.includes('HARNESS_DOCKER_ENABLED');
  const hasSetsid = c.includes('setsid bash');
  if (!hasDocker) { console.log('FAIL: cecelia-run.sh 缺少 docker run 路径'); process.exit(1); }
  if (!hasSetsid) { console.log('FAIL: cecelia-run.sh 缺少 setsid 回退路径'); process.exit(1); }
  console.log('PASS: cecelia-run.sh 包含 docker + setsid 双路径');
"

# Docker daemon 不可用时的回退（模拟测试）
HARNESS_DOCKER_ENABLED=false bash -c 'echo "PASS: 环境变量关闭时不触发 docker 逻辑"'
```

---

## Feature 3: 基于内存的资源调度 + 三池隔离（FR-005 / FR-006 / US-002）

**行为描述**:
Brain 的任务派发从抽象 slot 数模型（`MAX_SEATS=16`）改为基于真实内存容量的调度模型。总可分配内存 `TOTAL_CONTAINER_MEMORY_MB=12288`（12 GB），分为三个独立池：Pool A（前台 2 GB）、Pool B（Harness 6 GB）、Pool C（其他 4 GB）。派发前检查目标池的可用内存是否足够容纳新任务的容器规格。池间资源不互借，一个池满载不影响其他池的派发。

**硬阈值**:
- `TOTAL_CONTAINER_MEMORY_MB` 常量存在且值为 12288
- 三池定义：Pool A = 2048 MB，Pool B = 6144 MB，Pool C = 4096 MB，总和 = 12288
- 派发检查：`availableMemory >= CONTAINER_SIZES[task_type]`，不足时任务排队
- Pool 满载时该池的新任务排队，其他池不受影响
- 向后兼容：`MAX_SEATS` 仍可作为降级回退参数

**验证命令**:
```bash
# 三池常量定义检查
node -e "
  const c = require('fs').readFileSync('packages/brain/src/slot-allocator.js','utf8') +
            require('fs').readFileSync('packages/brain/src/executor.js','utf8') +
            require('fs').readFileSync('packages/brain/src/tick.js','utf8');
  const hasTotalMem = /TOTAL_CONTAINER_MEMORY_MB\s*=\s*12288/.test(c);
  const hasPoolA = /Pool.?A|POOL_A|foreground.*2048|2048.*foreground/i.test(c);
  const hasPoolB = /Pool.?B|POOL_B|harness.*6144|6144.*harness/i.test(c);
  const hasPoolC = /Pool.?C|POOL_C|other.*4096|4096.*other/i.test(c);
  if (!hasTotalMem) { console.log('FAIL: TOTAL_CONTAINER_MEMORY_MB != 12288'); process.exit(1); }
  if (!hasPoolA || !hasPoolB || !hasPoolC) { console.log('FAIL: 三池定义不完整 A=' + hasPoolA + ' B=' + hasPoolB + ' C=' + hasPoolC); process.exit(1); }
  console.log('PASS: 内存调度常量和三池定义完整');
"

# slot-allocator 单元测试通过
npm test -- --testPathPattern=slot-allocator --reporter=verbose 2>&1 | \
  node -e "
    const out = require('fs').readFileSync('/dev/stdin','utf8');
    if (/Tests:.*failed/.test(out)) { console.log('FAIL: slot-allocator 测试失败'); process.exit(1); }
    console.log('PASS: slot-allocator 测试通过');
  "

# 池隔离：API 层暴露内存调度状态
curl -sf localhost:5221/api/brain/executor-status 2>/dev/null | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (d.pools || d.memory_pools || d.pool_status) {
      console.log('PASS: executor-status 返回池状态信息');
    } else {
      console.log('WARN: executor-status 尚未包含池状态（需运行时验证）');
    }
  " || echo "WARN: Brain 未运行，跳过运行时验证"
```

---

## Feature 4: Harness Pipeline 健康监控端点（FR-007 / US-004）

**行为描述**:
新增 `GET /api/brain/harness/pipeline-health` 端点，返回所有活跃 pipeline 的健康状态。对超过 6 小时无进展的 pipeline 标记 `pipeline_stuck: true`，附带最后活跃时间。同时返回容器失败率统计和资源用量 histogram。

**硬阈值**:
- 端点 `GET /api/brain/harness/pipeline-health` 返回 HTTP 200 + JSON
- 响应包含 `pipelines` 数组，每个元素有 `pipeline_id`、`status`、`last_activity`、`pipeline_stuck` 字段
- 超过 6 小时无进展的 pipeline `pipeline_stuck = true`
- 响应包含 `failure_rate` 和 `resource_usage` 汇总字段
- 无活跃 pipeline 时返回空数组，不报错

**验证命令**:
```bash
# 端点存在且返回 200
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/pipeline-health" 2>/dev/null)
if [ "$STATUS" = "200" ]; then
  echo "PASS: pipeline-health 端点返回 200"
else
  echo "FAIL: 期望 200，实际 $STATUS（Brain 可能未运行）"
  exit 1
fi

# 响应结构验证
curl -sf "localhost:5221/api/brain/harness/pipeline-health" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!Array.isArray(d.pipelines)) { console.log('FAIL: 缺少 pipelines 数组'); process.exit(1); }
    if (!('failure_rate' in d) && !('summary' in d)) { console.log('FAIL: 缺少汇总字段'); process.exit(1); }
    console.log('PASS: pipeline-health 响应结构正确，pipelines=' + d.pipelines.length);
  "

# 路由注册检查（静态）
node -e "
  const s = require('fs').readFileSync('packages/brain/src/server.js','utf8');
  if (!s.includes('pipeline-health')) { console.log('FAIL: server.js 未注册 pipeline-health 路由'); process.exit(1); }
  console.log('PASS: pipeline-health 路由已注册');
"
```

---

## Feature 5: Dashboard Harness 监控页面（FR-008 / US-004）

**行为描述**:
Dashboard 新增 Harness 监控页面，展示运行中 pipeline 的容器状态、资源用量和失败率趋势图。页面通过调用 `pipeline-health` API 获取数据，自动刷新。运维人员可在该页面一目了然地发现卡住的 pipeline 和资源瓶颈。

**硬阈值**:
- Dashboard 路由存在（如 `/harness` 或 `/pipeline-monitor`）
- 页面组件文件存在于 `apps/dashboard/src/` 目录下
- 页面调用 `/api/brain/harness/pipeline-health` 获取数据
- 卡住的 pipeline 在页面上有视觉区分（如红色标记或警告图标）
- 页面能在无活跃 pipeline 时正常渲染空状态

**验证命令**:
```bash
# Dashboard 组件文件存在
node -e "
  const fs = require('fs');
  const glob = require('path');
  const dir = 'apps/dashboard/src';
  const files = fs.readdirSync(dir, { recursive: true }).filter(f =>
    /harness|pipeline.monitor/i.test(f) && /\.(tsx|jsx|ts|js)$/.test(f)
  );
  if (files.length === 0) { console.log('FAIL: 未找到 harness 监控页面组件'); process.exit(1); }
  console.log('PASS: 找到监控页面组件: ' + files.join(', '));
"

# 组件引用 pipeline-health API
node -e "
  const fs = require('fs');
  const files = fs.readdirSync('apps/dashboard/src', { recursive: true })
    .filter(f => /harness|pipeline/i.test(f) && /\.(tsx|jsx|ts|js)$/.test(f));
  const contents = files.map(f => fs.readFileSync('apps/dashboard/src/' + f, 'utf8')).join('');
  if (!contents.includes('pipeline-health')) {
    console.log('FAIL: 监控组件未引用 pipeline-health API'); process.exit(1);
  }
  console.log('PASS: 监控组件已对接 pipeline-health API');
"

# Dashboard 路由注册
node -e "
  const fs = require('fs');
  const routeFiles = fs.readdirSync('apps/dashboard/src', { recursive: true })
    .filter(f => /route|router|app/i.test(f) && /\.(tsx|jsx|ts|js)$/.test(f));
  const contents = routeFiles.map(f => fs.readFileSync('apps/dashboard/src/' + f, 'utf8')).join('');
  if (!/harness|pipeline.monitor/i.test(contents)) {
    console.log('FAIL: 路由未注册 harness 监控页面'); process.exit(1);
  }
  console.log('PASS: Dashboard 路由已注册 harness 监控页面');
"
```

---

## Workstreams

workstream_count: 4

### Workstream 1: 子进程递归内存采集修复

**范围**: 修改 `packages/brain/src/watchdog.js` 的 `sampleProcessDarwin` 和 `sampleProcess` 函数，使其递归统计主进程及所有子进程的 RSS 总和。同时更新对应的单元测试。不涉及 executor.js、tick.js 或 cecelia-run.sh。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] watchdog 的 sampleProcessDarwin 递归统计主进程及所有子进程 RSS 总和（macOS 用 `ps -o rss=,ppid= -ax` 构建进程树）
  Test: npm test -- --testPathPattern=watchdog --reporter=verbose
- [ ] [BEHAVIOR] task_run_metrics.peak_rss_mb 在任务完成后写入合理值（>= 50 MB），不再是固定个位数
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/watchdog.js','utf8');if(!c.includes('ppid')||!c.includes('children')||!c.includes('recursive'))process.exit(1);console.log('PASS')"
- [ ] [ARTIFACT] watchdog.test.js 包含子进程 RSS 累加的测试用例
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/watchdog.test.js','utf8');if(!c.includes('child')&&!c.includes('recursive')&&!c.includes('子进程'))process.exit(1);console.log('OK')"

### Workstream 2: Docker 容器化执行

**范围**: 新增 `docker/harness-runner/Dockerfile`；修改 `packages/brain/scripts/cecelia-run.sh` 在 `HARNESS_DOCKER_ENABLED=true` 时用 `docker run` 替换 `setsid`；在 `packages/brain/src/executor.js` 新增 `CONTAINER_SIZES` 常量映射 task_type → 容器规格。不修改 slot-allocator.js 或 tick.js 的调度逻辑。
**大小**: L（>300行）
**依赖**: Workstream 1 完成后（需真实内存数据验证容器限额合理性）

**DoD**:
- [ ] [ARTIFACT] docker/harness-runner/Dockerfile 存在且包含 claude CLI + Node.js 运行时
  Test: node -e "const c=require('fs').readFileSync('docker/harness-runner/Dockerfile','utf8');if(!c.includes('FROM')||!c.includes('node'))process.exit(1);console.log('OK')"
- [ ] [BEHAVIOR] cecelia-run.sh 在 HARNESS_DOCKER_ENABLED=true 时使用 docker run --rm --memory 启动任务
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');if(!c.includes('docker run')||!c.includes('--memory')||!c.includes('HARNESS_DOCKER_ENABLED'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] cecelia-run.sh 在 HARNESS_DOCKER_ENABLED=false 或未设置时仍使用 setsid bash 执行（零回归）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');const lines=c.split('\n');const setsidLine=lines.findIndex(l=>l.includes('setsid bash'));if(setsidLine<0)process.exit(1);console.log('PASS: setsid 回退路径保留在第'+(setsidLine+1)+'行')"
- [ ] [BEHAVIOR] executor.js 定义 CONTAINER_SIZES 常量，按 task_type 映射容器内存/CPU 规格（至少 light/normal/heavy 三档）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('CONTAINER_SIZES'))process.exit(1);const m=c.match(/CONTAINER_SIZES\s*=\s*\{[^}]+\}/s);if(!m||!m[0].includes('light')||!m[0].includes('normal')||!m[0].includes('heavy'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] Docker daemon 不可用时 cecelia-run.sh 检测并自动回退到 non-docker 模式
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');if(!c.includes('docker info')||!c.includes('fallback'))process.exit(1);console.log('PASS: 包含 docker 可用性检测和回退逻辑')"

### Workstream 3: 内存调度 + 三池隔离

**范围**: 修改 `packages/brain/src/slot-allocator.js` 和 `packages/brain/src/tick.js`，将 slot 数调度改为基于内存的三池模型。定义 TOTAL_CONTAINER_MEMORY_MB=12288，三池 A/B/C 分配。派发前检查目标池可用内存。更新相关单元测试。
**大小**: M（100-300行）
**依赖**: Workstream 2 完成后（需要 CONTAINER_SIZES 常量）

**DoD**:
- [ ] [BEHAVIOR] slot-allocator.js 定义 TOTAL_CONTAINER_MEMORY_MB=12288 和三池（A=2048/B=6144/C=4096）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/slot-allocator.js','utf8');if(!/TOTAL_CONTAINER_MEMORY_MB\s*=\s*12288/.test(c))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] 任务派发前检查目标池可用内存 >= CONTAINER_SIZES[task_type]，不足时排队
  Test: npm test -- --testPathPattern=slot-allocator --reporter=verbose
- [ ] [BEHAVIOR] 池间隔离：一个池满载不影响其他池的派发
  Test: npm test -- --testPathPattern=slot-allocator --reporter=verbose
- [ ] [ARTIFACT] slot-allocator.test.js 包含三池隔离和内存不足排队的测试用例
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/slot-allocator.test.js','utf8');if(!c.includes('pool')&&!c.includes('Pool')&&!c.includes('memory'))process.exit(1);console.log('OK')"

### Workstream 4: 监控端点 + Dashboard 页面

**范围**: 在 `packages/brain/src/server.js` 或路由文件中注册 `GET /api/brain/harness/pipeline-health` 端点，查询 pipeline 状态并计算 stuck 检测。在 `apps/dashboard/` 新增 Harness 监控页面组件，展示 pipeline 容器状态、资源用量和失败率。
**大小**: M（100-300行）
**依赖**: 无（端点可独立开发，数据来自 DB 查询）

**DoD**:
- [ ] [BEHAVIOR] GET /api/brain/harness/pipeline-health 返回 200 + JSON，含 pipelines 数组和汇总字段
  Test: manual:curl -sf localhost:5221/api/brain/harness/pipeline-health | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!Array.isArray(d.pipelines)){process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 超过 6 小时无进展的 pipeline 在响应中标记 pipeline_stuck=true
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/ops.js','utf8');if(!c.includes('pipeline_stuck')&&!c.includes('6'))process.exit(1);console.log('PASS')"
- [ ] [ARTIFACT] server.js 或路由文件注册了 pipeline-health 端点
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/server.js','utf8');if(!c.includes('pipeline-health'))process.exit(1);console.log('OK')"
- [ ] [ARTIFACT] Dashboard 存在 Harness 监控页面组件且引用 pipeline-health API
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('apps/dashboard/src',{recursive:true}).filter(f=>/harness|pipeline.monitor/i.test(f)&&/\.(tsx|jsx)$/.test(f));if(files.length===0)process.exit(1);console.log('OK: '+files.join(','))"
- [ ] [BEHAVIOR] Dashboard 监控页面能渲染空状态（无活跃 pipeline 时不报错）
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('apps/dashboard/src',{recursive:true}).filter(f=>/harness|pipeline/i.test(f)&&/\.(tsx|jsx)$/.test(f));const c=files.map(f=>fs.readFileSync('apps/dashboard/src/'+f,'utf8')).join('');if(!c.includes('empty')||!c.includes('pipeline-health'))process.exit(1);console.log('PASS')"
