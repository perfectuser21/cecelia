# Sprint Contract Draft (Round 5)

> **修订说明**: 基于 R4 REVISION 反馈修复：
> 1. **[必改] F3-C3 递增间隔验证升级**：从"仅检测 [N,N,N] 格式存在"升级为"解析三个数值并验证 a < b < c 严格递增"，堵住 `[5000,5000,5000]` 等间隔绕过
> 2. **[可选采纳] F1-C1 注释剥离**：路由检查追加块注释/行注释过滤，防止注释中的 `'/harness'` 假阳性
> 3. **[可选采纳] F1-C3 API URL 验证**：追加 URL 须含 `brain|harness|sprint` 的正则，防止 `useSWR('/unrelated')` 绕过
> 4. **[可选采纳] F3-C1 死代码防护**：追加 try/catch 或 error handler 中引用 retry 逻辑的检查，防止常量声明但未调用
> 5. **WS3 DoD Test 同步更新**：F3-C3 对应的 DoD Test 字段同步升级为严格递增验证

---

## Feature 1: Dashboard Harness Pipeline 面板

**行为描述**:
Dashboard 侧边栏出现 Harness 入口，点击后进入 `/harness` 路由。页面从 Brain API (`/api/brain/...`) 拉取 sprint / harness pipeline 数据，以列表或表格形式展示每条记录的标题、状态（status）、当前阶段（phase/stage）、GAN 轮次（round）。页面为只读，不提供创建/编辑操作。

实现方式遵循仓库现有 feature-manifest 架构：在 `apps/api/features/` 下注册 feature manifest（含 `routes` + `components` + `navGroups`），页面组件放在对应 feature 的 `pages/` 子目录下。

**硬阈值**:
- `apps/api/features/` 下某个 feature manifest 的 `routes` 数组包含 `path: '/harness'` 条目
- 对应的页面组件文件存在于 `apps/api/features/*/pages/` 下，大小 >50 字节
- 组件非注释代码包含 API 调用（fetch/axios/useSWR/useQuery），且 URL 关联 brain/harness/sprint
- 组件非注释代码包含列表/表格渲染（.map）
- 组件非注释代码渲染 status、phase/stage、round 字段

