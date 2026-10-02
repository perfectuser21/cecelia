"""固定MMV本地控制账入口；父进程强身份来自OS，不能从JSON伪造。"""
import json
import os
from pathlib import Path
import signal
import sys
import uuid
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'phone-ssh'))
from journal import Journal
from process_identity import boot_id,process_identity
from maintenance import read_maintenance

def handle(request,root='/var/lib/cecelia/phone-hub',marker='/var/run/cecelia/fleet-worker.drain'):
    if not isinstance(request,dict) or request.get('operation') not in ('identity','begin','end','snapshot','maintenance'):
        raise ValueError('phone_control_request_invalid')
    fields={'operation','token'} if request['operation']=='end' else {'operation'}
    if set(request)!=fields:raise ValueError('phone_control_request_invalid')
    owner=process_identity(os.getppid())
    if request['operation']=='identity':return {'boot_id':boot_id(),'owner':owner}
    # 不把丢失/未初始化账本重建成空账；初始化仅由受控安装步骤完成。
    if not Path(root).is_dir() or not (Path(root)/'.activity.json').is_file():raise ValueError('phone_control_journal_unknown')
    journal=Journal(root)
    if request['operation']=='begin':return {'token':journal.begin_activity('capabilities',owner=owner)}
    if request['operation']=='end':
        if str(uuid.UUID(request['token']))!=request['token']:raise ValueError('phone_control_request_invalid')
        journal.end_activity(request['token'],owner=owner);return {'ended':True}
    if request['operation']=='snapshot':return journal.activity_snapshot()
    return read_maintenance(journal,marker)

def main():
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(ValueError('phone_control_timeout')));signal.alarm(2)
    raw=sys.stdin.buffer.read(16385)
    if len(sys.argv)!=1 or len(raw)>16384:raise ValueError('phone_control_request_invalid')
    result=handle(json.loads(raw));sys.stdout.write(json.dumps(result,separators=(',',':'))+'\n')
if __name__=='__main__':
    try:main()
    except Exception:sys.stderr.write('phone_control_unconfirmed\n');sys.exit(1)
