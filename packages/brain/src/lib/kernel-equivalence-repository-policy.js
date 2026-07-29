import {
  lstatSync,
  readFileSync,
  readdirSync,
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
  rejectSymlink = () => false,
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

    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => compareText(left.name, right.name));
    } catch {
      error = 'unreadable_or_invalid';
      return;
    }

    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_TRAVERSAL_ENTRIES) {
        error = 'traversal_limit_exceeded';
        return;
      }

      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (rejectSymlink(path)) {
          rejectedSymlinks.push(path);
        }
      } else if (entry.isDirectory()) {
        if (recursive) {
          walk(path, depth + 1);
        }
      } else if (entry.isFile() && include(path)) {
        files.push(path);
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
    files: error === null ? files : [],
    rejectedSymlinks: error === null ? rejectedSymlinks : [],
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
  let status;
  try {
    status = lstatSync(path);
  } catch {
    return { error: 'unreadable_or_invalid' };
  }

  if (!status.isFile()) return { error: 'unreadable_or_invalid' };
  if (status.size > maxBytes) return { error: 'oversized' };

  try {
    const contents = readFileSync(path, 'utf8');
    if (Buffer.byteLength(contents, 'utf8') > maxBytes) {
      return { error: 'oversized' };
    }
    return { contents };
  } catch {
    return { error: 'unreadable_or_invalid' };
  }
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
  const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u);
  return match?.[0] ?? null;
}

function stripSqlCommentsAndStrings(sql) {
  const output = sql.split('');
  let index = 0;

  function blank(from, to) {
    for (let cursor = from; cursor < to; cursor += 1) {
      if (output[cursor] !== '\n' && output[cursor] !== '\r') {
        output[cursor] = ' ';
      }
    }
  }

  while (index < sql.length) {
    if (sql[index] === '"') {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === '"' && sql[index + 1] === '"') {
          index += 2;
        } else if (sql[index] === '"') {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }

    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index + 2);
      const stop = end === -1 ? sql.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }

    if (sql.startsWith('/*', index)) {
      const start = index;
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
      blank(start, index);
      continue;
    }

    const dollarQuote = sql[index] === '$' ? dollarQuoteAt(sql, index) : null;
    if (dollarQuote !== null) {
      const start = index;
      const contentStart = index + dollarQuote.length;
      const close = sql.indexOf(dollarQuote, contentStart);
      index = close === -1 ? sql.length : close + dollarQuote.length;
      blank(start, index);
      continue;
    }

    if (sql[index] === '\'') {
      const start = index;
      const prefix = index > 0 ? sql[index - 1] : '';
      const prefixBefore = index > 1 ? sql[index - 2] : '';
      const escapesBackslashes = (
        (prefix === 'e' || prefix === 'E')
        && !/[A-Za-z0-9_$]/u.test(prefixBefore)
      );
      index += 1;
      while (index < sql.length) {
        if (escapesBackslashes && sql[index] === '\\') {
          index += 2;
        } else if (sql[index] === '\'' && sql[index + 1] === '\'') {
          index += 2;
        } else if (sql[index] === '\'') {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      blank(start, Math.min(index, sql.length));
      continue;
    }

    index += 1;
  }

  return output.join('');
}

function readQuotedIdentifier(sql, quoteIndex) {
  let value = '';
  let index = quoteIndex + 1;
  while (index < sql.length) {
    if (sql[index] === '"' && sql[index + 1] === '"') {
      value += '"';
      index += 2;
    } else if (sql[index] === '"') {
      return { end: index + 1, value };
    } else {
      value += sql[index];
      index += 1;
    }
  }
  return { end: index, value };
}

function decodeUnicodeIdentifier(identifier) {
  let decoded = '';
  let index = 0;

  while (index < identifier.length) {
    if (identifier[index] !== '\\') {
      decoded += identifier[index];
      index += 1;
      continue;
    }
    if (identifier[index + 1] === '\\') {
      decoded += '\\';
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

  while (index < sql.length) {
    if (/\s/u.test(sql[index])) {
      index += 1;
      continue;
    }

    if (
      (sql[index] === 'u' || sql[index] === 'U')
      && sql[index + 1] === '&'
      && sql[index + 2] === '"'
    ) {
      const identifier = readQuotedIdentifier(sql, index + 2);
      const decoded = decodeUnicodeIdentifier(identifier.value);
      tokens.push({
        kind: 'identifier',
        value: (decoded ?? identifier.value).toLowerCase(),
      });
      index = identifier.end;
      continue;
    }

    if (sql[index] === '"') {
      const identifier = readQuotedIdentifier(sql, index);
      tokens.push({
        kind: 'identifier',
        value: identifier.value.toLowerCase(),
      });
      index = identifier.end;
      continue;
    }

    if (/[A-Za-z_]/u.test(sql[index])) {
      const start = index;
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_$]/u.test(sql[index])) {
        index += 1;
      }
      tokens.push({
        kind: 'word',
        value: sql.slice(start, index).toLowerCase(),
      });
      continue;
    }

    if (sql[index] === '.') {
      tokens.push({ kind: 'dot', value: '.' });
    } else {
      tokens.push({ kind: 'punctuation', value: sql[index] });
    }
    index += 1;
  }

  return tokens;
}

function isKeyword(token, keyword) {
  return token?.kind === 'word' && token.value === keyword;
}

function isIdentifier(token) {
  return token?.kind === 'word' || token?.kind === 'identifier';
}

function containsForbiddenBehaviorLedgerDdl(sql) {
  const tokens = tokenizeSql(stripSqlCommentsAndStrings(sql));

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
    if (!isIdentifier(tokens[cursor])) continue;

    let tableIdentifier = tokens[cursor];
    if (tokens[cursor + 1]?.kind === 'dot') {
      if (!isIdentifier(tokens[cursor + 2])) continue;
      tableIdentifier = tokens[cursor + 2];
    }
    if (tableIdentifier.value === 'behavior_ledger') {
      return true;
    }
  }
  return false;
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
    rejectSymlink: isContractYamlPath,
    missingIsError: !repositoryIsDirectory(root),
  });
  if (scan.error !== null) return [`packages/:${scan.error}`];

  const findings = scan.rejectedSymlinks.map(
    (path) => `${relativePath(root, path)}:symlink_not_allowed`,
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
      rejectSymlink: isSqlPath,
      missingIsError: !repositoryExists,
    });
    if (scan.error !== null) {
      findings.push(`${migrationRoot}/:${scan.error}`);
      continue;
    }

    findings.push(...scan.rejectedSymlinks.map(
      (path) => `${relativePath(root, path)}:symlink_not_allowed`,
    ));
    for (const path of scan.files) {
      const migrationPath = relativePath(root, path);
      const read = readBoundedText(path, MAX_SQL_BYTES);
      if (read.error) {
        findings.push(`${migrationPath}:${read.error}`);
      } else if (containsForbiddenBehaviorLedgerDdl(read.contents)) {
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
