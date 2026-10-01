'use strict';
const CONTAINER_ID = /^[a-f0-9]{64}$/;
// Docker is the authority for identity and immutable image resolution. Never include its raw output in errors.
async function verifyContainerIdentity({runCommand,containerId,containerName,image,labels,allowName=false,allowMissing=false,errorCode}) {
  try {
    if (!CONTAINER_ID.test(containerId ?? '') && !(allowName && containerId == null)) throw Error();
    let observed;
    try { observed = await runCommand('docker',['inspect','--type=container',containerId ?? containerName]); }
    catch (error) {
      if (allowMissing && /no such (?:container|object)/i.test([error?.stderr,error?.message].filter(Boolean).join(' '))) return null;
      throw error;
    }
    const value = JSON.parse(observed.stdout)?.[0];
    if (!CONTAINER_ID.test(value?.Id) || (containerId && value.Id !== containerId)
        || value.Name !== `/${containerName}` || (image != null && value.Config?.Image !== image)
        || !Object.entries(labels).every(([key,label]) => value.Config?.Labels?.[key] === label)) throw Error();
    const expectedImage = image ?? value.Config?.Image;
    if (!/^(?:[a-z0-9][a-z0-9._/:~-]*@)?sha256:[a-f0-9]{64}$/.test(expectedImage ?? '')) throw Error();
    const expected = await runCommand('docker',['image','inspect','--format','{{.Id}}',expectedImage]);
    if (!/^sha256:[a-f0-9]{64}$/.test(String(expected.stdout).trim()) || value.Image !== String(expected.stdout).trim()) throw Error();
    return value.Id;
  } catch { throw new Error(errorCode); }
}
module.exports = { CONTAINER_ID, verifyContainerIdentity };
