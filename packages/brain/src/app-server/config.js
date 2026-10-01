import fs from 'node:fs';
import {validateHome} from './identity.js';
export function loadAppServerHomes(filename){
 if(!filename)return Object.freeze({});
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const stat=fs.fstatSync(fd);
  if(!stat.isFile()||(stat.mode&0o077)!==0||(stat.uid!==0&&stat.uid!==process.getuid?.())||stat.size>65536)throw Error('appserver_home_configuration_untrusted');
  const value=JSON.parse(fs.readFileSync(fd,'utf8'));
  if(!value||Object.keys(value).some(k=>k!=='homes')||!Array.isArray(value.homes)||value.homes.length>32)throw Error('appserver_home_configuration_invalid');
  const homes=value.homes.map(validateHome);
  if(new Set(homes.map(h=>h.homeId)).size!==homes.length||new Set(homes.map(h=>h.homeKey)).size!==homes.length)throw Error('appserver_home_configuration_duplicate');
  return Object.freeze(Object.fromEntries(homes.map(h=>[h.homeId,h])));
 }finally{fs.closeSync(fd);}
}
