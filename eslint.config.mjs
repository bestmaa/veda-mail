import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "max-lines": [
        "error",
        { max: 250, skipBlankLines: false, skipComments: false },
      ],
    },
  },
  {
    files: ["src/presentation/**/ui/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "@/presentation/**/hooks/**",
                "@/infrastructure/**",
                "@/server/**",
                "@/transport/**",
              ],
              message: "Views accept props only; hooks and infrastructure live outside UI.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/presentation/**/hooks/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "coverage/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
