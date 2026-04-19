module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000, // Increase timeout for integration tests
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/index.js',
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  forceExit: true,
  detectOpenHandles: false,
};
