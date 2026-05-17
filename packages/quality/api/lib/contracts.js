/**
 * Contracts Module - RCI Contract operations
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import yaml from 'js-yaml';
import { getAllRepos, getRepoById } from './registry.js';

const PROJECT_ROOT = join(import.meta.dirname, '../..');
const CONTRACTS_DIR = join(PROJECT_ROOT, 'contracts');

/**
 * Read contract YAML file
 */
function readContract(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return yaml.load(content);
  } catch (err) {
    return null;
  }
}

/**
 * Get all contracts
 */
export function getAllContracts() {
  const contracts = [];

  try {
    const files = readdirSync(CONTRACTS_DIR).filter(f =>
      f.endsWith('.regression-contract.yaml') && !f.includes('template')
    );

    for (const file of files) {
      const filePath = join(CONTRACTS_DIR, file);
      const contract = readContract(filePath);

      if (contract) {
        contracts.push({
          file,
          repo: contract.repo,
          version: contract.version,
          lastUpdated: contract.last_updated,
          rciCount: contract.rcis?.length || 0,
        });
      }
    }
  } catch (err) {
    console.error('Error reading contracts:', err.message);
  }

  return contracts;
}

/**
 * Get contract for a specific repo
 */
export function getContractByRepoId(repoId) {
  // First check if repo has a contract path defined
  const repo = getRepoById(repoId);

  let contractPath;
  if (repo?.contract) {
    contractPath = join(PROJECT_ROOT, repo.contract);
  } else {
    // Try default naming convention
    contractPath = join(CONTRACTS_DIR, `${repoId}.regression-contract.yaml`);
  }

  if (!existsSync(contractPath)) {
    return null;
  }

  const contract = readContract(contractPath);
  if (!contract) return null;

  return {
    repo: contract.repo || repoId,
    version: contract.version,
    lastUpdated: contract.last_updated,
    rcis: contract.rcis || [],
    goldenPaths: contract.golden_paths || [],
  };
}

/**
 * Get single RCI by repo and RCI ID
 */
export function getRciById(repoId, rciId) {
  const contract = getContractByRepoId(repoId);
  if (!contract) return null;

  return contract.rcis.find(rci => rci.id === rciId) || null;
}

/**
 * Get all RCIs across all repos
 */
export function getAllRcis() {
  const repos = getAllRepos();
  const allRcis = [];

  for (const repo of repos) {
    const contract = getContractByRepoId(repo.id);
    if (contract?.rcis) {
      for (const rci of contract.rcis) {
        allRcis.push({
          ...rci,
          repoId: repo.id,
          repoName: repo.name,
        });
      }
    }
  }

  return allRcis;
}

/**
 * Get RCIs filtered by trigger
 */
export function getRcisByTrigger(trigger) {
  const allRcis = getAllRcis();
  return allRcis.filter(rci =>
    rci.triggers?.includes(trigger)
  );
}

/**
 * Get RCIs filtered by priority
 */
export function getRcisByPriority(priority) {
  const allRcis = getAllRcis();
  return allRcis.filter(rci => rci.priority === priority);
}
