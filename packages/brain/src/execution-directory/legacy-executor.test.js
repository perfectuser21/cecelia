import {it,expect,vi} from 'vitest';
import {withLegacyExecution} from './legacy-executor.js';
it.each(['xian-mac-m1','us-mac-m4','us-vps'])('普通Codex %s 无精确授权时不启动或改派',async machineId=>{
 const query=vi.fn(),operation=vi.fn();await expect(withLegacyExecution({pool:{query},machineId,provider:'codex'},operation)).rejects.toThrow(`execution_legacy_grant_denied:${machineId}:codex`);expect(operation).not.toHaveBeenCalled();expect(query).not.toHaveBeenCalled();
});
