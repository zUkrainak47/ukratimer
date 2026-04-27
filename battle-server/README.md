# Battle Server

This is the websocket backend used by Online Battle overlay.

## What it does

- Accepts websocket clients at `/battle/<room-name>`
- Creates rooms on first join
- Broadcasts shared room state
- Tracks `READY`, `INSPECTING`, `SOLVING`, `SOLVED`
- Advances to the next scramble once every player in the room has solved
- Updates ELO

## Deploy

1. Install Wrangler.
2. From this folder, run `wrangler deploy`.
3. Point the timer UI at the deployed websocket base.

## Notes

- Rooms are intentionally ephemeral.
- The current implementation keeps room state in memory while the Durable Object is alive.
- Disconnecting removes the player from the room immediately.
