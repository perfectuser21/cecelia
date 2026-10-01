#!/usr/bin/env python3
"""经 MMV 送到跑场机的台账镜子与空闲核验；不切号、不发消息。"""
import argparse
import base64
import csv
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
from datetime import datetime, timezone, timedelta

PROFILE_NAME = 'douyin-phone-profiles.tsv'
ACCOUNT_NAME = 'douyin-account-routes.tsv'
HEAD = ['profile', 'serial', 'model', 'width', 'height', 'nickname', 'host', 'owner', 'role', 'wechat']


def field(value):
    text = '' if value is None else str(value)
    if any(c in text for c in '\t\r\n\0'):
        raise ValueError('invalid TSV field')
    return text


def parse_profiles(text):
    columns = None
    out = {}
    for row in csv.reader(io.StringIO(text), delimiter='\t'):
        if not row:
            continue
        if row[0] in ('profile', '#profile'):
            columns = {name.lstrip('#'): n for n, name in enumerate(row)}
            continue
        if row[0].startswith('#'):
            continue
        cols = columns or dict(zip(HEAD, range(len(HEAD))))
        if max(cols.get(k, 100) for k in ('serial', 'width', 'height')) >= len(row):
            raise ValueError('profile dimensions missing')
        serial = row[cols['serial']]
        if serial in out:
            raise ValueError('duplicate profile serial')
        out[serial] = {k: row[n] for k, n in cols.items() if n < len(row)}
        if columns is None:
            # 控制器v1无表头的4/5列是最大坐标；v2表头才是真实像素宽高。
            for key in ('width', 'height'):
                if not out[serial][key].isdigit():
                    raise ValueError('legacy profile dimensions invalid')
                out[serial][key] = str(int(out[serial][key]) + 1)
    return out


def render(phones, old_profiles, old_accounts):
    dimensions = parse_profiles(old_profiles)
    tags = {}
    for row in csv.reader(io.StringIO(old_accounts), delimiter='\t'):
        if row and not row[0].startswith('#') and len(row) >= 4:
            tags[(row[0], row[1])] = row[3]
    profiles = ['#registry_version 2', '# Generated from Brain phone_registry', '#' + '\t'.join(HEAD)]
    accounts = ['# Generated from Brain phone_registry']
    seen_serial, seen_profile = set(), set()
    for p in sorted(phones, key=lambda x: x['serial']):
        if not p.get('enabled', True):
            continue
        serial, profile = field(p['serial']), field(p['profile'])
        if not re.fullmatch(r'[A-Za-z0-9._-]{1,64}', serial) or not re.fullmatch(r'[A-Za-z0-9._-]{1,64}', profile):
            raise ValueError('invalid technical mapping')
        if serial in seen_serial or profile in seen_profile or p['host'] not in ('xian-m1', 'xian-m4'):
            raise ValueError('ambiguous technical mapping')
        seen_serial.add(serial)
        seen_profile.add(profile)
        size = dimensions.get(serial, {})
        width, height = size.get('width', ''), size.get('height', '')
        if not width.isdigit() or not height.isdigit() or min(int(width), int(height)) < 1:
            raise ValueError('real dimensions missing')
        wx = p.get('wechat')
        wechat = (field(wx.get('id')) + '(' + field(wx.get('nickname')) + ')') if wx else '未登录'
        values = [profile, serial, p.get('model'), width, height, p.get('nickname'), p['host'], p.get('owner'), p.get('role'), wechat]
        profiles.append('\t'.join(field(v) for v in values))
        registered = p.get('douyin_accounts', [])
        if sum(a.get('current', False) is True for a in registered) > 1:
            raise ValueError('multiple current accounts')
        ids = set()
        for a in registered:
            if not a.get('id'):
                continue
            account_id = field(a['id'])
            if account_id in ids or not re.fullmatch(r'[A-Za-z0-9_-]+', account_id):
                raise ValueError('ambiguous account id')
            ids.add(account_id)
            role = tags.get((profile, account_id), 'search-primary,distribution' if a.get('current') else 'search-alt')
            accounts.append('\t'.join(map(field, [profile, account_id, a['nickname'], role])))
    return '\n'.join(profiles) + '\n', '\n'.join(accounts) + '\n'


def write_file(path, content):
    with open(path, 'w') as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    path.chmod(0o600)


def generation(config, profiles, accounts):
    digest = hashlib.sha256((profiles + '\0' + accounts).encode()).hexdigest()
    root = config / '.phone-registry-generations'
    root.mkdir(mode=0o700, exist_ok=True)
    dest = root / digest
    if not dest.exists():
        stage = Path(tempfile.mkdtemp(prefix='.stage-', dir=root))
        try:
            write_file(stage / 'profiles.tsv', profiles)
            write_file(stage / 'accounts.tsv', accounts)
            manifest = {'generation': digest, 'profiles_sha256': hashlib.sha256(profiles.encode()).hexdigest(),
                        'accounts_sha256': hashlib.sha256(accounts.encode()).hexdigest()}
            write_file(stage / 'manifest.json', json.dumps(manifest))
            stage.rename(dest)
        except BaseException:
            import shutil
            shutil.rmtree(stage, ignore_errors=True)
            raise
    for name, value in [('profiles.tsv', profiles), ('accounts.tsv', accounts)]:
        if (dest / name).read_text() != value:
            raise ValueError('generation checksum mismatch')
    return dest, digest


def point(config, dest):
    temporary = config / '.phone-registry-next'
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(dest.relative_to(config), target_is_directory=True)
    os.replace(temporary, config / '.phone-registry-current')


