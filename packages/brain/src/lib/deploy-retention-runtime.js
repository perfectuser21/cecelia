/** Load the same approved retention runtime in repository and flattened image layouts. */
export async function loadDeploymentRetentionRuntime() {
  const repositoryRuntime = new URL('../../../../scripts/brain-image-retention/runtime.mjs', import.meta.url);
  try {
    return await import(repositoryRuntime.href);
  } catch (error) {
    // A broken dependency inside an existing module must remain a failure.
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || error.url !== repositoryRuntime.href) throw error;
    return import(new URL('../../scripts/brain-image-retention/runtime.mjs', import.meta.url).href);
  }
}
