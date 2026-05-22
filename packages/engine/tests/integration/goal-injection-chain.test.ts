import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const BRAIN_ROOT = resolve(__dirname, '../../../../brain');
const ENGINE_ROOT = resolve(__dirname, '../../..');

describe('goal injection chain', () => {
  it('executor.js exports buildGoalSettings returning correct Stop hook JSON', () => {
    const result = execSync(
      `node -e "const {buildGoalSettings} = require('${BRAIN_ROOT}/src/executor.js'); process.stdout.write(buildGoalSettings('the PR has been merged') || 'null')"`,
      { encoding: 'utf8', timeout: 10000 }
    );
    const parsed = JSON.parse(result);
    expect(parsed.hooks.Stop[0].hooks[0].type).toBe('prompt');
    expect(parsed.hooks.Stop[0].hooks[0].model).toBe('claude-haiku-4-5-20251001');
    expect(parsed.hooks.Stop[0].hooks[0].prompt).toContain('the PR has been merged');
  });

  it('buildGoalSettings returns null for null/empty condition', () => {
    const result = execSync(
      `node -e "const {buildGoalSettings} = require('${BRAIN_ROOT}/src/executor.js'); console.log(buildGoalSettings(null))"`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    expect(result).toBe('null');
  });

  it('cecelia-bridge.js special-cases CECELIA_GOAL_SETTINGS (no SKILLENV_ prefix, JSON preserved)', () => {
    const source = readFileSync(resolve(BRAIN_ROOT, 'scripts/cecelia-bridge.js'), 'utf8');
    expect(source).toContain('CECELIA_GOAL_SETTINGS');
    expect(source).not.toMatch(/CECELIA_SKILLENV_CECELIA_GOAL_SETTINGS/);
    expect(source).toMatch(/CECELIA_GOAL_SETTINGS='/);
  });

  it('cecelia-run.sh writes CECELIA_GOAL_SETTINGS to temp file and appends --settings flag', () => {
    const source = readFileSync(resolve(BRAIN_ROOT, 'scripts/cecelia-run.sh'), 'utf8');
    expect(source).toContain('CECELIA_GOAL_SETTINGS');
    expect(source).toContain('SETTINGS_FLAG');
    expect(source).toContain('--settings');
  });
});
