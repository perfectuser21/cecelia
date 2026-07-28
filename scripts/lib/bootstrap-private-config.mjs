import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const SERVICE_NAME = 'kernel_release_bootstrap';
const SSL_MODES = new Set([
  'disable',
  'allow',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
]);

function validatePrivateFile(file) {
  if (!isAbsolute(file ?? '')) {
    throw new Error('bootstrap_private_config_reference_invalid');
  }
  const parent = dirname(file);
  const parentStat = lstatSync(parent);
  const stat = lstatSync(file);
  if (
    !parentStat.isDirectory()
    || parentStat.isSymbolicLink()
    || (parentStat.mode & 0o777) !== 0o700
    || (typeof process.getuid === 'function' && parentStat.uid !== process.getuid())
    || !stat.isFile()
    || stat.isSymbolicLink()
    || (stat.mode & 0o777) !== 0o600
    || stat.nlink !== 1
    || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
  ) {
    throw new Error('bootstrap_private_config_permissions_invalid');
  }
  return { parent, parentStat, stat };
}

function openPrivateFile(file) {
  const before = validatePrivateFile(file);
  let descriptor;
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    const parentAfter = lstatSync(before.parent);
    if (
      !opened.isFile()
      || opened.nlink !== 1
      || opened.dev !== before.stat.dev
      || opened.ino !== before.stat.ino
      || parentAfter.dev !== before.parentStat.dev
      || parentAfter.ino !== before.parentStat.ino
    ) {
      throw new Error('bootstrap_private_config_permissions_invalid');
    }
    return descriptor;
  } catch (error) {
    if (descriptor != null) closeSync(descriptor);
    if (error?.message === 'bootstrap_private_config_permissions_invalid') throw error;
    throw new Error('bootstrap_private_config_permissions_invalid', { cause: error });
  }
}

function decodeUrlComponent(value, code) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(code);
  }
}

function parseDatabaseUrl(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('bootstrap_database_url_invalid');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol)
    || !url.hostname
    || !url.username
    || !url.pathname
    || url.pathname === '/'
  ) {
    throw new Error('bootstrap_database_url_invalid');
  }
  for (const key of url.searchParams.keys()) {
    if (key !== 'sslmode') throw new Error('bootstrap_database_option_invalid');
  }
  const port = url.port || '5432';
  const sslmode = url.searchParams.get('sslmode') || 'prefer';
  const values = {
    host: url.hostname,
    port,
    database: decodeUrlComponent(url.pathname.slice(1), 'bootstrap_database_url_invalid'),
    user: decodeUrlComponent(url.username, 'bootstrap_database_url_invalid'),
    password: decodeUrlComponent(url.password, 'bootstrap_database_url_invalid'),
    sslmode,
  };
  if (
    !/^[A-Za-z0-9_.-]+$/.test(values.host)
    || !/^[1-9][0-9]{0,4}$/.test(values.port)
    || Number(values.port) > 65535
    || !/^[A-Za-z0-9_.-]+$/.test(values.database)
    || !/^[A-Za-z0-9_.-]+$/.test(values.user)
    || !SSL_MODES.has(values.sslmode)
  ) {
    throw new Error('bootstrap_database_url_invalid');
  }
  return values;
}

export function readBootstrapPrivateConfig(file) {
  const descriptor = openPrivateFile(file);
  let value;
  try {
    value = JSON.parse(readFileSync(descriptor, 'utf8'));
  } catch {
    throw new Error('bootstrap_private_config_invalid');
  } finally {
    closeSync(descriptor);
  }
  if (
    !value
    || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'approval_signature,database_url'
    || typeof value.database_url !== 'string'
    || typeof value.approval_signature !== 'string'
    || value.approval_signature.length === 0
  ) {
    throw new Error('bootstrap_private_config_invalid');
  }
  parseDatabaseUrl(value.database_url);
  return value;
}

