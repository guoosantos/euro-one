import js from "@eslint/js";
import pluginImport from "eslint-plugin-import";
import pluginJsxA11y from "eslint-plugin-jsx-a11y";
import pluginN from "eslint-plugin-n";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const ignores = [
  "node_modules",
  "dist",
  "client/dist",
  "backups",
  "vendor",
  "client/src/components/**",
  "client/src/ui/**",
  "client/src/pages/**",
  "client/src/routes/**",
  "client/src/App.jsx",
];

export default [
  { ignores },
  {
    files: ["client/**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      import: pluginImport,
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "jsx-a11y": pluginJsxA11y,
    },
    settings: {
      react: { version: "detect" },
      "import/resolver": {
        node: true,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...pluginReact.configs.recommended.rules,
      ...pluginReactHooks.configs.recommended.rules,
      ...pluginJsxA11y.configs.recommended.rules,
      ...pluginImport.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "no-unused-vars": "off",
      "no-undef": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    files: ["server/**/*.js"],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      import: pluginImport,
      n: pluginN,
    },
    settings: {
      "import/resolver": {
        node: true,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...pluginImport.configs.recommended.rules,
      ...pluginN.configs.recommended.rules,
      "n/no-missing-import": "off",
      "n/no-unsupported-features/node-builtins": "off",
      "no-unused-vars": "off",
      "import/no-unresolved": "off",
    },
  },
];
