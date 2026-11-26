import fs from 'node:fs';
export function cleanupReplayFixture({directory,closed,verified,aborted}){
 if(!closed||!verified||aborted)return {removed:false,reason:!closed?'child_not_closed':aborted?'test_aborted':'verification_incomplete'};
 fs.rmSync(directory,{recursive:true,force:true});
 return {removed:true};
}
