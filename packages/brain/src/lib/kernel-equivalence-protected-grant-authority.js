import {
  closeSync,
  constants,
  fsyncSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  dirname,
  isAbsolute,
  join,
  parse,
  resolve,
} from 'node:path';
import { execFileSync } from 'node:child_process';

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
    typeof process.geteuid === 'function'
    && status.uid === process.geteuid()
  );
}

function ownedByTrustedPrincipal(status) {
  return (
    typeof process.geteuid === 'function'
    && (status.uid === 0 || status.uid === process.geteuid())
  );
}

function assertAclFree(path, code) {
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
      fail(code);
    }
  } catch (error) {
    if (error instanceof ProtectedGrantAuthorityError) throw error;
    fail(code);
  }
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
    assertAclFree(grantRoot, 'protected_grant_root_unsafe');
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
      assertAclFree(ancestor, 'protected_grant_root_unsafe');
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
  now,
} = {}) {
  let descriptor;
  let bytes;
  try {
    assertAclFree(grantPath, 'protected_grant_file_unsafe');
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
      || completedStatus.ctimeMs !== openedStatus.ctimeMs
      || bytes.length !== openedStatus.size
    ) {
      fail('protected_grant_file_unsafe');
    }
    assertAclFree(grantPath, 'protected_grant_file_unsafe');
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
    if (
      grant.expires_at != null
      && (
        !Number.isFinite(Date.parse(grant.expires_at))
        || now() >= Date.parse(grant.expires_at)
      )
    ) {
      fail('protected_grant_expired');
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
  now = Date.now,
} = {}) {
  if (typeof now !== 'function') {
    fail('protected_grant_configuration_invalid');
  }
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
        now,
      });
      return Object.freeze({
        cell_id: request.cellId,
        grant_ref: request.grantRef,
        grant,
      });
    },
  });
}

function assertGrantAuthority(value) {
  if (
    !Object.isFrozen(value)
    || typeof value?.issue !== 'function'
    || typeof value?.key_id !== 'string'
    || value.purpose !== 'execution_grant'
    || value.service_id !== 'brain.authority'
  ) {
    fail('protected_grant_issuer_authority_invalid');
  }
}

function assertRootUnchanged(trustedRoot) {
  const current = validateRoot(trustedRoot.path);
  if (
    current.dev !== trustedRoot.dev
    || current.ino !== trustedRoot.ino
  ) {
    fail('protected_grant_root_unsafe');
  }
}

function removeExactFile(path, identity) {
  if (!identity) return;
  try {
    const current = lstatSync(path);
    if (
      current.isFile()
      && !current.isSymbolicLink()
      && current.dev === identity.dev
      && current.ino === identity.ino
    ) {
      unlinkSync(path);
    }
  } catch {
    // A missing or replaced temporary file must never broaden cleanup.
  }
}

