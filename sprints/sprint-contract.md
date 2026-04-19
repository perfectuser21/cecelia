# Sprint Contract Draft (Round 2)

## 修订说明

对 Round 1 Reviewer 反馈的 4 个必须修复项全部处理：
- **DoD 5 扩展**：POST → POST/PUT/PATCH/DELETE 全覆盖，在单条 Test 内循环断言 405
- **新增 DoD 6**（独立 BEHAVIOR 条目）：路径大小写敏感（`/api/brain/Ping` 非 200）
- **DoD 7 改写**：`pytest --collect-only` 结果改用 `python3 subprocess` + 正则匹配 `test_\w*ping\w*\.py::test_\w+`，移除 `grep`
- **DoD 8 改写**：pytest 运行结果改用 `python3 subprocess` 读 `returncode` + 正则匹配 `(\d+) passed`，移除 `grep` 与 `tee`

可选改进项未强制纳入 DoD（保持范围最小），但在"硬阈值/验证命令"区块补充了 Content-Type 断言与 timestamp 新鲜度校验作为加固。

---

## Feature 1: GET /api/brain/ping 冒烟端点

**行为描述**:
后端服务启动后，客户端通过 HTTP GET 方法请求 `/api/brain/ping` 路径，服务端立即返回 HTTP 200 响应，响应 `Content-Type` 为 `application/json`，响应体为 JSON 对象，包含两个字段：`pong` 固定为布尔值 `true`，`timestamp` 为服务器当前时间的 ISO 8601 字符串。端点无需鉴权、无请求参数、无副作用；多次连续调用返回的 `timestamp` 必须不同（反映实时生成而非缓存常量），且解析后时间与当前 UTC 时间相差不超过 5 秒；其他 HTTP 方法（POST/PUT/DELETE/PATCH）访问该路径均返回 405 Method Not Allowed；路径大小写敏感（`/api/brain/Ping` 不匹配，返回非 200 状态码）。

**硬阈值**:
- HTTP 状态码严格等于 200
- 响应头 `Content-Type` 包含 `application/json`
- 响应体为合法 JSON，且顶层为对象
- 响应 JSON 中 `pong` 字段存在且严格等于布尔 `true`（不是字符串 `"true"`、不是 `1`）
- 响应 JSON 中 `timestamp` 字段存在且为字符串类型
- `timestamp` 值可被 Python `datetime.fromisoformat()`（兼容 `Z` 后缀）解析成功
- 解析后的 `timestamp` 与当前 UTC 时间差的绝对值小于 5 秒
- 间隔至少 10 毫秒的两次连续调用，两次响应的 `timestamp` 字段值不相等
- `POST` / `PUT` / `PATCH` / `DELETE` 方法请求 `/api/brain/ping` 均返回 405 状态码
- `GET /api/brain/Ping`（大写 P）返回非 200 状态码
- 伴随至少 1 个自动化测试文件（pytest 可发现，文件名或测试函数名匹配 `test_\w*ping\w*\.py::test_\w+`），pytest 运行时退出码为 0 且至少 1 个 passed

