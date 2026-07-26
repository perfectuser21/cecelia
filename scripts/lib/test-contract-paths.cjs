"use strict";

const fs = require("node:fs");
const path = require("node:path");

const TEST_ARTIFACT_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$|(?:test|spec)\.sh$/;
const CONTRACT_FILENAMES = ["contract-draft.md", "sprint-contract.md"];

/**
 * Parse rows from a Harness v5 Test Contract table.
 *
 * @param {string} content
 * @returns {Array<{ws: string, testFile: string, behaviors: string[]}>}
 */
function parseTestContract(content) {
  const lines = content.split("\n");
  const rows = [];
  let inSection = false;

  for (const line of lines) {
    if (/^##+\s*(?:§\d+\s+)?Test Contract/.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##+\s/.test(line)) break;
    if (!inSection) continue;

    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const ws = cells[1];
    const testFileRaw = cells[2];
    const behaviorsRaw = cells[3];
    if (!ws || !testFileRaw) continue;
    if (ws === "Workstream" || ws.startsWith("-")) continue;

    const quotedPath = testFileRaw.match(/`([^`]+)`/);
    const testFile = quotedPath ? quotedPath[1] : testFileRaw;
    if (!/\.(test|spec|e2e)\.[cm]?[jt]sx?$|\.sh$/.test(testFile)) {
      continue;
    }

    const behaviors = behaviorsRaw
      .split(/[/,、]/)
      .map((behavior) => behavior.trim().replace(/^`|`$/g, ""))
      .filter(Boolean);
    rows.push({ ws, testFile, behaviors });
  }

  return rows;
}

/**
 * Extract the single executable bash block from the canonical E2E section.
 * This mirrors the Harness evaluator's section boundary and fenced-bash
 * semantics, while failing closed when the evidence is ambiguous.
 *
 * @param {string} content
 * @returns {string | null}
 */
function parseCanonicalE2EScript(content) {
  if (typeof content !== "string") return null;
  const normalized = content.replace(/\r\n?/g, "\n");
  const headers = [
    ...normalized.matchAll(/^##[ \t]+E2E 验收[ \t]*$/gm),
  ];
  if (headers.length !== 1) return null;

  const header = headers[0];
  const sectionStart = header.index + header[0].length;
  const afterHeader = normalized.slice(sectionStart);
  const nextSection = afterHeader.search(/\n##[ \t]+[^\n]+/);
  const section =
    nextSection >= 0 ? afterHeader.slice(0, nextSection) : afterHeader;
  const bashBlocks = [
    ...section.matchAll(/^```bash[ \t]*\n([\s\S]*?)^```[ \t]*$/gm),
  ];
  return bashBlocks.length === 1 ? bashBlocks[0][1] : null;
}

/**
 * Normalize only representation-level whitespace. Leading whitespace,
 * commands, arguments, content, and ordering remain significant.
 *
 * @param {string} script
 * @returns {string}
 */
function normalizeE2EScript(script) {
  return script
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "");
}

/**
 * Infer a repository root from .../sprints/<sprint>/contract.md, unless an
 * explicit root is provided.
 *
 * @param {string} contractPath
 * @param {string | undefined} explicitRoot
 * @returns {string | null}
 */
function inferRepositoryRoot(contractPath, explicitRoot) {
  if (typeof explicitRoot === "string" && explicitRoot.length > 0) {
    return path.resolve(explicitRoot);
  }
  if (typeof contractPath !== "string" || contractPath.length === 0) {
    return null;
  }

  const absoluteContract = path.resolve(contractPath);
  const parsed = path.parse(absoluteContract);
  const segments = absoluteContract
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);
  const sprintIndex = segments.lastIndexOf("sprints");
  if (sprintIndex < 0 || !segments[sprintIndex + 1]) return null;
  return path.resolve(parsed.root, ...segments.slice(0, sprintIndex));
}

function sprintSlug(name) {
  return name.replace(/^\d+-/, "").replace(/[^a-zA-Z0-9\-_]/g, "-");
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function repositoryRelativePath(testFile) {
  return /^(?:sprints|packages|scripts)\//.test(testFile) ||
    testFile.startsWith("tests/regression/")
    ? testFile
    : null;
}

function sprintNameFromContract(root, contractPath) {
  const relative = path.relative(root, contractPath).split(path.sep).join("/");
  const match = relative.match(/^sprints\/([^/]+)\//);
  return match ? match[1] : null;
}

function graduationTarget(testFile, contractSprintName) {
  const sprintTest = testFile.match(/^sprints\/([^/]+)\/tests\/(.+)$/);
  if (sprintTest) {
    return `tests/regression/${sprintSlug(sprintTest[1])}/${sprintTest[2]}`;
  }

  const sprintE2e = testFile.match(/^sprints\/([^/]+)\/e2e-verify\.sh$/);
  if (sprintE2e) {
    return `scripts/smoke/e2e/${sprintSlug(sprintE2e[1])}.sh`;
  }

  if (!contractSprintName) return null;
  const legacyTest = testFile.match(/^tests\/(.+)$/);
  if (legacyTest && !testFile.startsWith("tests/regression/")) {
    return `tests/regression/${sprintSlug(contractSprintName)}/${legacyTest[1]}`;
  }
  if (testFile === "e2e-verify.sh") {
    return `scripts/smoke/e2e/${sprintSlug(contractSprintName)}.sh`;
  }
  return null;
}

/**
 * Resolve a Test Contract declaration to its live sprint source or frozen
 * permanent target. The caller supplies existsSync to keep this helper free of
 * filesystem side effects.
 *
 * @param {{
 *   root?: string,
 *   contractPath: string,
 *   testFile: string,
 *   existsSync: (candidate: string) => boolean
 * }} options
 * @returns {{
 *   resolvedPath: string | null,
 *   candidates: string[],
 *   error: string | null
 * }}
 */
function resolveContractTestFile({
  root,
  contractPath,
  testFile,
  existsSync,
}) {
  const repositoryRoot = inferRepositoryRoot(contractPath, root);
  const candidates = [];
  if (!repositoryRoot) {
    return {
      resolvedPath: null,
      candidates,
      error: "无法从合同路径推断仓库根目录，且未提供显式 root",
    };
  }
  if (typeof testFile !== "string" || testFile.length === 0) {
    return {
      resolvedPath: null,
      candidates,
      error: "测试路径为空",
    };
  }

  const normalizedTestFile = testFile.replace(/\\/g, "/");
  if (
    path.posix.isAbsolute(normalizedTestFile) ||
    path.win32.isAbsolute(testFile)
  ) {
    return {
      resolvedPath: null,
      candidates,
      error: "拒绝绝对路径声明",
    };
  }
  if (
    normalizedTestFile.includes("\0") ||
    normalizedTestFile.split("/").includes("..")
  ) {
    return {
      resolvedPath: null,
      candidates,
      error: "拒绝含父目录穿越（..）的不安全路径",
    };
  }

  const hasExplicitRoot = typeof root === "string" && root.length > 0;
  const absoluteContract =
    hasExplicitRoot && !path.isAbsolute(contractPath)
      ? path.resolve(repositoryRoot, contractPath)
      : path.resolve(contractPath);
  if (!isWithinRoot(repositoryRoot, absoluteContract)) {
    return {
      resolvedPath: null,
      candidates,
      error: "合同路径越界，不在仓库根目录内",
    };
  }

  const repoRelative = repositoryRelativePath(normalizedTestFile);
  const primary = repoRelative
    ? path.resolve(repositoryRoot, repoRelative)
    : path.resolve(path.dirname(absoluteContract), normalizedTestFile);
  candidates.push(primary);

  const contractSprintName = sprintNameFromContract(
    repositoryRoot,
    absoluteContract
  );
  const graduated = graduationTarget(
    normalizedTestFile,
    contractSprintName
  );
  if (graduated) {
    const permanent = path.resolve(repositoryRoot, graduated);
    if (!candidates.includes(permanent)) candidates.push(permanent);
  }

  if (candidates.some((candidate) => !isWithinRoot(repositoryRoot, candidate))) {
    return {
      resolvedPath: null,
      candidates,
      error: "解析候选越界，不在仓库根目录内",
    };
  }

  const canCheckExistence =
    typeof existsSync === "function" ? existsSync : () => false;
  return {
    resolvedPath:
      candidates.find((candidate) => canCheckExistence(candidate)) || null,
    candidates,
    error: null,
  };
}

function isSprintArtifact(candidate) {
  return (
    TEST_ARTIFACT_RE.test(path.basename(candidate)) ||
    path.basename(candidate) === "e2e-verify.sh"
  );
}

/**
 * List live sprint test artifacts registered by their own sprint's canonical
 * Test Contract. Unsafe, missing, graduated, and cross-sprint declarations are
 * ignored so callers fail closed by treating those artifacts as unregistered.
 *
 * @param {string} root
 * @returns {string[]}
 */
function listRegisteredSprintArtifacts(root) {
  const repositoryRoot = path.resolve(root);
  const sprintsRoot = path.join(repositoryRoot, "sprints");
  let sprintEntries;
  try {
    sprintEntries = fs.readdirSync(sprintsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const registered = new Set();
  for (const entry of sprintEntries) {
    if (!entry.isDirectory() || entry.name === "archive") continue;
    const sprintDir = path.join(sprintsRoot, entry.name);
    let contractPath = null;
    let content = null;
    for (const contractFilename of CONTRACT_FILENAMES) {
      const candidate = path.join(sprintDir, contractFilename);
      try {
        content = fs.readFileSync(candidate, "utf8");
        contractPath = candidate;
        break;
      } catch {
        continue;
      }
    }
    if (!contractPath || content === null) continue;

    for (const row of parseTestContract(content)) {
      const resolution = resolveContractTestFile({
        root: repositoryRoot,
        contractPath,
        testFile: row.testFile,
        existsSync: fs.existsSync,
      });
      if (resolution.error || !resolution.resolvedPath) continue;

      const relativeToSprint = path.relative(
        sprintDir,
        resolution.resolvedPath
      );
      const belongsToSprint =
        relativeToSprint.length > 0 &&
        !path.isAbsolute(relativeToSprint) &&
        relativeToSprint !== ".." &&
        !relativeToSprint.startsWith(`..${path.sep}`);
      if (
        belongsToSprint &&
        isSprintArtifact(resolution.resolvedPath)
      ) {
        registered.add(resolution.resolvedPath);
      }
    }

    const contractE2e = parseCanonicalE2EScript(content);
    if (contractE2e !== null) {
      const e2ePath = path.join(sprintDir, "e2e-verify.sh");
      try {
        const script = fs.readFileSync(e2ePath, "utf8");
        const normalizedScript = normalizeE2EScript(script);
        const normalizedContractE2e = normalizeE2EScript(contractE2e);
        if (
          normalizedScript.length > 0 &&
          normalizedContractE2e.length > 0 &&
          normalizedScript === normalizedContractE2e
        ) {
          registered.add(e2ePath);
        }
      } catch {
        // Missing/unreadable evidence stays unregistered.
      }
    }
  }

  return [...registered].sort();
}

module.exports = {
  parseTestContract,
  parseCanonicalE2EScript,
  normalizeE2EScript,
  inferRepositoryRoot,
  resolveContractTestFile,
  listRegisteredSprintArtifacts,
};
