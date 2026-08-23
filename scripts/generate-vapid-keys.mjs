#!/usr/bin/env node
/* Generates a VAPID keypair for Web Push (RFC 8292). Zero dependencies.
   Run once:  node scripts/generate-vapid-keys.mjs
   Then store the values as Supabase Edge Function secrets:
     supabase secrets set \
       VAPID_PUBLIC_KEY=<public> \
       VAPID_PRIVATE_KEY=<private> \
       PUSH_SUBJECT=mailto:you@example.com
   The public key is safe to expose (the app fetches it at subscribe time);
   the private key must only live in server-side secrets. */

import { webcrypto } from 'node:crypto';

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function main() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const pubRaw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const d = Buffer.from(jwk.d, 'base64');

  console.log('VAPID keys generated (P-256 / base64url):\n');
  console.log(`VAPID_PUBLIC_KEY=${b64url(pubRaw)}`);
  console.log(`VAPID_PRIVATE_KEY=${b64url(d)}`);
  console.log('\nStore them (private key NEVER in client code):');
  console.log('  supabase secrets set \\');
  console.log(`    VAPID_PUBLIC_KEY=${b64url(pubRaw)} \\`);
  console.log(`    VAPID_PRIVATE_KEY=${b64url(d)} \\`);
  console.log('    PUSH_SUBJECT=mailto:you@example.com');
}

main().catch(err => { console.error(err); process.exit(1); });
