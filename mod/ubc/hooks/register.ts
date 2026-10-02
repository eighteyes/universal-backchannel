// ubc: universal backchannel, the session end. No pane.
// - polls $UBC_DIR/inbox/<session id>/*.msg (default ~/.ubc), which the `ubc` CLI drops
// - claims each message by moving it to $UBC_DIR/read/<session id>/, then
//   submits them all as one prompt, so a message starts a turn (queued behind a running one)
// - keeps $UBC_DIR/sessions/<session id>.json fresh so `ubc --list` shows live sessions
// - /ubc prints this session's id, the send command and how many messages wait
//   (delivery stays with the timer: a command hook cannot submit a prompt)

import type { EngineInterface, Register } from 'claude-code'

const POLL_MS = 1500
const BEAT_MS = 60_000
let busy = false

type Message = { from: string | null; text: string }
type Paths = { sid: string; root: string; inbox: string; read: string; beat: string }

async function paths($: EngineInterface): Promise<Paths> {
  const sid = await $.session.id()
  const root = (await $.env.get('UBC_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.ubc`
  return {
    sid,
    root,
    inbox: `${root}/inbox/${sid}`,
    read: `${root}/read/${sid}`,
    beat: `${root}/sessions/${sid}.json`,
  }
}

// A message file is optional `key: value` header lines, a blank line, then the
// body. A file with no blank line is all body.
function parse(raw: string): Message {
  const cut = raw.indexOf('\n\n')
  if (cut < 0) return { from: null, text: raw.trim() }
  const head = raw.slice(0, cut).split('\n')
  if (!head.every(l => /^[a-z]+: /.test(l))) return { from: null, text: raw.trim() }
  const from = head.find(l => l.startsWith('from: '))?.slice(6).trim() || null
  return { from, text: raw.slice(cut + 2).trim() }
}

function format(list: Message[]): string {
  return list.map(m => `ubc message${m.from ? ` from ${m.from}` : ''}:\n${m.text}`).join('\n\n')
}

async function beat($: EngineInterface): Promise<void> {
  const p = await paths($)
  const at = new Date(await $.clock.now()).toISOString()
  await $.fs.write(p.beat, JSON.stringify({ sid: p.sid, cwd: await $.session.cwd(), at }) + '\n')
}

async function waiting($: EngineInterface, inbox: string): Promise<string[]> {
  if (!(await $.fs.exists(inbox))) return []
  return (await $.fs.list(inbox))
    .filter(f => f.kind === 'file' && f.name.endsWith('.msg'))
    .map(f => f.name)
    .sort()
}

async function poll($: EngineInterface): Promise<void> {
  if (busy) return
  busy = true
  try {
    const p = await paths($)
    const names = await waiting($, p.inbox)
    if (names.length === 0) return
    await $.process.run(['mkdir', '-p', p.read])
    const got: Message[] = []
    for (const name of names) {
      // The move is the claim: a second poll or session never delivers it twice.
      const moved = await $.process.run(['mv', `${p.inbox}/${name}`, `${p.read}/${name}`])
      if (moved.exitCode !== 0) continue
      got.push(parse(await $.fs.read(`${p.read}/${name}`)))
    }
    if (got.length > 0) await $.prompt.submit({ text: format(got) })
  } finally {
    busy = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ubc',
      description: "Show this session's ubc id and how to message it",
    })
    $.clock.every(POLL_MS, () => poll($))
    $.clock.every(BEAT_MS, () => beat($))
    void beat($)
    void poll($)

    return next(e)
  })

  on('command.run', { command: 'ubc' }, async $ => {
    const p = await paths($)
    await beat($)
    const n = (await waiting($, p.inbox)).length
    return {
      text:
        `ubc: this session is ${p.sid}\n` +
        `send: ubc --agent ${p.sid} "hi there from ubc"\n` +
        `inbox: ${p.inbox}` +
        (n > 0 ? `\n${n} message${n === 1 ? '' : 's'} waiting, delivered within ${POLL_MS / 1000}s` : ''),
    }
  })
}
