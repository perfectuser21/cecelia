"use strict";

const path = require("node:path");

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

module.exports = {
  parseTestContract,
  inferRepositoryRoot,
  resolveContractTestFile,
};