**验证命令**:
```bash
# F1-C1: feature manifest 中注册了 /harness 路由（注释剥离后检查）
node -e "
  const fs = require('fs');
  const path = require('path');
  const featDir = 'apps/api/features';
  let found = false;
  for (const d of fs.readdirSync(featDir, {withFileTypes:true})) {
    if (!d.isDirectory()) continue;
    for (const ext of ['index.ts', 'index.tsx', 'index.js']) {
      const idx = path.join(featDir, d.name, ext);
      if (!fs.existsSync(idx)) continue;
      let code = fs.readFileSync(idx, 'utf8');
      code = code.replace(/\/\*[\s\S]*?\*\//g, '');
      code = code.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
      if (code.includes(\"'/harness'\") || code.includes('\"/harness\"')) {
        found = true;
        console.log('PASS: feature ' + d.name + '/' + ext + ' 注册了 /harness 路由（注释已剥离）');
        break;
      }
    }
    if (found) break;
  }
  if (!found) { console.log('FAIL: apps/api/features/*/index.{ts,tsx,js} 非注释代码中未找到 /harness 路由'); process.exit(1); }
"

# F1-C2: harness 页面组件存在且 >50 字节（在 apps/api/features/*/pages/ 下）
node -e "
  const fs = require('fs');
  const path = require('path');
  const featDir = 'apps/api/features';
  let found = false;
  for (const d of fs.readdirSync(featDir, {withFileTypes:true})) {
    if (!d.isDirectory()) continue;
    const pagesDir = path.join(featDir, d.name, 'pages');
    if (!fs.existsSync(pagesDir)) continue;
    for (const f of fs.readdirSync(pagesDir)) {
      if (/harness/i.test(f) && /\.tsx?$/.test(f)) {
        const stat = fs.statSync(path.join(pagesDir, f));
        if (stat.size > 50) {
          found = true;
          console.log('PASS: ' + path.join(pagesDir, f) + ' (' + stat.size + ' bytes)');
          break;
        }
      }
    }
    if (found) break;
  }
  if (!found) { console.log('FAIL: apps/api/features/*/pages/ 下未找到 >50 字节的 harness 组件'); process.exit(1); }
"

# F1-C3: 组件包含 API 调用（URL 关联 brain/harness/sprint）+ 列表渲染 + status/phase/round 字段（注释剥离）
node -e "
  const fs = require('fs');
  const path = require('path');
  const featDir = 'apps/api/features';
  let allCode = '';
  for (const d of fs.readdirSync(featDir, {withFileTypes:true})) {
    if (!d.isDirectory()) continue;
    const pagesDir = path.join(featDir, d.name, 'pages');
    if (!fs.existsSync(pagesDir)) continue;
    for (const f of fs.readdirSync(pagesDir)) {
      if (/harness/i.test(f) && /\.tsx?$/.test(f)) {
        let code = fs.readFileSync(path.join(pagesDir, f), 'utf8');
        code = code.replace(/\/\*[\s\S]*?\*\//g, '');
        allCode += code.split('\n').filter(l => !l.trim().startsWith('//')).join('\n') + '\n';
      }
    }
  }
  if (!allCode.trim()) { console.log('FAIL: 未找到 harness 组件代码'); process.exit(1); }
  const checks = [
    [/(?:fetch|useSWR|useQuery|axios)\s*\(.*(?:brain|harness|sprint)/s, 'API 调用（URL 关联 brain/harness/sprint）'],
    [/\.map\s*\(/, '列表/表格渲染（.map）'],
    [/status/, 'status 字段'],
    [/phase|stage/, 'phase/stage 字段'],
    [/round|gan_round/, 'round/gan_round 字段'],
  ];
  const errors = [];
  for (const [re, label] of checks) {
    if (!re.test(allCode)) errors.push(label);
  }
  if (errors.length > 0) { console.log('FAIL: 非注释代码中缺少: ' + errors.join(', ')); process.exit(1); }
  console.log('PASS: 组件包含 API 调用（URL 关联 brain/harness/sprint）+ 列表渲染 + status/phase/round 字段');
"
```

---

## Feature 2: CI 白名单同步 — playwright 加入

**行为描述**:
`scripts/devgate/check-manual-cmd-whitelist.cjs` 的 `ALLOWED_COMMANDS` 集合包含 `'playwright'`，使得合同验证命令中 `playwright test ...`（作为独立顶层命令）不被 CI 白名单校验器拦截。`npx playwright` 已因 `npx` 在白名单而通过；此修复解决 `playwright` 作为独立命令的场景。

**硬阈值**:
- `ALLOWED_COMMANDS` 集合（非注释代码行）包含字符串 `'playwright'`
- 白名单脚本语法正确，`node` 可解析无报错

**验证命令**:
```bash
# F2-C1: ALLOWED_COMMANDS 非注释代码包含 playwright
node -e "
  const c = require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs', 'utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const code = lines.join('\n');
  if (!code.includes(\"'playwright'\") && !code.includes('\"playwright\"')) {
    console.log('FAIL: ALLOWED_COMMANDS 非注释代码中未找到 playwright');
    process.exit(1);
  }
  console.log('PASS: ALLOWED_COMMANDS 包含 playwright');
"

# F2-C2: 白名单脚本语法正确
node -e "
  try {
    const c = require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs', 'utf8');
    new Function(c);
    console.log('PASS: 白名单脚本语法正确');
  } catch(e) {
    console.log('FAIL: 语法错误 — ' + e.message);
    process.exit(1);
  }
"
```

---

## Feature 3: harness_report 失败重试

**行为描述**:
当 harness_report 任务执行失败（skill 返回错误或 agent 超时）时，系统自动重新创建 harness_report 任务，最多重试 3 次。每次重试间隔递增（如 5s → 15s → 30s）。3 次均失败后，将最终 verdict 标记为 `REPORT_FAILED` 并停止重试。重试逻辑位于 Brain 代码中（executor.js / harness-watcher.js / routes/execution.js 之一）。