**验证命令**:
```bash
# 验证 1: Happy path — 状态码 200 + Content-Type + pong=true + timestamp 为字符串
python3 -c "
import subprocess, json, sys
r = subprocess.run(['curl','-s','-D','-','http://localhost:5221/api/brain/ping'],
                   capture_output=True, text=True)
out = r.stdout
header_end = out.find('\r\n\r\n')
if header_end < 0: header_end = out.find('\n\n')
headers = out[:header_end].lower()
body = out[header_end:].strip()
if '200' not in headers.split('\n')[0]:
    print(f'FAIL: 状态行 {headers.splitlines()[0]!r}'); sys.exit(1)
if 'content-type: application/json' not in headers:
    print(f'FAIL: Content-Type 非 json\n{headers}'); sys.exit(1)
d = json.loads(body)
if not isinstance(d, dict): print(f'FAIL: 响应非对象 {d!r}'); sys.exit(1)
if d.get('pong') is not True:
    print(f'FAIL: pong 非布尔 true，实际 {d.get(\"pong\")!r}'); sys.exit(1)
if not isinstance(d.get('timestamp'), str):
    print(f'FAIL: timestamp 非字符串'); sys.exit(1)
print('PASS: 200 + JSON Content-Type + pong=true + timestamp 字符串')
"

# 验证 2: timestamp 是合法 ISO 8601 且新鲜（与当前 UTC 时间差 < 5s）
python3 -c "
import subprocess, json, sys
from datetime import datetime, timezone
r = subprocess.run(['curl','-sf','http://localhost:5221/api/brain/ping'],
                   capture_output=True, text=True)
if r.returncode != 0: print(f'FAIL: curl exit={r.returncode}'); sys.exit(1)
ts = json.loads(r.stdout)['timestamp']
parsed = datetime.fromisoformat(ts.replace('Z','+00:00'))
if parsed.tzinfo is None:
    parsed = parsed.replace(tzinfo=timezone.utc)
delta = abs((datetime.now(timezone.utc) - parsed).total_seconds())
if delta > 5:
    print(f'FAIL: timestamp 不新鲜，相差 {delta:.2f}s'); sys.exit(1)
print(f'PASS: timestamp={ts!r} 可解析，相差 {delta:.3f}s')
"

# 验证 3: 两次调用 timestamp 不同（实时生成）
python3 -c "
import subprocess, json, sys, time
def hit():
    r = subprocess.run(['curl','-sf','http://localhost:5221/api/brain/ping'],
                       capture_output=True, text=True)
    return json.loads(r.stdout)['timestamp']
t1 = hit(); time.sleep(0.1); t2 = hit()
if t1 == t2: print(f'FAIL: timestamp 相同 {t1!r}，疑似缓存'); sys.exit(1)
print(f'PASS: 两次 timestamp 不同（{t1} vs {t2}）')
"

# 验证 4: 非 GET 方法（POST/PUT/PATCH/DELETE）均返回 405
python3 -c "
import subprocess, sys
for method in ['POST','PUT','PATCH','DELETE']:
    r = subprocess.run(['curl','-s','-o','/dev/null','-w','%{http_code}',
                        '-X', method, 'http://localhost:5221/api/brain/ping'],
                       capture_output=True, text=True)
    code = r.stdout.strip()
    if code != '405':
        print(f'FAIL: {method} 期望 405，实际 {code}'); sys.exit(1)
print('PASS: POST/PUT/PATCH/DELETE 全部返回 405')
"

# 验证 5: 路径大小写敏感（大写 P 不匹配）
python3 -c "
import subprocess, sys
r = subprocess.run(['curl','-s','-o','/dev/null','-w','%{http_code}',
                    'http://localhost:5221/api/brain/Ping'],
                   capture_output=True, text=True)
code = r.stdout.strip()
if code == '200':
    print('FAIL: 路径大小写不敏感（/api/brain/Ping 返回 200）'); sys.exit(1)
print(f'PASS: /api/brain/Ping 返回 {code}（非 200）')
"

# 验证 6: 路由在 Flask url_map 中已注册
python3 -c "
from api.routes import register_routes
from flask import Flask
app = Flask(__name__)
register_routes(app)
rules = [str(r) for r in app.url_map.iter_rules()]
assert '/api/brain/ping' in rules, f'FAIL: 路由未注册，当前规则: {rules}'
print('PASS: /api/brain/ping 已在 url_map 中注册')
"

# 验证 7: pytest 可 collect 到 ping 相关测试（白名单：subprocess + 正则，禁用 grep）
python3 -c "
import subprocess, sys, re
r = subprocess.run(['python3','-m','pytest','tests/','-k','ping','--collect-only','-q'],
                   capture_output=True, text=True)
out = r.stdout + r.stderr
matches = re.findall(r'test_\w*ping\w*\.py::test_\w+', out)
if not matches:
    print(f'FAIL: 未发现 ping 相关测试\n{out}'); sys.exit(1)
print(f'PASS: 发现 {len(matches)} 个 ping 测试: {matches}')
"

# 验证 8: pytest 运行 ping 测试全部通过（白名单：subprocess + returncode + 正则）
python3 -c "
import subprocess, sys, re
r = subprocess.run(['python3','-m','pytest','tests/','-k','ping','-v','--tb=short'],
                   capture_output=True, text=True)
out = r.stdout + r.stderr
if r.returncode != 0:
    print(f'FAIL: pytest exit={r.returncode}\n{out}'); sys.exit(1)
m = re.search(r'(\d+) passed', out)
if not m or int(m.group(1)) < 1:
    print(f'FAIL: 无 passed 用例\n{out}'); sys.exit(1)
print(f'PASS: {m.group(1)} 个 ping 用例通过')
"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: 实现 GET /api/brain/ping 路由与测试

**范围**: 在现有 Flask 应用内注册只读路由 `GET /api/brain/ping`，返回 `{pong: true, timestamp: <ISO 8601 字符串>}`；通过 `api/routes.py` 的 `register_routes(app)` 统一挂载机制接入；新增至少 1 个 pytest 测试文件（命名需使 `test_\w*ping\w*\.py::test_\w+` 正则可匹配）覆盖 happy path + ISO 解析断言。不改动任何既有路由、不引入新依赖、不修改鉴权或 CORS 配置。
**大小**: S（<100 行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `api/routes.py` 或其 import 的 brain 子模块中存在 `/api/brain/ping` 路由注册代码
  Test: python3 -c "from api.routes import register_routes; from flask import Flask; app=Flask(__name__); register_routes(app); rules=[str(r) for r in app.url_map.iter_rules()]; assert '/api/brain/ping' in rules, f'FAIL: 路由未注册，当前: {rules}'; print('PASS: /api/brain/ping 已注册')"
- [ ] [BEHAVIOR] 服务启动后 `GET /api/brain/ping` 返回 HTTP 200 + Content-Type application/json + JSON `{pong: true, timestamp: <str>}`
  Test: python3 -c "import subprocess,json,sys; r=subprocess.run(['curl','-s','-D','-','http://localhost:5221/api/brain/ping'],capture_output=True,text=True); out=r.stdout; he=out.find('\r\n\r\n'); he=out.find('\n\n') if he<0 else he; h=out[:he].lower(); b=out[he:].strip(); assert '200' in h.split('\n')[0], f'FAIL status: {h.splitlines()[0]!r}'; assert 'content-type: application/json' in h, f'FAIL ct: {h}'; d=json.loads(b); assert d.get('pong') is True and isinstance(d.get('timestamp'),str), f'FAIL body: {d}'; print('PASS: 200 + json + pong=true + timestamp str')"
- [ ] [BEHAVIOR] `timestamp` 字段为合法 ISO 8601 字符串，可被 `datetime.fromisoformat` 解析，且与当前 UTC 时间差 < 5 秒
  Test: python3 -c "import subprocess,json,sys; from datetime import datetime,timezone; r=subprocess.run(['curl','-sf','http://localhost:5221/api/brain/ping'],capture_output=True,text=True); assert r.returncode==0, f'FAIL curl: {r.returncode}'; ts=json.loads(r.stdout)['timestamp']; p=datetime.fromisoformat(ts.replace('Z','+00:00')); p=p.replace(tzinfo=timezone.utc) if p.tzinfo is None else p; d=abs((datetime.now(timezone.utc)-p).total_seconds()); assert d<5, f'FAIL freshness: {d}s'; print(f'PASS: {ts!r} 解析成功，差 {d:.3f}s')"
- [ ] [BEHAVIOR] 连续两次调用返回的 `timestamp` 不同（证明实时生成、非缓存常量）
  Test: python3 -c "import subprocess,json,sys,time; f=lambda:json.loads(subprocess.run(['curl','-sf','http://localhost:5221/api/brain/ping'],capture_output=True,text=True).stdout)['timestamp']; t1=f(); time.sleep(0.1); t2=f(); assert t1!=t2, f'FAIL: {t1}=={t2}'; print(f'PASS: {t1} != {t2}')"
- [ ] [BEHAVIOR] `POST` / `PUT` / `PATCH` / `DELETE` 方法请求 `/api/brain/ping` 均返回 405 Method Not Allowed
  Test: python3 -c "import subprocess,sys
for m in ['POST','PUT','PATCH','DELETE']:
    r=subprocess.run(['curl','-s','-o','/dev/null','-w','%{http_code}','-X',m,'http://localhost:5221/api/brain/ping'],capture_output=True,text=True)
    c=r.stdout.strip()
    assert c=='405', f'FAIL {m}: 期望 405 实际 {c}'
print('PASS: POST/PUT/PATCH/DELETE 全部返回 405')"
- [ ] [BEHAVIOR] `GET /api/brain/Ping`（大写 P）返回状态码非 200（路径大小写敏感）
  Test: python3 -c "import subprocess,sys; r=subprocess.run(['curl','-s','-o','/dev/null','-w','%{http_code}','http://localhost:5221/api/brain/Ping'],capture_output=True,text=True); c=r.stdout.strip(); assert c!='200', f'FAIL: 大写 Ping 返回 200，路径大小写不敏感'; print(f'PASS: /api/brain/Ping 返回 {c}（非 200）')"
- [ ] [ARTIFACT] 存在 pytest 测试（文件名或函数名可被正则 `test_\w*ping\w*\.py::test_\w+` 收集到）
  Test: python3 -c "import subprocess,sys,re; r=subprocess.run(['python3','-m','pytest','tests/','-k','ping','--collect-only','-q'],capture_output=True,text=True); out=r.stdout+r.stderr; m=re.findall(r'test_\w*ping\w*\.py::test_\w+', out); assert m, f'FAIL: 未发现 ping 测试\n{out}'; print(f'PASS: 发现 {len(m)} 个 ping 测试: {m}')"
- [ ] [BEHAVIOR] pytest 运行 ping 相关测试全部通过（exit code == 0 且至少 1 个 passed）
  Test: python3 -c "import subprocess,sys,re; r=subprocess.run(['python3','-m','pytest','tests/','-k','ping','-v','--tb=short'],capture_output=True,text=True); out=r.stdout+r.stderr; assert r.returncode==0, f'FAIL exit={r.returncode}\n{out}'; m=re.search(r'(\d+) passed', out); assert m and int(m.group(1))>=1, f'FAIL 无 passed\n{out}'; print(f'PASS: {m.group(1)} 个用例通过')"

---

## 给定-当-则（Given-When-Then）验收标准

### 场景 1: 正常调用返回成功（US-001 / SC-001 / SC-003）
- **Given** 后端 Flask 服务已启动并监听 localhost:5221
- **When** 客户端发起 `GET /api/brain/ping`
- **Then** 响应 HTTP 200，Content-Type 包含 `application/json`，响应体 JSON 包含 `pong=true`（布尔）和 `timestamp`（字符串）

### 场景 2: timestamp 动态刷新且新鲜（US-001 / SC-002）
- **Given** 后端服务已启动
- **When** 客户端间隔至少 10 毫秒连续两次调用 `GET /api/brain/ping`
- **Then** 两次响应 `timestamp` 值严格不相等，均可被 ISO 8601 解析器解析，且解析后时间与当前 UTC 时间差 < 5 秒

### 场景 3: 所有非 GET 方法均被拒绝（边界情况）
- **Given** 后端服务已启动
- **When** 客户端对 `/api/brain/ping` 分别发起 `POST` / `PUT` / `PATCH` / `DELETE` 请求
- **Then** 每个方法的响应均为 HTTP 405 Method Not Allowed

### 场景 4: 路径大小写敏感（边界情况）
- **Given** 后端服务已启动
- **When** 客户端 `GET /api/brain/Ping`（大写 P）
- **Then** 响应状态码严格非 200（预期 404 或 405）

### 场景 5: 端点伴随自动化测试（SC-001/SC-002/SC-003 的回归保护）
- **Given** 代码仓库包含本任务改动
- **When** 在仓库根目录运行 `python3 -m pytest tests/ -k "ping" -v`
- **Then** 至少 1 个测试被收集（文件/函数名可被正则 `test_\w*ping\w*\.py::test_\w+` 匹配），pytest 退出码为 0，且至少 1 个 passed；断言覆盖 HTTP 200、`pong=true`、`timestamp` 可 ISO 解析

### 场景 6: 路由注册完整性（FR-001 / FR-004）
- **Given** 在空 Flask app 上调用 `api.routes.register_routes`
- **When** 枚举 `app.url_map.iter_rules()`
- **Then** 结果集中包含字符串 `/api/brain/ping`

### 场景 7: PR 产出可达（US-002 / SC-004）
- **Given** Generator 容器内执行本 workstream 的实现与 git push
- **When** 流水线完成
- **Then** 产出 PR 链接非 null，PR diff 中包含 `/api/brain/ping` 路由注册代码与配套 pytest 文件
