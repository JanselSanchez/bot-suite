// eslint.config.ts (o .mjs, según tu proyecto)
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // ✅ Config base de Next + TypeScript
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // ✅ Ignorar carpetas de build / externas
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // puedes ignorar workers si quieres que no molesten:
      // "worker/**",
    ],
  },

  // ✅ Reglas personalizadas para todo el proyecto
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      // 🔧 Relajamos el infierno de TypeScript
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/ban-ts-comment": "off",

      // 🔧 Menos agresivo con variables sin usar: solo warning
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],

      // 🔧 React hooks: solo warning, no error
      "react-hooks/exhaustive-deps": "warn",

      // 🔧 Permitimos alert en el panel admin sin bloquear el build
      "no-alert": "off",
    },
  },
];

export default eslintConfig;
