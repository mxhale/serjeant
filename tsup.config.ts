import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.tsx'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
})
