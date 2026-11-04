# Dibiaa Tickets Bot

Node.js Discord ticket bot designed to run as a Render **Web Service**.

## Current implemented features

- Discord Gateway bot connection using discord.js v14.
- `/ticket-panel panel_id:<id>` slash command to publish a dashboard panel.
- Create private ticket channels from published panel buttons.
- Claim and close ticket actions.
- Dashboard API calls for server synchronization, panel retrieval, panel publishing, ticket creation and ticket updates.
- HTTP health endpoints for Render: `/health` and `/ready`.

## Not yet implemented

This package is not the complete feature set described in the master project prompt. Dropdown forms, full transcript generation, message-history persistence, staff role mapping, ticket reopen/transfer/assignment workflows and other advanced features still require implementation in the PHP API and bot.

## GitHub repository

Upload the **contents** of this folder to the root of your GitHub repository. Do not upload `.env`, `node_modules`, real tokens, passwords or API secrets.

## Render Web Service configuration

- Runtime: Node
- Branch: `main`
- Root Directory: leave blank when `package.json` is in repository root
- Build Command: `npm install`
- Start Command: `npm start`
- Instance Type: Free (if available in your Render account)

Set the Render Health Check Path to `/health` if the field is shown.

## Render environment variables

Required:

- `DISCORD_TOKEN`: Discord bot token. Keep secret.
- `DISCORD_CLIENT_ID`: Discord application ID.
- `API_BASE_URL`: `https://dibiaa.free.nf/api`
- `API_SECRET`: must match the secret configured by the PHP dashboard API.

Optional:

- `DASHBOARD_URL`: `https://dibiaa.free.nf`

`DISCORD_PUBLIC_KEY` is not required by this Gateway-based bot. It is used for Discord HTTP interaction signature verification, not for the normal discord.js Gateway connection.

## Discord setup

Invite the bot with the `bot` and `applications.commands` scopes and the permissions required to view channels, create/manage ticket channels, send messages, embed links and read message history.

The bot must have permission to create channels under the configured category and manage channel permission overwrites.

## Health endpoints

- `/` returns a simple JSON service status.
- `/health` returns HTTP 200 while the web process is running and reports whether Discord is connected.
- `/ready` returns HTTP 200 when Discord is ready and HTTP 503 while it is starting.

## Free Web Service limitations

Render Free Web Services can spin down after a period without inbound HTTP traffic. A Discord Gateway connection does not prevent this. When the service sleeps, the bot disconnects until the web service starts again. Therefore this is suitable for testing, not guaranteed 24/7 production operation.

## Important API compatibility note

The bot expects these PHP API routes to exist and return the documented data shapes:

- `GET /api/bot/panels?guild_id=<discord-server-id>` returns `{ "panels": [...] }`
- `POST /api/bot/servers/upsert`
- `POST /api/bot/panel-publish`
- `POST /api/bot/ticket-create`
- `POST /api/bot/ticket-update`

The PHP dashboard API must authenticate `X-API-Secret` and `X-Timestamp`. The timestamp should be checked server-side with a short allowed clock window. Confirm the exact route paths and response formats against the deployed PHP API before relying on the bot.

## Local check

```bash
npm install
npm run check
npm start
```


## Discord OAuth2 proxy for InfinityFree

The same Render Web Service also handles dashboard Discord login, because InfinityFree shared hosting may not resolve/reach Discord API hosts.

In Discord Developer Portal -> OAuth2 -> Redirects, add this exact URL:

`https://dibiaa-bot.onrender.com/oauth/discord/callback`

Set these Render environment variables:
- `DISCORD_CLIENT_SECRET`: Discord OAuth2 Client Secret (private).
- `DISCORD_OAUTH_REDIRECT_URI`: `https://dibiaa-bot.onrender.com/oauth/discord/callback`
- `DASHBOARD_CALLBACK_URL`: `https://dibiaa.free.nf/auth/callback.php`
- `API_SECRET`: a new random secret shared with `htdocs/config/local.php`.

The website login button redirects to `/oauth/discord/start`. Render exchanges the OAuth code with Discord and redirects the browser to the PHP callback with a 5-minute HMAC-signed, one-time handoff. The PHP callback validates the signature, expiry, audience, and replay nonce before creating the session.

Do not put `DISCORD_CLIENT_SECRET`, `DISCORD_TOKEN`, database passwords or `API_SECRET` in GitHub.
