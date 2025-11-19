module.exports = {
    root: true,
    env: {
        browser: true,
        es2021: true,
        node: true,
    },
    parser: "vue-eslint-parser",
    parserOptions: {
        parser: "@typescript-eslint/parser",
        ecmaVersion: 2021,
        sourceType: "module",
    },
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:vue/vue3-recommended",
        "plugin:prettier/recommended",
    ],
    plugins: [
        "@typescript-eslint",
        "vue",
        "import"
    ],
    rules: {
        // Enforce arrow functions
        "prefer-arrow/prefer-arrow-functions": [
            "error",
            {
                disallowPrototype: true,
                singleReturnOnly: false,
                classPropertiesAllowed: false,
            },
        ],
        // Enforce explicit return types
        "@typescript-eslint/explicit-function-return-type": "warn",
        // Require semicolons
        "@typescript-eslint/semi": ["error", "always"],
        // Enforce consistent spacing
        "@typescript-eslint/indent": ["error", 4],
        // No unused variables
        "@typescript-eslint/no-unused-vars": ["error"],
        // No unused imports
        "import/no-unused-modules": [1, { unusedExports: true }],
        // Enforce import sorting
        "import/order": [
            "error",
            {
                "groups": ["builtin", "external", "internal", "parent", "sibling", "index"],
                "newlines-between": "always"
            }
        ],
        // Enforce Vue-specific linting rules
        "vue/multi-word-component-names": "off",
        "vue/html-indent": ["error", 4],
        "vue/max-attributes-per-line": [
            "error",
            {
                singleline: 3,
                multiline: {
                    max: 1,
                    allowFirstLine: false,
                },
            },
        ],
    },
};
