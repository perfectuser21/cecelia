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
import {
  assertPathAclFree,
} from './kernel-equivalence-protected-filesystem.js';
import {
  sha256Canonical,
} from './kernel-equivalence-receipts.js';

const GRANT_REF =
  /^kernel-equivalence-grant:([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
const CASE_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CELL_ID =
  /^KERNEL-P[01]-[0-9]{2}-[A-Z0-9-]+::(?:claude|codex|grok)::(?:normal|violation|recovery)$/;
const REQUEST_FIELDS = Object.freeze(['cellId', 'grantRef']);
const REVOKE_FIELDS = Object.freeze(['grant_ref']);
const SIGNED_GRANT_FIELDS = Object.freeze([
  'adapter_id',
  'artifact_sha',
  'attempt_id',
  'behavior_id',
  'brain_version',
  'cell_id',
  'engine_version',
  'environment',
  'expires_at',
  'grant_id',
  'issued_at',
  'key_id',
  'nonce',
  'provider',
  'resource_id',
  'resource_prefix',
  'resource_ref',
  'run_id',
  'scenario',
  'schema_version',
  'scopes',
  'seam_id',
  'signature',
]);
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

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function canonicalGrantSha256(grant) {
  if (!exactFields(grant, SIGNED_GRANT_FIELDS)) {
    fail('protected_grant_invalid');
  }
  return sha256Canonical(grant);
}

function assertGrantExecutionAuthority(value) {
  if (
    typeof value?.registerPendingGrant !== 'function'
    || typeof value?.markGrantPublished !== 'function'
    || typeof value?.resolveActiveGrant !== 'function'
  ) {
    fail('protected_grant_configuration_invalid');
  }
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
    assertPathAclFree(
      grantRoot,
      () => fail('protected_grant_root_unsafe'),
    );
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
      assertPathAclFree(
        ancestor,
        () => fail('protected_grant_root_unsafe'),
        { allowSystemRootless: true },
      );
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

function grantFileStatusMatches(pathStatus, openedStatus, identity) {
  return (
    pathStatus.isFile()
    && !pathStatus.isSymbolicLink()
    && pathStatus.nlink === 1
    && openedStatus.isFile()
    && openedStatus.nlink === 1
    && pathStatus.dev === identity.dev
    && pathStatus.ino === identity.ino
    && pathStatus.size === identity.size
    && pathStatus.ctimeMs === identity.ctimeMs
    && openedStatus.dev === identity.dev
    && openedStatus.ino === identity.ino
    && openedStatus.size === identity.size
    && openedStatus.ctimeMs === identity.ctimeMs
    && ownedByService(pathStatus)
    && ownedByService(openedStatus)
    && [0o400, 0o600].includes(pathStatus.mode & 0o777)
    && [0o400, 0o600].includes(openedStatus.mode & 0o777)
  );
}

function assertOpenGrantFileUnchanged(grantPath, descriptor, identity) {
  try {
    assertPathAclFree(
      grantPath,
      () => fail('protected_grant_file_unsafe'),
    );
    const pathStatus = lstatSync(grantPath);
    const openedStatus = fstatSync(descriptor);
    if (!grantFileStatusMatches(pathStatus, openedStatus, identity)) {
      fail('protected_grant_file_unsafe');
    }
  } catch (error) {
    if (error instanceof ProtectedGrantAuthorityError) throw error;
    fail('protected_grant_file_unsafe');
  }
}

function closeBestEffort(descriptor) {
  if (descriptor === undefined) return;
  try {
    closeSync(descriptor);
  } catch {
    // Cleanup and fail-closed error mapping take precedence.
  }
}

function readGrantFile(grantPath, {
  expectedCellId,
  expectedGrantId,
  keepOpen = false,
  now,
} = {}) {
  let descriptor;
  let bytes;
  let retainDescriptor = false;
  try {
    assertPathAclFree(
      grantPath,
      () => fail('protected_grant_file_unsafe'),
    );
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
      || completedStatus.nlink !== 1
      || completedStatus.size !== openedStatus.size
      || completedStatus.ctimeMs !== openedStatus.ctimeMs
      || bytes.length !== openedStatus.size
    ) {
      fail('protected_grant_file_unsafe');
    }
    const identity = Object.freeze({
      dev: openedStatus.dev,
      ino: openedStatus.ino,
      size: openedStatus.size,
      ctimeMs: openedStatus.ctimeMs,
    });
    assertOpenGrantFileUnchanged(grantPath, descriptor, identity);
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
      || !exactFields(grant, SIGNED_GRANT_FIELDS)
      || grant.schema_version
        !== 'kernel-equivalence-execution-grant/v1'
      || typeof grant.signature !== 'string'
      || grant.signature.length === 0
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
    const frozenGrant = deepFreeze(structuredClone(grant));
    const grantSha256 = canonicalGrantSha256(frozenGrant);
    retainDescriptor = keepOpen;
    return Object.freeze({
      grant: frozenGrant,
      grant_sha256: grantSha256,
      descriptor: keepOpen ? descriptor : undefined,
      identity,
    });
  } catch (error) {
    if (error instanceof ProtectedGrantAuthorityError) throw error;
    fail('protected_grant_file_invalid');
  } finally {
    bytes?.fill(0);
    if (!retainDescriptor) closeBestEffort(descriptor);
  }
}

export function createProtectedGrantFileAuthority({
  grantRoot,
  grantExecutionAuthority,
  now = Date.now,
} = {}) {
  if (typeof now !== 'function') {
    fail('protected_grant_configuration_invalid');
  }
  assertGrantExecutionAuthority(grantExecutionAuthority);
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
      const transport = readGrantFile(grantPath, {
        expectedCellId: request.cellId,
        expectedGrantId: match[1],
        keepOpen: true,
        now,
      });
      try {
        let durable;
        try {
          durable = await grantExecutionAuthority.resolveActiveGrant({
            grant_id: match[1],
            grant_sha256: transport.grant_sha256,
            cell_id: request.cellId,
          });
        } catch {
          fail('protected_grant_authority_denied');
        }
        assertOpenGrantFileUnchanged(
          grantPath,
          transport.descriptor,
          transport.identity,
        );
        let durableGrantSha256;
        let durableExpiry;
        let transportExpiry;
        try {
          durableGrantSha256 = canonicalGrantSha256(durable?.grant);
          durableExpiry = Date.parse(durable?.expires_at);
          transportExpiry = Date.parse(transport.grant.expires_at);
        } catch {
          fail('protected_grant_authority_mismatch');
        }
        if (
          durable?.active !== true
          || durable.grant_id !== match[1]
          || durable.grant_ref !== request.grantRef
          || durable.grant_sha256 !== transport.grant_sha256
          || durable.cell_id !== request.cellId
          || !Number.isFinite(durableExpiry)
          || !Number.isFinite(transportExpiry)
          || durableExpiry !== transportExpiry
          || durableGrantSha256 !== transport.grant_sha256
        ) {
          fail('protected_grant_authority_mismatch');
        }
        return Object.freeze({
          cell_id: request.cellId,
          grant_ref: request.grantRef,
          grant_sha256: transport.grant_sha256,
          grant: transport.grant,
        });
      } finally {
        closeBestEffort(transport.descriptor);
      }
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
  if (!identity) return false;
  try {
    const current = lstatSync(path);
    if (
      current.isFile()
      && !current.isSymbolicLink()
      && current.dev === identity.dev
      && current.ino === identity.ino
    ) {
      unlinkSync(path);
      return true;
    }
  } catch {
    // A missing or replaced temporary file must never broaden cleanup.
  }
  return false;
}

export function createProtectedGrantFileIssuer({
  grantRoot,
  executionGrantAuthority,
  grantExecutionAuthority,
  maximumTtlSeconds = null,
  now = Date.now,
} = {}) {
  if (
    typeof now !== 'function'
    || (
      maximumTtlSeconds != null
      && (
        !Number.isInteger(maximumTtlSeconds)
        || maximumTtlSeconds < 1
      )
    )
  ) {
    fail('protected_grant_configuration_invalid');
  }
  assertGrantAuthority(executionGrantAuthority);
  assertGrantExecutionAuthority(grantExecutionAuthority);
  const trustedRoot = validateRoot(grantRoot);

  return Object.freeze({
    owner_service: 'brain.kernel_equivalence.grant_issuer',
    capability_id:
      'brain.kernel_equivalence.protected_grant_issuer.v1',
    async issueProtectedGrant(input = {}) {
      assertRootUnchanged(trustedRoot);
      const caseDescriptor = Object.getOwnPropertyDescriptor(
        input,
        'case_id',
      );
      if (
        !caseDescriptor
        || !Object.hasOwn(caseDescriptor, 'value')
        || !CASE_ID.test(caseDescriptor.value ?? '')
      ) {
        fail('protected_grant_case_id_invalid');
      }
      const ttlDescriptor = Object.getOwnPropertyDescriptor(
        input,
        'ttl_seconds',
      );
      if (
        maximumTtlSeconds != null
        && (
          !ttlDescriptor
          || !Object.hasOwn(ttlDescriptor, 'value')
          || !Number.isInteger(ttlDescriptor.value)
          || ttlDescriptor.value > maximumTtlSeconds
        )
      ) {
        fail('protected_grant_ttl_exceeded');
      }
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
      const grantSha256 = canonicalGrantSha256(grant);
      let registration;
      try {
        registration = await grantExecutionAuthority.registerPendingGrant({
          case_id: caseDescriptor.value,
          grant,
          grant_sha256: grantSha256,
        });
      } catch {
        fail('protected_grant_registration_failed');
      }
      let registrationExpiry;
      let grantExpiry;
      try {
        registrationExpiry = Date.parse(registration?.expires_at);
        grantExpiry = Date.parse(grant.expires_at);
      } catch {
        fail('protected_grant_registration_failed');
      }
      if (
        registration?.grant_id !== grantId
        || registration.grant_ref
          !== `kernel-equivalence-grant:${grantId}`
        || registration.grant_sha256 !== grantSha256
        || registration.cell_id !== grant.cell_id
        || !Number.isFinite(registrationExpiry)
        || !Number.isFinite(grantExpiry)
        || registrationExpiry !== grantExpiry
      ) {
        fail('protected_grant_registration_failed');
      }
      const finalPath = join(trustedRoot.path, `${grantId}.json`);
      const temporaryPath = join(
        trustedRoot.path,
        `.${grantId}.${randomUUID()}.tmp`,
      );
      let descriptor;
      let markAttempted = false;
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
        const verified = readGrantFile(finalPath, {
          expectedCellId: grant.cell_id,
          expectedGrantId: grantId,
          now,
        });
        if (verified.grant_sha256 !== grantSha256) {
          fail('protected_grant_file_invalid');
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
        markAttempted = true;
        let publication;
        try {
          publication = await grantExecutionAuthority.markGrantPublished({
            grant_id: grantId,
            grant_sha256: grantSha256,
          });
        } catch {
          fail('protected_grant_publication_uncertain');
        }
        if (
          publication?.grant_id !== grantId
          || publication.state !== 'published'
        ) {
          fail('protected_grant_publication_uncertain');
        }
        return Object.freeze({
          grant_ref: `kernel-equivalence-grant:${grantId}`,
          grant_id: grantId,
          grant_sha256: grantSha256,
          expires_at: grant.expires_at,
        });
      } catch (error) {
        closeBestEffort(descriptor);
        removeExactFile(temporaryPath, temporaryIdentity);
        // Node cannot atomically unlink a pathname by an already-verified
        // inode. Retain any published, DB-unusable orphan for maintenance
        // rather than risk deleting a replacement inode.
        if (markAttempted) {
          fail('protected_grant_publication_uncertain');
        }
        if (error instanceof ProtectedGrantAuthorityError) throw error;
        fail('protected_grant_publish_failed');
      } finally {
        encoded.fill(0);
      }
    },
    async revokeProtectedGrant(request = {}) {
      if (!exactFields(request, REVOKE_FIELDS)) {
        fail('protected_grant_revoke_request_invalid');
      }
      const match = String(request.grant_ref ?? '').match(GRANT_REF);
      if (!match) fail('protected_grant_revoke_request_invalid');
      assertRootUnchanged(trustedRoot);
      const grantPath = join(trustedRoot.path, `${match[1]}.json`);
      let descriptor;
      let bytes;
      try {
        assertPathAclFree(
          grantPath,
          () => fail('protected_grant_revoke_failed'),
        );
        const pathStatus = lstatSync(grantPath);
        if (
          !pathStatus.isFile()
          || pathStatus.isSymbolicLink()
          || pathStatus.nlink !== 1
          || !ownedByService(pathStatus)
          || (pathStatus.mode & 0o777) !== 0o600
          || pathStatus.size < 2
          || pathStatus.size > MAXIMUM_GRANT_BYTES
        ) {
          fail('protected_grant_revoke_failed');
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
          fail('protected_grant_revoke_failed');
        }
        bytes = readFileSync(descriptor);
        let grant;
        try {
          grant = JSON.parse(bytes.toString('utf8'));
        } catch {
          fail('protected_grant_revoke_failed');
        }
        const completed = fstatSync(descriptor);
        if (
          completed.dev !== opened.dev
          || completed.ino !== opened.ino
          || completed.size !== opened.size
          || completed.ctimeMs !== opened.ctimeMs
          || bytes.length !== opened.size
          || grant?.schema_version
            !== 'kernel-equivalence-execution-grant/v1'
          || grant?.grant_id !== match[1]
        ) {
          fail('protected_grant_revoke_failed');
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
          fail('protected_grant_revoke_failed');
        }
        return Object.freeze({
          grant_ref: request.grant_ref,
          transport_removed: false,
        });
      } catch (error) {
        if (error instanceof ProtectedGrantAuthorityError) throw error;
        fail('protected_grant_revoke_failed');
      } finally {
        bytes?.fill(0);
        if (descriptor !== undefined) {
          try {
            closeSync(descriptor);
          } catch {
            // Revocation remains fail-closed if the descriptor changed state.
          }
        }
      }
    },
    async cleanupExpiredGrants() {
      assertRootUnchanged(trustedRoot);
      const operationNow = now();
      if (!Number.isFinite(operationNow)) {
        fail('protected_grant_configuration_invalid');
      }
      const removed = 0;
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
            || grant?.schema_version
              !== 'kernel-equivalence-execution-grant/v1'
            || grant?.grant_id !== entry.name.slice(0, -'.json'.length)
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
          retained += 1;
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
      return Object.freeze({ removed, retained });
    },
  });
}
