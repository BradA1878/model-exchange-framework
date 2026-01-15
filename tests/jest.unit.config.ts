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
        '^@mxf/(.*)$': '<rootDir>/src/$1',
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
        'src/shared/schemas/**/*.ts',
        'src/shared/protocols/mcp/McpToolCallParser.ts',
        'src/shared/protocols/mcp/McpToolSchema.ts',
        'src/shared/utils/validation.ts',
        'src/shared/types/TaskTypes.ts',
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
