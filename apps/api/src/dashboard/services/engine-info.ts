/**
 * Engine Info Service
 * Parses zenithjoy-engine data to provide real-time engine info
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import type { EngineInfo, Skill, Hook, ChangelogEntry } from '../../shared/engine-types.js';

// Default engine path - can be overridden via environment variable
const ENGINE_PATH = process.env.ZENITHJOY_ENGINE || '/home/xx/perfect21/cecelia/engine';

/**
 * Parse YAML front matter from a markdown file
 */
function parseYamlFrontMatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: Record<string, string> = {};

  // Simple YAML parsing for name and description
  const lines = yaml.split('\n');
  let currentKey = '';
  let currentValue = '';
  let inMultiline = false;

  for (const line of lines) {
    if (inMultiline) {
      if (line.startsWith('  ') || line.trim() === '') {
        currentValue += line.trim() + ' ';
      } else {
        result[currentKey] = currentValue.trim();
        inMultiline = false;
      }
    }

    if (!inMultiline) {
      const keyMatch = line.match(/^(\w+):\s*(.*)$/);
      if (keyMatch) {
        const [, key, value] = keyMatch;
        if (value === '|' || value === '>') {
          currentKey = key;
          currentValue = '';
          inMultiline = true;
        } else {
          result[key] = value.trim();
        }
      }
    }
  }

  if (inMultiline && currentKey) {
    result[currentKey] = currentValue.trim();
  }

  return result;
}

/**
 * Extract trigger info from skill description or content
 */
function extractTrigger(description: string, content: string): string {
  // Look for trigger conditions in description
  const triggerMatch = description.match(/触发条件[：:]\s*(.+?)(?:\n|$)/);
  if (triggerMatch) {
    return triggerMatch[1].trim();
  }

  // Look for common patterns
  if (description.includes('/dev') || content.includes('/dev')) {
    return '用户输入 /dev 或 Hook 触发';
  }
  if (description.includes('/audit')) {
    return '用户输入 /audit';
  }

  return '用户调用';
}

/**
 * Load skills from skills/ directory
 */
function loadSkills(): Skill[] {
  const skillsPath = join(ENGINE_PATH, 'skills');
  if (!existsSync(skillsPath)) return [];

  const skills: Skill[] = [];

  try {
    const skillDirs = readdirSync(skillsPath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const skillDir of skillDirs) {
      const skillFile = join(skillsPath, skillDir, 'SKILL.md');
      if (!existsSync(skillFile)) continue;

      try {
        const content = readFileSync(skillFile, 'utf-8');
        const frontMatter = parseYamlFrontMatter(content);

        skills.push({
          name: `/${frontMatter.name || skillDir}`,
          description: frontMatter.description?.split('\n')[0] || `${skillDir} skill`,
          trigger: extractTrigger(frontMatter.description || '', content),
          status: 'active',
        });
      } catch {
        // Skip invalid skill files
      }
    }
  } catch {
    // Skills directory not accessible
  }

  return skills;
}

/**
 * Parse hook description from shell script comments
 */
function parseHookComments(content: string): { description: string; protectedPaths: string[] } {
  const lines = content.split('\n').slice(0, 20); // Only check first 20 lines
  const comments: string[] = [];
  const protectedPaths: string[] = [];

  for (const line of lines) {
    if (line.startsWith('#') && !line.startsWith('#!')) {
      const comment = line.replace(/^#\s*/, '').trim();
      if (comment && !comment.startsWith('=')) {
        comments.push(comment);
      }
    }
  }

  // Extract protected paths from content
  const pathPatterns = content.match(/\*"\/(\w+)\/"/g) || [];
  for (const pattern of pathPatterns) {
    const path = pattern.match(/\/(\w+)\//)?.[1];
    if (path) protectedPaths.push(`${path}/`);
  }

  // Check for file extension patterns
  const extMatch = content.match(/case.*\$EXT.*in\s*\n\s*([^)]+)\)/);
  if (extMatch) {
    const exts = extMatch[1].split('|').map((e) => `*.${e.trim()}`);
    protectedPaths.push(...exts.slice(0, 5)); // Limit to first 5
  }

  return {
    description: comments.slice(1, 3).join(' ') || 'Shell hook',
    protectedPaths: [...new Set(protectedPaths)].slice(0, 6),
  };
}

/**
 * Determine hook trigger type from filename and content
 */
