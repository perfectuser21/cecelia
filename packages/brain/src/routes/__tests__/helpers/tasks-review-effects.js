import { afterEach, beforeEach, expect, vi } from 'vitest';
const effects = vi.hoisted(() => ({
  forbidden: [], query: vi.fn(), block: vi.fn(), emit: vi.fn(), terminal: vi.fn(), promote: vi.fn(), finalize: vi.fn(),
  deny(kind) { effects.forbidden.push(kind); throw Error('forbidden_'+kind); },
}));
vi.mock('../../../db.js', () => ({ default: { query: effects.query, connect: () => effects.deny('db_connect') } }));
vi.mock('../../../task-updater.js', () => ({ blockTask: effects.block }));
vi.mock('../../../actions.js', () => ({ createTask: () => effects.deny('create_task'), updateTask: () => effects.deny('update_task') }));
vi.mock('../../../tick-helpers.js', () => ({ routeTask: () => effects.deny('route_task'), TASK_TYPE_AGENT_MAP: {} }));
vi.mock('../../../task-router.js', () => ({ identifyWorkType: vi.fn(), getTaskLocation: vi.fn(), routeTaskCreate: vi.fn(), getValidTaskTypes: vi.fn(), LOCATION_MAP: {}, diagnoseKR: vi.fn() }));
vi.mock('../../../task-weight.js', () => ({ getTaskWeights: vi.fn() }));
vi.mock('../../shared.js', () => ({ classifyLearningType: vi.fn() }));
vi.mock('../../../memory-utils.js', () => ({ generateL0Summary: vi.fn() }));
vi.mock('../../../events/taskEvents.js', () => ({ publishTaskCreated: vi.fn() }));
vi.mock('../../../quarantine.js', () => ({ getQuarantinedTasks: vi.fn(), getQuarantineStats: vi.fn(), releaseTask: vi.fn(), quarantineTask: vi.fn(), QUARANTINE_REASONS: {}, REVIEW_ACTIONS: {} }));
vi.mock('../../../executor.js', () => ({ triggerCeceliaRun: () => effects.deny('executor'), checkCeceliaRunAvailable: vi.fn() }));
vi.mock('../../../event-bus.js', () => ({ emit: effects.emit }));
vi.mock('../../../capture-inbox.js', () => ({ pushCaptureAtom: () => effects.deny('capture_atom') }));
vi.mock('../../../handoff.js', () => ({ pushHandoffAtom: () => effects.deny('handoff_atom') }));
vi.mock('../../../anchor-check.js', () => ({ checkAnchor: vi.fn() }));
vi.mock('../../../lib/manual-dispatch-device-gate.js', () => ({ checkDeviceLockForManualDispatch: vi.fn(), releaseDeviceLockNonFatal: vi.fn() }));
vi.mock('../../../lib/manual-qiumi-dispatch.js', () => ({ dispatchManualQiumi: () => effects.deny('device_dispatch') }));
vi.mock('../../../llm-caller.js', () => ({ callLLM: () => effects.deny('llm') }));
vi.mock('../../../lib/task-terminal.js', async importActual => ({ ...await importActual(), afterTerminalTransition: effects.terminal }));
vi.mock('../../../lib/callback-postprocess.js', () => ({ promoteRegressionOnHarnessMerged: effects.promote }));
vi.mock('../../../lib/harness-finalize.js', () => ({ finalizeHarnessTask: effects.finalize }));

beforeEach(() => {
  effects.forbidden.length=0;
  for (const key of ['query','block','emit','terminal','promote','finalize']) effects[key].mockReset();
  effects.block.mockResolvedValue({success:true}); effects.terminal.mockResolvedValue({relay:null});
  effects.emit.mockResolvedValue(undefined); effects.promote.mockResolvedValue(undefined);
  effects.finalize.mockResolvedValue({applies:true,allow:false,reason:'synthetic_unverified'});
});
afterEach(() => { expect(effects.forbidden).toEqual([]); });
export function getReviewEffects() { return effects; }
