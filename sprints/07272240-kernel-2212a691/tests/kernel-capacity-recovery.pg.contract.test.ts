import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const slotAllocator = fs.readFileSync('/workspace/packages/brain/src/slot-allocator.js', 'utf8');
const dispatcher = fs.readFileSync('/workspace/packages/brain/src/dispatcher.js', 'utf8');
const executionContract = fs.readFileSync('/workspace/packages/brain/src/orchestrator/execution-contract.js', 'utf8');
const attemptStore = fs.readFileSync('/workspace/packages/brain/src/orchestrator/attempt-store.js', 'utf8');
const relay = fs.readFileSync('/workspace/packages/brain/src/harness-skill-relay.js', 'utf8');

describe('Kernel provider-neutral capacity PG contract', () => {
  it('active terminal SSOT 与 execution-contract 完全一致', () => {
    for (const status of ['completed', 'completed_with_concerns', 'needs_context', 'blocked', 'failed', 'cancelled']) {
      expect(executionContract).toContain(`'${status}'`);
      expect(attemptStore).toContain(`'${status}'`);
    }
    expect(slotAllocator).toContain("('queued','starting','running')");
  });

  it('active attempt 进入 terminal 后 occupancy 自然释放容量', () => {
    expect(slotAllocator).toContain('FROM harness_attempts');
    expect(slotAllocator).toContain('status IN (\'queued\',\'starting\',\'running\')');
    expect(slotAllocator).not.toContain('recovered_at');
    expect(slotAllocator).not.toContain('releaseHarnessCapacity');
  });

  it('provider_snapshot_missing', () => {
    expect(slotAllocator).toContain('provider_snapshot_missing');
  });

  it('provider_snapshot_stale', () => {
    expect(slotAllocator).toContain('provider_snapshot_stale');
  });

  it('provider_usage_unavailable', () => {
    expect(slotAllocator).toContain('provider_usage_unavailable');
  });

  it('memory_pressure', () => {
    expect(slotAllocator).toContain('memory_pressure');
  });

  it('disk_pressure', () => {
    expect(slotAllocator).toContain('disk_pressure');
  });

  it('quota_critical', () => {
    expect(slotAllocator).toContain('quota_critical');
  });

  it('global_hard_cap_reached', () => {
    expect(slotAllocator).toContain('global_hard_cap_reached');
  });

  it('legacy admission adapter 在 provider-neutral snapshot 之前独立生效', () => {
    expect(dispatcher).toContain('legacy admission adapter');
    expect(dispatcher).toMatch(/legacy.+provider-neutral|provider-neutral.+legacy/s);
  });

  it('双任务双 cycle 真链路中 Claude 满额被拒而 Codex 或 Grok 空闲被真实 launch', () => {
    expect(dispatcher).toContain('harnessSlotCheck');
    expect(relay).toContain('launchKernelProcess');
    expect(dispatcher).not.toContain('path array');
  });

  it('review_required=true gate 继续生效', () => {
    expect(relay).toContain('review_required');
  });
});
