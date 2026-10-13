import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { RunState } from './db.js'

export const BADGE: Record<RunState, [string, string]> = {
  idle: ['⎇', 'blue'],
  working: ['●', 'yellow'],
  permission: ['!', 'red'],
  asking: ['?', 'magenta'],
  done: ['✓', 'green'],
  failed: ['✗', 'red'],
  interrupted: ['⏸', 'gray'],
}

// Hard-wrap to width, keeping paragraph breaks. Ink wraps too, but we need exact line counts to scroll.
export function wrapText(text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/(\s+)/)) {
      if ((line + word).length > width && line.trim()) { out.push(line.trimEnd()); line = word.trimStart() }
      else line += word
      while (line.length > width) { out.push(line.slice(0, width)); line = line.slice(width) }
    }
    out.push(line.trimEnd())
  }
  return out
}

// Replays batched keystrokes (fast typing, key repeat, paste) one at a time.
export function eachKey(input: string, key: Parameters<Parameters<typeof useInput>[0]>[1], fn: (c: string) => void) {
  if (input.length > 1 && !key.ctrl && !key.meta) for (const c of input) fn(c)
  else fn(input)
}

export function Picker({ title, options, onSelect, onCancel }: {
  title: string; options: string[]; onSelect: (v: string) => void; onCancel: () => void
}) {
  const [i, setI] = useState(0)
  useInput((input, key) => {
    eachKey(input, key, c => {
      if (c === 'j') setI(n => Math.min(n + 1, options.length - 1))
      else if (c === 'k') setI(n => Math.max(n - 1, 0))
    })
    if (key.downArrow) setI(n => Math.min(n + 1, options.length - 1))
    else if (key.upArrow) setI(n => Math.max(n - 1, 0))
    else if (key.return) onSelect(options[i])
    else if (key.escape || input === 'q') onCancel()
  })
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{title}</Text>
      {options.map((o, n) => <Text key={o} inverse={n === i}>{o}</Text>)}
      <Text dimColor>j/k  enter select  esc cancel</Text>
    </Box>
  )
}
