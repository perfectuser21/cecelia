"""精确 owner 的停止标记：业务动作中止，finally 的网络/桌面/锁收尾仍放行。"""
import pathlib
import re


def assert_business_allowed(owner, root, cleanup=False):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', owner):
        raise ValueError('invalid price owner')
    if not cleanup and (pathlib.Path(root) / owner / 'lease-lost').exists():
        raise RuntimeError('lease_lost: stop business and run owner cleanup')
