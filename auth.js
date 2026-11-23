import http from 'http';
import crypto from 'crypto';
import { execFile } from 'child_process';
import {
  SHOPIFY_STORE_NAME,
  SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET,
  SCOPES,
  REDIRECT_URI,
  exchangeAuthorizationCode,
  writeSession,
} from './shopifyAuth.js';

const expectedShop = `${SHOPIFY_STORE_NAME}.myshopify.com`;
const redirectUrl = new URL(REDIRECT_URI);
const state = crypto.randomBytes(16).toString('hex');

function isValidShop(shop) {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

function verifyHmac(searchParams) {
  const hmac = searchParams.get('hmac') || '';
  const message = [...searchParams.entries()]
    .filter(([key]) => key !== 'hmac')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const digest = crypto.createHmac('sha256', SHOPIFY_CLIENT_SECRET).update(message).digest('hex');
  const digestBuf = Buffer.from(digest);
  const hmacBuf = Buffer.from(hmac);
  return digestBuf.length === hmacBuf.length && crypto.timingSafeEqual(digestBuf, hmacBuf);
}

function missingScopes(grantedScope) {
  const granted = (grantedScope || '').split(',').filter(Boolean);
  return SCOPES.split(',').filter((scope) => {
    if (granted.includes(scope)) return false;
    return !(scope.startsWith('read_') && granted.includes(`write_${scope.slice(5)}`));
  });
}

const authUrl = `https://${expectedShop}/admin/oauth/authorize?${new URLSearchParams({
  client_id: SHOPIFY_CLIENT_ID,
  scope: SCOPES,
  redirect_uri: REDIRECT_URI,
  state,
})}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== redirectUrl.pathname) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const finish = (status, message) => {
    if (status !== 200) process.exitCode = 1;
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><p>${message}</p>`);
    server.close(() => process.exit(process.exitCode || 0));
  };

  try {
    const callbackState = url.searchParams.get('state');
    const shop = url.searchParams.get('shop') || '';
    const code = url.searchParams.get('code');

    if (!callbackState || callbackState !== state) {
      finish(403, 'Authorization failed: invalid state.');
      return;
    }
    if (!verifyHmac(url.searchParams)) {
      finish(403, 'Authorization failed: invalid HMAC.');
      return;
    }
    if (!isValidShop(shop) || shop !== expectedShop) {
      finish(400, 'Authorization failed: unexpected shop.');
      return;
    }
    if (!code) {
      finish(400, 'Authorization failed: Shopify did not return a code.');
      return;
    }

    const session = await exchangeAuthorizationCode(code);
    const missing = missingScopes(session.scope);
    if (missing.length) {
      finish(403, `Authorization failed: missing scopes ${missing.join(', ')}.`);
      return;
    }

    writeSession(session);
    console.log(`Shopify session saved (scopes: ${session.scope})`);
    finish(200, 'Authorized. You can close this tab and return to the terminal.');
  } catch (error) {
    console.error(error.message);
    finish(500, 'Authorization failed. See the terminal for details.');
  }
});

server.listen(Number(redirectUrl.port), () => {
  console.log(`Waiting for Shopify to redirect to ${REDIRECT_URI}`);
  console.log('If the browser shows a redirect error, add that URL to the app\'s allowed redirection URLs and release the version, then run this again.');
  console.log(authUrl);
  execFile('open', [authUrl]);
});
