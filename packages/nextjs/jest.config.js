module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    '^@savvagent/sdk$': '<rootDir>/../typescript/src',
    '^@savvagent/sdk/server$': '<rootDir>/../typescript/src/server',
    '^@savvagent/react$': '<rootDir>/../react/src',
  },
  transform: {
    // TypeScript 6 no longer loads every @types package by default.
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { types: ['node', 'jest'] } }],
  },
};
