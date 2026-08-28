<p align="center">
  <img alt="stamphog" src="public/super_beaver.png" width="200">
</p>

<h1 align="center">StampHog</h1>

<p align="center">
  Realtime leaderboard of who gives and receives the most PR approval stamps in Slack.
</p>

> [!WARNING]
> This is a chaotic side project held together by vibes and SQLite. If you take leaderboard rankings seriously, that's on you.

## What is StampHog?

StampHog gamifies code review culture. It watches your Slack channels for PR links and stamp reactions, then ranks everyone on a live leaderboard. Think of it as a hall of fame for your most prolific reviewers (and most persistent PR posters).

**How it works:**

1. Someone posts a GitHub or Graphite PR link in Slack
2. A reviewer reacts with a stamp emoji (there are 19 tracked variants)
3. StampHog records the stamp and updates the leaderboard

Built with [TanStack Start](https://tanstack.com/start) + SQLite + [PostHog](https://posthog.com).

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm dev
```

The UI is Vite at `http://127.0.0.1:5173`. The API is `http://127.0.0.1:8787`. If you see the StampHog UI on port 8787, Slack is hitting Vite — stop `pnpm dev`, ensure `.env` has `API_PORT=8787` and **no** `PORT=`, then start again.

### Seed local test data (no Slack required)

```bash
# Keep existing data, replace prior fixture rows
pnpm seed

# Optional: wipe all existing data first
pnpm seed -- --reset
```

This creates sample actors, PR requests, and stamp events so the leaderboard and recent events UI are populated immediately.

## Slack Setup

Slack Event Subscriptions need a public HTTPS URL. Locally that is [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), not localhost.

**Socket Mode must be off.** If it is on, Slack sends events over a WebSocket and never POSTs to your Request URL — URL verify can succeed while stamps never arrive.

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

1. Set Event Subscriptions request URL to:
   - `https://<trycloudflare-host>/slack/stamps`
2. Subscribe to bot events:
   - `reaction_added`
   - `reaction_removed`
   - `message.channels` (and `message.groups` for private channels)
3. Add OAuth scopes:
   - `reactions:read`
   - `channels:history` (plus `groups:history` for private channels)
   - `users:read` (for names and avatars)
4. In `.env` (API process, not Vite):
   - `SLACK_SIGNING_SECRET` (for verifying Slack signatures)
   - `SLACK_BOT_TOKEN` (for fetching message authors)
   - `CHANNEL_IDS` (comma-separated channel IDs for backfill)

Quick tunnels get a new hostname every `cloudflared` restart. Re-paste the Request URL after each restart. Invite the bot into the channel: `/invite @YourApp`.

### What counts as a stamp?

StampHog tracks 19 emoji variants including `stamp`, `lgtm`, `approved_stamp`, `check`, and more. The reacted message must contain a qualifying URL (`github.com` or `graphite.dev`).

Most of those names are custom emoji. On a workspace that does not have them, `:white_check_mark:` (✅) and `:heavy_check_mark:` still count.

### How reactions become stamps

- **Reviewer** (stamp giver) = the user who added the reaction
- **Requester** = the author of the reacted message (looked up via Slack API)
- PR request messages are tracked as soon as they're posted, so requesters appear even with 0 stamps
- Non-tracked emojis and messages without qualifying URLs are ignored
- Thread replies are ignored

## Backfill existing history

Import existing qualifying reactions from Slack channels listed in `CHANNEL_IDS`:

```bash
pnpm backfill
```

- Hard-limited to the most recent 90 days
- Idempotent via dedupe keys, safe to rerun

## Development

```bash
pnpm dev              # Run web app + API together
pnpm dev:web          # Web app only (Vite)
pnpm dev:api          # API only
pnpm seed             # Load fixture data
pnpm backfill         # Import Slack history
pnpm test             # Ingest contract tests
pnpm build            # Production build
pnpm preview          # Preview production build
pnpm check-types      # TypeScript check
pnpm check            # Lint (ultracite/biome)
pnpm fix              # Auto-fix lint issues
```

## License

MIT
