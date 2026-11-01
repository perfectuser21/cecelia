import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ciArchive} from './fixtures/ci-admission-archive.mjs';
import {unpackCiAdmissionArchive} from '../ci-admission-archive.mjs';
test('专用ZIP只解两份CI文件，不提供legacy head.json通道',()=>{
 const envelope={ci_format:'cecelia.ci-admission/v1',ci_assertions:{proof:true}};
 assert.deepEqual(unpackCiAdmissionArchive(ciArchive(envelope)),{envelope,assertions:{proof:true}});
});
for(const kind of ['extra','duplicate','symlink','json-duplicate'])test('恶意ZIP或重复JSON键拒绝：'+kind,()=>{
 assert.throws(()=>unpackCiAdmissionArchive(ciArchive({ci_assertions:{}},kind)),/CI_ADMISSION_ARCHIVE/);
});
