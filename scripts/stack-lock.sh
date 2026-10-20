#!/usr/bin/env bash
#
# stack-lock.sh — serialise every command that touches the local Supabase stack.
#
# Runs <command...> holding an exclusive, machine-global lock, and propagates its exit code
# unchanged. One acquisition covers the WHOLE stack-touching span — start / reset / seed / the
# entire e2e run — because guarding individual commands leaves exactly the window this exists to
# close.
#
# ── The class it ends ───────────────────────────────────────────────────────────────────────────
# Five collisions in two days, five different mechanisms, one shape: CHECK-THEN-ACT on a shared
# local stack. A session checks the stack looks free, then acts, and a second session interleaves
# between the two. Fixing the mechanisms one at a time produced five fixes and five recurrences:
#
#   1. a runner printed CONTENDED and ran anyway — the gate and the act were separated in time
#   2. a pre-flight port check treated as sufficient when the stack operations happened later
#   3. a `db reset` deadlocked mid-run, disrupting both sides
#   4. the seeded dev account vanished mid-assessment, the DB filling with another run's spec
#      users — during an ANNOUNCED hold
#   5. the dev seed vanished again during #307, costing a re-seed and a re-capture
#
# An advisory-lock syscall has no window between checking and holding, which is why this ends the
# class rather than narrowing it again. Announcing, port-probing and politeness are all check-then-
# act; `lockf`/`flock` is not.
#
# ── Why serialise rather than isolate ───────────────────────────────────────────────────────────
# Per-worktree stacks were costed and are dead on resources: three stacks already run on this box
# (34 containers, ~5.7 GB of 16 GB, load 12.72/18.18/20.05 on 8 cores). Concurrency here was never
# REQUIRED, only ever wanted — so serialising costs wall-clock and nothing else. The asymmetry is
# the argument: a collision costs a full e2e re-run (measured 14.4–18.2 min) and usually costs it to
# BOTH sides, while waiting costs at most the holder's remainder.
#
# ── The fd is the truth; the sidecar is decoration ──────────────────────────────────────────────
# The kernel releases the lock fd when the holder dies, so a `kill -9`'d holder leaves nothing to
# clean up and there is no stale-lock ritual. The sidecar file below records pid/command/start-time
# ONLY to make the waiting message useful. It is never read to decide whether the lock is free —
# doing that would reintroduce check-then-act one level up, inside the code whose whole purpose is
# to remove it.
#
# ── Formerly a known gap, now closed — two real incidents, not luck ────────────────────────────
# `npx playwright test` / `supabase db reset` invoked DIRECTLY used to bypass this lock silently;
# this file used to call that out of scope by choice. Two real collisions changed that call: a
# parallel session's raw `npx playwright test` collided with another session's e2e run on the
# fixed port 4317 (17x ERR_CONNECTION_REFUSED), and a `db:reset` overlapped a live session by
# ordering luck, not because this lock enforced anything. Both raw forms are now refused two ways:
#   - `.agent-tooling/hooks/pretooluse-guard.sh` blocks them at the Bash-tool layer for coding agent
#     sessions, before either binary even starts (see its own header for exactly what it matches).
#   - apps/web/playwright.config.ts additionally refuses to load unless RV_STACK_LOCK_HELD=1 (the
#     flag this script sets, below) or CI is set — that one fires for ANY `playwright test`
#     invocation, human terminals included, not only coding agent's.
# `supabase db reset` has no equivalent config-load hook (the CLI is a compiled binary with no
# script-loading point to hang a check on), so the Bash-tool hook is its only mechanical gate;
# a human typing it directly in a terminal still relies on this comment and AGENTS.md.
#
# Testability: the lock binary is `${STACK_LOCK_BIN:-auto}` and the lock path
# `${RV_STACK_LOCK_FILE:-derived}`, so scripts/stack-lock.test.sh drives every branch without
# touching the real stack.
#
# Escapes, both deliberate and typed rather than defaulted:
#   RV_STACK_LOCK_DISABLE=1   run unguarded (the no-binary refusal names this)
#   RV_STACK_LOCK_TIMEOUT=N   seconds to wait before failing (default 2700 = 45 min)

