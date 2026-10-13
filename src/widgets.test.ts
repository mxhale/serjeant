import { expect, test } from 'vitest'
import { wrapText } from './widgets.js'

test('wrapText wraps at word boundaries, keeps blank lines, splits long words', () => {
  expect(wrapText('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc'])
  expect(wrapText('a\n\nb', 5)).toEqual(['a', '', 'b'])
  expect(wrapText('abcdefgh', 3)).toEqual(['abc', 'def', 'gh'])
})