**硬阈值**:
- Brain `packages/brain/src/` 下存在 harness_report 专属重试逻辑，与通用 watchdog retry 分离
- 重试逻辑实际被 try/catch 或 error handler 调用（非死代码）
- 最大重试次数硬编码为 3
- 重试间隔为严格递增序列（数组字面量 `[a, b, c]` 中 `a < b < c`，或乘法递增 `delay *= N`）
- 3 次失败后输出 `REPORT_FAILED` verdict（而非通用 quarantine）

**验证命令**:
```bash
# F3-C1: Brain 非注释代码包含 harness_report 重试逻辑 + REPORT_FAILED + 被 try/catch 或 error handler 引用
node -e "
  const fs = require('fs');
  const path = require('path');
  const walk = (dir) => {
    const r = [];
    for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '__tests__') walk(full).forEach(f => r.push(f));
      else if (e.name.endsWith('.js')) r.push(full);
    }
    return r;
  };
  let found = false;
  for (const f of walk('packages/brain/src')) {
    const c = fs.readFileSync(f, 'utf8');
    const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const code = lines.join('\n');
    if (code.includes('harness_report') && /max.?retries|MAX.?RETRIES|retry.?count|report.?retry/i.test(code) && code.includes('REPORT_FAILED')) {
      // 死代码防护：retry 逻辑必须在 try/catch 或 error handler 中被引用
      if (/try\s*\{[\s\S]*?(?:retry|REPORT_FAILED)[\s\S]*?\}\s*catch/s.test(code) || /(?:catch|error|err|on(?:Error|Failure|Failed))\s*[\(\{][\s\S]*?(?:retry|REPORT_FAILED)/s.test(code) || /(?:retry|retryCount|report_retry)[\s\S]{0,200}catch/s.test(code)) {
        found = true;
        console.log('PASS: 找到 harness_report 重试逻辑 + REPORT_FAILED + error handler 引用 in ' + f);
        break;
      }
    }
  }
  if (!found) { console.log('FAIL: Brain 非注释代码中未找到 harness_report 专属重试（含 error handler 引用）+ REPORT_FAILED'); process.exit(1); }
"

# F3-C2: max_retries 值为 3
node -e "
  const fs = require('fs');
  const path = require('path');
  const walk = (dir) => {
    const r = [];
    for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '__tests__') walk(full).forEach(f => r.push(f));
      else if (e.name.endsWith('.js')) r.push(full);
    }
    return r;
  };
  let found = false;
  for (const f of walk('packages/brain/src')) {
    const c = fs.readFileSync(f, 'utf8');
    const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const code = lines.join('\n');
    if (/max.?retries\s*[:=]\s*3/i.test(code) && code.includes('REPORT_FAILED')) {
      found = true;
      console.log('PASS: max_retries=3 已确认 in ' + f);
      break;
    }
  }
  if (!found) { console.log('FAIL: 未找到 max_retries=3 + REPORT_FAILED'); process.exit(1); }
"

# F3-C3: 递增间隔——解析数组三个数值验证严格递增 a < b < c（或乘法递增模式）
node -e "
  const fs = require('fs');
  const path = require('path');
  const walk = (dir) => {
    const r = [];
    for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '__tests__') walk(full).forEach(f => r.push(f));
      else if (e.name.endsWith('.js')) r.push(full);
    }
    return r;
  };
  for (const f of walk('packages/brain/src')) {
    const c = fs.readFileSync(f, 'utf8');
    const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const code = lines.join('\n');
    const m = code.match(/\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/);
    if (m && /retry|REPORT_FAILED/i.test(code)) {
      const [a, b, c2] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (a < b && b < c2) {
        console.log('PASS: 严格递增间隔 [' + a + ',' + b + ',' + c2 + '] in ' + f);
        process.exit(0);
      }
    }
    if (/delay\s*\*=?\s*\d/.test(code) && /retry|REPORT_FAILED/i.test(code)) {
      console.log('PASS: 找到递增间隔乘法模式 in ' + f);
      process.exit(0);
    }
  }
  console.log('FAIL: 未找到严格递增间隔模式（数组需 a<b<c，或 delay*=N 乘法递增）');
  process.exit(1);
"

# F3-C4: 3 次失败后 REPORT_FAILED verdict 输出（边界路径验证）
node -e "
  const fs = require('fs');
  const path = require('path');
  const walk = (dir) => {
    const r = [];
    for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '__tests__') walk(full).forEach(f => r.push(f));
      else if (e.name.endsWith('.js')) r.push(full);
    }
    return r;
  };
  let found = false;
  for (const f of walk('packages/brain/src')) {
    const c = fs.readFileSync(f, 'utf8');
    const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const code = lines.join('\n');
    if (code.includes('REPORT_FAILED') && /max.?retries|>=\s*3|>\s*2|===?\s*3/i.test(code) && /verdict|status/i.test(code)) {
      found = true;
      console.log('PASS: REPORT_FAILED verdict 与 max_retries 边界判断共存 in ' + f);
      break;
    }
  }
  if (!found) { console.log('FAIL: 未找到 REPORT_FAILED verdict 输出与 max_retries 边界判断共存'); process.exit(1); }
"
```

