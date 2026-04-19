# Sprint Contract Draft (Round 4)

> Task: 57ab38ad-dee3-43f4-80bc-8e5571ac4715 — 新增 `GET /api/brain/ping` 冒烟端点（验证 Generator Docker PR 产出链路）
>
> Round 4 变更：仅修复 Round 3 Reviewer 指出的 4 条 CI 白名单违规（DoD-1/2/4/5 去除 `grep`/`echo`/`cut`），并顺手清洁 Feature 1/3 的人类可读示例命令。硬阈值、Feature 设计、workstream_count 均未改动。

---

## Feature 1: `GET /api/brain/ping` 返回合法 JSON 响应

**行为描述**:
向本地 Brain 服务的 `/api/brain/ping` 发送 GET 请求（无认证、无参数），服务返回 HTTP 200，`Content-Type` 为 `application/json`，响应 body 是一个 JSON 对象，至少包含 `pong`（布尔真值）和 `timestamp`（字符串）两个字段。

**硬阈值**:
- HTTP 状态码必须是 `200`
- 响应头 `Content-Type` 必须包含 `application/json`
- 响应 body 可被 `JSON.parse` 成功解析
- `pong` 字段存在且严格等于 `true`（boolean，非字符串 `"true"`）
- `timestamp` 字段存在且类型为 `string`，非空

**验证命令**:
```bash
# Happy path: status + headers + body 一次采集，由 node 做严格校验（CI 白名单：curl + node + bash）
curl -s -D /tmp/ping_headers.txt -o /tmp/ping_body.json -w "%{http_code}" "http://localhost:5221/api/brain/ping" > /tmp/ping_status.txt
node -e "
  const fs = require('fs');
  const status = fs.readFileSync('/tmp/ping_status.txt','utf8').trim();
  if (status !== '200') { console.log('FAIL: status=' + status); process.exit(1); }
  const headers = fs.readFileSync('/tmp/ping_headers.txt','utf8');
  if (!/^content-type:\s*[^\r\n]*application\/json/im.test(headers)) { console.log('FAIL: content-type not application/json\n' + headers); process.exit(1); }
  const body = JSON.parse(fs.readFileSync('/tmp/ping_body.json','utf8'));
  if (body.pong !== true) { console.log('FAIL: pong!==true got ' + JSON.stringify(body.pong)); process.exit(1); }
  if (typeof body.timestamp !== 'string' || !body.timestamp) { console.log('FAIL: timestamp missing or not string'); process.exit(1); }
  console.log('PASS: status=200 json pong=true ts=' + body.timestamp);
"
```

---

## Feature 2: `timestamp` 字段是合法 ISO-8601 UTC 时间且反映当前时刻

**行为描述**:
每次调用 `/api/brain/ping` 返回的 `timestamp` 字段是一个合法的 ISO-8601 格式字符串（由 `new Date().toISOString()` 产生的形状，以 `Z` 结尾），可被 `Date.parse()` 成功解析，且解析后的时间与客户端当前系统时间相差不超过 ±60 秒。

**硬阈值**:
- `timestamp` 可被 `Date.parse()` 解析为有效数字（非 `NaN`）
- `timestamp` 符合 ISO-8601 正则：`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$`
- `|Date.parse(timestamp) - Date.now()| ≤ 60_000` 毫秒
- 间隔 ≥ 1.1 秒的两次调用返回的 `timestamp` **不相等**（证明非硬编码）

**验证命令**:
```bash
# 时间戳格式 + 范围 + 两次调用差异三合一
T1=$(curl -sf "http://localhost:5221/api/brain/ping" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).timestamp || '')")
sleep 1.2
T2=$(curl -sf "http://localhost:5221/api/brain/ping" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).timestamp || '')")
[ -n "$T1" ] && [ -n "$T2" ] || { node -e "console.log('FAIL: timestamp empty T1=$T1 T2=$T2'); process.exit(1)"; }
node -e "
  const t1='$T1', t2='$T2';
  const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\$/;
  if (!iso.test(t1) || !iso.test(t2)) throw new Error('FAIL: 非 ISO-8601 UTC 格式 t1='+t1+' t2='+t2);
  const p1=Date.parse(t1), p2=Date.parse(t2);
  if (isNaN(p1) || isNaN(p2)) throw new Error('FAIL: Date.parse 失败');
  if (Math.abs(p1 - Date.now()) > 60000) throw new Error('FAIL: timestamp 偏离系统时间超过 60 秒');
  if (t1 === t2) throw new Error('FAIL: 两次调用 timestamp 相同，疑似硬编码');
  if (p2 <= p1) throw new Error('FAIL: 第二次 timestamp 不晚于第一次，p1='+p1+' p2='+p2);
  console.log('PASS: ISO-8601 合法，时间差 ' + (p2-p1) + 'ms，系统时间偏差在 60s 内');
"
```

