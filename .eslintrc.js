module.exports = {
    root: true,
    env: {
        es2021: true,
        node: true,
    },
    parser: "@typescript-eslint/parser",
    parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
    },
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
    ],
    plugins: ["@typescript-eslint"],
    // dashboard/ and src/desktop/ own their lint setups (Vue and Tauri toolchains).
    ignorePatterns: [
        "dist/",
        "dashboard/",
        "src/desktop/",
        "examples/twenty-questions/client/",
        "logs/",
        "reports/",
        "presentation/",
        "projects/",
        "backups/",
        "*.js",
    ],
    rules: {
        "@typescript-eslint/explicit-function-return-type": "warn",
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
};
