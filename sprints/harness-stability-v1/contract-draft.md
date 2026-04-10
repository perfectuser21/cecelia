# Sprint Contract Draft (Round 2)

> **修订说明**: 基于 Round 1 Reviewer 反馈修复全部 8 个必须修改项 + 2 个可选改进。
> 核心改进：所有验证命令过滤注释行后再检查、文件存在性要求 .tsx 且 >50 字节、路由验证用 Node API 替代 find。

---

## Feature 1: Dashboard Harness Pipeline 面板

**行为描述**:
用户在 Dashboard 导航栏中看到"Harness"入口，点击后进入 `/harness` 路由页面。页面从 Brain API 拉取 sprint 列表数据，以列表形式渲染每条 sprint 记录。每条记录展示：标题、状态（status）、当前阶段（phase/stage）、GAN 轮次（round）、CI 状态。页面为只读，不提供创建/编辑/触发操作。

**硬阈值**:
- `/harness` 路由在 Dashboard 中注册且可访问
- 页面目录 `apps/dashboard/src/pages/harness/` 包含至少 1 个 >50 字节的 `.tsx` 组件文件
- 组件代码（排除注释行）包含 API 调用（fetch/axios/useSWR/useQuery）
- 组件代码（排除注释行）包含列表渲染（.map）
- 组件代码（排除注释行）渲染 status、phase/stage、round 字段

**验证命令**:
```bash
# F1-C1: harness 目录包含有效组件文件（修复 R1#5：空目录/gitkeep 不再通过）
node -e "
  const fs = require('fs');
  const dir = 'apps/dashboard/src/pages/harness';
  if (!fs.existsSync(dir)) throw new Error('FAIL: harness 目录不存在');
  const tsxFiles = fs.readdirSync(dir).filter(f => /\.(tsx?|jsx?)$/.test(f));
  if (tsxFiles.length === 0) throw new Error('FAIL: harness 目录无组件文件');
  for (const f of tsxFiles) {
    const stat = fs.statSync(require('path').join(dir, f));
    if (stat.size > 50) { console.log('PASS: ' + f + ' (' + stat.size + ' bytes)'); process.exit(0); }
  }
  throw new Error('FAIL: 所有组件文件均小于 50 字节');
"

# F1-C2: 组件包含真实 API 调用 + 列表渲染 + 阶段/轮次字段（修复 R1#3,#7：过滤注释 + 补充 phase/round 验证）
node -e "
  const fs = require('fs');
  const path = require('path');
  const dir = 'apps/dashboard/src/pages/harness';
  const tsxFiles = fs.readdirSync(dir).filter(f => /\.tsx$/.test(f));
  let allCode = '';
  for (const f of tsxFiles) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    allCode += lines.join('\n') + '\n';
  }
  const checks = [
    [/fetch|axios|useSWR|useQuery/, 'API 调用（fetch/axios/useSWR/useQuery）'],
    [/\.map\s*\(/, '列表渲染（.map）'],
    [/status/, 'status 字段'],
    [/phase|stage/, 'phase/stage 字段'],
    [/round|gan_round/, 'round/gan_round 字段'],
  ];
  for (const [re, label] of checks) {
    if (!re.test(allCode)) { console.log('FAIL: 非注释代码中未找到 ' + label); process.exit(1); }
  }
  console.log('PASS: 组件包含 API 调用 + 列表渲染 + status/phase/round 字段');
"

# F1-C3: /harness 路由已注册（修复 R1#6：用 Node API 替代 find，过滤注释行）
node -e "
  const fs = require('fs');
  const path = require('path');
  const candidates = ['apps/dashboard/src/App.tsx', 'apps/dashboard/src/routes.tsx', 'apps/dashboard/src/router.tsx'];
  let found = false;
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(l => !l.trim().startsWith('//'));
    if (lines.join('\n').includes('/harness')) { found = true; console.log('PASS: ' + f + ' 注册了 /harness 路由'); break; }
  }
  if (!found) {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
        if (e.isDirectory() && e.name !== 'node_modules') walk(path.join(dir, e.name));
        else if (/\.tsx?$/.test(e.name)) {
          const lines = fs.readFileSync(path.join(dir, e.name), 'utf8').split('\n').filter(l => !l.trim().startsWith('//'));
          const code = lines.join('\n');
          if (code.includes('/harness') && (code.includes('path') || code.includes('Route') || code.includes('route'))) { found = true; return; }
        }
      }
    };
    walk('apps/dashboard/src');
  }
  if (!found) { console.log('FAIL: 未找到非注释代码中的 /harness 路由注册'); process.exit(1); }
  if (found) console.log('PASS: /harness 路由已注册');
"
```

---

## Feature 2: CI 白名单同步 — playwright 加入

**行为描述**:
当 Proposer 在合同验证命令中使用 `npx playwright test ...` 时，CI 白名单校验器 `check-manual-cmd-whitelist.cjs` 不再将其标记为非法命令。`playwright` 作为独立命令被加入 ALLOWED_COMMANDS 集合。

