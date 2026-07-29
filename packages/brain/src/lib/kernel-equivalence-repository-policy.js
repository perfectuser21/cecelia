import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
} from 'node:fs';
import {
  basename,
  extname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { load as loadYaml } from 'js-yaml';

const MAX_TRAVERSAL_ENTRIES = 20_000;
const MAX_TRAVERSAL_DEPTH = 32;
const MAX_YAML_BYTES = 1_000_000;
const MAX_SQL_BYTES = 4_000_000;
const MAX_SQL_TOKENS = 250_000;
const MIGRATION_ROOTS = Object.freeze([
  'packages/brain/migrations',
  'packages/brain/src/db/migrations',
  'packages/brain/src/migrations',
]);

function repositoryIsDirectory(repositoryRoot) {
  try {
    return lstatSync(repositoryRoot).isDirectory();
  } catch {
    return false;
  }
}

function relativePath(repositoryRoot, path) {
  return relative(repositoryRoot, path).split(sep).join('/');
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

function walkFiles(repositoryRoot, relativeRoot, {
  include,
  recursive = true,
  skipNodeModules = false,
  missingIsError = false,
} = {}) {
  const absoluteRoot = join(repositoryRoot, relativeRoot);
  const files = [];
  const rejectedSymlinks = [];
  let visited = 0;
  let error = null;

  function walk(directory, depth) {
    if (error !== null) return;
    if (depth > MAX_TRAVERSAL_DEPTH) {
      error = 'traversal_limit_exceeded';
      return;
    }

    let directoryHandle;
    try {
      directoryHandle = opendirSync(directory);
    } catch {
      error = 'unreadable_or_invalid';
      return;
    }

    try {
      let entry;
      while (error === null && (entry = directoryHandle.readSync()) !== null) {
        if (
          skipNodeModules
          && entry.name === 'node_modules'
          && (entry.isDirectory() || entry.isSymbolicLink())
        ) {
          continue;
        }

        visited += 1;
        if (visited > MAX_TRAVERSAL_ENTRIES) {
          error = 'traversal_limit_exceeded';
          break;
        }

        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          rejectedSymlinks.push(path);
        } else if (entry.isDirectory()) {
          if (recursive) {
            walk(path, depth + 1);
          }
        } else if (entry.isFile() && include(path)) {
          files.push(path);
        }
      }
    } catch {
      if (error === null) {
        error = 'unreadable_or_invalid';
      }
    } finally {
      try {
        directoryHandle.closeSync();
      } catch {
        if (error === null) {
          error = 'unreadable_or_invalid';
        }
      }
    }
  }

  try {
    const status = lstatSync(absoluteRoot);
    if (!status.isDirectory()) error = 'unreadable_or_invalid';
  } catch {
    if (missingIsError) error = 'unreadable_or_invalid';
    return { error, files: [], rejectedSymlinks: [] };
  }

  walk(absoluteRoot, 0);
  return {
    error,
    files: error === null ? files.sort(compareText) : [],
    rejectedSymlinks: (
      error === null ? rejectedSymlinks.sort(compareText) : []
    ),
  };
}

function isContractYamlPath(path) {
  const extension = extname(path).toLowerCase();
  return (
    (extension === '.yaml' || extension === '.yml')
    && basename(path).toLowerCase().includes('regression-contract')
  );
}

function isSqlPath(path) {
  return extname(path) === '.sql';
}

function readBoundedText(path, maxBytes) {
  if (typeof constants.O_NOFOLLOW !== 'number') {
    return { error: 'nofollow_unsupported' };
  }

  let descriptor;
  let result = { error: 'unreadable_or_invalid' };
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const status = fstatSync(descriptor);
    if (!status.isFile()) {
      result = { error: 'unreadable_or_invalid' };
    } else if (status.size > maxBytes) {
      result = { error: 'oversized' };
    } else {
      const bytes = Buffer.allocUnsafe(maxBytes + 1);
      let bytesRead = 0;
      while (bytesRead < bytes.length) {
        const count = readSync(
          descriptor,
          bytes,
          bytesRead,
          bytes.length - bytesRead,
          null,
        );
        if (count === 0) break;
        bytesRead += count;
      }
      result = bytesRead > maxBytes
        ? { error: 'oversized' }
        : { contents: bytes.toString('utf8', 0, bytesRead) };
    }
  } catch {
    result = { error: 'unreadable_or_invalid' };
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        result = { error: 'unreadable_or_invalid' };
      }
    }
  }
  return result;
}

function readYamlDocument(path) {
  const read = readBoundedText(path, MAX_YAML_BYTES);
  if (read.error) return read;

  try {
    const parsed = loadYaml(read.contents);
    return { parsed };
  } catch {
    return { error: 'unreadable_or_invalid' };
  }
}

