export function internalServiceHeaders(headers = {}, env = process.env) {
  const token = env.CECELIA_INTERNAL_TOKEN?.trim();
  return token
    ? { ...headers, Authorization: `Bearer ${token}` }
    : { ...headers };
}
