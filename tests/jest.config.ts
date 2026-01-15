import type { Config } from 'jest';

const config: Config = {
    displayName: 'MXF Integration Tests',
    preset: 'ts-jest',
    testEnvironment: 'node',
    rootDir: '..',
    roots: ['<rootDir>/tests'],
    testMatch: [
        '**/tests/integration/**/*.integration.test.ts',
        '**/tests/integration/**/*.e2e.test.ts',
        '**/tests/integration/**/*.api.test.ts'
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        // Legacy tests that don't use Jest framework
        'meilisearch-integration.test.ts',
        'code-execution-demo.ts'
    ],
    setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.ts'],
    globalSetup: '<rootDir>/tests/setup/globalSetup.ts',
    globalTeardown: '<rootDir>/tests/setup/globalTeardown.ts',
    moduleNameMapper: {
        '^@mxf/(.*)$': '<rootDir>/src/$1',
        '^@tests/(.*)$': '<rootDir>/tests/$1'
    },
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: '<rootDir>/tests/tsconfig.json'
        }]
    },
    // Integration tests need more time
    testTimeout: 60000,
    // Run sequentially to avoid port conflicts and resource contention
    maxWorkers: 1,
    verbose: true,
    // Ensure clean exit
    forceExit: true,
    detectOpenHandles: true,
    // Coverage configuration
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/**/index.ts',
        '!src/**/*.test.ts',
        '!src/**/*.spec.ts'
    ],
    coverageDirectory: '<rootDir>/coverage',
    coverageReporters: ['text', 'lcov', 'html']
};

export default config;