function hasOwnBehaviorEquivalence(mapping) {
  return (
    mapping !== null
    && typeof mapping === 'object'
    && !Array.isArray(mapping)
    && Object.prototype.hasOwnProperty.call(mapping, 'behavior_equivalence')
  );
}

function dollarQuoteAt(sql, index) {
  if (sql[index] !== '$') return null;
  if (sql[index + 1] === '$') return '$$';
  if (!/[A-Za-z_]/u.test(sql[index + 1] ?? '')) return null;

  let cursor = index + 2;
  while (cursor < sql.length && /[A-Za-z0-9_]/u.test(sql[cursor])) {
    cursor += 1;
  }
  return sql[cursor] === '$' ? sql.slice(index, cursor + 1) : null;
}

function readQuotedIdentifier(sql, quoteIndex) {
  let value = '';
  let index = quoteIndex + 1;
  while (index < sql.length) {
    if (sql[index] === '"' && sql[index + 1] === '"') {
      value += '"';
      index += 2;
    } else if (sql[index] === '"') {
      return { end: index + 1, valid: true, value };
    } else {
      value += sql[index];
      index += 1;
    }
  }
  return { end: index, valid: false, value };
}

function readSqlString(sql, quoteIndex, escapesBackslashes) {
  let value = '';
  let index = quoteIndex + 1;
  let consecutiveBackslashes = 0;
  while (index < sql.length) {
    if (escapesBackslashes && sql[index] === '\\') {
      if (index + 1 >= sql.length) {
        return { end: sql.length, valid: false, value };
      }
      value += sql[index + 1];
      index += 2;
      consecutiveBackslashes = 0;
    } else if (!escapesBackslashes && sql[index] === '\\') {
      value += '\\';
      consecutiveBackslashes += 1;
      index += 1;
    } else if (
      sql[index] === '\''
      && consecutiveBackslashes % 2 === 1
    ) {
      return { end: index + 1, valid: false, value };
    } else if (sql[index] === '\'' && sql[index + 1] === '\'') {
      value += '\'';
      index += 2;
      consecutiveBackslashes = 0;
    } else if (sql[index] === '\'') {
      return { end: index + 1, valid: true, value };
    } else {
      value += sql[index];
      index += 1;
      consecutiveBackslashes = 0;
    }
  }
  return { end: index, valid: false, value };
}

function validUnicodeEscapeCharacter(escapeCharacter) {
  return (
    escapeCharacter.length === 1
    && !/[0-9A-Fa-f+'"\s]/u.test(escapeCharacter)
  );
}

function decodeUnicodeIdentifier(identifier, escapeCharacter = '\\') {
  let decoded = '';
  let index = 0;

  while (index < identifier.length) {
    if (identifier[index] !== escapeCharacter) {
      decoded += identifier[index];
      index += 1;
      continue;
    }
    if (identifier[index + 1] === escapeCharacter) {
      decoded += escapeCharacter;
      index += 2;
      continue;
    }

    const hasLongEscape = identifier[index + 1] === '+';
    const digits = hasLongEscape
      ? identifier.slice(index + 2, index + 8)
      : identifier.slice(index + 1, index + 5);
    const requiredDigits = hasLongEscape ? 6 : 4;
    if (
      digits.length !== requiredDigits
      || !/^[0-9A-Fa-f]+$/u.test(digits)
    ) {
      return null;
    }

    const codePoint = Number.parseInt(digits, 16);
    if (
      codePoint === 0
      || (codePoint >= 0xD800 && codePoint <= 0xDFFF)
      || codePoint > 0x10FFFF
    ) {
      return null;
    }
    try {
      decoded += String.fromCodePoint(codePoint);
    } catch {
      return null;
    }
    index += requiredDigits + (hasLongEscape ? 2 : 1);
  }

  return decoded;
}

function tokenizeSql(sql) {
  const tokens = [];
  let index = 0;

  function push(token) {
    tokens.push(token);
    return tokens.length <= MAX_SQL_TOKENS;
  }

  while (index < sql.length) {
    if (/\s/u.test(sql[index])) {
      index += 1;
      continue;
    }

    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index + 2);
      index = end === -1 ? sql.length : end + 1;
      continue;
    }

    if (sql.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql.startsWith('/*', index)) {
          depth += 1;
          index += 2;
        } else if (sql.startsWith('*/', index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth !== 0) return { invalid: true, tokens: [] };
      continue;
    }

    const dollarQuote = sql[index] === '$' ? dollarQuoteAt(sql, index) : null;
    if (dollarQuote !== null) {
      const close = sql.indexOf(dollarQuote, index + dollarQuote.length);
      if (close === -1) return { invalid: true, tokens: [] };
      index = close + dollarQuote.length;
      continue;
    }

    if (
      (sql[index] === 'u' || sql[index] === 'U')
      && sql[index + 1] === '&'
      && sql[index + 2] === '"'
    ) {
      const identifier = readQuotedIdentifier(sql, index + 2);
      if (!identifier.valid || !push({
        kind: 'unicode_identifier',
        value: identifier.value,
      })) {
        return { invalid: true, tokens: [] };
      }
      index = identifier.end;
      continue;
    }

    if (sql[index] === '"') {
      const identifier = readQuotedIdentifier(sql, index);
      if (!identifier.valid || !push({
        kind: 'identifier',
        value: identifier.value.toLowerCase(),
      })) {
        return { invalid: true, tokens: [] };
      }
      index = identifier.end;
      continue;
    }

    if (
      (sql[index] === 'e' || sql[index] === 'E')
      && sql[index + 1] === '\''
    ) {
      const string = readSqlString(sql, index + 1, true);
      if (!string.valid || !push({ kind: 'string', value: string.value })) {
        return { invalid: true, tokens: [] };
      }
      index = string.end;
      continue;
    }

    if (sql[index] === '\'') {
      const string = readSqlString(sql, index, false);
      if (!string.valid || !push({ kind: 'string', value: string.value })) {
        return { invalid: true, tokens: [] };
      }
      index = string.end;
      continue;
    }

    if (/[A-Za-z_]/u.test(sql[index])) {
      const start = index;
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_$]/u.test(sql[index])) {
        index += 1;
      }
      if (!push({
        kind: 'word',
        value: sql.slice(start, index).toLowerCase(),
      })) {
        return { invalid: true, tokens: [] };
      }
      continue;
    }

    if (sql[index] === '.') {
      if (!push({ kind: 'dot', value: '.' })) {
        return { invalid: true, tokens: [] };
      }
    } else {
      if (!push({ kind: 'punctuation', value: sql[index] })) {
        return { invalid: true, tokens: [] };
      }
    }
    index += 1;
  }

  return { invalid: false, tokens };
}

