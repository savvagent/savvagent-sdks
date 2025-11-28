module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    '^@savvagent/sdk$': '<rootDir>/../typescript/src/index.ts',
    '^@angular/core/testing$': '<rootDir>/test-utils/angular-testing-mock.ts',
    '^@angular/core$': '<rootDir>/test-utils/angular-core-mock.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        target: 'ES2022',
        module: 'CommonJS',
        lib: ['ES2022', 'DOM'],
        esModuleInterop: true,
        skipLibCheck: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        useDefineForClassFields: false,
        moduleResolution: 'node',
        noUnusedLocals: false,
        noUnusedParameters: false,
      },
    }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@angular|rxjs|tslib)/)'
  ],
  extensionsToTreatAsEsm: ['.ts'],
};