set -euo pipefail

[ $# -gt 0 ] || {
  echo "stack-lock: usage: bash scripts/stack-lock.sh <command...>" >&2
  exit 64
}

TIMEOUT="${RV_STACK_LOCK_TIMEOUT:-2700}"
NOTIFY_EVERY="${RV_STACK_LOCK_NOTIFY:-60}"

# ── Re-entrancy ────────────────────────────────────────────────────────────────────────────────
# `lockf`/`flock` are NOT reentrant: a nested acquisition of the same file self-deadlocks. Nothing
# in the tree nests through this wrapper TODAY — a11y.spec.ts and shelf-membership.spec.ts do shell
# out mid-run, but to `node scripts/seed-dev.mjs` directly rather than through `pnpm db:seed`. That
# is one refactor away from bricking every a11y run, so the escape is insurance, not ceremony.
if [ "${RV_STACK_LOCK_HELD:-}" = "1" ]; then
  echo "stack-lock: NOT LOCKING (re-entrant) — this process tree already holds the lock" >&2
  exec "$@"
fi

# ── Every non-locking path announces itself, on stderr ─────────────────────────────────────────
# There are three ways this script does NOT lock: re-entrancy, CI, and the explicit disable. Each
# prints one line naming WHICH path and WHY, and all three go to stderr — two of them printed to
# stdout in the first draft, where a notice is easily lost in command output and pollutes anything
# parsing it. A guard built to end a SILENT failure must not fail silently itself.
#
# The gate below stays `CI` rather than the narrower `GITHUB_ACTIONS`: `CI` is what every runner
# sets and keeps this correct if CI ever moves, and the risk it carries — some local tool exporting
# CI=1 and silently unlocking a developer run — is answered by VISIBILITY rather than by narrowing.
# The line prints the value it saw (`CI=1`), so a wrongly-set gate announces itself on every run
# instead of quietly dropping the lock.
#
# ── CI passthrough, and why it is correct rather than a dodge ──────────────────────────────────
# This lock serialises SESSIONS SHARING ONE DEVELOPER BOX. On CI each job gets a dedicated ephemeral
# runner with its own stack, so there is no shared resource and nothing to serialise. Locking there
# would be overhead that can only ever fail (a missing binary) for zero benefit. CI's e2e jobs call
# `pnpm --filter @reverie/web e2e --project=…`, which routes through the wrapped script — this is
# the branch that keeps that harmless. (Checked, not assumed: `flock` IS present on ubuntu-latest —
# util-linux 2.39.3 — so this is a correctness choice, not a workaround for an absent binary.)
if [ -n "${CI:-}" ]; then
  echo "stack-lock: NOT LOCKING (CI=${CI}) — dedicated runner, own stack, nothing to serialise" >&2
  exec "$@"
fi

if [ "${RV_STACK_LOCK_DISABLE:-}" = "1" ]; then
  echo "stack-lock: NOT LOCKING (RV_STACK_LOCK_DISABLE=1) — unguarded by explicit request" >&2
  exec "$@"
fi

# ── The lock path is keyed to the STACK, not the checkout ──────────────────────────────────────
# A lock inside the worktree gives every worktree its own file and therefore no mutual exclusion at
# all — the original failure, re-implemented. Keyed to config.toml's project_id so every worktree of
# this repo contends for one file, and a different project legitimately does not. A fixed /tmp
# prefix, never $TMPDIR, which is per-process on macOS and would hand each session a private lock.
if [ -z "${RV_STACK_LOCK_FILE:-}" ]; then
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  PROJECT_ID="$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$REPO_ROOT/supabase/config.toml" 2>/dev/null | head -1)"
  [ -n "$PROJECT_ID" ] || {
    echo "stack-lock: could not read project_id from supabase/config.toml — refusing to guess a" >&2
    echo "            lock path, because the wrong path is no lock at all." >&2
    exit 70
  }
  RV_STACK_LOCK_FILE="/tmp/reverie-stack-${PROJECT_ID}.lock"
