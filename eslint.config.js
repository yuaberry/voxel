import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "src-tauri/target", "src-tauri"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "apps/mine-rank-site/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": hooks },
    rules: {
      ...hooks.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // TODO(refactor): migrate data-loading effects to async state patterns
      "react-hooks/set-state-in-effect": "warn",
    },
  },
);
