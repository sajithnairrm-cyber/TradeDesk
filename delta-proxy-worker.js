/* ============================================================================
   Trade Desk — Delta P&L proxy (Cloudflare Worker)

   Why this exists
   ---------------
   Delta's authenticated endpoints must be signed with your API SECRET. In a
   static PWA that secret would sit in the browser, where anything can read it.
   This Worker holds the secret server-side, signs each request, and returns
   ONLY your fills to the app. The browser never sees the secret.

   It is deliberately read-only: it exposes exactly one upstream path
   (/v2/fills) and refuses everything else, so even a stolen Worker URL can do
   nothing but read your trade history.

   Setup (all in the Cloudflare dashboard — no files to edit)
   ----------------------------------------------------------
   1.  On Delta India: Profile -> API Management -> Create New API Key.
       Permission: READ DATA ONLY. Do NOT enable Trading or Withdrawal.
       (If Delta offers IP whitelisting, whitelist nothing / leave open —
       Cloudflare Workers do not have a fixed egress IP.)
   2.  Workers & Pages -> Create -> Worker. Name it e.g. trade-desk-delta.
       Paste this file as the Worker code and Deploy.
   3.  Worker -> Settings -> Variables and Secrets. Add two SECRETS
       (type: Secret, not plaintext):
         DELTA_API_KEY     = your Delta API key
         DELTA_API_SECRET  = your Delta API secret
       Add one PLAINTEXT variable:
         ALLOW_ORIGIN      = https://sajithnairrm-cyber.github.io
       (your exact site origin — scheme + host, no path, no trailing slash)
   4.  Optional but recommended — set a shared token so only your app can call
       the Worker. Add a SECRET:
         CLIENT_TOKEN      = any long random string
       then paste the same string into Trade Desk when it asks.
   5.  Copy the Worker URL (…workers.dev) into Trade Desk's P&L -> Sync setup.

   The Worker returns Delta's fills JSON unchanged, plus CORS headers for
   your origin only.
   ========================================================================= */

const DELTA_BASE = 'https://api.india.delta.exchange';
const ALLOWED_PATHS = new Set(['/v2/fills']);   // read-only allow-list

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, x-client-token',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };

    // Pre-flight
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, cors);

    // Config sanity
    if (!env.DELTA_API_KEY || !env.DELTA_API_SECRET) {
      return json({ error: 'worker_not_configured', detail: 'Set DELTA_API_KEY and DELTA_API_SECRET as Worker secrets.' }, 500, cors);
    }

    // Optional shared-token gate — blocks strangers who find the URL
    if (env.CLIENT_TOKEN) {
      const sent = request.headers.get('x-client-token') || new URL(request.url).searchParams.get('token');
      if (sent !== env.CLIENT_TOKEN) return json({ error: 'unauthorized' }, 401, cors);
    }

    const inUrl = new URL(request.url);
    // The app calls  <worker>/v2/fills?...  — we forward only allow-listed paths.
    const path = inUrl.pathname === '/' ? '/v2/fills' : inUrl.pathname;
    if (!ALLOWED_PATHS.has(path)) return json({ error: 'path_not_allowed', path }, 403, cors);

    // Whitelisted query params only, in a fixed order, so the signature is
    // deterministic and nothing unexpected is forwarded upstream.
    const allowedQuery = ['product_ids', 'contract_types', 'start_time', 'end_time', 'after', 'before', 'page_size'];
    const params = new URLSearchParams();
    for (const k of allowedQuery) {
      const v = inUrl.searchParams.get(k);
      if (v !== null && v !== '') params.set(k, v);
    }
    if (!params.has('page_size')) params.set('page_size', '100');
    const query = params.toString() ? '?' + params.toString() : '';

    // ---- Delta signature: HMAC-SHA256( method + timestamp + path + query ) ----
    const method = 'GET';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const prehash = method + timestamp + path + query;
    const signature = await hmacHex(env.DELTA_API_SECRET, prehash);

    let upstream;
    try {
      upstream = await fetch(DELTA_BASE + path + query, {
        method,
        headers: {
          'api-key': env.DELTA_API_KEY,
          'timestamp': timestamp,
          'signature': signature,
          'Accept': 'application/json',
          'User-Agent': 'trade-desk-proxy'
        }
      });
    } catch (err) {
      return json({ error: 'upstream_unreachable', detail: String(err) }, 502, cors);
    }

    const bodyText = await upstream.text();
    // Pass Delta's status through so the app can show real error messages
    // (e.g. bad signature, revoked key) rather than a generic failure.
    return new Response(bodyText, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
};

/* ---- helpers ---- */
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
