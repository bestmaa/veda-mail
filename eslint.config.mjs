import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import { defineConfig, globalIgnores } from "eslint/config";
import reactA11y from "eslint-plugin-react-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "coverage/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    ...nextPlugin.configs["core-web-vitals"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat["recommended-latest"],
  },
  {
    files: ["src/**/*.tsx"],
    plugins: {
      "react-a11y": reactA11y,
    },
    rules: {
      "react-a11y/alt-text": "error",
      "react-a11y/anchor-has-content": "error",
      "react-a11y/anchor-is-valid": "error",
      "react-a11y/aria-activedescendant-has-tabindex": "error",
      "react-a11y/aria-props": "error",
      "react-a11y/aria-role": "error",
      "react-a11y/aria-unsupported-elements": "error",
      "react-a11y/autocomplete-valid": "error",
      "react-a11y/heading-has-content": "error",
      "react-a11y/html-has-lang": "error",
      "react-a11y/iframe-has-title": "error",
      "react-a11y/img-redundant-alt": "error",
      "react-a11y/lang": "error",
      "react-a11y/media-has-caption": "error",
      "react-a11y/mouse-events-have-key-events": "error",
      "react-a11y/no-access-key": "error",
      "react-a11y/no-aria-hidden-on-focusable": "error",
      "react-a11y/no-distracting-elements": "error",
      "react-a11y/no-keyboard-inaccessible-elements": "error",
      "react-a11y/no-redundant-roles": "error",
      "react-a11y/role-has-required-aria-props": "error",
      "react-a11y/role-supports-aria-props": "error",
      "react-a11y/scope": "error",
      "react-a11y/tabindex-no-positive": "error",
    },
  },
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
]);

export default eslintConfig;
