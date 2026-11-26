"""OPC对象同步：缺凭据、完整分页与失败关闭。"""
import importlib.util
import os
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

    def test_pagination_requires_explicit_completion_and_rejects_repeats(self):
        m = load('opc-objects-sync')
        auth = ({'code': 0, 'tenant_access_token': 'token'}, None)
        incomplete = ({'code': 0, 'data': {'items': [{'record_id': 'a'}]}}, None)
        repeated = ({'code': 0, 'data': {'items': [], 'has_more': True, 'page_token': 'same'}}, None)
        with patch.dict(os.environ, {'FEISHU_APP_ID': 'id', 'FEISHU_APP_SECRET': 'secret'}):
            for responses in [[auth, incomplete], [auth, repeated, repeated]]:
                with patch.object(m, 'http', side_effect=responses), self.assertRaises(RuntimeError): m.feishu_records()
        with patch.object(m, 'http', return_value=({'results': []}, None)), self.assertRaises(RuntimeError): m.notion_existing()

    def test_objects_partial_writes_are_not_success(self):
        m = load('opc-objects-sync')
        with patch.dict(os.environ, {'NOTION_API_KEY': 'secret'}), patch.object(m, 'feishu_records', return_value=[{'record_id': 'a', 'fields': {}}]), patch.object(m, 'notion_existing', return_value={'a': 'page'}), patch.object(m, 'http', return_value=(None, 'HTTP 500')), patch.object(m.time, 'sleep'):
            with self.assertRaises(RuntimeError):m.main()


if __name__ == '__main__': unittest.main()