function isKeyword(token, keyword) {
  return token?.kind === 'word' && token.value === keyword;
}

function parseIdentifier(tokens, cursor) {
  const token = tokens[cursor];
  if (token?.kind === 'word' || token?.kind === 'identifier') {
    return {
      invalid: false,
      next: cursor + 1,
      value: token.value,
    };
  }
  if (token?.kind !== 'unicode_identifier') return null;

  let escapeCharacter = '\\';
  let next = cursor + 1;
  if (isKeyword(tokens[next], 'uescape')) {
    const escapeLiteral = tokens[next + 1];
    if (
      escapeLiteral?.kind !== 'string'
      || !validUnicodeEscapeCharacter(escapeLiteral.value)
    ) {
      return { invalid: true };
    }
    escapeCharacter = escapeLiteral.value;
    next += 2;
  }

  const decoded = decodeUnicodeIdentifier(token.value, escapeCharacter);
  if (decoded === null) return { invalid: true };
  return {
    invalid: false,
    next,
    value: decoded.toLowerCase(),
  };
}

function inspectBehaviorLedgerDdl(sql) {
  const tokenization = tokenizeSql(sql);
  if (tokenization.invalid) return 'invalid';
  const { tokens } = tokenization;

  for (let start = 0; start < tokens.length; start += 1) {
    if (!isKeyword(tokens[start], 'create')) continue;
    let cursor = start + 1;
    if (
      isKeyword(tokens[cursor], 'global')
      || isKeyword(tokens[cursor], 'local')
    ) {
      cursor += 1;
      if (
        !isKeyword(tokens[cursor], 'temp')
        && !isKeyword(tokens[cursor], 'temporary')
      ) {
        continue;
      }
      cursor += 1;
    } else if (
      isKeyword(tokens[cursor], 'unlogged')
      || isKeyword(tokens[cursor], 'temp')
      || isKeyword(tokens[cursor], 'temporary')
    ) {
      cursor += 1;
    }
    if (!isKeyword(tokens[cursor], 'table')) continue;
    cursor += 1;
    if (isKeyword(tokens[cursor], 'if')) {
      if (
        !isKeyword(tokens[cursor + 1], 'not')
        || !isKeyword(tokens[cursor + 2], 'exists')
      ) {
        continue;
      }
      cursor += 3;
    }
    const firstIdentifier = parseIdentifier(tokens, cursor);
    if (firstIdentifier?.invalid) return 'invalid';
    if (firstIdentifier === null) continue;

    let tableIdentifier = firstIdentifier;
    cursor = firstIdentifier.next;
    if (tokens[cursor]?.kind === 'dot') {
      const secondIdentifier = parseIdentifier(tokens, cursor + 1);
      if (secondIdentifier?.invalid) return 'invalid';
      if (secondIdentifier === null) continue;
      tableIdentifier = secondIdentifier;
    }
    if (tableIdentifier.value === 'behavior_ledger') {
      return 'forbidden';
    }
  }
  return 'clean';
}

