// ubc.test: the ubc mod against an in-memory inbox.
// - the poll timer delivers waiting messages as one prompt, signed by sender
// - /ubc reports the session id and send command
// - each message is claimed by a move into read/, so it is never delivered twice
// - a headerless file is delivered whole, unsigned
// - /ubc name sets the name the beat carries, beside the herdr ids

import { expect, mock, test } from 'claude-code/testing'

const RUN = {
  command: 'ubc',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

test('the poll delivers waiting messages once', async ($, on) => {
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on)
  mock.store(on)
  const files = new Map<string, string>([
    ['/h/.ubc/inbox/a1/1-1.msg', 'from: alice\n\nhi there from ubc\n'],
    ['/h/.ubc/inbox/a1/2-1.msg', 'second\n\nwith a gap'],
  ])
  const woke: string[] = []
  on('session.id', () => ({ value: 'a1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', (_$, e) => ({ value: [...files.keys()].some(k => k.startsWith(e.path + '/')) }))
  on('fs.list', (_$, e) => ({
    value: [...files.keys()]
      .filter(k => k.startsWith(e.path + '/'))
      .map(k => ({ name: k.slice(e.path!.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_$, e) => ({ value: files.get(e.path) ?? '' }))
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'mv') {
      const body = files.get(e.argv[1]!)
      if (body === undefined) return { value: { ...ok, exitCode: 1 } }
      files.delete(e.argv[1]!)
      files.set(e.argv[2]!, body)
    }
    return { value: ok }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('prompt.submit', (_$, e) => {
    woke.push(e.text)
    return { text: e.text }
  })

  const before = await $.command.run(RUN)
  expect(JSON.stringify(before)).toContain('ubc --agent a1')
  expect(JSON.stringify(before)).toContain('2 messages waiting')

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)
  expect(woke.join('\n')).toContain('ubc message from alice:\nhi there from ubc')
  expect(woke.join('\n')).toContain('ubc message:\nsecond\n\nwith a gap')
  expect(files.has('/h/.ubc/read/a1/1-1.msg')).toBe(true)

  await clock.advance(3000)
  expect(woke.length).toBe(1)
  expect(files.has('/h/.ubc/sessions/a1.json')).toBe(true)
})

test('/ubc name lands in the beat with the herdr ids', async ($, on) => {
  mock.env(on, { HOME: '/h', HERDR_TAB_ID: 't9', HERDR_WORKSPACE_ID: 'w9' })
  mock.clock(on)
  mock.store(on)
  const files = new Map<string, string>()
  on('session.id', () => ({ value: 'a1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: false }))

  const out = await $.command.run({ ...RUN, args: 'name api' })
  expect(JSON.stringify(out)).toContain('ubc --to api')
  const beat = JSON.parse(files.get('/h/.ubc/sessions/a1.json') ?? '{}')
  expect(beat).toMatchObject({ sid: 'a1', name: 'api', cwd: '/repo', herdr: { tab: 't9', workspace: 'w9', pane: null } })

  await $.command.run({ ...RUN, args: 'name -' })
  expect(JSON.parse(files.get('/h/.ubc/sessions/a1.json') ?? '{}').name).toBe(null)
  expect(JSON.stringify(await $.command.run({ ...RUN, args: 'name bad/name' }))).toContain('bad name')
})
