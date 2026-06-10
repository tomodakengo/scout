import { defineConfig } from 'vitest/config'

// JSX in tests is transformed by esbuild via tsconfig's "jsx": "react-jsx";
// the @vitejs/plugin-react plugin is not needed here.
export default defineConfig({
  test: {
    // node is the default environment (pure lib tests);
    // DOM tests opt in per-file with `// @vitest-environment jsdom`
    globals: true,
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.*', 'src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
      reporter: ['text', 'html'],
    },
  },
})