export function cleanupStaleBootstrapPgDirectories({
  temporaryRoot,
  now = () => new Date(),
  staleAfterMs = 2 * 60 * 60_000,
} = {}) {
  if (
    !isAbsolute(temporaryRoot ?? '')
    || !Number.isFinite(staleAfterMs)
    || staleAfterMs <= 0
  ) {
    throw new Error('bootstrap_pg_reaper_request_invalid');
  }
  let removed = 0;
  let entries = [];
  try {
    entries = readdirSync(temporaryRoot);
  } catch {
    return { removed };
  }
  const uid = process.getuid?.();
  const allowedNames = new Set(['pg_service.conf', 'pgpass']);
  const nowMs = now().getTime();
  for (const entry of entries) {
    if (!entry.startsWith('kernel-bootstrap-pg.')) continue;
    const directory = join(temporaryRoot, entry);
    try {
      const directoryStat = lstatSync(directory);
      if (
        !directoryStat.isDirectory()
        || directoryStat.isSymbolicLink()
        || (directoryStat.mode & 0o777) !== 0o700
        || (uid != null && directoryStat.uid !== uid)
        || nowMs - directoryStat.mtimeMs < staleAfterMs
      ) continue;
      const children = readdirSync(directory);
      let safe = true;
      for (const child of children) {
        if (!allowedNames.has(child)) {
          safe = false;
          break;
        }
        const stat = lstatSync(join(directory, child));
        if (
          !stat.isFile()
          || stat.isSymbolicLink()
          || (stat.mode & 0o777) !== 0o600
          || stat.nlink !== 1
          || (uid != null && stat.uid !== uid)
          || nowMs - stat.mtimeMs < staleAfterMs
        ) {
          safe = false;
          break;
        }
      }
      if (!safe) continue;
      rmSync(directory, { recursive: true });
      removed += 1;
    } catch {
      // Ignore malformed or concurrently changed paths.
    }
  }
  return { removed };
}

function escapePgPass(value) {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
}

function writePrivate(file, content) {
  if (!isAbsolute(file ?? '')) {
    throw new Error('bootstrap_pg_reference_invalid');
  }
  try {
    writeFileSync(file, content, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    chmodSync(file, 0o600);
  } catch (error) {
    try {
      unlinkSync(file);
    } catch {
      // The file may not have been created.
    }
    throw error;
  }
}

export function writeBootstrapPgFiles(
  privateConfigFile,
  { serviceFile, passFile },
) {
  const config = readBootstrapPrivateConfig(privateConfigFile);
  const database = parseDatabaseUrl(config.database_url);
  writePrivate(serviceFile, [
    `[${SERVICE_NAME}]`,
    `host=${database.host}`,
    `port=${database.port}`,
    `dbname=${database.database}`,
    `user=${database.user}`,
    `sslmode=${database.sslmode}`,
    '',
  ].join('\n'));
  try {
    writePrivate(passFile, [
      database.host,
      database.port,
      database.database,
      database.user,
      database.password,
    ].map(escapePgPass).join(':') + '\n');
  } catch (error) {
    try {
      unlinkSync(passFile);
    } catch {
      // writePrivate already removes partial files.
    }
    try {
      unlinkSync(serviceFile);
    } catch {
      // Preserve the original private-file error.
    }
    throw error;
  }
  return { serviceFile, passFile, service: SERVICE_NAME };
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [action, privateConfigFile, serviceFile, passFile] =
      process.argv.slice(2);
    if (action === 'validate') {
      readBootstrapPrivateConfig(privateConfigFile);
    } else if (action === 'write-pg-files') {
      writeBootstrapPgFiles(privateConfigFile, { serviceFile, passFile });
    } else if (action === 'cleanup-stale-pg') {
      cleanupStaleBootstrapPgDirectories({ temporaryRoot: privateConfigFile });
    } else {
      throw new Error('bootstrap_private_config_action_invalid');
    }
  } catch {
    process.exitCode = 1;
  }
}

export const __test__ = { parseDatabaseUrl, SERVICE_NAME };
