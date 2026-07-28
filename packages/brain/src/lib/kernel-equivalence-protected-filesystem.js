import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const INSPECTION_OPTIONS = Object.freeze({
  encoding: 'utf8',
  env: { LC_ALL: 'C' },
  maxBuffer: 65_536,
  timeout: 1_000,
});

function nonEmptyLines(output) {
  if (typeof output !== 'string') return null;
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

export function parseDarwinProtectedPathInspection(
  output,
  { allowSystemRootless = false } = {},
) {
  const lines = nonEmptyLines(output);
  if (!lines || ![1, 2].includes(lines.length)) return false;
  const permissions = lines[0].trimStart().split(/\s+/, 1)[0];
  if (lines.length === 1) {
    return /^[bcdlps-][rwxStTs-]{9}$/.test(permissions);
  }
  return (
    allowSystemRootless
    &&
    /^[bcdlps-][rwxStTs-]{9}@$/.test(permissions)
    && /^\s*com\.apple\.rootless\s+\d+\s*$/.test(lines[1])
  );
}

export function parseLinuxAclInspection(output) {
  const lines = nonEmptyLines(output);
  if (!lines) return false;
  const entries = lines.filter((line) => (
    !line.trimStart().startsWith('#')
  ));
  const required = new Set([
    'user::',
    'group::',
    'other::',
  ]);
  if (entries.length !== required.size) return false;
  for (const entry of entries) {
    const match = /^(user::|group::|other::)([rwx-]{3})$/.exec(
      entry.trim(),
    );
    if (!match || !required.delete(match[1])) return false;
  }
  return required.size === 0;
}

export function parseLinuxXattrInspection(output) {
  const lines = nonEmptyLines(output);
  return (
    lines != null
    && lines.every((line) => (
      line.trimStart().startsWith('#')
    ))
  );
}

function availableCommand(candidates) {
  return candidates.find((candidate) => existsSync(candidate));
}

export function assertPathAclFree(
  path,
  onFailure,
  { allowSystemRootless = false } = {},
) {
  let invalid = false;
  try {
    if (process.platform === 'darwin') {
      const output = execFileSync(
        '/bin/ls',
        ['-lde@', path],
        INSPECTION_OPTIONS,
      );
      invalid = !parseDarwinProtectedPathInspection(
        output,
        { allowSystemRootless },
      );
    } else if (process.platform === 'linux') {
      const getfacl = availableCommand([
        '/usr/bin/getfacl',
        '/bin/getfacl',
      ]);
      const getfattr = availableCommand([
        '/usr/bin/getfattr',
        '/bin/getfattr',
      ]);
      if (!getfacl || !getfattr) {
        invalid = true;
      } else {
        const acl = execFileSync(
          getfacl,
          ['--absolute-names', '--numeric', path],
          INSPECTION_OPTIONS,
        );
        const xattr = execFileSync(
          getfattr,
          [
            '--absolute-names',
            '--dump',
            '--encoding=hex',
            '--match=-',
            path,
          ],
          INSPECTION_OPTIONS,
        );
        invalid = (
          !parseLinuxAclInspection(acl)
          || !parseLinuxXattrInspection(xattr)
        );
      }
    } else {
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
