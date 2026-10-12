import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('lease', pathlib.Path(__file__).with_name('us_price_lease.py'))
lease = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lease)


class LeaseTests(unittest.TestCase):
    def test_business_stops_but_cleanup_runs(self):
        with tempfile.TemporaryDirectory() as root:
            owner = 'price' + 'a' * 64
            marker = pathlib.Path(root) / owner / 'lease-lost'
            marker.parent.mkdir()
            actions = []
            lease.assert_business_allowed(owner, root)
            actions.append('first')
            marker.write_text('lease_lost')
            with self.assertRaisesRegex(RuntimeError, 'lease_lost'):
                try:
                    lease.assert_business_allowed(owner, root)
                    actions.append('must-not-run')
                finally:
                    lease.assert_business_allowed(owner, root, cleanup=True)
                    actions.extend(['restore-network', 'home', 'release-own-lock'])
            self.assertEqual(actions, ['first', 'restore-network', 'home', 'release-own-lock'])

    def test_invalid_owner_rejected(self):
        with self.assertRaises(ValueError):
            lease.assert_business_allowed('../another-owner', '/tmp')


if __name__ == '__main__':
    unittest.main()
