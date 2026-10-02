// ubc: universal backchannel, the session end. No pane.
// - polls $UBC_DIR/inbox/<session id>/*.msg (default ~/.ubc), which the `ubc` CLI drops
// - claims each message by moving it to $UBC_DIR/read/<session id>/, then
//   submits them all as one prompt, so a message starts a turn (queued behind a running one)
// - keeps $UBC_DIR/sessions/<session id>.json fresh (cwd, herdr ids, name) so the CLI
//   can find this session from a shell that never saw its id
// - /ubc prints this session's id, the send command and how many messages wait
//   (delivery stays with the timer: a command hook cannot submit a prompt)
// - /ubc name <name> names this session for `ubc --to <name>`; /ubc name - drops it

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

async function nameOf($: EngineInterface, sid: string): Promise<string | null> {
  const got = await $.store.get(`name:${sid}`)
  return typeof got === 'string' ? got : null
}

async function beat($: EngineInterface): Promise<void> {
  const p = await paths($)
  const at = new Date(await $.clock.now()).toISOString()
  const herdr = {
    workspace: (await $.env.get('HERDR_WORKSPACE_ID')) ?? null,
    tab: (await $.env.get('HERDR_TAB_ID')) ?? null,
    pane: (await $.env.get('HERDR_PANE_ID')) ?? null,
  }
  const cwd = await $.session.cwd()
  const entry = { sid: p.sid, name: await nameOf($, p.sid), cwd, herdr, at }
  await $.fs.write(p.beat, JSON.stringify(entry) + '\n')
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
      description: "Show this session's ubc id; /ubc name <name> to name it",
    })
    $.clock.every(POLL_MS, () => poll($))
    $.clock.every(BEAT_MS, () => beat($))
    void beat($)
    void poll($)

    return next(e)
  })

  on('command.run', { command: 'ubc' }, async ($, e) => {
    const p = await paths($)
    const [verb, arg] = e.args.trim().split(/\s+/)
    if (verb === 'name') {
      if (arg === undefined || arg === '') return { text: `ubc: name is ${(await nameOf($, p.sid)) ?? 'unset'}` }
      if (arg === '-') await $.store.delete(`name:${p.sid}`)
      else if (/^[A-Za-z0-9_.-]+$/.test(arg)) await $.store.set(`name:${p.sid}`, arg)
      else return { text: `ubc: bad name ${arg}: use letters, digits, _ . -` }
      await beat($)
      return { text: arg === '-' ? 'ubc: name dropped' : `ubc: named ${arg}\nsend: ubc --to ${arg} "msg"` }
    }
    await beat($)
    const n = (await waiting($, p.inbox)).length
    const named = await nameOf($, p.sid)
    return {
      text:
        `ubc: this session is ${p.sid}${named ? ` (${named})` : ''}\n` +
        `send: ubc --agent ${p.sid} "hi there from ubc"\n` +
        `inbox: ${p.inbox}` +
        (n > 0 ? `\n${n} message${n === 1 ? '' : 's'} waiting, delivered within ${POLL_MS / 1000}s` : ''),
    }
  })
}
