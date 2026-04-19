contract_branch: cp-harness-review-approved-57ab38ad
workstream_index: 1
sprint_dir: sprints

# Contract DoD — Workstream 1: 实现 GET /api/brain/ping 路由与测试

- [x] [ARTIFACT] `api/routes.py` 或其 import 的 brain 子模块中存在 `/api/brain/ping` 路由注册代码
  Test: python3 -c "from api.routes import register_routes; from flask import Flask; app=Flask(__name__); register_routes(app); rules=[str(r) for r in app.url_map.iter_rules()]; assert '/api/brain/ping' in rules, f'FAIL: 路由未注册，当前: {rules}'; print('PASS: /api/brain/ping 已注册')"
- [x] [BEHAVIOR] 服务启动后 `GET /api/brain/ping` 返回 HTTP 200 + Content-Type application/json + JSON `{pong: true, timestamp: <str>}`
  Test: python3 -c "import subprocess,json,sys; r=subprocess.run(['curl','-s','-D','-','http://localhost:5221/api/brain/ping'],capture_output=True,text=True); out=r.stdout; he=out.find('\r\n\r\n'); he=out.find('\n\n') if he<0 else he; h=out[:he].lower(); b=out[he:].strip(); assert '200' in h.split('\n')[0], f'FAIL status: {h.splitlines()[0]!r}'; assert 'content-type: application/json' in h, f'FAIL ct: {h}'; d=json.loads(b); assert d.get('pong') is True and isinstance(d.get('timestamp'),str), f'FAIL body: {d}'; print('PASS: 200 + json + pong=true + timestamp str')"
- [x] [BEHAVIOR] `timestamp` 字段为合法 ISO 8601 字符串，可被 `datetime.fromisoformat` 解析，且与当前 UTC 时间差 < 5 秒
  Test: python3 -c "import subprocess,json,sys; from datetime import datetime,timezone; r=subprocess.run(['curl','-sf','http://localhost:5221/api/brain/ping'],capture_output=True,text=True); assert r.returncode==0, f'FAIL curl: {r.returncode}'; ts=json.loads(r.stdout)['timestamp']; p=datetime.fromisoformat(ts.replace('Z','+00:00')); p=p.replace(tzinfo=timezone.utc) if p.tzinfo is None else p; d=abs((datetime.now(timezone.utc)-p).total_seconds()); assert d<5, f'FAIL freshness: {d}s'; print(f'PASS: {ts!r} 解析成功，差 {d:.3f}s')"
- [x] [BEHAVIOR] 连续两次调用返回的 `timestamp` 不同（证明实时生成、非缓存常量）
  Test: python3 -c "import subprocess,json,sys,time; f=lambda:json.loads(subprocess.run(['curl','-sf','http://localhost:5221/api/brain/ping'],capture_output=True,text=True).stdout)['timestamp']; t1=f(); time.sleep(0.1); t2=f(); assert t1!=t2, f'FAIL: {t1}=={t2}'; print(f'PASS: {t1} != {t2}')"
- [x] [BEHAVIOR] `POST` / `PUT` / `PATCH` / `DELETE` 方法请求 `/api/brain/ping` 均返回 405 Method Not Allowed
  Test: python3 -c "import subprocess,sys
for m in ['POST','PUT','PATCH','DELETE']:
    r=subprocess.run(['curl','-s','-o','/dev/null','-w','%{http_code}','-X',m,'http://localhost:5221/api/brain/ping'],capture_output=True,text=True)
    c=r.stdout.strip()
    assert c=='405', f'FAIL {m}: 期望 405 实际 {c}'
print('PASS: POST/PUT/PATCH/DELETE 全部返回 405')"
- [x] [BEHAVIOR] `GET /api/brain/Ping`（大写 P）返回状态码非 200（路径大小写敏感）
  Test: python3 -c "import subprocess,sys; r=subprocess.run(['curl','-s','-o','/dev/null','-w','%{http_code}','http://localhost:5221/api/brain/Ping'],capture_output=True,text=True); c=r.stdout.strip(); assert c!='200', f'FAIL: 大写 Ping 返回 200，路径大小写不敏感'; print(f'PASS: /api/brain/Ping 返回 {c}（非 200）')"
- [x] [ARTIFACT] 存在 pytest 测试（文件名或函数名可被正则 `test_\w*ping\w*\.py::test_\w+` 收集到）
  Test: python3 -c "import subprocess,sys,re; r=subprocess.run(['python3','-m','pytest','tests/','-k','ping','--collect-only','-q'],capture_output=True,text=True); out=r.stdout+r.stderr; m=re.findall(r'test_\w*ping\w*\.py::test_\w+', out); assert m, f'FAIL: 未发现 ping 测试\n{out}'; print(f'PASS: 发现 {len(m)} 个 ping 测试: {m}')"
- [x] [BEHAVIOR] pytest 运行 ping 相关测试全部通过（exit code == 0 且至少 1 个 passed）
  Test: python3 -c "import subprocess,sys,re; r=subprocess.run(['python3','-m','pytest','tests/','-k','ping','-v','--tb=short'],capture_output=True,text=True); out=r.stdout+r.stderr; assert r.returncode==0, f'FAIL exit={r.returncode}\n{out}'; m=re.search(r'(\d+) passed', out); assert m and int(m.group(1))>=1, f'FAIL 无 passed\n{out}'; print(f'PASS: {m.group(1)} 个用例通过')"
