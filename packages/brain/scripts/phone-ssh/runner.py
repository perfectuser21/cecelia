"""固定JSONstdin控制器；部署配置独立于公开请求，默认资源准入拒绝。"""
from dataclasses import dataclass, field
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import uuid
from journal import Journal, safe_open
from phone_lease import PhoneLease
from process_identity import boot_id, process_identity, process_matches, process_absent, stop_verified
import worker

BINDINGS = ['reservation_id', 'task_id', 'machine_id', 'host', 'serial', 'profile', 'account_id',
            'execution_version_id', 'execution_grant_id', 'lease_token', 'execution_id',
            'worker_id', 'worker_boot_id', 'action', 'config_digest']
UUID_FIELDS = ['dispatch_id', 'reservation_id', 'task_id', 'execution_version_id',
               'execution_grant_id', 'lease_token', 'execution_id']
SCHEMA = 'phone-ssh/v1'


def denied_resources():
    raise ValueError('phone_resources_unconfigured')


@dataclass
class Config:
    journal_root: str = '/var/lib/cecelia/phone-ssh'
    lock_root: str = '/private/tmp/openclaw-phone/locks'
    adb: str = '/opt/homebrew/bin/adb'
    machine_id: str = ''
    worker_id: str = ''
    host: str = ''
    drain_path: str = '/var/run/cecelia/fleet-worker.drain'
    hard_cap_sec: float = 5
    assert_resources: object = field(default=denied_resources, repr=False)
    fault: object = field(default=lambda stage: None, repr=False)

    def assert_can_launch(self):
        try:
            Path(self.drain_path).lstat()
        except FileNotFoundError:
            return
        except OSError as error:
            raise ValueError('phone_drain_unconfirmed') from error
        raise ValueError('phone_worker_draining')


def validate_identity(identity):
    if not isinstance(identity, dict) or set(identity) != set(BINDINGS + ['dispatch_id']):
        raise ValueError('phone_identity_invalid')
    if any(not isinstance(value, str) or not value or len(value.encode()) > 256 for value in identity.values()):
        raise ValueError('phone_identity_invalid')
    for key in UUID_FIELDS:
        try:
            if str(uuid.UUID(identity[key])) != identity[key]:
                raise ValueError('uuid')
        except ValueError as error:
            raise ValueError('phone_identity_invalid') from error
    if identity['action'] != 'adb_get_state' or not re.fullmatch('[a-f0-9]{64}', identity['config_digest']) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', identity['serial']):
        raise ValueError('phone_identity_invalid')


