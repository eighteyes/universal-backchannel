# ubc

"Slip a note under the door"

Claude Code sessions can't hear each other, and neither can your shell scripts. `ubc` is a backchannel: any process can drop a message for a session by its id, and that session starts a turn with it.

```
ubc "hi there from ubc"                    # send to the session this shell belongs to
ubc --to api "deploy done"                 # send to a session named with /ubc name api
ubc --agent <uuid> "hi"                    # send by id
echo "build failed" | ubc                  # send from stdin
ubc --from ci "deploy done"                # sign it
ubc --who                                  # which session a send would reach
ubc --list                                 # live sessions
```

The session reads:

```
The ubc plugin sent a message:
ubc message from ci:
deploy done
```

## parts

```
bin/ubc       the sender CLI (bash)
mod/ubc       the Claude Code mod that receives; no pane
```

## finding the session

With no `--agent`, `ubc` picks the live session that matches the shell, first hit wins:

```
--to <name>               a session named with /ubc name <name>
$CLAUDE_CODE_SESSION_ID   set in shells Claude itself starts (Bash tool, hooks)
$HERDR_TAB_ID             a session in the same herdr tab
$HERDR_WORKSPACE_ID       a session in the same herdr workspace
$PWD                      a session whose cwd is this dir, above it or below it
```

Several matches narrow to the ones whose cwd nests with `$PWD`, then to an exact cwd. Still more than one, `ubc` lists them and exits 3. It never guesses. A session counts as live for 150s after its last beat (`UBC_LIVE_SECS`). Finding a session needs `jq`.

## how it works

The CLI writes `~/.ubc/inbox/<uuid>/<time>-<pid>-<rand>.msg` through a temp file and a rename. The mod polls its own session's inbox every 1.5s and claims each message by moving it to `~/.ubc/read/<uuid>/`, so it delivers once. It submits everything waiting as one prompt, which starts a turn or queues behind the running one.

Every 60s the mod writes `~/.ubc/sessions/<uuid>.json`: its cwd, herdr ids and name. The CLI finds sessions from these.

`UBC_DIR` moves the whole tree. `UBC_FROM` sets the default sender, otherwise it's the current directory's name.

## setup

```
ln -s "$PWD/bin/ubc" ~/.local/bin/ubc      # CLI on PATH
claude --plugin-dir "$PWD/mod/ubc"         # load the mod for one session
```

For every session, add `mod/ubc` to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`.

In a session, `/ubc` prints its id and a ready-to-paste send line. `/ubc name api` names it, `/ubc name -` drops the name.

## limits

- `/ubc` can only report. Claude Code doesn't let a slash command submit a prompt, so delivery always comes from the poll.
- Messages sent in the same second can arrive out of order: macOS `date` has no sub-second precision.
- Nothing is authenticated. Anything that can write to `~/.ubc` can prompt your sessions.
- `~/.ubc/read/` is never pruned.

## tests

```
claude plugin test mod/ubc
```