---

## Workstreams

workstream_count: 3

### Workstream 1: CI 白名单 — playwright 加入

**范围**: `scripts/devgate/check-manual-cmd-whitelist.cjs` 的 ALLOWED_COMMANDS 集合新增 `'playwright'`
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `scripts/devgate/check-manual-cmd-whitelist.cjs` 中 ALLOWED_COMMANDS 非注释代码包含 `'playwright'`
  Test: node -e "const c=require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs','utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*'));const code=lines.join('\n');if(!code.includes(\"'playwright'\")&&!code.includes('\"playwright\"')){console.log('FAIL');process.exit(1)}console.log('PASS: ALLOWED_COMMANDS 包含 playwright')"
- [ ] [BEHAVIOR] 白名单脚本语法正确可解析
  Test: node -e "try{const c=require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs','utf8');new Function(c);console.log('PASS')}catch(e){console.log('FAIL: '+e.message);process.exit(1)}"

### Workstream 2: Dashboard Harness 面板

**范围**: `apps/api/features/` 下注册 harness feature manifest（routes + components + navGroups），页面组件在对应 `pages/` 子目录，展示 sprint 列表（status/phase/round）
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `apps/api/features/*/index.{ts,tsx,js}` 中某个 manifest 非注释代码注册了 `/harness` 路由
  Test: node -e "const fs=require('fs');const path=require('path');const d='apps/api/features';let found=false;for(const e of fs.readdirSync(d,{withFileTypes:true})){if(!e.isDirectory())continue;for(const ext of['index.ts','index.tsx','index.js']){const f=path.join(d,e.name,ext);if(!fs.existsSync(f))continue;let code=fs.readFileSync(f,'utf8');code=code.replace(/\/\*[\s\S]*?\*\//g,'');code=code.split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');if(code.includes(\"'/harness'\")||code.includes('\"/harness\"')){found=true;console.log('PASS: '+e.name+'/'+ext);break}}if(found)break}if(!found){console.log('FAIL');process.exit(1)}"
- [ ] [ARTIFACT] `apps/api/features/*/pages/` 下存在 harness 组件文件（>50 字节）
  Test: node -e "const fs=require('fs');const path=require('path');const d='apps/api/features';let found=false;for(const e of fs.readdirSync(d,{withFileTypes:true})){if(!e.isDirectory())continue;const p=path.join(d,e.name,'pages');if(!fs.existsSync(p))continue;for(const f of fs.readdirSync(p)){if(/harness/i.test(f)&&/\.tsx?$/.test(f)&&fs.statSync(path.join(p,f)).size>50){found=true;console.log('PASS: '+path.join(p,f));break}}if(found)break}if(!found){console.log('FAIL');process.exit(1)}"
