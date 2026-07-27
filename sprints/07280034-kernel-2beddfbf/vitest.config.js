export default {
  test: {
    environment: 'node',
    include: [
      'sprints/07280034-kernel-2beddfbf/tests/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 1,
      },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
};