def publish(config, profiles, accounts, old_profiles, old_accounts):
    # 先把旧可用代放入指针，两个既有入口只改为固定链接；最后一次替换指针同时切代。
    current = config / '.phone-registry-current'
    if not current.exists():
        old_dest, _ = generation(config, old_profiles, old_accounts)
        point(config, old_dest)
    for name, target in [(PROFILE_NAME, 'profiles.tsv'), (ACCOUNT_NAME, 'accounts.tsv')]:
        path = config / name
        link = '.phone-registry-current/' + target
        if path.is_symlink() and os.readlink(path) == link:
            continue
        temporary = config / ('.' + name + '.next')
        temporary.unlink(missing_ok=True)
        temporary.symlink_to(link)
        os.replace(temporary, path)
    dest, digest = generation(config, profiles, accounts)
    point(config, dest)
    return digest


def devices(payload):
    serials, profiles = set(), set()
    if isinstance(payload, dict):
        for key, value in payload.items():
            if isinstance(value, str):
                if key in ('serial', 'phone_serial', 'device_serial', 'phoneSerial', 'deviceSerial'):
                    serials.add(value)
                if key in ('profile', 'phone_profile', 'device_profile', 'phoneProfile'):
                    profiles.add(value)
            a, b = devices(value)
            serials.update(a)
            profiles.update(b)
    elif isinstance(payload, list):
        for value in payload:
            a, b = devices(value)
            serials.update(a)
            profiles.update(b)
    return serials, profiles


def task_busy(phone, tasks, phones):
    if not isinstance(tasks, list):
        return True
    known = {p.get('profile'): p['serial'] for p in phones}
    for task in tasks:
        if not isinstance(task, dict) or task.get('status') != 'in_progress' or not isinstance(task.get('payload'), dict):
            return True
        serials, profiles = devices(task['payload'])
        serials.update(known[p] for p in profiles if p in known)
        if phone['serial'] in serials:
            return True
        if task.get('task_type') in ('qiumi_task', 'device_job', 'workflow_run') and not serials:
            return True
    return False


def command(argv, timeout_s=20):
    process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=timeout_s)
        return process.returncode, stdout + '\n' + stderr
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=2)
        return 124, ''


def reconcile(config, bundle):
    state_path = config / '.phone-registry-reconcile.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    day = datetime.fromtimestamp(bundle['now'] / 1000, timezone(timedelta(hours=8))).strftime('%Y-%m-%d')
    ctl = os.environ.get('PHONE_AGENT_CONTROLLER', str(Path.home() / '.local/bin/douyin-phone-adb'))
    receipts = []
    for phone in bundle['phones']:
        if phone.get('enabled', True) is False or phone.get('host') != bundle['host']:
            continue
        current = [a for a in phone.get('douyin_accounts', []) if a.get('current') is True and a.get('id')]
        expected = current[0]['id'] if len(current) == 1 else None
        base = {'serial': phone['serial'], 'expected_id': expected, 'day': day}
        old = state.get(phone['serial'], {})
        if old.get('day') == day and old.get('expected_id') == expected and old.get('status') == 'verified':
            receipts.append(old)
            continue
        if not expected:
            receipts.append({**base, 'status': 'unknown_account'})
            continue
        if task_busy(phone, bundle['tasks'], bundle['phones']):
            receipts.append({**base, 'status': 'task_busy'})
            continue
        rc, output = command([ctl, '--profile', phone['profile'], 'lock-status'])
        if rc != 0 or not re.search(r'^lock=free\s*$', output, re.M):
            receipts.append({**base, 'status': 'busy' if rc == 0 else 'unreachable'})
            continue
        owner = 'registry-' + day + '-' + phone['serial']
        rc, output = command([ctl, '--profile', phone['profile'], 'with-lock', owner, '--',
                              ctl, '--profile', phone['profile'], 'account-current', expected])
        ids = re.findall(r'^douyin_id=([A-Za-z0-9_-]+)\s*$', output, re.M)
        actual = ids[0] if len(ids) == 1 else None
        cleanup_failed = 'warning: close-app cleanup failed' in output
        status = 'cleanup_failed' if cleanup_failed else 'unreadable' if rc != 0 else 'verified' if actual == expected else 'mismatch' if actual else 'unreadable'
        receipt = {**base, 'actual_id': actual, 'status': status}
        receipts.append(receipt)
        state[phone['serial']] = receipt
    temporary = state_path.with_suffix('.next')
    write_file(temporary, json.dumps(state, ensure_ascii=False))
    os.replace(temporary, state_path)
    return receipts


def run(bundle):
    config = Path(os.environ.get('PHONE_AGENT_CONFIG', str(Path.home() / '.config/openclaw')))
    config.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        with open(config / '.phone-registry-agent.guard', 'a') as guard:
            fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
            old_profiles = (config / PROFILE_NAME).read_text()
            old_accounts = (config / ACCOUNT_NAME).read_text()
            profiles, accounts = render(bundle['phones'], old_profiles, old_accounts)
            digest = publish(config, profiles, accounts, old_profiles, old_accounts)
            receipts = reconcile(config, bundle)
            return {'ok': True, 'generation': digest, 'profiles_sha256': hashlib.sha256(profiles.encode()).hexdigest(),
                    'accounts_sha256': hashlib.sha256(accounts.encode()).hexdigest(), 'receipts': receipts}
    except (ValueError, KeyError, OSError, subprocess.SubprocessError):
        return {'ok': False, 'error': 'mirror or verification failed; not confirmed', 'receipts': []}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle-b64', required=True)
    args = parser.parse_args()
    print(json.dumps(run(json.loads(base64.b64decode(args.bundle_b64))), ensure_ascii=False))
