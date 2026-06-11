import type { Config } from 'jest';

const config: Config = {
    displayName: 'MXF Unit & Property Tests',
    preset: 'ts-jest',
    testEnvironment: 'node',
    rootDir: '..',
    roots: ['<rootDir>/tests/unit', '<rootDir>/tests/property'],
    testMatch: [
        '**/*.unit.test.ts',
        '**/*.property.test.ts'
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '/tests/integration/'
    ],
    moduleNameMapper: {
        // Workspace packages resolve to TS source so jest uses a single module graph.
        '^@mxf-dev/core$': '<rootDir>/packages/core/src/index.ts',
        '^@mxf-dev/core/(.*)$': '<rootDir>/packages/core/src/$1',
        '^@mxf-dev/sdk$': '<rootDir>/packages/sdk/src/index.ts',
        '^@mxf-dev/sdk/(.*)$': '<rootDir>/packages/sdk/src/$1',
        // NodeNext ESM emits .js suffixes on relative imports inside packages.
        '^(\\.{1,2}/.*)\\.js$': '$1',
        '^@tests/(.*)$': '<rootDir>/tests/$1'
    },
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: '<rootDir>/tests/tsconfig.json'
        }]
    },
    // Unit tests should be fast
    testTimeout: 5000,
    // Parallel execution for speed
    maxWorkers: '50%',
    verbose: true,
    // Coverage configuration for unit tests
    collectCoverageFrom: [
        'packages/core/src/schemas/**/*.ts',
        'packages/core/src/protocols/mcp/McpToolCallParser.ts',
        'packages/core/src/protocols/mcp/McpToolSchema.ts',
        'packages/core/src/utils/validation.ts',
        'packages/core/src/types/TaskTypes.ts',
        'src/server/api/controllers/**/*.ts',
        '!src/**/*.d.ts',
        '!src/**/index.ts',
        '!src/**/*.test.ts',
        '!src/**/*.spec.ts'
    ],
    coverageDirectory: '<rootDir>/coverage/unit',
    coverageReporters: ['text', 'lcov', 'html']
};

export default config;