**硬阈值**:
- `check-manual-cmd-whitelist.cjs` 的 ALLOWED_COMMANDS 集合包含字符串 `'playwright'`
- 白名单仅做第一个词的校验（`npx playwright` 中 `npx` 已在白名单，`playwright` 作为独立命令时也需通过）

**验证命令**:
```bash
# F2-C1: ALLOWED_COMMANDS 包含 playwright（修复 R1#1：读文件内容而非 require CLI 脚本）
node -e "
  const c = require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs', 'utf8');
  if (!c.includes(\"'playwright'\") && !c.includes('\"playwright\"')) {
    console.log('FAIL: ALLOWED_COMMANDS 中未找到 playwright');
    process.exit(1);
  }
  console.log('PASS: ALLOWED_COMMANDS 包含 playwright');
"

# F2-C2: 白名单文件语法正确，node 可解析无报错
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
当 harness_report skill 执行失败时，系统自动重试最多 3 次。每次重试间隔递增（如 5s → 15s → 30s）。3 次均失败后，将 verdict 标记为 REPORT_FAILED 并保留已收集的部分数据。每次重试从头生成报告，不做增量恢复。

**硬阈值**:
- Brain 代码中存在 harness_report 重试逻辑，最大重试次数为 3
- 重试间隔为递增序列（数组或乘法递增）
- 3 次失败后输出 REPORT_FAILED verdict

**验证命令**:
```bash
# F3-C1: Brain 代码非注释行包含重试逻辑 + REPORT_FAILED（修复 R1#2：过滤注释行）
node -e "
  const fs = require('fs');
  const path = require('path');
  let found = false;
  for (const f of fs.readdirSync('packages/brain/src').filter(x => x.endsWith('.js'))) {
    const c = fs.readFileSync(path.join('packages/brain/src', f), 'utf8');
    const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const code = lines.join('\n');
    if (code.includes('harness_report') && /max.?retries|MAX.?RETRIES|retry.?count/i.test(code) && code.includes('REPORT_FAILED')) {
      found = true; break;
    }
  }
  if (!found) { console.log('FAIL: Brain 非注释代码中未找到 harness_report + 重试逻辑 + REPORT_FAILED'); process.exit(1); }
  console.log('PASS: 找到非注释的重试逻辑');
"

# F3-C2: max_retries 的值确实是 3（修复 R1#2：用正则匹配赋值模式而非纯 includes）
node -e "
  const fs = require('fs');
  const path = require('path');
  let found = false;
  for (const f of fs.readdirSync('packages/brain/src').filter(x => x.endsWith('.js'))) {
    const c = fs.readFileSync(path.join('packages/brain/src', f), 'utf8');
    const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const code = lines.join('\n');
    if (/max.?retries\s*[:=]\s*3/i.test(code) && code.includes('REPORT_FAILED')) {
      found = true; break;
    }
  }
  if (!found) { console.log('FAIL: 未找到非注释代码中 max_retries=3 + REPORT_FAILED 的赋值'); process.exit(1); }
  console.log('PASS: max_retries=3 已确认');
"

# F3-C3: 递增间隔模式存在（修复 R1#8：新增递增间隔验证）
node -e "
  const fs = require('fs');
  const path = require('path');
  for (const f of fs.readdirSync('packages/brain/src').filter(x => x.endsWith('.js'))) {
    const c = fs.readFileSync(path.join('packages/brain/src', f), 'utf8');
    const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const code = lines.join('\n');
    if (/\[\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\]/.test(code) && /retry|REPORT_FAILED/i.test(code)) {
      console.log('PASS: 找到递增间隔数组'); process.exit(0);
    }
    if (/delay\s*\*=?\s*\d/.test(code) && /retry|REPORT_FAILED/i.test(code)) {
      console.log('PASS: 找到递增间隔乘法模式'); process.exit(0);
    }
  }
  console.log('FAIL: 未找到递增间隔模式'); process.exit(1);
