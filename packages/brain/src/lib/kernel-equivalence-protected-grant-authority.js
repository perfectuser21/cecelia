import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  join,
  parse,
  resolve,
} from 'node:path';

const GRANT_REF =
  /^kernel-equivalence-grant:([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
const CELL_ID =
  /^KERNEL-P[01]-[0-9]{2}-[A-Z0-9-]+::(?:claude|codex|grok)::(?:normal|violation|recovery)$/;
const REQUEST_FIELDS = Object.freeze(['cellId', 'grantRef']);
const MAXIMUM_GRANT_BYTES = 65_536;

export class ProtectedGrantAuthorityError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProtectedGrantAuthorityError';
    this.code = code;
  }
}

function fail(code) {
  throw new ProtectedGrantAuthorityError(code);
}

function exactFields(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length
    && actual.every((field, index) => field === expected[index])
  );
}

function ownedByService(status) {
  return (
    typeof process.geteuid !== 'function'
    || status.uid === process.geteuid()
  );
}

function ownedByTrustedPrincipal(status) {
  return (
    typeof process.geteuid !== 'function'
    || status.uid === 0
    || status.uid === process.geteuid()
  );
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validateRoot(grantRoot) {
  if (
    typeof grantRoot !== 'string'
    || !isAbsolute(grantRoot)
    || grantRoot === parse(grantRoot).root
    || resolve(grantRoot) !== grantRoot
  ) {
    fail('protected_grant_root_unsafe');
  }
  let rootStatus;
  try {
    if (realpathSync(grantRoot) !== grantRoot) {
      fail('protected_grant_root_unsafe');
    }
    rootStatus = lstatSync(grantRoot);
    if (
      !rootStatus.isDirectory()
      || rootStatus.isSymbolicLink()
      || !ownedByService(rootStatus)
      || (rootStatus.mode & 0o777) !== 0o700
    ) {
      fail('protected_grant_root_unsafe');
    }
    let ancestor = dirname(grantRoot);
    while (ancestor !== parse(ancestor).root) {
      const ancestorStatus = lstatSync(ancestor);
      if (
        ancestorStatus.isSymbolicLink()
        || !ancestorStatus.isDirectory()
        || !ownedByTrustedPrincipal(ancestorStatus)
        || (ancestorStatus.mode & 0o022) !== 0
      ) {
        fail('protected_grant_root_unsafe');
      }
      ancestor = dirname(ancestor);
    }
  } catch (error) {
    if (error instanceof ProtectedGrantAuthorityError) throw error;
    fail('protected_grant_root_unsafe');
  }
  return Object.freeze({
    path: grantRoot,
    dev: rootStatus.dev,
    ino: rootStatus.ino,
  });
}

function readGrantFile(grantPath, {
  expectedCellId,
  expectedGrantId,
} = {}) {
  let descriptor;
  let bytes;
  try {
    const pathStatus = lstatSync(grantPath);
    if (
      !pathStatus.isFile()
      || pathStatus.isSymbolicLink()
      || pathStatus.nlink !== 1
      || !ownedByService(pathStatus)
      || ![0o400, 0o600].includes(pathStatus.mode & 0o777)
      || pathStatus.size < 2
      || pathStatus.size > MAXIMUM_GRANT_BYTES
    ) {
      fail('protected_grant_file_unsafe');
    }
    descriptor = openSync(
      grantPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const openedStatus = fstatSync(descriptor);
    if (
      !openedStatus.isFile()
      || openedStatus.nlink !== 1
      || openedStatus.dev !== pathStatus.dev
      || openedStatus.ino !== pathStatus.ino
      || !ownedByService(openedStatus)
      || ![0o400, 0o600].includes(openedStatus.mode & 0o777)
      || openedStatus.size < 2
      || openedStatus.size > MAXIMUM_GRANT_BYTES
    ) {
      fail('protected_grant_file_unsafe');
    }
    bytes = readFileSync(descriptor);
    const completedStatus = fstatSync(descriptor);
    if (
      completedStatus.dev !== openedStatus.dev
      || completedStatus.ino !== openedStatus.ino
      || completedStatus.size !== openedStatus.size
      || bytes.length !== openedStatus.size
    ) {
      fail('protected_grant_file_unsafe');
    }
    let grant;
    try {
      grant = JSON.parse(bytes.toString('utf8'));
    } catch {
      fail('protected_grant_file_invalid');
    }
    if (
      !grant
      || typeof grant !== 'object'
      || Array.isArray(grant)
    ) {
      fail('protected_grant_file_invalid');
    }
    if (
      grant.grant_id !== expectedGrantId
      || grant.cell_id !== expectedCellId
    ) {
      fail('protected_grant_binding_invalid');
    }
    return deepFreeze(structuredClone(grant));
  } catch (error) {
    if (error instanceof ProtectedGrantAuthorityError) throw error;
    fail('protected_grant_file_invalid');
  } finally {
    bytes?.fill(0);
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function createProtectedGrantFileAuthority({
  grantRoot,
} = {}) {
  const trustedRoot = validateRoot(grantRoot);
  return Object.freeze({
    owner_service: 'brain.kernel_equivalence.grants',
    capability_id:
      'brain.kernel_equivalence.protected_grant_reader.v1',
    async resolveProtectedGrant(request = {}) {
      if (
        !exactFields(request, REQUEST_FIELDS)
        || !CELL_ID.test(request.cellId ?? '')
      ) {
        fail('protected_grant_request_invalid');
      }
      const match = String(request.grantRef ?? '').match(GRANT_REF);
      if (!match) fail('protected_grant_request_invalid');
      const currentRoot = validateRoot(trustedRoot.path);
      if (
        currentRoot.dev !== trustedRoot.dev
        || currentRoot.ino !== trustedRoot.ino
      ) {
        fail('protected_grant_root_unsafe');
      }
      const grantPath = join(trustedRoot.path, `${match[1]}.json`);
      if (
        resolve(grantPath) !== grantPath
        || !grantPath.startsWith(`${trustedRoot.path}/`)
      ) {
        fail('protected_grant_request_invalid');
      }
      const grant = readGrantFile(grantPath, {
        expectedCellId: request.cellId,
        expectedGrantId: match[1],
      });
      return Object.freeze({
        cell_id: request.cellId,
        grant_ref: request.grantRef,
        grant,
      });
    },
  });
}
