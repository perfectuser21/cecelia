import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bundleCache = new Map();
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(moduleDir, '../../../..');
const VALID_SKILL_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

function resolveSkillsRoot(options) {
  if (options.skillsRoot) return path.resolve(options.skillsRoot);
  if (process.env.CECELIA_SKILLS_ROOT) {
    return path.resolve(process.env.CECELIA_SKILLS_ROOT);
  }
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  return path.join(repoRoot, 'packages', 'workflows', 'skills');
}

function readVersion(content, skillName) {
  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const version = frontmatter?.match(/^version:\s*["']?([^\s"']+)["']?\s*$/m)?.[1];
  if (!version) {
    throw new Error(`loadSkillBundle: version missing in SKILL.md for "${skillName}"`);
  }
  return version;
}

/**
 * Load one repository-owned Skill as an immutable execution snapshot.
 * The digest lets every attempt prove which exact instructions it received.
 */
export function loadSkillBundle(skillName, options = {}) {
  if (!VALID_SKILL_NAME.test(skillName)) {
    throw new Error(`loadSkillBundle: invalid skill name "${skillName}"`);
  }

  const skillPath = path.join(resolveSkillsRoot(options), skillName, 'SKILL.md');
  if (bundleCache.has(skillPath)) return bundleCache.get(skillPath);
  if (!existsSync(skillPath)) {
    throw new Error(`loadSkillBundle: SKILL.md not found for "${skillName}". Searched: ${skillPath}`);
  }

  let content;
  try {
    content = readFileSync(skillPath, 'utf8');
  } catch (error) {
    throw new Error(
      `loadSkillBundle: failed to read SKILL.md for "${skillName}": ${error.message}`,
      { cause: error },
    );
  }

  const bundle = Object.freeze({
    name: skillName,
    version: readVersion(content, skillName),
    digest: `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`,
    content,
    source_path: skillPath,
  });
  bundleCache.set(skillPath, bundle);
  return bundle;
}

export function clearSkillBundleCacheForTests() {
  bundleCache.clear();
}
