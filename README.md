# ubc

"Slip a note under the door"

Claude Code sessions can't hear each other, and neither can your shell scripts. `ubc` is a backchannel: any process can drop a message for a session by its id, and that session starts a turn with it.

```
ubc --agent <uuid> "hi there from ubc"     # send
echo "build failed" | ubc -a <uuid>        # send from stdin
ubc --agent <uuid> --from ci "deploy done" # sign it
ubc --list                                 # sessions the mod has seen
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

## how it works

The CLI writes `~/.ubc/inbox/<uuid>/<time>-<pid>-<rand>.msg` through a temp file and a rename. The mod polls its own session's inbox every 1.5s and claims each message by moving it to `~/.ubc/read/<uuid>/`, so it delivers once. It submits everything waiting as one prompt, which starts a turn or queues behind the running one.

Every 60s the mod writes `~/.ubc/sessions/<uuid>.json` with its working directory, which is what `ubc --list` shows.

`UBC_DIR` moves the whole tree. `UBC_FROM` sets the default sender, otherwise it's the current directory's name.

## setup

```
ln -s "$PWD/bin/ubc" ~/.local/bin/ubc      # CLI on PATH
claude --plugin-dir "$PWD/mod/ubc"         # load the mod for one session
```

For every session, add `mod/ubc` to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`.

In a session, `/ubc` prints its id and a ready-to-paste send line.

## limits

- `/ubc` can only report. Claude Code doesn't let a slash command submit a prompt, so delivery always comes from the poll.
- Messages sent in the same second can arrive out of order: macOS `date` has no sub-second precision.
- Nothing is authenticated. Anything that can write to `~/.ubc` can prompt your sessions.
- `~/.ubc/read/` is never pruned.

## tests

```
claude plugin test mod/ubc
```