export function createProtectedGrantFileIssuer({
  grantRoot,
  executionGrantAuthority,
  now = Date.now,
} = {}) {
  if (typeof now !== 'function') {
    fail('protected_grant_configuration_invalid');
  }
  assertGrantAuthority(executionGrantAuthority);
  const trustedRoot = validateRoot(grantRoot);

  return Object.freeze({
    owner_service: 'brain.kernel_equivalence.grant_issuer',
    capability_id:
      'brain.kernel_equivalence.protected_grant_issuer.v1',
    async issueProtectedGrant(input = {}) {
      assertRootUnchanged(trustedRoot);
      const grant = executionGrantAuthority.issue(input);
      const grantId = grant?.grant_id;
      if (
        typeof grantId !== 'string'
        || !GRANT_REF.test(`kernel-equivalence-grant:${grantId}`)
        || !Number.isFinite(Date.parse(grant?.expires_at))
        || Date.parse(grant.expires_at) <= now()
      ) {
        fail('protected_grant_issue_invalid');
      }
      const finalPath = join(trustedRoot.path, `${grantId}.json`);
      const temporaryPath = join(
        trustedRoot.path,
        `.${grantId}.${randomUUID()}.tmp`,
      );
      let descriptor;
      let temporaryIdentity;
      const encoded = Buffer.from(`${JSON.stringify(grant)}\n`, 'utf8');
      try {
        if (
          encoded.length < 2
          || encoded.length > MAXIMUM_GRANT_BYTES
        ) {
          fail('protected_grant_issue_invalid');
        }
        try {
          lstatSync(finalPath);
          fail('protected_grant_already_exists');
        } catch (error) {
          if (error instanceof ProtectedGrantAuthorityError) throw error;
          if (error?.code !== 'ENOENT') {
            fail('protected_grant_file_unsafe');
          }
        }
        descriptor = openSync(
          temporaryPath,
          constants.O_WRONLY
            | constants.O_CREAT
            | constants.O_EXCL
            | (constants.O_NOFOLLOW ?? 0),
          0o600,
        );
        const opened = fstatSync(descriptor);
        temporaryIdentity = {
          dev: opened.dev,
          ino: opened.ino,
        };
        if (
          !opened.isFile()
          || opened.nlink !== 1
          || !ownedByService(opened)
          || (opened.mode & 0o777) !== 0o600
        ) {
          fail('protected_grant_file_unsafe');
        }
        writeFileSync(descriptor, encoded);
        fsyncSync(descriptor);
        const completed = fstatSync(descriptor);
        if (
          completed.dev !== opened.dev
          || completed.ino !== opened.ino
          || completed.size !== encoded.length
          || completed.nlink !== 1
          || (completed.mode & 0o777) !== 0o600
        ) {
          fail('protected_grant_file_unsafe');
        }
        closeSync(descriptor);
        descriptor = undefined;
        assertRootUnchanged(trustedRoot);
        renameSync(temporaryPath, finalPath);
        temporaryIdentity = null;
        const published = lstatSync(finalPath);
        if (
          !published.isFile()
          || published.isSymbolicLink()
          || published.nlink !== 1
          || !ownedByService(published)
          || (published.mode & 0o777) !== 0o600
          || published.size !== encoded.length
        ) {
          fail('protected_grant_file_unsafe');
        }
        const directoryDescriptor = openSync(
          trustedRoot.path,
          constants.O_RDONLY
            | (constants.O_DIRECTORY ?? 0)
            | (constants.O_NOFOLLOW ?? 0),
        );
        try {
          fsyncSync(directoryDescriptor);
        } finally {
          closeSync(directoryDescriptor);
        }
        return Object.freeze({
          grant_ref: `kernel-equivalence-grant:${grantId}`,
          expires_at: grant.expires_at,
        });
      } catch (error) {
        if (descriptor !== undefined) closeSync(descriptor);
        removeExactFile(temporaryPath, temporaryIdentity);
        if (error instanceof ProtectedGrantAuthorityError) throw error;
        fail('protected_grant_publish_failed');
      } finally {
        encoded.fill(0);
      }
    },
    async cleanupExpiredGrants() {
      assertRootUnchanged(trustedRoot);
      const operationNow = now();
      if (!Number.isFinite(operationNow)) {
        fail('protected_grant_configuration_invalid');
      }
      let removed = 0;
      let retained = 0;
      let entries;
      try {
        entries = readdirSync(trustedRoot.path, {
          withFileTypes: true,
        });
      } catch {
        fail('protected_grant_root_unsafe');
      }
      for (const entry of entries) {
        if (
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.json$/
            .test(entry.name)
        ) {
          continue;
        }
        const grantPath = join(trustedRoot.path, entry.name);
        let descriptor;
        try {
          const pathStatus = lstatSync(grantPath);
          if (
            !entry.isFile()
            || entry.isSymbolicLink()
            || !pathStatus.isFile()
            || pathStatus.isSymbolicLink()
            || pathStatus.nlink !== 1
            || !ownedByService(pathStatus)
            || (pathStatus.mode & 0o777) !== 0o600
            || pathStatus.size < 2
            || pathStatus.size > MAXIMUM_GRANT_BYTES
          ) {
            retained += 1;
            continue;
          }
          descriptor = openSync(
            grantPath,
            constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
          );
          const opened = fstatSync(descriptor);
          if (
            !opened.isFile()
            || opened.nlink !== 1
            || opened.dev !== pathStatus.dev
            || opened.ino !== pathStatus.ino
            || !ownedByService(opened)
            || (opened.mode & 0o777) !== 0o600
            || opened.size !== pathStatus.size
          ) {
            retained += 1;
            continue;
          }
          const bytes = readFileSync(descriptor);
          let grant;
          try {
            grant = JSON.parse(bytes.toString('utf8'));
          } finally {
            bytes.fill(0);
          }
          const completed = fstatSync(descriptor);
          const expiresAt = Date.parse(grant?.expires_at);
          if (
            completed.dev !== opened.dev
            || completed.ino !== opened.ino
            || completed.size !== opened.size
            || completed.ctimeMs !== opened.ctimeMs
            || !Number.isFinite(expiresAt)
            || expiresAt > operationNow
          ) {
            retained += 1;
            continue;
          }
          closeSync(descriptor);
          descriptor = undefined;
          assertRootUnchanged(trustedRoot);
          const current = lstatSync(grantPath);
          if (
            !current.isFile()
            || current.isSymbolicLink()
            || current.nlink !== 1
            || current.dev !== opened.dev
            || current.ino !== opened.ino
            || current.size !== opened.size
            || current.ctimeMs !== opened.ctimeMs
          ) {
            retained += 1;
            continue;
          }
          unlinkSync(grantPath);
          removed += 1;
        } catch {
          retained += 1;
        } finally {
          if (descriptor !== undefined) {
            try {
              closeSync(descriptor);
            } catch {
              // Retain unsafe entries; cleanup must never broaden.
            }
          }
        }
      }
      if (removed > 0) {
        const directoryDescriptor = openSync(
          trustedRoot.path,
          constants.O_RDONLY
            | (constants.O_DIRECTORY ?? 0)
            | (constants.O_NOFOLLOW ?? 0),
        );
        try {
          fsyncSync(directoryDescriptor);
        } finally {
          closeSync(directoryDescriptor);
        }
      }
      return Object.freeze({ removed, retained });
    },
  });
}
