// 显式执行仍被API/恢复工具消费的窄来源与context兼容合同。
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const files=['workspace-ci-source-contract','verification-context'].map(name=>`scripts/ci/legacy/__tests__/${name}.test.mjs`);
const result=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
