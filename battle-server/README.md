# Battle Server

This is the websocket backend used by Online Battle overlay.

## What it does

- Accepts websocket clients at `/battle/<room-name>`
- Creates rooms on first join
- Broadcasts shared room state
- Tracks `READY`, `INSPECTING`, `SOLVING`, `SOLVED`
- Advances to the next scramble once every player in the room has solved
- Updates ELO
- Tracks disconnected players for a short grace period before removing them
- Records an active disconnected attempt as a DNF after grace expires
- Allows a late client solve to recover the current or last round when the scramble still matches, including replacing a grace-period forfeit

## Deploy

1. Install Wrangler.
2. From this folder, run `wrangler deploy`.
3. Point the timer UI at the deployed websocket base.

## Notes

- Rooms are intentionally ephemeral.
- The current implementation keeps room state in memory while the Durable Object is alive.
- Room names must be 3-32 characters and may use letters, numbers, `_`, or `-`.
- Disconnecting no longer removes the player immediately. The player is marked disconnected, remains visible briefly, then is removed if they do not reconnect.
- A new session or page instance with the same account can reclaim the player slot after the old page disconnects or stops sending activity; a still-active duplicate tab remains blocked.
- If a player disconnects while inspecting or solving and the grace period expires, the server records a DNF for that round so the room can advance.
- Casual recovery is supported for the current or most recent completed round: if the disconnected page later uploads the real solve for that round, the solve is accepted when the scramble matches, any server-created forfeit is replaced, and ELO for a completed round is recalculated.