---

## Feature 3: 改动范围最小化（仅 `routes/brain.js`，净增 ≤ 10 行，零新依赖）

**行为描述**:
本次 PR 的 diff 只修改 `packages/brain/src/routes/brain.js` 一个文件，净增行数不超过 10 行；`package.json`、`package-lock.json`、`packages/brain/src/app.js` 等均不被修改；不新增任何 `require`/`import` 语句（除非 `brain.js` 中已存在的复用）。

**硬阈值**:
- `git diff --name-only main...HEAD` 输出**只有** `packages/brain/src/routes/brain.js` 一行
- `git diff --numstat main...HEAD` 中该文件的"净增行"（`added - deleted`）≤ 10
- 新增代码不引入 `brain.js` 中尚未 require/import 的模块

**验证命令**:
```bash
# 只改一个文件 + 净增 ≤10 + 无新 require/import 三合一，全部由 node 做严格判断（CI 白名单：bash + node）
node -e "
  const { execSync } = require('child_process');
  const files = execSync('git diff --name-only main...HEAD', { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const expected = 'packages/brain/src/routes/brain.js';
  if (files.length !== 1 || files[0] !== expected) { console.log('FAIL: 预期仅 ' + expected + '，实际 ' + JSON.stringify(files)); process.exit(1); }
  const numstat = execSync('git diff --numstat main...HEAD ' + expected, { encoding: 'utf8' }).trim();
  const [added, deleted] = numstat.split(/\s+/).map(Number);
  const net = added - deleted;
  if (net > 10) { console.log('FAIL: 净增 ' + net + ' 行 > 10（added=' + added + ' deleted=' + deleted + '）'); process.exit(1); }
  const diff = execSync('git diff main...HEAD ' + expected, { encoding: 'utf8' });
  const addedLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const bad = addedLines.filter(l => /\brequire\s*\(/.test(l) || /^\+\s*import\s+/.test(l));
  if (bad.length) { console.log('FAIL: 新增 require/import 行:\n' + bad.join('\n')); process.exit(1); }
  console.log('PASS: 仅改 routes/brain.js，净增 ' + net + ' 行，无新 require/import');
"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: 新增 `/ping` handler 至 `packages/brain/src/routes/brain.js`

**范围**:
在 `packages/brain/src/routes/brain.js` 中新增一个 `router.get('/ping', handler)` 路由。handler 同步返回 `res.json({ pong: true, timestamp: new Date().toISOString() })`，不读取数据库、不调外部服务、不读环境变量、不挂 auth 中间件、不新增 require/import。不修改 `app.js`、`package.json`、测试文件或任何其他文件。

**大小**: S（≤ 10 行净增）

**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `packages/brain/src/routes/brain.js` 中存在形如 `router.get('/ping'` 的路由注册行（剔除行注释后匹配）
  Test: node -e "const fs=require('fs'); const src=fs.readFileSync('packages/brain/src/routes/brain.js','utf8'); const stripped=src.replace(/^\s*\/\/.*\$/gm,'').replace(/\/\*[\s\S]*?\*\//g,''); if(!/router\.get\(\s*['\"]\\/ping['\"]/.test(stripped)){console.log('FAIL: 未找到有效 router.get(\'/ping\' 注册（已剔除行/块注释）');process.exit(1);} console.log('PASS');"
- [ ] [ARTIFACT] handler 体中包含 `pong: true` 与 `new Date().toISOString()` 两个关键片段（剔除注释后匹配）
  Test: node -e "const fs=require('fs'); const src=fs.readFileSync('packages/brain/src/routes/brain.js','utf8'); const stripped=src.replace(/^\s*\/\/.*\$/gm,'').replace(/\/\*[\s\S]*?\*\//g,''); if(!/pong\s*:\s*true/.test(stripped)){console.log('FAIL: 非注释代码中未找到 pong: true');process.exit(1);} if(!/new\s+Date\s*\(\s*\)\s*\.toISOString\s*\(\s*\)/.test(stripped)){console.log('FAIL: 非注释代码中未找到 new Date().toISOString()');process.exit(1);} console.log('PASS');"
- [ ] [ARTIFACT] diff 仅涉及 `packages/brain/src/routes/brain.js`，净增 ≤ 10 行
  Test: node -e "const {execSync}=require('child_process'); const files=execSync('git diff --name-only main...HEAD',{encoding:'utf8'}).trim().split('\n').filter(Boolean); if(files.length!==1||files[0]!=='packages/brain/src/routes/brain.js'){console.log('FAIL: 改动文件='+JSON.stringify(files));process.exit(1);} const [a,d]=execSync('git diff --numstat main...HEAD packages/brain/src/routes/brain.js',{encoding:'utf8'}).trim().split(/\s+/).map(Number); const net=a-d; if(net>10){console.log('FAIL: 净增 '+net+' > 10');process.exit(1);} console.log('PASS net='+net);"
- [ ] [ARTIFACT] 未新增 require/import 语句
  Test: node -e "const {execSync}=require('child_process'); const diff=execSync('git diff main...HEAD packages/brain/src/routes/brain.js',{encoding:'utf8'}); const added=diff.split('\n').filter(l=>l.startsWith('+')&&!l.startsWith('+++')); const bad=added.filter(l=>/\brequire\s*\(/.test(l)||/^\+\s*import\s+/.test(l)); if(bad.length){console.log('FAIL: 新增 require/import 行:\n'+bad.join('\n'));process.exit(1);} console.log('PASS: no new require/import, added='+added.length);"
- [ ] [BEHAVIOR] `GET /api/brain/ping` 返回 HTTP 200，Content-Type 为 application/json，body 含 `pong===true` 且 `timestamp` 为非空字符串
  Test: curl -s -D /tmp/ping_headers.txt -o /tmp/ping_body.json -w "%{http_code}" "http://localhost:5221/api/brain/ping" > /tmp/ping_status.txt; node -e "const fs=require('fs'); const status=fs.readFileSync('/tmp/ping_status.txt','utf8').trim(); if(status!=='200'){console.log('FAIL: status='+status);process.exit(1);} const headers=fs.readFileSync('/tmp/ping_headers.txt','utf8'); if(!/^content-type:\s*[^\r\n]*application\/json/im.test(headers)){console.log('FAIL: content-type not application/json\n'+headers);process.exit(1);} const body=JSON.parse(fs.readFileSync('/tmp/ping_body.json','utf8')); if(body.pong!==true){console.log('FAIL: pong!==true got '+JSON.stringify(body.pong));process.exit(1);} if(typeof body.timestamp!=='string'||!body.timestamp){console.log('FAIL: timestamp missing or not string');process.exit(1);} console.log('PASS: status=200 json pong=true ts='+body.timestamp);"
- [ ] [BEHAVIOR] `timestamp` 是合法 ISO-8601 UTC（以 Z 结尾），可 `Date.parse`，与系统时间偏差 ≤ 60 秒，且间隔 1.2s 的两次调用 timestamp 不同且单调递增
  Test: T1=$(curl -sf "http://localhost:5221/api/brain/ping" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).timestamp||'')"); sleep 1.2; T2=$(curl -sf "http://localhost:5221/api/brain/ping" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).timestamp||'')"); node -e "const t1='$T1',t2='$T2'; if(!t1||!t2){console.log('FAIL empty ts T1='+t1+' T2='+t2);process.exit(1);} const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\$/; if(!iso.test(t1)||!iso.test(t2))throw new Error('bad ISO'); const p1=Date.parse(t1),p2=Date.parse(t2); if(isNaN(p1)||isNaN(p2))throw new Error('NaN'); if(Math.abs(p1-Date.now())>60000)throw new Error('off by >60s'); if(t1===t2)throw new Error('same ts'); if(p2<=p1)throw new Error('not monotonic'); console.log('PASS diff='+(p2-p1)+'ms');"
- [ ] [BEHAVIOR] 端点不依赖 auth：未携带 Authorization/Cookie 头时仍返回 200（而非 401/403）
  Test: STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization:" -H "Cookie:" "http://localhost:5221/api/brain/ping"); node -e "if('$STATUS'!=='200'){console.log('FAIL noauth=$STATUS');process.exit(1);} console.log('PASS noauth=$STATUS');"
- [ ] [BEHAVIOR] 端点对 query string / body 不敏感：`/api/brain/ping?x=1` 与裸路径行为一致（仍 200 + pong:true）
  Test: STATUS=$(curl -s -o /tmp/q.json -w "%{http_code}" "http://localhost:5221/api/brain/ping?x=1&y=foo"); node -e "if('$STATUS'!=='200'){console.log('FAIL query status=$STATUS');process.exit(1);} const b=JSON.parse(require('fs').readFileSync('/tmp/q.json','utf8')); if(b.pong!==true)throw new Error('pong!=true under query'); console.log('PASS');"