fi
SIDECAR="${RV_STACK_LOCK_FILE}.holder"

# ── Pick the binary: native first ──────────────────────────────────────────────────────────────
# macOS ships lockf(1) and not flock(1); Linux the reverse. Both take an exclusive advisory lock on
# an fd the kernel drops on process exit, which is the property that makes a killed holder safe.
LOCK_BIN="${STACK_LOCK_BIN:-auto}"
if [ "$LOCK_BIN" = "auto" ]; then
  if command -v lockf >/dev/null 2>&1; then
    LOCK_BIN="lockf"
  elif command -v flock >/dev/null 2>&1; then
    LOCK_BIN="flock"
  else
    # REFUSE rather than warn-and-proceed. "Warn loudly and run anyway" is the exact shape of
    # failure #1, and the bypass should be something a person types on purpose.
    echo "stack-lock: neither lockf(1) nor flock(1) is available, so the stack cannot be" >&2
    echo "            guarded. REFUSING to run unguarded — that is the failure this exists to" >&2
    echo "            prevent. To proceed anyway, deliberately:" >&2
    echo "              RV_STACK_LOCK_DISABLE=1 <your command>" >&2
    exit 69
  fi
fi

# `-t 0` is the non-blocking probe; the wait form differs between the two binaries.
#
# `-k` IS LOAD-BEARING on lockf, not tidiness: without it lockf UNLINKS the lock file when the
# holder releases (verified — `lockf -t 0 F true` leaves no F behind). A waiter blocked on the old
# inode while a fresh process creates a NEW file at the same path would then be waiting on a lock
# nobody holds, and both could run — the very race this script exists to remove, reintroduced by
# the locking primitive itself. `-k` keeps one inode at the path so every acquirer contends for the
# same lock. flock never unlinks, so it needs no equivalent.
lock_try() { # $@ = command to run while holding
  case "$LOCK_BIN" in
    lockf) lockf -k -t 0 "$RV_STACK_LOCK_FILE" "$@" ;;
    flock) flock -n "$RV_STACK_LOCK_FILE" "$@" ;;
    *) "$LOCK_BIN" -t 0 "$RV_STACK_LOCK_FILE" "$@" ;;
  esac
}
lock_wait() { # $1 = seconds, rest = command
  local secs="$1"
  shift
  case "$LOCK_BIN" in
    lockf) lockf -k -t "$secs" "$RV_STACK_LOCK_FILE" "$@" ;;
    flock) flock -w "$secs" "$RV_STACK_LOCK_FILE" "$@" ;;
    *) "$LOCK_BIN" -t "$secs" "$RV_STACK_LOCK_FILE" "$@" ;;
  esac
}

describe_holder() {
  # Decoration only. If the sidecar is missing or stale the MESSAGE degrades; the DECISION never
  # consults it.
  if [ -r "$SIDECAR" ]; then
    cat "$SIDECAR"
  else
    echo "another session (no holder details recorded)"
  fi
}

# What actually runs under the lock: stamp the sidecar (best-effort, both directions — failing to
# write it must never fail the run) and exec the command with the re-entrancy flag set.
export SIDECAR
# A private per-invocation marker distinguishes acquisition from a command returning lockf's
# own timeout status (75), or flock's status (1). It is diagnostic only: acquisition still goes
# exclusively through the kernel lock, and neither the sidecar nor this marker grants it.
RV_STACK_LOCK_ACQUIRE_MARKER=$(mktemp)
export RV_STACK_LOCK_ACQUIRE_MARKER
RUN_HOLDING='printf "1\n" >"$RV_STACK_LOCK_ACQUIRE_MARKER" || exit 74
unset RV_STACK_LOCK_ACQUIRE_MARKER
printf "pid %s · %s · since %s\n" "$$" "$*" "$(date "+%H:%M:%S")" >"$SIDECAR" 2>/dev/null || true
RV_STACK_LOCK_HELD=1 exec "$@"'

