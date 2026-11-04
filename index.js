const http = require('node:http');
const crypto = require('node:crypto');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  REST,
  Routes,
  Events
} = require('discord.js');

const config = require('./src/config/config');
const { info, error } = require('./src/utils/logger');
const { api } = require('./src/services/apiService');
const { createTicket, ticketAction } = require('./src/services/ticketService');
const panelCommand = require('./src/commands/ticket-panel');

let botReady = false;
let shuttingDown = false;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

client.commands = new Collection([
  ['ticket-panel', panelCommand]
]);


// OAuth2 is proxied through Render because InfinityFree cannot make outbound
// requests to Discord. The website receives only a short-lived signed handoff.
const OAUTH_STATE_COOKIE = '__Host-dibiaa_oauth_state';
const OAUTH_STATE_TTL_SECONDS = 600;
const DASHBOARD_CALLBACK_URL = process.env.DASHBOARD_CALLBACK_URL || 'https://dibiaa.free.nf/auth/callback.php';
const DISCORD_OAUTH_REDIRECT_URI = process.env.DISCORD_OAUTH_REDIRECT_URI || 'https://dibiaa-bot.onrender.com/oauth/discord/callback';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}
function hmacHex(value) {
  return crypto.createHmac('sha256', config.apiSecret).update(value).digest('hex');
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sendText(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}
async function handleOAuth(req, res, pathname, requestUrl) {
  if (pathname === '/oauth/discord/start' && req.method === 'GET') {
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!clientSecret) return sendText(res, 503, 'Discord OAuth is not configured on Render.');
    const state = crypto.randomBytes(32).toString('hex');
    const stateCookie = `${state}.${hmacHex(state)}`;
    const authorize = new URL('https://discord.com/oauth2/authorize');
    authorize.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: DISCORD_OAUTH_REDIRECT_URI,
      response_type: 'code',
      scope: 'identify',
      state
    }).toString();
    res.writeHead(302, {
      'Location': authorize.toString(),
      'Cache-Control': 'no-store',
      'Set-Cookie': `${OAUTH_STATE_COOKIE}=${encodeURIComponent(stateCookie)}; Max-Age=${OAUTH_STATE_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`
    });
    return res.end();
  }

  if (pathname === '/oauth/discord/callback' && req.method === 'GET') {
    const code = requestUrl.searchParams.get('code');
    const returnedState = requestUrl.searchParams.get('state');
    const cookies = parseCookies(req.headers.cookie || '');
    const stateCookie = cookies[OAUTH_STATE_COOKIE] || '';
    const stateParts = stateCookie.split('.');
    if (!code || !returnedState || stateParts.length !== 2 ||
        !safeEqual(stateParts[0], returnedState) ||
        !safeEqual(stateParts[1], hmacHex(stateParts[0]))) {
      return sendText(res, 400, 'OAuth state validation failed. Please start login again.');
    }

    try {
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: DISCORD_OAUTH_REDIRECT_URI
        })
      });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenData.access_token) {
        throw new Error(`Discord token exchange failed (HTTP ${tokenResponse.status}).`);
      }

      const profileResponse = await fetch('https://discord.com/api/users/@me', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Accept': 'application/json' }
      });
      const profile = await profileResponse.json();
      if (!profileResponse.ok || !profile.id || !profile.username) {
        throw new Error(`Discord profile request failed (HTTP ${profileResponse.status}).`);
      }

      let avatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png';
      if (profile.avatar) {
        const ext = String(profile.avatar).startsWith('a_') ? 'gif' : 'png';
        avatarUrl = `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${ext}?size=128`;
      }

      const now = Math.floor(Date.now() / 1000);
      const handoffPayload = {
        iss: 'dibiaa-render-oauth',
        aud: 'https://dibiaa.free.nf',
        iat: now,
        exp: now + 300,
        nonce: crypto.randomBytes(24).toString('hex'),
        id: String(profile.id),
        username: String(profile.username),
        display_name: String(profile.global_name || profile.username),
        avatar_url: avatarUrl
      };
      const encoded = base64url(JSON.stringify(handoffPayload));
      const handoff = `${encoded}.${hmacHex(encoded)}`;
      const destination = new URL(DASHBOARD_CALLBACK_URL);
      destination.searchParams.set('handoff', handoff);

      res.writeHead(302, {
        'Location': destination.toString(),
        'Cache-Control': 'no-store',
        'Set-Cookie': `${OAUTH_STATE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
        'Referrer-Policy': 'no-referrer'
      });
      return res.end();
    } catch (err) {
      error('Discord OAuth callback failed', err);
      return sendText(res, 502, 'Discord login could not be completed. Please try again.');
    }
  }

  return false;
}

// Render Web Services must listen on the PORT environment variable.
const PORT = Number(process.env.PORT || 10000);

const healthServer = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;

  if (pathname.startsWith('/oauth/discord/')) {
    const handled = await handleOAuth(req, res, pathname, requestUrl);
    if (handled !== false) return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: 'Method not allowed' }));
    return;
  }

  if (pathname === '/' || pathname === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify({
      service: 'Dibiaa Discord Ticket Bot',
      status: 'online',
      discord_connected: client.isReady(),
      uptime_seconds: Math.floor(process.uptime())
    }));
    return;
  }

  if (pathname === '/ready') {
    const ready = client.isReady();
    res.writeHead(ready ? 200 : 503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify({
      status: ready ? 'ready' : 'starting',
      discord_connected: ready
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'error', message: 'Not found' }));
});

healthServer.listen(PORT, '0.0.0.0', () => {
  info(`HTTP health server listening on 0.0.0.0:${PORT}`);
});

healthServer.on('error', (err) => {
  error('HTTP server error', err);
  if (!shuttingDown) process.exitCode = 1;
});

client.once(Events.ClientReady, async (readyClient) => {
  botReady = true;
  info(`Connected to Discord as ${readyClient.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(config.token);

  try {
    await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: [panelCommand.data.toJSON()] }
    );
    info('Slash commands synchronized successfully');
  } catch (err) {
    error('Slash command registration failed', err);
  }

  for (const guild of readyClient.guilds.cache.values()) {
    try {
      await api('servers/upsert', 'POST', {
        guild_id: guild.id,
        name: guild.name,
        icon_url: guild.iconURL()
      });
      info(`Server synchronized: ${guild.name} (${guild.id})`);
    } catch (err) {
      error(`Server sync failed for ${guild.id}`, err.message);
    }
  }
});

