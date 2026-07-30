const OUTPUT_LIMIT_BYTES = 4096;
const STRICT_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const SECRET_KEY_PATTERN = [
  'aws[_-]?secret[_-]?access[_-]?key',
  'aws[_-]?session[_-]?token',
  'api[_-]?key',
  'access[_-]?token',
  'refresh[_-]?token',
  'token',
  'secret',
  'password',
  'credential',
  'private[_-]?key',
].join('|');
const QUOTED_SECRET_ASSIGNMENT = new RegExp(
  `((?:["']?)(?:${SECRET_KEY_PATTERN})(?:["']?)\\s*[=:]\\s*)(["'])([\\s\\S]*?)\\2`,
  'gi',
);
const BARE_SECRET_ASSIGNMENT = new RegExp(
  `((?:["']?)(?:${SECRET_KEY_PATTERN})(?:["']?)\\s*[=:]\\s*)([^\\s,;}]+)`,
  'gi',
);
const URI_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)([^@\s]+)(@[^/@\s]+)/gi;

function trimTextToByteLimit(text, limit) {
  let start = 0;
  while (Buffer.byteLength(text.slice(start)) > limit) {
    start += text.codePointAt(start) > 0xFFFF ? 2 : 1;
  }
  return text.slice(start);
}

export function byteSafeTail(value, limit) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  let start = Math.max(0, bytes.length - limit);
  while (start < bytes.length && (bytes[start] & 0xC0) === 0x80) start += 1;
  let decoded;
  try {
    decoded = STRICT_UTF8_DECODER.decode(bytes.subarray(start));
  } catch {
    return '';
  }
  if (decoded.includes('�')) return '';
  return trimTextToByteLimit(decoded, limit);
}

export function appendBufferTail(current, chunk, limit) {
  const next = Buffer.concat([
    current,
    Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
  ]);
  return next.length <= limit ? next : next.subarray(next.length - limit);
}

function stripAnsi(value) {
  let output = '';
  let inEscape = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (!inEscape && code === 27 && value[index + 1] === '[') {
      inEscape = true;
      index += 1;
      continue;
    }
    if (inEscape) {
      if (code >= 64 && code <= 126) inEscape = false;
      continue;
    }
    output += value[index];
  }
  return output;
}

function maxCount(text, label) {
  const matches = [...text.matchAll(new RegExp(`(\\d+)\\s+${label}\\b`, 'gi'))];
  return matches.reduce((highest, match) => (
    Math.max(highest, Number(match[1]))
  ), 0);
}

export function scenarioEvidenceFromOutput(kind, stdout = '', stderr = '') {
  const text = stripAnsi(`${stdout}\n${stderr}`);
  if (kind === 'bash') {
    const matches = [...text.matchAll(/GP_ASSERTION_SCENARIO_COUNT=(\d+)/g)];
    const count = matches.reduce((highest, match) => (
      Math.max(highest, Number(match[1]))
    ), 0);
    return {
      scenarioCount: count,
      scenarioEvidence: { kind, marker: 'GP_ASSERTION_SCENARIO_COUNT' },
    };
  }
  const passed = maxCount(text, 'passed');
  const failed = maxCount(text, 'failed');
  return {
    scenarioCount: passed + failed,
    scenarioEvidence: { kind: kind ?? 'command', passed, failed },
  };
}

export function normalizeExecutionEvidence(execution, evidenceKind) {
  if (
    Number.isInteger(execution?.scenarioCount)
    && execution.scenarioCount >= 0
    && execution.scenarioEvidence
    && typeof execution.scenarioEvidence === 'object'
    && !Array.isArray(execution.scenarioEvidence)
  ) {
    return {
      scenarioCount: execution.scenarioCount,
      scenarioEvidence: execution.scenarioEvidence,
    };
  }
  return scenarioEvidenceFromOutput(
    evidenceKind,
    execution?.stdout,
    execution?.stderr,
  );
}

export function redactAndBoundOutput(stdout = '', stderr = '') {
  const redacted = `${stdout}${stderr ? `\n${stderr}` : ''}`
    .replace(
      /(authorization\s*:\s*bearer\s+)[^\s]+/gi,
      '$1[REDACTED]',
    )
    .replace(QUOTED_SECRET_ASSIGNMENT, '$1$2[REDACTED]$2')
    .replace(BARE_SECRET_ASSIGNMENT, '$1[REDACTED]')
    .replace(URI_PASSWORD, '$1[REDACTED]$3');
  return byteSafeTail(redacted, OUTPUT_LIMIT_BYTES);
}