- [ ] [BEHAVIOR] 组件非注释代码包含 API 调用（URL 关联 brain/harness/sprint）+ 列表渲染 + status/phase/round 字段
  Test: node -e "const fs=require('fs');const path=require('path');const d='apps/api/features';let allCode='';for(const e of fs.readdirSync(d,{withFileTypes:true})){if(!e.isDirectory())continue;const p=path.join(d,e.name,'pages');if(!fs.existsSync(p))continue;for(const f of fs.readdirSync(p)){if(/harness/i.test(f)&&/\.tsx?$/.test(f)){let code=fs.readFileSync(path.join(p,f),'utf8');code=code.replace(/\/\*[\s\S]*?\*\//g,'');allCode+=code.split('\n').filter(l=>!l.trim().startsWith('//')).join('\n')+'\n'}}}if(!allCode.trim()){console.log('FAIL: no harness component');process.exit(1)}const checks=[[/(?:fetch|useSWR|useQuery|axios)\s*\(.*(?:brain|harness|sprint)/s,'API调用(URL关联brain/harness/sprint)'],[/\.map\s*\(/,'.map渲染'],[/status/,'status'],[/phase|stage/,'phase/stage'],[/round|gan_round/,'round']];for(const[re,label]of checks){if(!re.test(allCode)){console.log('FAIL: 缺少 '+label);process.exit(1)}}console.log('PASS')"

### Workstream 3: harness_report 失败重试

**范围**: `packages/brain/src/` 中（executor.js / harness-watcher.js / routes/execution.js 之一）增加 harness_report 专属重试逻辑（max_retries=3、严格递增间隔、REPORT_FAILED verdict）
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] Brain 非注释代码包含 harness_report 重试逻辑 + REPORT_FAILED + error handler 引用（非死代码）
  Test: node -e "const fs=require('fs');const path=require('path');const walk=(dir)=>{const r=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isDirectory()&&e.name!=='node_modules'&&e.name!=='__tests__')walk(full).forEach(f=>r.push(f));else if(e.name.endsWith('.js'))r.push(full)}return r};let found=false;for(const f of walk('packages/brain/src')){const c=fs.readFileSync(f,'utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*'));const code=lines.join('\n');if(code.includes('harness_report')&&/max.?retries|MAX.?RETRIES|retry.?count|report.?retry/i.test(code)&&code.includes('REPORT_FAILED')){if(/try\s*\{[\s\S]*?(?:retry|REPORT_FAILED)[\s\S]*?\}\s*catch/s.test(code)||/(?:catch|error|err|on(?:Error|Failure|Failed))\s*[\(\{][\s\S]*?(?:retry|REPORT_FAILED)/s.test(code)||/(?:retry|retryCount|report_retry)[\s\S]{0,200}catch/s.test(code)){found=true;break}}}if(!found){console.log('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] max_retries 赋值为 3
  Test: node -e "const fs=require('fs');const path=require('path');const walk=(dir)=>{const r=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isDirectory()&&e.name!=='node_modules'&&e.name!=='__tests__')walk(full).forEach(f=>r.push(f));else if(e.name.endsWith('.js'))r.push(full)}return r};let found=false;for(const f of walk('packages/brain/src')){const c=fs.readFileSync(f,'utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*'));const code=lines.join('\n');if(/max.?retries\s*[:=]\s*3/i.test(code)&&code.includes('REPORT_FAILED')){found=true;break}}if(!found){console.log('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 重试间隔为严格递增序列（数组 a<b<c 或乘法递增 delay*=N）
  Test: node -e "const fs=require('fs');const path=require('path');const walk=(dir)=>{const r=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isDirectory()&&e.name!=='node_modules'&&e.name!=='__tests__')walk(full).forEach(f=>r.push(f));else if(e.name.endsWith('.js'))r.push(full)}return r};for(const f of walk('packages/brain/src')){const c=fs.readFileSync(f,'utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*'));const code=lines.join('\n');const m=code.match(/\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/);if(m&&/retry|REPORT_FAILED/i.test(code)){const[a,b,c2]=[Number(m[1]),Number(m[2]),Number(m[3])];if(a<b&&b<c2){console.log('PASS: 严格递增['+a+','+b+','+c2+']');process.exit(0)}}if(/delay\s*\*=?\s*\d/.test(code)&&/retry|REPORT_FAILED/i.test(code)){console.log('PASS: 乘法递增');process.exit(0)}}console.log('FAIL');process.exit(1)"
