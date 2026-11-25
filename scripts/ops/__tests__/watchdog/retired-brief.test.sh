#!/usr/bin/env bash
# 真实监控入口：退役晨报不能再探旧容器；现役健康、磁盘及每日报到仍须执行。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
python3 - "$ROOT" <<'PY'
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(sys.argv[1])
# 生产为 Linux Bash；macOS 系统 Bash 3 的嵌套引号解析与生产不同。
shell = '/opt/homebrew/bin/bash' if Path('/opt/homebrew/bin/bash').exists() else '/bin/bash'
source = (root / 'scripts/ops/us-vps/opc-watchdog.sh').read_text()
with tempfile.TemporaryDirectory(prefix='watchdog-brief-') as directory:
    area = Path(directory)
    base, credentials, bin_dir = [area / name for name in ('base', 'credentials', 'bin')]
    for path in (base, credentials, bin_dir):
        path.mkdir()
    boundaries = {'BASE=/opt/opc-watchdog': f'BASE={base}',
                  '/root/.credentials/feishu.env': str(credentials / 'feishu.env'),
                  '/root/.credentials/bark.env': str(credentials / 'bark.env')}
    for old, new in boundaries.items():
        assert source.count(old) == 1, f'隔离边界匹配次数异常：{old}'
        source = source.replace(old, new)
    assert '/root/.credentials' not in source and '/opt/opc-watchdog' not in '\n'.join(
        line for line in source.splitlines() if not line.startswith('#'))
    (credentials / 'feishu.env').write_text("FEISHU_WEBHOOK='https://fixture.invalid/feishu'\n")
    (credentials / 'bark.env').write_text("BARK_TOKEN='fixture-only'\n")
    script = area / 'watchdog.sh'
    script.write_text(source)
    dispatch = bin_dir / 'dispatch'
    dispatch.write_text('#!' + sys.executable + '\n' + r'''
import datetime,json,os,re,sys
from pathlib import Path
name,args=Path(sys.argv[0]).name,sys.argv[1:]
area=Path(os.environ['FIXTURE_ROOT']);state=area/'base/state'
with (area/'calls.jsonl').open('a') as f:f.write(json.dumps([name,args])+'\n')
def deny():
 with (area/'forbidden').open('a') as f:f.write(json.dumps([name,args])+'\n')
 sys.exit(97)
def local(value):
 p=Path(value)
 return p.is_absolute() and p.is_relative_to(state) and '..' not in p.parts
if name=='date':
 values={('-u','+%F %T'):'2026-11-25 01:25:00',('-u','+%H%M'):os.environ['FIXTURE_HM'],
         ('-u','+%u'):'3',('-u','+%F'):'2026-11-25',('+%s',):'1795569900'}
 if tuple(args) not in values:deny()
 print(values[tuple(args)]);sys.exit(0)
if name=='mkdir' and len(args)==2 and args[0]=='-p' and Path(args[1])==state:
 state.mkdir(exist_ok=True);sys.exit(0)
if name in ['cat','touch'] and len(args)==1 and local(args[0]):
 p=Path(args[0])
 if name=='touch':p.touch()
 else:sys.stdout.write(p.read_text())
 sys.exit(0)
if name=='find' and len(args)==6 and Path(args[0])==state and args[1:] in [
 ['-name','reported.*','-mtime','+2','-delete'],['-name','briefchecked.*','-mtime','+2','-delete']]:
 sys.exit(0)
if name=='tr' and args==['-dc','0-9']:
 print(''.join(c for c in sys.stdin.read() if c.isdigit()),end='');sys.exit(0)
if name=='grep' and args in [['-q','"code":200'],['-q','"code":0']]:
 sys.exit(0 if args[1] in sys.stdin.read() else 1)
if name=='ssh' and args==['-o','BatchMode=yes','hk-ts','df --output=pcent / | tail -1']:
 print(os.environ['FIXTURE_DISK']+'%');sys.exit(0)
if name=='docker' and len(args)==6 and args[:5]==['exec','openclaw-gateway','openclaw','cron','get']:
 sys.exit(1)
if name=='bash' and len(args)==2 and args[0]=='-c' and re.fullmatch(
 r'docker exec openclaw-gateway openclaw cron get [0-9a-f-]{36} 2>/dev/null',args[1]):
 os.execv(os.environ['FIXTURE_BASH'],[os.environ['FIXTURE_BASH'],*args])
if name=='timeout' and ((args[:2]==['20','ssh']) or (args[:3]==['25','bash','-c'])):
 os.execv(str(area/'bin'/args[1]),args[1:])
if name=='curl':
 if args==['-s','-m','10','http://100.71.151.105:5221/api/brain/health']:
  print(json.dumps({'status':os.environ['FIXTURE_BRAIN']}));sys.exit(0)
 if len(args)==10 and args[:5]==['-s','-m','10','-X','POST'] and args[6:9]==['-H','Content-Type: application/json','-d']:
  body=json.loads(args[9]);url=args[5]
  if url=='https://api.day.app/push' and body.get('device_key')=='fixture-only':print('{"code":200}');sys.exit(0)
  if url=='https://fixture.invalid/feishu' and body.get('msg_type')=='text':print('{"code":0}');sys.exit(0)
 deny()
if name=='python3' and len(args)>=2 and args[0]=='-c':
 code=args[1]
 brain='import json,sys;print(json.load(sys.stdin).get("status",""))'
 allowed=(code==brain or code=="import json,sys;print(json.dumps({'title':'OPC-Watchdog','body':sys.argv[1],'device_key':'fixture-only','group':'opc-watchdog','level':'timeSensitive'}))"
          or code=="import json,sys;print(json.dumps({'msg_type':'text','content':{'text':sys.argv[1]}}))"
          or code=="\nimport json,sys,datetime\nj=json.load(sys.stdin); st=j.get(\"state\",{})\nts=st.get(\"lastRunAtMs\",0)/1000\nd=datetime.datetime.utcfromtimestamp(ts).strftime(\"%Y-%m-%d\") if ts else \"\"\nprint(st.get(\"lastRunStatus\",\"?\")+\"|\"+d)")
 if not allowed:deny()
 os.execv(sys.executable,[sys.executable,*args])
deny()
''')
    dispatch.chmod(0o755)
    for name in ('date','mkdir','cat','touch','find','tr','grep','ssh','docker','bash','timeout','curl','python3'):
        (bin_dir / name).symlink_to(dispatch)
    def run(hm='0125', disk='73', brain='healthy'):
        (area / 'calls.jsonl').write_text('')
        env = {'PATH': str(bin_dir), 'HOME': str(area), 'FIXTURE_ROOT': str(area),
               'FIXTURE_HM': hm, 'FIXTURE_DISK': disk, 'FIXTURE_BRAIN': brain, 'LC_ALL': 'C.UTF-8',
               'FIXTURE_BASH': shell}
        result = subprocess.run([shell, str(script)], env=env, capture_output=True, text=True)
        forbidden = area / 'forbidden'
        assert not forbidden.exists(), '脚本试图执行未批准命令：' + (forbidden.read_text() if forbidden.exists() else '')
        assert result.returncode == 0, f'真实入口异常退出{result.returncode}: {result.stderr}'
        calls = [json.loads(line) for line in (area / 'calls.jsonl').read_text().splitlines()]
        assert not any(name == 'docker' for name, _ in calls), '退役晨报仍调用已不存在的 OpenClaw 容器'
        messages = [json.loads(args[-1]) for name,args in calls if name == 'curl' and '-X' in args]
        assert not any('晨报未按时成功' in json.dumps(message,ensure_ascii=False) for message in messages), '仍发送旧晨报假警'
        assert (base / 'state/last.brain').read_text().strip() == brain
        assert (base / 'state/last.hkdisk').read_text().strip() == disk
        assert any(name == 'ssh' for name,_ in calls), 'HK 检查没有执行'
        return messages
    assert run() == [], '健康监控不应发通知'
    messages = run(disk='90')
    assert len(messages) == 2 and '90%' in json.dumps(messages,ensure_ascii=False), 'HK 高水位未经双通道告警'
    for _ in range(2):
        assert run(brain='unhealthy') == []
    messages = run(brain='unhealthy')
    assert len(messages) == 2 and 'Brain /api/brain/health' in json.dumps(messages,ensure_ascii=False), 'Brain 连败阈值失效'
    messages = run(hm='0105')
    assert len(messages) == 2 and all('每日' in json.dumps(message,ensure_ascii=False) for message in messages)
    assert (base / 'state/reported.2026-11-25').is_file(), '每日存活回执缺失'
    assert run(hm='0105') == [], '同日存活报到未去重'
    print('真实 Watchdog 隔离回归通过：无旧晨报，Brain/HK 告警与每日存活报到保留')
PY
