import {test,expect,vi} from 'vitest';
import {MACHINE_IDS,createLiveDispatch,ensureSyntheticRun} from './kernel-fleet-three-machine-canary.mjs';
test.each(MACHINE_IDS)('retired live kernel adapter on %s never probes, creates run, or starts attempt',async machine=>{
 const effect=vi.fn();await expect(createLiveDispatch({env:{CECELIA_MACHINE_ID:machine},fetchFn:effect,createLocalWorkspace:effect})).rejects.toMatchObject({code:'kernel_runtime_retired'});
 await expect(ensureSyntheticRun({query:effect},'old')).rejects.toMatchObject({code:'kernel_runtime_retired'});expect(effect).not.toHaveBeenCalled();
});
