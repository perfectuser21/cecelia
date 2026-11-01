#!/usr/bin/env node
/** 专用子进程入口；只输出CI typed draft，不持有GitHub权限或发布能力。 */
import {writeFileSync} from 'node:fs';
import {buildCiAdmissionDraft} from './ci-admission-builder.mjs';
if(process.argv.length!==7)throw Error('CI_ADMISSION_WORKER_ARGUMENTS');
if(process.versions.node.split('.')[0]!=='22')throw Error('CI_ADMISSION_WORKER_NODE_VERSION');
const [sourceRoot,controlRoot,sourceRevision,controlRevision,output]=process.argv.slice(2);
let readback;
const draft=await buildCiAdmissionDraft({sourceRoot,controlRoot,sourceRevision,controlRevision},{observe:value=>{readback=value;}});
writeFileSync(output,JSON.stringify({ci_worker_format:'cecelia.ci-worker/v1',draft,readback})+'\n',{mode:0o600,flag:'wx'});
