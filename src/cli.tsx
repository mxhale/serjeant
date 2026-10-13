import { render } from 'ink'
import { Explorer } from './screens/Explorer.js'

const demo = process.argv.includes('--demo')
const apiKey = process.env.LINEAR_API_KEY

// ponytail: alt-screen by hand; swap for fullscreen-ink if it grows more terminal chrome
process.stdout.write('\x1b[?1049h')
const { waitUntilExit } = render(<Explorer apiKey={apiKey} demo={demo} />)
await waitUntilExit()
process.stdout.write('\x1b[?1049l')