# ── Announce the wait ──────────────────────────────────────────────────────────────────────────
# `lockf -t N` blocks SILENTLY. A session that looks hung for up to 45 minutes behind a legitimate
# ~40-minute isolation sweep is a session someone kills — which is what happened to two background
# waiters earlier. So: say what is held and keep saying it, so "waiting" and "hung" stay
# distinguishable at a glance.
#
# The probe below acquires and releases in a microsecond, and exists ONLY to decide whether to
# print. It is deliberately not a gate: the real command always goes through the blocking acquire
# beneath it, so losing this race costs a missing message and never a wrong decision — the same
# rule the sidecar follows.
STARTED_AT=$(date +%s)
HEARTBEAT=""
cleanup() {
  if [ -n "$HEARTBEAT" ]; then kill "$HEARTBEAT" 2>/dev/null || true; fi
  rm -f -- "$RV_STACK_LOCK_ACQUIRE_MARKER" 2>/dev/null || true
}
trap cleanup EXIT
if ! lock_try true 2>/dev/null; then
  if [ "$TIMEOUT" -ge 60 ]; then WAIT_DESC="$((TIMEOUT / 60)) min"; else WAIT_DESC="${TIMEOUT}s"; fi
  echo "stack-lock: the stack is held — waiting up to ${WAIT_DESC}." >&2
  echo "            holder: $(describe_holder)" >&2
  echo "            lock:   $RV_STACK_LOCK_FILE" >&2
  echo "            (this is WAITING, not hung — a heartbeat prints every ${NOTIFY_EVERY}s)" >&2
  # Heartbeat ONLY on the contended path: the uncontended run is the common one and must stay
  # silent — spawning and killing a background job there printed a "Terminated" notice on every
  # single e2e run, which is noise the wrapper has no business adding.
  (
    while :; do
      sleep "$NOTIFY_EVERY"
      [ -s "$RV_STACK_LOCK_ACQUIRE_MARKER" ] && break
      echo "stack-lock: still waiting ($(($(date +%s) - STARTED_AT))s) — holder: $(describe_holder)" >&2
    done
  ) &
  HEARTBEAT=$!
  disown "$HEARTBEAT" 2>/dev/null || true # suppress the shell's own job-termination notice
fi

set +e
lock_wait "$TIMEOUT" bash -c "$RUN_HOLDING" _ "$@"
STATUS=$?
set -e
ACQUIRED=0
[ -s "$RV_STACK_LOCK_ACQUIRE_MARKER" ] && ACQUIRED=1
cleanup
trap - EXIT

# lockf exits 75 (EX_TEMPFAIL) and flock 1 when the wait expires without acquiring. Distinguish that
# from the command's own failure: on expiry the command NEVER RAN, and saying so matters — running
# after a failed wait is the original bug.
WAITED=$(($(date +%s) - STARTED_AT))
if [ "$ACQUIRED" -eq 0 ] && {
  { [ "$LOCK_BIN" = "lockf" ] && [ "$STATUS" -eq 75 ]; } ||
  { [ "$LOCK_BIN" = "flock" ] && [ "$STATUS" -eq 1 ] && [ "$WAITED" -ge "$TIMEOUT" ]; }
}; then
  echo "stack-lock: TIMED OUT after ${WAITED}s waiting for the stack." >&2
  echo "            holder: $(describe_holder)" >&2
  echo "            The command did NOT run. Re-run when the holder finishes, or raise" >&2
  echo "            RV_STACK_LOCK_TIMEOUT if the holder is legitimately long." >&2
  exit 75
fi

exit "$STATUS"
