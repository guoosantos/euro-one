module.exports = {
  root: true,
  env: {
    es2023: true,
  },
  settings: {
    react: {
      version: "detect",
    },
    "import/resolver": {
      node: true,
    },
  },
  plugins: ["import"],
  extends: ["eslint:recommended", "plugin:import/recommended", "prettier"],
  ignorePatterns: ["node_modules", "dist", "client/dist", "backups", "vendor"],
  overrides: [
    {
      files: ["client/**/*.{js,jsx,ts,tsx}"],
      env: {
        browser: true,
      },
      extends: [
        "eslint:recommended",
        "plugin:react/recommended",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended",
        "plugin:import/recommended",
        "prettier",
      ],
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      rules: {
        "react/react-in-jsx-scope": "off",
      },
    },
    {
      files: ["server/**/*.js"],
      env: {
        node: true,
      },
      extends: ["eslint:recommended", "plugin:n/recommended", "plugin:import/recommended", "prettier"],
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      rules: {
        "n/no-missing-import": "off",
      },
    },
  ],
};
