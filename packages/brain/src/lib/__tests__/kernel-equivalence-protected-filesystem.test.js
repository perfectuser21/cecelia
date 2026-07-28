import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  parseDarwinProtectedPathInspection,
  parseLinuxAclInspection,
  parseLinuxXattrInspection,
} from '../kernel-equivalence-protected-filesystem.js';

describe('kernel equivalence protected filesystem inspection', () => {
  it('accepts one Darwin mode-only record', () => {
    expect(parseDarwinProtectedPathInspection(
      '-rw-------  1 cecelia  wheel  12 Jul 29 00:00 /tmp/key.pem\n',
    )).toBe(true);
  });

  it('allows the Darwin OS rootless marker only for trusted ancestors', () => {
    const output = [
      'drwx------@ 2 cecelia staff 64 Jul 29 00:00 /tmp/root',
      '\tcom.apple.rootless\t7 ',
    ].join('\n');

    expect(parseDarwinProtectedPathInspection(output)).toBe(false);
    expect(parseDarwinProtectedPathInspection(
      output,
      { allowSystemRootless: true },
    )).toBe(true);
  });

  it.each([
    [
      'xattr marker and entry',
      [
        '-rw-------@ 1 cecelia wheel 12 Jul 29 00:00 /tmp/key.pem',
        '\tcom.cecelia.test\t5 ',
      ].join('\n'),
    ],
    [
      'ACL entry',
      [
        '-rw-------+ 1 cecelia wheel 12 Jul 29 00:00 /tmp/key.pem',
        ' 0: group:everyone allow read',
      ].join('\n'),
    ],
    [
      'combined xattr and ACL entries',
      [
        '-rw-------@ 1 cecelia wheel 12 Jul 29 00:00 /tmp/key.pem',
        '\tcom.cecelia.test\t5 ',
        ' 0: group:everyone allow read',
      ].join('\n'),
    ],
  ])('rejects Darwin %s', (_label, output) => {
    expect(parseDarwinProtectedPathInspection(output)).toBe(false);
  });

  it('accepts only the three Linux base ACL entries', () => {
    expect(parseLinuxAclInspection([
      '# file: /tmp/key.pem',
      '# owner: 501',
      '# group: 20',
      'user::rw-',
      'group::---',
      'other::---',
      '',
    ].join('\n'))).toBe(true);
  });

  it.each([
    'user:65534:r--',
    'group:65534:r--',
    'mask::r--',
    'default:user::rwx',
  ])('rejects the Linux extended ACL entry %s', (entry) => {
    expect(parseLinuxAclInspection([
      '# file: /tmp/key.pem',
      'user::rw-',
      entry,
      'group::---',
      'other::---',
    ].join('\n'))).toBe(false);
  });

  it('accepts an empty Linux xattr dump', () => {
    expect(parseLinuxXattrInspection('')).toBe(true);
    expect(parseLinuxXattrInspection(
      '# file: /tmp/key.pem\n',
    )).toBe(true);
  });

  it.each([
    'user.cecelia=0x01',
    'security.selinux=0x01',
    'system.posix_acl_access=0x01',
  ])('rejects the Linux xattr %s', (entry) => {
    expect(parseLinuxXattrInspection([
      '# file: /tmp/key.pem',
      entry,
    ].join('\n'))).toBe(false);
  });
});
