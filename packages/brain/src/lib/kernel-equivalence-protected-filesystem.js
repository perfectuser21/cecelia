import { execFileSync } from 'node:child_process';

export function assertPathAclFree(path, onFailure) {
  let invalid = false;
  try {
    const output = execFileSync('/bin/ls', ['-ld', path], {
      encoding: 'utf8',
      env: { LC_ALL: 'C' },
      maxBuffer: 4_096,
      timeout: 1_000,
    });
    const permissions = output.trimStart().split(/\s+/, 1)[0];
    if (
      !/^[bcdlps-][rwxStTs-]{9}[+@.]?$/.test(permissions)
      || permissions.endsWith('+')
    ) {
      invalid = true;
    }
  } catch {
    invalid = true;
  }
  if (invalid) {
    if (typeof onFailure === 'function') onFailure();
    throw new Error('protected_path_acl_check_failed');
  }
}
