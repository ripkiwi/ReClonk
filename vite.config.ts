import { defineConfig } from 'vitest/config';

// BASE_PATH lets the same build live at a subdomain root ("/") or under a
// path such as GitHub Pages' "/ReClonk/" or "/clonk/" on the main website.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  test: { environment: 'node' },
});