def request_digest(identity):
    return hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class Runner:
    def __init__(self, config):
        self.config = config
        if not all(isinstance(value, str) and value for value in (config.machine_id, config.worker_id, config.host)):
            raise ValueError('phone_worker_unconfigured')
        if not 0 < config.hard_cap_sec <= 10:
            raise ValueError('phone_hard_cap_invalid')
        self.journal = Journal(config.journal_root)

    def validate(self, identity):
        validate_identity(identity)
        if any(identity[k] != getattr(self.config, k) for k in ('machine_id', 'worker_id', 'host')):
            raise ValueError('phone_worker_identity_mismatch')

    def state(self, identity):
        state = self.journal.read(identity['dispatch_id'])
        if state and (state.get('request_digest') != request_digest(identity) or state.get('identity') != identity):
            raise ValueError('phone_configuration_conflict')
        return state

    def view(self, identity, state):
        if state and state.get('receipt'):
            receipt = state['receipt']
            if not isinstance(receipt, dict) or any(receipt.get(k) != identity[k] for k in BINDINGS + ['dispatch_id']) or receipt.get('status') not in ('completed', 'failed') or receipt.get('execution_exited') is not True or receipt.get('lock_released') is not True or receipt.get('lock_owner') != identity['lease_token']:
                raise ValueError('phone_receipt_unconfirmed')
            return receipt
        receipt = {**identity, 'status': 'unknown'}
        if state and state.get('phase') == 'running' and process_matches(state.get('worker_identity')) and process_matches(state.get('child_identity')):
            receipt['status'] = 'running'
        return receipt

    def start(self, identity):
        self.validate(identity)
        key = identity['dispatch_id']
        with self.journal.locked(key):
            state = self.state(identity)
            if state:
                return self.view(identity, state)
            if identity['worker_boot_id'] != boot_id():
                raise ValueError('phone_boot_identity_mismatch')
            state = {'identity': identity, 'request_digest': request_digest(identity),
                     'phase': 'launch_intent', 'launcher_identity': process_identity(os.getpid())}
            self.journal.write(key, state)
            self.config.fault('after_launch_intent')
            state['phase'] = 'forking'
            self.journal.write(key, state)
            pid = os.fork()
            if pid == 0:
                try:
                    worker.detach()
                    worker.run(self.config, identity, self.journal)
                    os._exit(0)
                except Exception:
                    os._exit(1)
            state['spawned_pid'] = pid
            self.journal.write(key, state)
            return self.view(identity, state)

    def inspect(self, identity):
        self.validate(identity)
        with self.journal.locked(identity['dispatch_id']):
            state = self.state(identity)
            if state and state.get('spawned_pid'):
                try:
                    os.waitpid(state['spawned_pid'], os.WNOHANG)
                except ChildProcessError:
                    pass
            return self.view(identity, state)

    def cancel(self, identity):
        self.validate(identity)
        key = identity['dispatch_id']
        with self.journal.locked(key):
            state = self.state(identity)
            if state and state.get('receipt'):
                return self.view(identity, state)
            if state is None:
                state = {'identity': identity, 'request_digest': request_digest(identity), 'phase': 'tombstone'}
            state['tombstone'] = True
            self.journal.write(key, state)
            lease = PhoneLease(self.config.lock_root, identity)
            # launch_intent仍在fork之前且所有fork均在同一互斥内；可确定不曾启动。
            before_fork = state['phase'] in ('tombstone', 'launch_intent')
            stopped = False
            if not before_fork and state.get('child_identity'):
                stop_verified(state['child_identity'])
            if not before_fork and state.get('worker_identity') and process_absent(state['worker_identity']):
                child_absent = not state.get('child_identity') or process_absent(state['child_identity'])
                # child_preparing的未记录fork不能证明没有孩子。
                if child_absent and state['phase'] != 'child_preparing':
                    stopped = lease.release(state['worker_identity']['pid']) if state.get('lease_acquired') else lease.own_absent()
            if (before_fork and lease.own_absent()) or stopped:
                state['phase'] = 'terminal'
                state['receipt'] = {**identity, 'status': 'failed', 'reason': 'phone_cancelled',
                                    'execution_exited': True, 'lock_released': True,
                                    'lock_owner': identity['lease_token']}
                self.journal.write(key, state)
            return self.view(identity, state)

    def maintenance(self):
        pending = 0
        revision = 0
        for key in self.journal.keys():
            with self.journal.locked(key):
                state = self.journal.read(key)
                if not state or not isinstance(state.get('revision'), int):
                    raise ValueError('phone_maintenance_unconfirmed')
                validate_identity(state.get('identity'))
                if state.get('request_digest') != request_digest(state['identity']):
                    raise ValueError('phone_maintenance_unconfirmed')
                self.view(state['identity'], state)
                pending += not bool(state.get('receipt')) or (state.get('worker_identity') is not None and not process_absent(state['worker_identity']))
                revision += state['revision']
        return {'pending': pending, 'activity_revision': revision}

    def handle(self, request):
        if not isinstance(request, dict) or set(request) != {'schema', 'request_nonce', 'operation', 'identity'} or request['schema'] != SCHEMA or request['operation'] not in ('start', 'inspect', 'cancel'):
            raise ValueError('phone_request_invalid')
        try:
            if str(uuid.UUID(request['request_nonce'])) != request['request_nonce']:
                raise ValueError('nonce')
        except (ValueError, TypeError, AttributeError) as error:
            raise ValueError('phone_request_invalid') from error
        receipt = getattr(self, request['operation'])(request['identity'])
        return {'schema': SCHEMA, 'request_nonce': request['request_nonce'], 'receipt': receipt}


def production_config():
    # 身份配置只读固定安装路径；JSONstdin永远不能设置执行路径或资源hook。
    fd = safe_open('/etc/cecelia/phone-ssh/worker.json', os.O_RDONLY)
    with os.fdopen(fd) as handle:
        identity = json.load(handle)
    if not isinstance(identity, dict) or set(identity) != {'machine_id', 'worker_id', 'host'}:
        raise ValueError('phone_worker_unconfigured')
    return Config(**identity)


def main():
    raw = sys.stdin.buffer.read(16385)
    if len(raw) > 16384 or len(sys.argv) != 1:
        raise ValueError('phone_request_invalid')
    result = Runner(production_config()).handle(json.loads(raw))
    sys.stdout.write(json.dumps(result, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.stderr.write('phone_runner_unconfirmed\n')
        sys.exit(1)
