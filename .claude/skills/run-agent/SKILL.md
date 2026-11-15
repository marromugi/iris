---
name: run-agent
description: Starts and drives the agent Worker (apps/agent, the iris Cloudflare Worker) locally to check a change. Use when a change touches apps/agent or its API and someone needs to see the running server answer, not only the tests. Starts from an empty database, waits until the server answers, runs the checks that need no sign-in, keeps the log, and stops only what it started. A second copy runs on its own port.
---

# Run the agent Worker

The Worker is `apps/agent`. This skill runs it on this Mac with `wrangler dev --local`, using `scripts/run.sh` beside this file. The script takes `start`, `check`, or `stop`, and an optional port (default 8787).

## Run it

From the repository root:

```bash
.claude/skills/run-agent/run.sh start 8788
.claude/skills/run-agent/run.sh check 8788
.claude/skills/run-agent/run.sh stop 8788
```

- **Start** makes a clean state, migrates the local D1 database from empty, and starts wrangler with the `~/.iris-dev` certificate. It refuses a port that already answers, since another copy may be running there, and it does not stop that copy. It waits until `/.well-known/oauth-protected-resource/api` returns 200. Being ready means that answer, not just a listening process. If the server exits first, it fails.
- **Check** runs the routes that need no sign-in and expects fixed status codes: the discovery document 200, `/api/me` 401, `/api/agents` 401. It writes `check.log` and fails on any mismatch.
- **Stop** kills the process tree rooted at the pid it saved at start, and nothing else.

Use a port that is free for each copy. A second copy beside another session's run takes its own port. Its state and logs are per port.

## Evidence

Each run's log is in `/private/tmp/iris-run/<port>/`:

- `wrangler.log`: the migration and the server's output, cleared at each start.
- `check.log`: the check results.

These stay after stop. The PR carries the run's `check.log` and the final lines of `wrangler.log`.

## Does not run here

- **Agent replies.** A message to an agent starts a model run. The Claude key in `apps/agent/.dev.vars` is live, so the run never posts one. Model runs are for a developer to start on purpose and pay for.
- **Signed-in flows.** Signing in needs a passkey, which only the developer can do. The skill does not sign in.
- **Deployed behaviour.** The Worker's R2 buckets, Email Routing, Browser Run, and the sandbox container are local stand-ins, and their deployed behaviour is not checked here. The Email Routing address setup is done once in the Cloudflare dashboard, and `wrangler deploy` is run by the developer.
- **The iOS app.** Its screens and sign-in run in the simulator, and the developer checks them.

For those, the check comes from a developer or from the deployed Worker, not from this run.

## Stop what you started

If `stop` says nothing is started, the pid file is already gone. Look at `ps` for `iris-run/<port>` before killing anything else; a copy on the same port that is not in the pid file is not yours.