client.on(Events.GuildCreate, async (guild) => {
  try {
    await api('servers/upsert', 'POST', {
      guild_id: guild.id,
      name: guild.name,
      icon_url: guild.iconURL()
    });
    info(`Joined and synchronized server: ${guild.name} (${guild.id})`);
  } catch (err) {
    error(`Guild sync failed for ${guild.id}`, err.message);
  }
});

client.on(Events.GuildDelete, (guild) => {
  info(`Removed from server: ${guild.id}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (command) await command.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      const [kind, action, id] = interaction.customId.split(':');

      if (kind === 'panel' && action === 'create') {
        await interaction.deferReply({ ephemeral: true });
        await createTicket(interaction, Number(id));
        return;
      }

      if (kind === 'ticket') {
        await ticketAction(interaction, action, id);
      }
    }
  } catch (err) {
    error('Interaction failed', err);

    const message = {
      content: err.message || 'Something went wrong. Please try again.',
      ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(message).catch(() => {});
    } else {
      await interaction.reply(message).catch(() => {});
    }
  }
});

// Keep this listener lightweight. Do not call the dashboard API for every
// message until a real ticket-message persistence endpoint is implemented.
client.on(Events.MessageCreate, (message) => {
  if (message.author.bot || !message.guild) return;
  // Ticket message history persistence is not implemented in this release.
});

client.on(Events.Error, (err) => error('Discord client error', err));
client.on(Events.ShardError, (err, shardId) => error(`Discord shard ${shardId} error`, err));

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  info(`${signal} received. Shutting down Dibiaa bot...`);

  botReady = false;

  await new Promise((resolve) => {
    if (!healthServer.listening) return resolve();
    healthServer.close(() => resolve());
  });

  try {
    client.destroy();
  } catch (err) {
    error('Error while destroying Discord client', err);
  }

  process.exit(0);
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  error('Unhandled promise rejection', reason);
});

process.on('uncaughtException', (err) => {
  error('Uncaught exception. Process will shut down.', err);
  shutdown('uncaughtException');
});

client.login(config.token).catch((err) => {
  error('Discord login failed. Check DISCORD_TOKEN and bot configuration.', err);
  process.exit(1);
});
