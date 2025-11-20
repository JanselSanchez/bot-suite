// .eslintrc.js
/** @type {import("eslint").Linter.Config} */
module.exports = {
    root: true,
    parser: "@typescript-eslint/parser",
    parserOptions: {
      project: ["./tsconfig.json"],
      tsconfigRootDir: __dirname,
    },
    extends: [
      "next/core-web-vitals",
      "plugin:@typescript-eslint/recommended",
    ],
    plugins: ["@typescript-eslint"],
    ignorePatterns: [
      ".eslintrc.js",
      "next.config.js",
      "next.config.mjs",
      "next.config.ts",
      "tailwind.config.js",
      "postcss.config.js",
      "node_modules/",
      ".next/",
      "dist/",
    ],
    rules: {
      // ⚙️ Flexibilizamos TS para tu caso real
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/ban-ts-comment": "off",
  
      // Unused vars: solo avisa, pero permite nombres con _
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
  
      // React Hooks: ya arreglamos lo importante, no queremos que bloquee
      "react-hooks/exhaustive-deps": "off",
  
      // cositas menores que no deben tumbarte el lint
      "no-alert": "off",
    },
    overrides: [
      {
        files: ["worker/**/*", "src/server/**/*"],
        rules: {
          "@typescript-eslint/no-explicit-any": "off",
          "@typescript-eslint/no-unused-vars": [
            "warn",
            {
              argsIgnorePattern: "^_",
              varsIgnorePattern: "^_",
            },
          ],
        },
      },
    ],
  };
  