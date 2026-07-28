import {
  chmodSync,
  lstatSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute } from 'node:path';
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
  const stat = lstatSync(file);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || (stat.mode & 0o777) !== 0o600
    || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
  ) {
    throw new Error('bootstrap_private_config_permissions_invalid');
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
  validatePrivateFile(file);
  let value;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error('bootstrap_private_config_invalid');
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

function escapePgPass(value) {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
}

function writePrivate(file, content) {
  if (!isAbsolute(file ?? '')) {
    throw new Error('bootstrap_pg_reference_invalid');
  }
  writeFileSync(file, content, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(file, 0o600);
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
    unlinkSync(serviceFile);
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
    } else {
      throw new Error('bootstrap_private_config_action_invalid');
    }
  } catch {
    process.exitCode = 1;
  }
}

export const __test__ = { parseDatabaseUrl, SERVICE_NAME };
