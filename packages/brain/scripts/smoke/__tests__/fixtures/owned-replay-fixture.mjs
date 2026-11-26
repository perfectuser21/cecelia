import fs from 'node:fs';
export function cleanupReplayFixture({directory}){
 fs.rmSync(directory,{recursive:true,force:true});
 return {removed:true};
}
