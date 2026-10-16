import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths: the build works from any sub-path, e.g.
  // https://<user>.github.io/<repo>/ (routing uses #/ so no server rewrites are needed).
  base: './',
  server: { port: 5173 },
});
