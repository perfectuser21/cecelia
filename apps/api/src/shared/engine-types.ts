/**
 * Engine Types
 * Type definitions for engine info API
 */

export interface Skill {
  name: string;
  description: string;
  trigger: string;
  status: 'active' | 'inactive';
}

export interface Hook {
  name: string;
  trigger: string;
  description: string;
  protectedPaths: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
  type: 'major' | 'minor' | 'patch';
}

export interface EngineInfo {
  version: string;
  name: string;
  description: string;
  skills: Skill[];
  hooks: Hook[];
  changelog: ChangelogEntry[];
}

export interface EngineInfoResponse {
  success: boolean;
  engine?: EngineInfo;
  error?: string;
}
