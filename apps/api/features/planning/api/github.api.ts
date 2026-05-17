/**
 * GitHub API client for dev panorama
 */

import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api/github',
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface RepoInfo {
  name: string;
  fullName: string;
  defaultBranch: string;
  description: string | null;
  updatedAt: string;
  pushedAt: string;
  openIssues: number;
}

export interface BranchInfo {
  name: string;
  sha: string;
  protected: boolean;
  lastCommit: {
    sha: string;
    message: string;
    author: string;
    date: string;
  };
}

export interface PrInfo {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  author: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  headBranch: string;
  baseBranch: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  url: string;
}

export interface RepoPanorama {
  repo: {
    name: string;
    description: string | null;
    defaultBranch: string;
    updatedAt: string;
    pushedAt: string;
  };
  branches: {
    total: number;
    main: string | null;
    develop: string | null;
    featureCount: number;
    checkpointCount: number;
    features: string[];
    checkpoints: string[];
  };
  recentPrs: Array<{
    number: number;
    title: string;
    state: string;
    author: string;
    createdAt: string;
    mergedAt: string | null;
    headBranch: string;
    baseBranch: string;
    url: string;
  }>;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Get all tracked repos
export async function getRepos(): Promise<ApiResponse<RepoInfo[]>> {
  const response = await apiClient.get('/repos');
  return response.data;
}

// Get branches for a repo
export async function getBranches(repo: string): Promise<ApiResponse<BranchInfo[]>> {
  const response = await apiClient.get(`/repos/${repo}/branches`);
  return response.data;
}

// Get PRs for a repo
export async function getPulls(
  repo: string,
  options?: { state?: 'open' | 'closed' | 'all'; limit?: number }
): Promise<ApiResponse<PrInfo[]>> {
  const params = new URLSearchParams();
  if (options?.state) params.set('state', options.state);
  if (options?.limit) params.set('limit', options.limit.toString());
  const response = await apiClient.get(`/repos/${repo}/pulls?${params}`);
  return response.data;
}

// Get full panorama data
export async function getPanorama(): Promise<ApiResponse<RepoPanorama[]>> {
  const response = await apiClient.get('/panorama');
  return response.data;
}

// Commit info for branch graph
export interface CommitInfo {
  sha: string;
  fullSha: string;
  message: string;
  author: string;
  date: string;
  parents: string[];
}

export interface CommitsData {
  main: CommitInfo[];
  develop: CommitInfo[];
  mergePoints: string[];
}

// Feature info with grouped PRs
export interface FeatureInfo {
  name: string;
  displayName: string;
  prs: PrInfo[];
  latestPr: PrInfo;
}

export interface FeaturesData {
  features: FeatureInfo[];
}

// Get commits for branch graph
export async function getCommits(repo: string, limit = 30): Promise<ApiResponse<CommitsData>> {
  const response = await apiClient.get(`/repos/${repo}/commits?limit=${limit}`);
  return response.data;
}

// Get features (PRs grouped by feature)
export async function getFeatures(repo: string, limit = 50): Promise<ApiResponse<FeaturesData>> {
  const response = await apiClient.get(`/repos/${repo}/features?limit=${limit}`);
  return response.data;
}
