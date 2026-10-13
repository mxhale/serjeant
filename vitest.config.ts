import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

const state = mkdtempSync(join(tmpdir(), 'sj-test-'))
export default defineConfig({
  test: {
    env: { SERJEANT_STATE: state, SERJEANT_CONFIG: join(state, 'config.toml') },
    pool: 'forks',
  },
})
