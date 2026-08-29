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
  2. A reviewer reacts with a stamp emoji (there are 20 tracked variants)
3. StampHog records the stamp and updates the leaderboard

Built with [TanStack Start](https://tanstack.com/start) + SQLite + [PostHog](https://posthog.com).

## Quick Start

```bash
bun install --frozen-lockfile
cp .env.example .env
bun run db:migrate
bun run dev
```

StampHog requires Bun 1.4.0 (pinned in `.bun-version` and `package.json`). The UI is Vite at `http://127.0.0.1:5173`. The API is `http://127.0.0.1:8787`. If you see the StampHog UI on port 8787, Slack is hitting Vite — stop `bun run dev`, ensure `.env` has `API_PORT=8787` and **no** `PORT=`, then start again.

Browser API calls are same-origin: the Vite dev server proxies `/api/*` to the API process, so there is no wildcard CORS. `VITE_API_URL` is used only by the server-side renderer to reach the API internally.

Read access (the leaderboard and recent-events endpoints under `/api/*`) is gated by a middleware boundary. Local development defaults to anonymous access. To authorize with a trusted identity (e.g. a proxy that injects `x-auth-request-user`), set `READ_AUTH_IDENTITY_HEADER`, `READ_AUTH_ALLOWED_IDENTITIES` (comma-separated), and `READ_AUTH_ALLOW_ANONYMOUS=false` so anonymous read access is rejected. This is an identity boundary only — workspace authorization arrives with multi-tenant support; a workspace ID supplied purely by the browser is never sufficient authorization on its own.

### Seed local test data (no Slack required)

```bash
# Keep existing data, replace prior fixture rows
bun run seed

# Optional: wipe all existing data first
bun run seed -- --reset
```

This creates sample actors, PR requests, and stamp events so the leaderboard and recent events UI are populated immediately.

### Database migrations

The API applies versioned Drizzle migrations when it starts. A database created by an older StampHog checkout is verified and backed up beside the original as `*.pre-drizzle-<timestamp>.bak` before it is adopted by the migration system.

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

StampHog tracks 20 emoji: `stamp`, `stampstamp`, `approved_stamp`, `rubberstamp`, `fixed-stamp`, `kirby-stamp`, `party-rubber-stamp`, `turbo-stamp`, `sloth-zootopia-stamp`, `bufo-fastest-stamp-in-the-west`, `please-sir-i-want-some-more-stamp`, `lgtm`, `lgtm2`, `bufo-lgtm`, `check`, `gold_check`, `cowboy-check`, `done`, `white_check_mark`, and `heavy_check_mark`.

The reacted message must contain a GitHub pull request (`/{owner}/{repo}/pull/{number}`) or Graphite review (`/github/pr/{owner}/{repo}/{number}`) URL.

Most of those names are custom emoji. On a workspace that does not have them, `:white_check_mark:` (✅) and `:heavy_check_mark:` still count.

### How reactions become stamps

- **Reviewer** (stamp giver) = the user who added the reaction
- **Requester** = the author of the reacted message (looked up via Slack API)
- Self-stamps are ignored
- PR request messages are tracked as soon as they are posted, and they count in the request total
- Requesters with zero stamps are left off the requester leaderboard. Unstamped PRs will get a separate “awaiting review” view later, rather than a zero-score ranking
- Non-tracked emojis and messages without qualifying URLs are ignored
- Thread replies are ignored

## Backfill existing history

Import existing qualifying reactions from Slack channels listed in `CHANNEL_IDS`:

```bash
bun run backfill
```

- Hard-limited to the most recent 90 days
- Idempotent via dedupe keys, safe to rerun

## Development

```bash
bun run dev              # Run web app + API together
bun run dev:web          # Web app only (Vite)
bun run dev:api          # API only
bun run db:migrate       # Apply versioned database migrations
bun run seed             # Load fixture data
bun run backfill         # Import Slack history
bun run slack:inbox      # Inspect failed Slack inbox jobs (without payloads)
bun test                 # Ingest contract tests
bun run build            # Production build
bun run preview          # Preview production build
bun run check-types      # TypeScript check
bun run check            # Lint (ultracite/biome)
bun run fix              # Auto-fix lint issues
```

The Bun 1.4.0 baseline was verified with a frozen install, tests, type checking, linting, a production build, fresh migrations and seed data, and local API/UI smoke tests.

## License

MIT
