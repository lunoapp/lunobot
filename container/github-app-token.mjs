/**
 * Generate a GitHub App installation access token.
 *
 * Reads from environment variables:
 *   GITHUB_APP_ID              — GitHub App ID
 *   GITHUB_APP_INSTALLATION_ID — Installation ID
 *   GITHUB_APP_PRIVATE_KEY     — PEM private key (base64-encoded)
 *
 * Outputs the token to stdout (consumed by entrypoint.sh).
 */

import crypto from 'crypto';

const appId = process.env.GITHUB_APP_ID;
const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
const privateKeyB64 = process.env.GITHUB_APP_PRIVATE_KEY;

if (!appId || !installationId || !privateKeyB64) {
  process.exit(1);
}

const privateKey = Buffer.from(privateKeyB64, 'base64').toString('utf8');

// Create JWT (RS256)
const now = Math.floor(Date.now() / 1000);
const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId })).toString('base64url');
const signature = crypto.sign('sha256', Buffer.from(header + '.' + payload), privateKey).toString('base64url');
const jwt = header + '.' + payload + '.' + signature;

// Exchange JWT for installation access token
const res = await fetch(
  `https://api.github.com/app/installations/${installationId}/access_tokens`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
    },
  },
);

const data = await res.json();
if (data.token) {
  process.stdout.write(data.token);
} else {
  process.exit(1);
}
