const required = ['vitest', 'pg', 'express'];

for (const dependency of required) {
  try {
    import.meta.resolve(dependency);
  } catch (error) {
    console.error(`FAKE_RED:dependency:${dependency}:${error.message}`);
    process.exit(70);
  }
}

console.log(`DEPENDENCIES_OK:${required.join(',')}`);
