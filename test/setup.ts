// Runs in each test file's process: isolated state so parallel files never share a sqlite db.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sj-test-'))
process.env.SERJEANT_STATE = dir
process.env.SERJEANT_CONFIG = join(dir, 'config.toml')
