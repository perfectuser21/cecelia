"""固定HTTP物理wire；安装真身约束，不从公开JSON取得配置或授权。"""
from datetime import datetime, timezone
import uuid
from runner import BINDINGS
PHYSICAL=('machine_id','worker_id','physical_boot_id','config_digest','build_digest','action_digest')

def handle(runner,request,*,installation=None):
    from probe import installed_identity
    if not isinstance(request,dict) or set(request)!={'schema','request_nonce','operation','identity','physical'} or request['schema']!='phone-physical-execution/v1' or request['operation'] not in ('start','inspect','cancel'):
        raise ValueError('phone_http_request_invalid')
    try:
        nonce=uuid.UUID(request['request_nonce'])
        if nonce.version!=4 or str(nonce)!=request['request_nonce']:raise ValueError('nonce')
    except (ValueError,TypeError,AttributeError) as error:raise ValueError('phone_http_request_invalid') from error
    runner.validate(request['identity'])
    before=installed_identity(**(installation or {}))
    physical={k:before[k] for k in PHYSICAL}
    if request['physical']!=physical or not isinstance(request['physical'],dict) or set(request['physical'])!=set(PHYSICAL) or any(before[k]!=getattr(runner.config,k) for k in ('machine_id','worker_id','host')) or request['identity']['worker_boot_id']!=before['physical_boot_id']:
        raise ValueError('phone_http_physical_mismatch')
    # C3/C4尚未安装：production固定构造器始终拒绝新启动，不写launch intent。
    if request['operation']=='start':runner.config.assert_http_activation(request['identity'])
    receipt=getattr(runner,request['operation'])(request['identity'])
    after=installed_identity(**(installation or {}))
    if before!=after:raise ValueError('phone_http_version_changed')
    fields=['dispatch_id',*BINDINGS,'status','execution_exited','lock_released','lock_owner','reason']
    return {'schema':'phone-physical-execution/v1','request_nonce':request['request_nonce'],
            'physical':physical,'observed_at':datetime.now(timezone.utc).isoformat(),
            'identity':{k:v for k,v in receipt.items() if k in fields}}
