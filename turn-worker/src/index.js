/*
 * Hands out short-lived Cloudflare TURN logins to the Pips duel page, so
 * players whose networks block direct WebRTC connections can still meet
 * through the relay. The API token stays here; browsers only ever see
 * logins that expire after TTL_SECONDS.
 *
 * Usage cap: every 15 minutes (see wrangler.toml) the Worker reads this
 * month's TURN traffic from Cloudflare's analytics and stores it. Once it
 * passes CAP_GB, no more logins are handed out until next month (duels fall
 * back to direct connections) and one email is sent through Resend.
 */

const TTL_SECONDS = 60 * 60;
const GB = 1e9;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
    if (!allowed.includes(origin)) return new Response('Forbidden', { status: 403 });
    const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    const usage = await env.USAGE.get('usage', 'json');
    if (usage && usage.month === currentMonth() && usage.bytes >= capBytes(env)) {
      return new Response('Monthly relay limit reached', { status: 503, headers: cors });
    }

    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
      },
    );
    if (!res.ok) return new Response('TURN unavailable', { status: 502, headers: cors });
    const { iceServers } = await res.json();

    // Keep only TURN entries (trystero brings its own STUN servers) and drop
    // port 53 URLs, which browsers block and would only wait to time out on.
    const turn = (Array.isArray(iceServers) ? iceServers : [iceServers])
      .map((s) => ({ ...s, urls: [s.urls].flat().filter((u) => u.startsWith('turn') && !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length > 0 && s.username);

    return Response.json(
      { iceServers: turn, ttl: TTL_SECONDS },
      { headers: { ...cors, 'Cache-Control': 'no-store' } },
    );
  },

  async scheduled(_event, env) {
    const month = currentMonth();
    const bytes = await monthlyEgressBytes(env, month);
    await env.USAGE.put('usage', JSON.stringify({ month, bytes, checkedAt: new Date().toISOString() }));

    const cap = capBytes(env);
    if (bytes < cap || (await env.USAGE.get(`notified:${month}`))) return;
    await sendEmail(
      env,
      `Pips duels: TURN relay limit reached for ${month}`,
      `The TURN relay has used ${(bytes / GB).toFixed(1)} GB this month, over the ${env.CAP_GB} GB limit.\n\n` +
        `The Worker has stopped handing out relay logins until next month. Duels still work over direct ` +
        `connections, but players on strict networks may not connect.\n\n` +
        `To allow more, raise CAP_GB in turn-worker/wrangler.toml and run npx wrangler deploy.`,
    );
    await env.USAGE.put(`notified:${month}`, '1', { expirationTtl: 40 * 24 * 60 * 60 });
  },
};

/** "2026-10", in UTC like Cloudflare's billing. */
function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function capBytes(env) {
  return Number(env.CAP_GB) * GB;
}

/** Bytes the TURN servers sent to players this month: what Cloudflare bills for. */
async function monthlyEgressBytes(env, month) {
  const query = `query ($account: string!, $key: string!, $from: Date!, $to: Date!) {
    viewer {
      accounts(filter: { accountTag: $account }) {
        callsTurnUsageAdaptiveGroups(limit: 1, filter: { keyId: $key, date_geq: $from, date_leq: $to }) {
          sum { egressBytes }
        }
      }
    }
  }`;
  const variables = {
    account: env.CF_ACCOUNT_ID,
    key: env.TURN_KEY_ID,
    from: `${month}-01`,
    to: new Date().toISOString().slice(0, 10),
  };
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors?.length) throw new Error(`Usage query failed: ${JSON.stringify(data.errors ?? res.status)}`);
  const rows = data.data.viewer.accounts[0]?.callsTurnUsageAdaptiveGroups ?? [];
  return rows[0]?.sum.egressBytes ?? 0;
}

async function sendEmail(env, subject, text) {
  // Resend's test sender can mail the address the Resend account was made with, no domain needed.
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Pips duels <onboarding@resend.dev>', to: [env.NOTIFY_EMAIL], subject, text }),
  });
  if (!res.ok) throw new Error(`Email failed: ${res.status} ${await res.text()}`);
}
