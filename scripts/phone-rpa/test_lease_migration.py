"""迁移器必须在修改现场前验证全部基线，并留下可回滚的备份。"""
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest

def sha(data):
    return hashlib.sha256(data).hexdigest()

class MigrationTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('migration', pathlib.Path(__file__).parent / 'lease-migration/apply.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = pathlib.Path(self.tmp.name)
        self.artifact = root / 'artifact'
        self.target = root / 'live'
        self.artifact.mkdir(); self.target.mkdir()
        (self.target / 'consumer.py').write_bytes(b'old\n')
        (root / 'guard.py').write_bytes(b'guard\n')
        patch = b'--- a/consumer.py\n+++ b/consumer.py\n@@ -1 +1 @@\n-old\n+new\n'
        (self.artifact / 'node.patch').write_bytes(patch)
        self.config = {'patch':'node.patch','patch_sha256':sha(patch),'files':{'consumer.py':{'before':sha(b'old\n'),'after':sha(b'new\n')}},'guards':{'guard.py':sha(b'guard\n')}}
        self.save()

    def save(self):
        (self.artifact / 'manifest.json').write_text(json.dumps({'groups':{'node':self.config}}))

    def test_applies_exact_patch_and_preserves_backup(self):
        result = self.module.apply(self.artifact, self.target, 'node', install=True)
        self.assertEqual((self.target / 'consumer.py').read_bytes(), b'new\n')
        self.assertEqual((self.target / 'guard.py').read_bytes(), b'guard\n')
        self.assertEqual((pathlib.Path(result['backup']) / 'consumer.py').read_bytes(), b'old\n')

    def test_changed_baseline_refuses_every_write(self):
        (self.target / 'consumer.py').write_bytes(b'other session\n')
        with self.assertRaisesRegex(ValueError, 'baseline'):
            self.module.apply(self.artifact, self.target, 'node', install=True)
        self.assertFalse((self.target / 'guard.py').exists())
        self.assertEqual((self.target / 'consumer.py').read_bytes(), b'other session\n')

    def test_wrong_output_refuses_every_write(self):
        self.config['files']['consumer.py']['after'] = sha(b'wrong\n'); self.save()
        with self.assertRaisesRegex(ValueError, 'output'):
            self.module.apply(self.artifact, self.target, 'node', install=True)
        self.assertEqual((self.target / 'consumer.py').read_bytes(), b'old\n')
        self.assertFalse((self.target / 'guard.py').exists())

if __name__ == '__main__':
    unittest.main()