export function findSecondaryBehaviorEquivalenceContracts(repositoryRoot) {
  let root;
  try {
    root = resolve(repositoryRoot);
  } catch {
    return ['packages/:unreadable_or_invalid'];
  }

  const scan = walkFiles(root, 'packages', {
    include: isContractYamlPath,
    skipNodeModules: true,
    missingIsError: !repositoryIsDirectory(root),
  });
  if (scan.error !== null) return [`packages/:${scan.error}`];

  const findings = scan.rejectedSymlinks.map(
    (path) => (
      isContractYamlPath(path)
        ? `${relativePath(root, path)}:symlink_not_allowed`
        : `${relativePath(root, path)}/:symlink_not_allowed`
    ),
  );
  for (const path of scan.files) {
    const relativeContractPath = relativePath(root, path);
    const yaml = readYamlDocument(path);
    if (yaml.error) {
      findings.push(`${relativeContractPath}:${yaml.error}`);
    } else if (hasOwnBehaviorEquivalence(yaml.parsed)) {
      findings.push(relativeContractPath);
    }
  }
  return sortedUnique(findings);
}

export function findForbiddenBehaviorLedgerTables(repositoryRoot) {
  let root;
  try {
    root = resolve(repositoryRoot);
  } catch {
    return MIGRATION_ROOTS.map(
      (migrationRoot) => `${migrationRoot}/:unreadable_or_invalid`,
    );
  }

  const repositoryExists = repositoryIsDirectory(root);
  const findings = [];

  for (const migrationRoot of MIGRATION_ROOTS) {
    const scan = walkFiles(root, migrationRoot, {
      include: isSqlPath,
      recursive: false,
      missingIsError: !repositoryExists,
    });
    if (scan.error !== null) {
      findings.push(`${migrationRoot}/:${scan.error}`);
      continue;
    }

    findings.push(...scan.rejectedSymlinks.map(
      (path) => (
        isSqlPath(path)
          ? `${relativePath(root, path)}:symlink_not_allowed`
          : `${relativePath(root, path)}/:symlink_not_allowed`
      ),
    ));
    for (const path of scan.files) {
      const migrationPath = relativePath(root, path);
      const read = readBoundedText(path, MAX_SQL_BYTES);
      if (read.error) {
        findings.push(`${migrationPath}:${read.error}`);
        continue;
      }
      const inspection = inspectBehaviorLedgerDdl(read.contents);
      if (inspection === 'invalid') {
        findings.push(`${migrationPath}:sql_parse_invalid`);
      } else if (inspection === 'forbidden') {
        findings.push(migrationPath);
      }
    }
  }

  return sortedUnique(findings);
}

function findRootContractFinding(repositoryRoot) {
  let root;
  try {
    root = resolve(repositoryRoot);
  } catch {
    return 'regression-contract.yaml:unreadable_or_invalid';
  }

  const yaml = readYamlDocument(join(root, 'regression-contract.yaml'));
  if (yaml.error) {
    return `regression-contract.yaml:${yaml.error}`;
  }
  if (!hasOwnBehaviorEquivalence(yaml.parsed)) {
    return 'regression-contract.yaml:missing_top_level_behavior_equivalence';
  }
  return null;
}

export function evaluateRepositoryPolicy(repositoryRoot) {
  const duplicateBehaviorEquivalenceContracts =
    findSecondaryBehaviorEquivalenceContracts(repositoryRoot);
  const rootFinding = findRootContractFinding(repositoryRoot);
  if (rootFinding !== null) {
    duplicateBehaviorEquivalenceContracts.push(rootFinding);
  }
  const forbiddenBehaviorLedgerTables =
    findForbiddenBehaviorLedgerTables(repositoryRoot);

  const duplicateFindings = sortedUnique(
    duplicateBehaviorEquivalenceContracts,
  );
  return {
    repository_policy_valid: (
      duplicateFindings.length === 0
      && forbiddenBehaviorLedgerTables.length === 0
    ),
    duplicate_behavior_equivalence_contracts: duplicateFindings,
    forbidden_behavior_ledger_tables: forbiddenBehaviorLedgerTables,
  };
}
