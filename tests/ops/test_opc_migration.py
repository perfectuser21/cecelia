"""MMV迁移边界：真实入口、时区、完整读取与失败关闭。"""
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]

def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts/ops' / (name + '.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

class Migration(unittest.TestCase):
    def test_current_mmv_paths_and_external_accounting(self):
        for name in ['opc-kr-current', 'opc-okr-sync']:
            m = load(name)
            def stop(url, body=None, method=None):
                self.assertEqual(body['task_type'], 'data')
                self.assertEqual(body['payload']['headed_manual'], True)
                raise RuntimeError('stop-before-write')
            with patch.object(m, 'call', side_effect=stop), self.assertRaisesRegex(RuntimeError, 'stop-before-write'):
                m.main()
        self.assertEqual(load('opc-okr-sync').ROOT, str(Path.home() / 'openclaw-root/workspaces-root'))

    def test_cron_reads_current_cli_and_rejects_partial_snapshot(self):
        m = load('opc-kr-current')
        jobs = [{'id': i, 'state': {'lastRunStatus': 'ok'}} for i in m.REPORT_CRON_IDS]
        for data, good in [({'jobs': jobs, 'hasMore': False}, True), ({'jobs': jobs, 'hasMore': True}, False)]:
            result = subprocess.CompletedProcess([], 0, json.dumps(data), '')
            with patch.object(m.subprocess, 'run', return_value=result) as run:
                if good:
                    self.assertEqual(len(m.cron_states()), 3)
                    self.assertEqual(run.call_args.args[0][-4:], ['cron', 'list', '--all', '--json'])
                else:
                    with self.assertRaises(RuntimeError): m.cron_states()

    def test_okr_missing_department_fails_before_any_site_write(self):
        m = load('opc-okr-sync')
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'clawd').mkdir()
            def call(url, body=None, method=None):
                return {'id': 'fixture', 'success': True, 'status': (body or {}).get('status')}
            with patch.object(m, 'ROOT', directory), patch.object(m, 'call', side_effect=call), patch.object(m, 'fetch', return_value=[]), patch.object(m, 'write_site') as write:
                with self.assertRaisesRegex(RuntimeError, '执行现场'): m.main()
                write.assert_not_called()

    def test_business_date_uses_shanghai_once(self):
        m = load('opc-kr-current')
        source = Path(m.__file__).read_text()
        self.assertNotIn('time.time() + 8 * 3600', source)
        self.assertEqual(m.business_now().tzinfo.key, 'Asia/Shanghai')

    def test_objects_missing_credential_stops_without_network(self):
        m = load('opc-objects-sync')
        with patch.dict(os.environ, {}, clear=True), patch.object(m, 'http') as request:
            with self.assertRaisesRegex(RuntimeError, 'FEISHU_APP_ID'): m.feishu_records()
            request.assert_not_called()

    def test_objects_auth_and_full_pagination(self):
        m = load('opc-objects-sync')
        replies = [({'code': 0, 'tenant_access_token': 'private-token'}, None),
                   ({'code': 0, 'data': {'items': [{'record_id': 'a'}], 'has_more': True, 'page_token': 'second'}}, None),
                   ({'code': 0, 'data': {'items': [{'record_id': 'b'}], 'has_more': False}}, None)]
        with patch.dict(os.environ, {'FEISHU_APP_ID': 'id', 'FEISHU_APP_SECRET': 'secret'}), patch.object(m, 'http', side_effect=replies):
            self.assertEqual([r['record_id'] for r in m.feishu_records()], ['a', 'b'])

    def test_objects_nonzero_api_code_and_repeated_cursor_fail(self):
        m = load('opc-objects-sync')
        for response in [{'code': 999, 'msg': 'private-token'}, {'code': 0, 'data': {'items': [], 'has_more': True}}]:
            with patch.dict(os.environ, {'FEISHU_APP_ID': 'id', 'FEISHU_APP_SECRET': 'secret'}), patch.object(m, 'http', side_effect=[({'code': 0, 'tenant_access_token': 'private-token'}, None), (response, None)]):
                with self.assertRaises(RuntimeError) as error:m.feishu_records()
                self.assertNotIn('private-token', str(error.exception))

    def test_objects_partial_writes_are_not_success(self):
        m = load('opc-objects-sync')
        with patch.dict(os.environ, {'NOTION_API_KEY': 'secret'}), patch.object(m, 'feishu_records', return_value=[{'record_id': 'a', 'fields': {}}]), patch.object(m, 'notion_existing', return_value={'a': 'page'}), patch.object(m, 'http', return_value=(None, 'HTTP 500')), patch.object(m.time, 'sleep'):
            with self.assertRaises(RuntimeError):m.main()

if __name__ == '__main__': unittest.main()
