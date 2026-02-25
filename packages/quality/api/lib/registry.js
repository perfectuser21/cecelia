/**
 * Registry Module - Repo Registry CRUD operations
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

const PROJECT_ROOT = join(import.meta.dirname, '../..');
const REGISTRY_FILE = join(PROJECT_ROOT, 'control-plane/repo-registry.yaml');
const DEV_DIR = '/home/xx/dev';

/**
 * Read registry from YAML file
 */
function readRegistry() {
  try {
    const content = readFileSync(REGISTRY_FILE, 'utf-8');
    return yaml.load(content);
  } catch (err) {
    return { version: '1.0.0', repos: [] };
  }
}

/**
 * Write registry to YAML file
 */
function writeRegistry(registry) {
  registry.updated = new Date().toISOString().split('T')[0];
  const content = yaml.dump(registry, { lineWidth: -1 });
  writeFileSync(REGISTRY_FILE, content, 'utf-8');
}

/**
 * Get all repos
 */
export function getAllRepos() {
  const registry = readRegistry();
  return registry.repos || [];
}

/**
 * Get repo by ID
 */
export function getRepoById(id) {
  const repos = getAllRepos();
  return repos.find(r => r.id === id) || null;
}

/**
 * Register new repo
 */
export function registerRepo(repo) {
  const registry = readRegistry();

  // Check for duplicate
  const exists = registry.repos.some(r => r.id === repo.id);
  if (exists) {
    throw new Error(`Repo with id '${repo.id}' already exists`);
  }

  // Add default fields
  const newRepo = {
    id: repo.id,
    name: repo.name || repo.id,
    type: repo.type || 'Business',
    path: repo.path,
    git_url: repo.git_url || '',
    main_branch: repo.main_branch || 'main',
    owner: repo.owner || 'Unknown',
    priority: repo.priority || 'P2',
    enabled: repo.enabled !== false,
    runners: repo.runners || { qa: 'npm test' },
    evidence_path: repo.evidence_path || '.qa-evidence.json',
    contract: repo.contract || null,
  };

  registry.repos.push(newRepo);
  writeRegistry(registry);

  return newRepo;
}

/**
 * Remove repo by ID
 */
export function removeRepo(id) {
  const registry = readRegistry();
  const index = registry.repos.findIndex(r => r.id === id);

  if (index === -1) {
    return false;
  }

  registry.repos.splice(index, 1);
  writeRegistry(registry);

  return true;
}

/**
 * Discover unregistered repos in dev directory
 */
export function discoverRepos() {
  const registered = getAllRepos();
  const registeredPaths = new Set(registered.map(r => r.path));

  const discovered = [];

  try {
    const entries = readdirSync(DEV_DIR);

    for (const entry of entries) {
      const fullPath = join(DEV_DIR, entry);

      // Skip if not a directory
      if (!statSync(fullPath).isDirectory()) continue;

      // Skip if already registered
      if (registeredPaths.has(fullPath)) continue;

      // Check if it's a git repo
      const gitDir = join(fullPath, '.git');
      if (!existsSync(gitDir)) continue;

      // Get git remote URL
      let gitUrl = '';
      try {
        const configPath = join(gitDir, 'config');
        if (existsSync(configPath)) {
          const config = readFileSync(configPath, 'utf-8');
          const match = config.match(/url\s*=\s*(.+)/);
          if (match) gitUrl = match[1].trim();
        }
      } catch {}

      discovered.push({
        id: entry,
        name: entry,
        path: fullPath,
        git_url: gitUrl,
        suggested_type: guessRepoType(fullPath),
      });
    }
  } catch (err) {
    console.error('Error scanning dev directory:', err.message);
  }

  return discovered;
}

/**
 * Guess repo type based on files
 */
function guessRepoType(repoPath) {
  // Check for Engine indicators
  if (existsSync(join(repoPath, 'regression-contract.yaml'))) return 'Engine';
  if (existsSync(join(repoPath, 'hooks'))) return 'Engine';
  if (existsSync(join(repoPath, 'skills'))) return 'Engine';

  // Check for Service indicators
  if (existsSync(join(repoPath, 'Dockerfile'))) return 'Service';
  if (existsSync(join(repoPath, 'docker-compose.yml'))) return 'Service';

  // Check for Infrastructure indicators
  if (existsSync(join(repoPath, 'control-plane'))) return 'Infrastructure';

  return 'Business';
}

/**
 * Register multiple repos at once
 */
export function registerDiscovered(repoIds) {
  const discovered = discoverRepos();
  const registered = [];

  for (const id of repoIds) {
    const repo = discovered.find(r => r.id === id);
    if (repo) {
      try {
        const newRepo = registerRepo({
          id: repo.id,
          name: repo.name,
          path: repo.path,
          git_url: repo.git_url,
          type: repo.suggested_type,
        });
        registered.push(newRepo);
      } catch (err) {
        console.error(`Failed to register ${id}:`, err.message);
      }
    }
  }

  return registered;
}
