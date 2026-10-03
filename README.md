# universal-backchannel

"Slip a note under the door"

Your Claude Code sessions are islands. A build script, a cron job, another agent or you in a spare shell can't reach a session without typing into its window. To reach one from outside we need an *address* and a *mailbox*: anything writes, the session reads.

`ubc` is a backchannel into Claude Code. Any shell drops a message, and the session it's meant for starts a turn with it.

```sh
ubc "the build is green, go ahead and tag it"
```

```
The ubc plugin sent a message:
ubc message from my-repo:
the build is green, go ahead and tag it
```

## Features

### no uuid needed
Run `ubc` from a shell and it finds the session that shell belongs to: same herdr tab, same project folder, or a name you gave it. Pass `--agent <uuid>` to skip the guessing.

### never guesses
When more than one session matches, `ubc` lists them and exits 3. Pick one with `--agent` or `--to`.

### names
`/ubc name api` in a session, then `ubc --to api "deploy done"` from anywhere.

### delivered once
The mod claims each message by moving it out of the inbox before it reads it. Two polls or two sessions can't deliver the same message twice.

### queues behind a busy turn
A message that lands mid-turn waits for that turn to finish. Several waiting messages arrive as one prompt.

### pipes
`make test 2>&1 | tail -20 | ubc` sends the output. `--from ci` signs it.

### no pane
The mod draws nothing. It polls an inbox and starts turns. `/ubc` prints the session's id and a ready-to-paste send line.

It's a folder of text files and a 1.5 second poll, but it's replaced a lot of copy-pasting between my windows.

## Installation

```sh
git clone https://github.com/eighteyes/universal-backchannel
cd universal-backchannel
ln -s "$PWD/bin/ubc" ~/.local/bin/ubc        # the CLI
claude --plugin-dir "$PWD/mod/ubc"           # a session with the mod loaded
```

To load the mod in every session, add the `mod/ubc` path to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`.

Needs: bash, `jq` (only for finding a session without `--agent`), and a Claude Code build that loads hooks-module mods.

### Incomplete Implementations

**Codex, Desktop, others**: nothing yet. The mod needs Claude Code's `$.prompt.submit` to start a turn.

**Hot reload**: a mod folder under `~/.claude/dev-mods/` that's a symlink loads once and then ignores edits. Copy it in, or use `--plugin-dir`.

## Implementation

### CLI

```sh
ubc "hi there from ubc"                    # to the session this shell belongs to
ubc --to api "deploy done"                 # to a session named with /ubc name api
ubc --agent <uuid> "hi"                    # by id
echo "build failed" | ubc                  # message from stdin
ubc --from ci "deploy done"                # sign it (default: this folder's name)
ubc --who                                  # which session a send would reach
ubc --list                                 # live sessions
```

### Finding the session

With no `--agent`, the first rule that matches wins:

```
rule                      matches
--to <name>               a live session named with /ubc name <name>
$CLAUDE_CODE_SESSION_ID   set in shells Claude itself starts (Bash tool, hooks)
$HERDR_TAB_ID             a live session in the same herdr tab
$HERDR_WORKSPACE_ID       a live session in the same herdr workspace
$PWD                      a live session whose cwd is this folder, above it or below it
```

Several matches narrow to those whose cwd nests with `$PWD`, then to an exact cwd. A session is live for 150s after its last heartbeat (`UBC_LIVE_SECS`).

### Mod

```
event           does
session.start   registers /ubc; polls the inbox every 1.5s; heartbeats every 60s
command.run     /ubc prints id, send line and waiting count; /ubc name <x> names it, /ubc name - drops it
```

`/ubc` can't deliver: Claude Code doesn't allow a prompt submit from a command hook, so delivery always comes from the poll.

### Layout

```
~/.ubc/inbox/<uuid>/*.msg      waiting; the CLI writes a dotfile and renames it
~/.ubc/read/<uuid>/*.msg       delivered; never pruned
~/.ubc/sessions/<uuid>.json    heartbeat: cwd, herdr ids, name, time
```

A message is `from: <name>`, a blank line, then the body. `UBC_DIR` moves the tree; `UBC_FROM` sets the default sender.

### Trust

Nothing is authenticated. Anything that can write to `~/.ubc` can prompt your sessions, the same as anything that can type into your terminal.

### Tests

```sh
claude plugin test mod/ubc
```

## Contributions
Are welcome. I wanted agents and scripts to tap each other on the shoulder without a server, a socket or a pane, and a mailbox on disk turned out to be enough.