"
```

---

## Workstreams

workstream_count: 3

### Workstream 1: CI 白名单 — playwright 加入

**范围**: `scripts/devgate/check-manual-cmd-whitelist.cjs` 的 ALLOWED_COMMANDS 集合新增 `playwright`
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `scripts/devgate/check-manual-cmd-whitelist.cjs` 中 ALLOWED_COMMANDS 包含 `'playwright'`
  Test: node -e "const c=require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs','utf8');if(!c.includes(\"'playwright'\")&&!c.includes('\"playwright\"')){console.log('FAIL: ALLOWED_COMMANDS 中未找到 playwright');process.exit(1)}console.log('PASS: ALLOWED_COMMANDS 包含 playwright')"
- [ ] [BEHAVIOR] 白名单脚本语法正确可解析
  Test: node -e "try{const c=require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs','utf8');new Function(c);console.log('PASS: 语法正确')}catch(e){console.log('FAIL: '+e.message);process.exit(1)}"

### Workstream 2: Dashboard Harness 面板

**范围**: `apps/dashboard/src/pages/harness/` 新增页面组件 + 路由注册，展示 sprint 列表（status/phase/round）
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `apps/dashboard/src/pages/harness/` 目录包含至少 1 个 >50 字节的 `.tsx` 组件文件
  Test: node -e "const fs=require('fs');const dir='apps/dashboard/src/pages/harness';if(!fs.existsSync(dir))throw new Error('FAIL: 目录不存在');const tsxFiles=fs.readdirSync(dir).filter(f=>/\.(tsx?|jsx?)$/.test(f));if(tsxFiles.length===0)throw new Error('FAIL: 无组件文件');for(const f of tsxFiles){const stat=fs.statSync(require('path').join(dir,f));if(stat.size>50){console.log('PASS: '+f+' ('+stat.size+' bytes)');process.exit(0)}}throw new Error('FAIL: 所有文件均小于 50 字节')"
- [ ] [BEHAVIOR] 组件非注释代码包含 API 调用（fetch/axios/useSWR/useQuery）+ 列表渲染（.map）+ status/phase/round 字段
  Test: node -e "const fs=require('fs');const path=require('path');const dir='apps/dashboard/src/pages/harness';const tsxFiles=fs.readdirSync(dir).filter(f=>/\.tsx$/.test(f));let allCode='';for(const f of tsxFiles){const lines=fs.readFileSync(path.join(dir,f),'utf8').split('\n').filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*'));allCode+=lines.join('\n')+'\n'}const checks=[[/fetch|axios|useSWR|useQuery/,'API 调用'],[/\.map\s*\(/,'列表渲染(.map)'],[/status/,'status 字段'],[/phase|stage/,'phase/stage 字段'],[/round|gan_round/,'round 字段']];for(const[re,label]of checks){if(!re.test(allCode)){console.log('FAIL: 非注释代码中未找到 '+label);process.exit(1)}}console.log('PASS: 组件包含所有必需元素')"
- [ ] [BEHAVIOR] `/harness` 路由在 Dashboard 中注册（非注释代码，使用 Node API 扫描）
  Test: node -e "const fs=require('fs');const path=require('path');const candidates=['apps/dashboard/src/App.tsx','apps/dashboard/src/routes.tsx','apps/dashboard/src/router.tsx'];let found=false;for(const f of candidates){if(!fs.existsSync(f))continue;const lines=fs.readFileSync(f,'utf8').split('\n').filter(l=>!l.trim().startsWith('//'));if(lines.join('\n').includes('/harness')){found=true;console.log('PASS: '+f+' 注册了 /harness 路由');break}}if(!found){const walk=(dir)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isDirectory()&&e.name!=='node_modules')walk(path.join(dir,e.name));else if(/\.tsx?$/.test(e.name)){const lines=fs.readFileSync(path.join(dir,e.name),'utf8').split('\n').filter(l=>!l.trim().startsWith('//'));const code=lines.join('\n');if(code.includes('/harness')&&(code.includes('path')||code.includes('Route')||code.includes('route'))){found=true;return}}}};walk('apps/dashboard/src')}if(!found){console.log('FAIL: 未找到 /harness 路由注册');process.exit(1)}if(found)console.log('PASS: /harness 路由已注册')"

### Workstream 3: harness_report 失败重试

**范围**: `packages/brain/src/` 中增加 harness_report 重试逻辑（max_retries=3、递增间隔、REPORT_FAILED verdict）
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] Brain 非注释代码包含 harness_report 重试逻辑 + REPORT_FAILED
  Test: node -e "const fs=require('fs');const path=require('path');let found=false;for(const f of fs.readdirSync('packages/brain/src').filter(x=>x.endsWith('.js'))){const c=fs.readFileSync(path.join('packages/brain/src',f),'utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*'));const code=lines.join('\n');if(code.includes('harness_report')&&/max.?retries|MAX.?RETRIES|retry.?count/i.test(code)&&code.includes('REPORT_FAILED')){found=true;break}}if(!found){console.log('FAIL: Brain 非注释代码中未找到 harness_report+重试+REPORT_FAILED');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] max_retries 赋值为 3
  Test: node -e "const fs=require('fs');const path=require('path');let found=false;for(const f of fs.readdirSync('packages/brain/src').filter(x=>x.endsWith('.js'))){const c=fs.readFileSync(path.join('packages/brain/src',f),'utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*'));const code=lines.join('\n');if(/max.?retries\s*[:=]\s*3/i.test(code)&&code.includes('REPORT_FAILED')){found=true;break}}if(!found){console.log('FAIL: 未找到 max_retries=3');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 重试间隔为递增序列（数组或乘法递增模式）
  Test: node -e "const fs=require('fs');const path=require('path');for(const f of fs.readdirSync('packages/brain/src').filter(x=>x.endsWith('.js'))){const c=fs.readFileSync(path.join('packages/brain/src',f),'utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*'));const code=lines.join('\n');if(/\[\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\]/.test(code)&&/retry|REPORT_FAILED/i.test(code)){console.log('PASS: 递增间隔数组');process.exit(0)}if(/delay\s*\*=?\s*\d/.test(code)&&/retry|REPORT_FAILED/i.test(code)){console.log('PASS: 递增间隔乘法');process.exit(0)}}console.log('FAIL: 未找到递增间隔模式');process.exit(1)"
