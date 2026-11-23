import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const root = path.dirname(fileURLToPath(import.meta.url));

export const SHOPIFY_STORE_NAME = process.env.SHOPIFY_STORE_NAME;
export const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
export const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
export const SCOPES = 'read_products,read_inventory,read_locations';
export const REDIRECT_URI = 'http://localhost:3456/callback';
export const SESSION_PATH = path.join(root, '.shopify-session.json');

if (!SHOPIFY_STORE_NAME || !SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
  throw new Error(
    'Set SHOPIFY_STORE_NAME, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET in .env.'
  );
}

export function shopifyErrorDetail(error) {
  const data = error.response?.data;
  if (typeof data === 'string') {
    const oauthError = data.match(/Oauth error [^<]+/);
    if (oauthError) return oauthError[0].replace(/\s+/g, ' ').trim();
    return `HTTP ${error.response.status}`;
  }
  if (data) return JSON.stringify(data);
  return error.message;
}

export function readSession() {
  if (!fs.existsSync(SESSION_PATH)) return null;
  return JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
}

export function writeSession(session) {
  fs.writeFileSync(SESSION_PATH, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
}

function tokenUrl() {
  return `https://${SHOPIFY_STORE_NAME}.myshopify.com/admin/oauth/access_token`;
}

function sessionFromTokenResponse(data, previous = {}) {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || previous.refresh_token || null,
    scope: data.scope || previous.scope || null,
    expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    refresh_token_expires_at: data.refresh_token_expires_in
      ? Date.now() + data.refresh_token_expires_in * 1000
      : previous.refresh_token_expires_at ?? null,
  };
}

export async function exchangeAuthorizationCode(code) {
  try {
    const response = await axios.post(
      tokenUrl(),
      new URLSearchParams({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        code,
        expiring: '1',
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      }
    );
    return sessionFromTokenResponse(response.data);
  } catch (error) {
    throw new Error(`Shopify token exchange failed: ${shopifyErrorDetail(error)}`);
  }
}

async function refreshSession(session) {
  try {
    const response = await axios.post(
      tokenUrl(),
      new URLSearchParams({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: session.refresh_token,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      }
    );
    const next = sessionFromTokenResponse(response.data, session);
    writeSession(next);
    console.log(`Shopify access token refreshed (scopes: ${next.scope})`);
    return next;
  } catch (error) {
    throw new Error(
      `Shopify token refresh failed: ${shopifyErrorDetail(error)}. Run npm run auth again.`
    );
  }
}

export async function getAccessToken() {
  const session = readSession();
  if (!session?.access_token) {
    throw new Error('No Shopify session. Run npm run auth and approve the app in the browser.');
  }

  const stillValid = !session.expires_at || Date.now() < session.expires_at - 60_000;
  if (stillValid) return session.access_token;

  if (!session.refresh_token) {
    throw new Error('Shopify access token expired. Run npm run auth again.');
  }

  const next = await refreshSession(session);
  return next.access_token;
}
