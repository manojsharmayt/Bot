require('dotenv').config();
const required = ['DISCORD_TOKEN','DISCORD_CLIENT_ID','API_BASE_URL','API_SECRET'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
module.exports = {
 token: process.env.DISCORD_TOKEN,
 clientId: process.env.DISCORD_CLIENT_ID,
 apiBase: process.env.API_BASE_URL.replace(/\/$/,''),
 apiSecret: process.env.API_SECRET,
 dashboardUrl: process.env.DASHBOARD_URL || 'https://dibiaa.free.nf'
};