function getHookTrigger(filename: string, content: string): string {
  const name = basename(filename, '.sh');

  if (name === 'branch-protect' || content.includes('PreToolUse')) {
    return 'PreToolUse (Write/Edit)';
  }
  if (name === 'bash-guard' || content.includes('git config branch')) {
    return 'PreToolUse (Bash)';
  }
  if (name === 'project-detect' || content.includes('PostToolUse')) {
    return 'PostToolUse (Bash)';
  }

  return 'Hook';
}

/**
 * Load hooks from hooks/ directory
 */
function loadHooks(): Hook[] {
  const hooksPath = join(ENGINE_PATH, 'hooks');
  if (!existsSync(hooksPath)) return [];

  const hooks: Hook[] = [];

  try {
    const hookFiles = readdirSync(hooksPath).filter((f) => f.endsWith('.sh'));

    for (const hookFile of hookFiles) {
      const hookPath = join(hooksPath, hookFile);

      try {
        const content = readFileSync(hookPath, 'utf-8');
        const { description, protectedPaths } = parseHookComments(content);
        const name = basename(hookFile, '.sh');

        hooks.push({
          name,
          trigger: getHookTrigger(hookFile, content),
          description,
          protectedPaths,
        });
      } catch {
        // Skip invalid hook files
      }
    }
  } catch {
    // Hooks directory not accessible
  }

  return hooks;
}

/**
 * Determine version type from version string
 */
function getVersionType(version: string, prevVersion?: string): 'major' | 'minor' | 'patch' {
  const [major, minor] = version.split('.').map(Number);
  if (!prevVersion) return 'minor';

  const [prevMajor, prevMinor] = prevVersion.split('.').map(Number);

  if (major > prevMajor) return 'major';
  if (minor > prevMinor) return 'minor';
  return 'patch';
}

/**
 * Parse CHANGELOG.md in Keep a Changelog format
 */
function loadChangelog(): ChangelogEntry[] {
  const changelogPath = join(ENGINE_PATH, 'CHANGELOG.md');
  if (!existsSync(changelogPath)) return [];

  const entries: ChangelogEntry[] = [];

  try {
    const content = readFileSync(changelogPath, 'utf-8');
    const lines = content.split('\n');

    let currentVersion = '';
    let currentDate = '';
    let currentChanges: string[] = [];
    let prevVersion = '';

    for (const line of lines) {
      // Match version header: ## [7.26.0] - 2026-01-17
      const versionMatch = line.match(/^## \[(\d+\.\d+\.\d+)\]\s*-\s*(\d{4}-\d{2}-\d{2})/);
      if (versionMatch) {
        // Save previous entry
        if (currentVersion && currentChanges.length > 0) {
          entries.push({
            version: currentVersion,
            date: currentDate,
            changes: currentChanges,
            type: getVersionType(currentVersion, prevVersion),
          });
          prevVersion = currentVersion;
        }

        currentVersion = versionMatch[1];
        currentDate = versionMatch[2];
        currentChanges = [];
        continue;
      }

      // Skip [Unreleased] and section headers
      if (line.startsWith('## [Unreleased]') || line.match(/^### /)) {
        continue;
      }

      // Match change items: - Change description
      const changeMatch = line.match(/^- (.+)$/);
      if (changeMatch && currentVersion) {
        currentChanges.push(changeMatch[1].trim());
      }
    }

    // Don't forget the last entry
    if (currentVersion && currentChanges.length > 0) {
      entries.push({
        version: currentVersion,
        date: currentDate,
        changes: currentChanges,
        type: getVersionType(currentVersion, prevVersion),
      });
    }
  } catch {
    // Changelog not accessible
  }

  return entries.slice(0, 20); // Limit to 20 entries
}

/**
 * Load package.json for version and metadata
 */
function loadPackageJson(): { version: string; name: string; description: string } {
  const packagePath = join(ENGINE_PATH, 'package.json');

  try {
    const content = readFileSync(packagePath, 'utf-8');
    const pkg = JSON.parse(content);
    return {
      version: pkg.version || '0.0.0',
      name: pkg.name || 'ZenithJoy Engine',
      description: pkg.description || 'AI development workflow engine',
    };
  } catch {
    return {
      version: '0.0.0',
      name: 'ZenithJoy Engine',
      description: 'AI development workflow engine',
    };
  }
}

/**
 * Get complete engine info
 */
export function getEngineInfo(): EngineInfo {
  const pkg = loadPackageJson();

  return {
    version: pkg.version,
    name: 'ZenithJoy Engine',
    description: pkg.description,
    skills: loadSkills(),
    hooks: loadHooks(),
    changelog: loadChangelog(),
  };
}

/**
 * Check if engine is accessible
 */
export function isEngineAccessible(): boolean {
  return existsSync(join(ENGINE_PATH, 'package.json'));
}
