// Crew sync client. A shared trip lives in one server row addressed by an unguessable
// 16-character join code; there are no accounts. The server only ever sees the code's
// hash (see the shared_trips functions in supabase/migrations). Merging happens on the
// device (merge.js); the server just stores versions and rejects stale writes.
const BASE = 'https://nhplgoetehrydaeoyrgz.supabase.co/rest/v1/rpc';
const KEY = 'sb_publishable_eJ0X3vnbOK09gLhPigYiSQ_TWnyQrk3'; // publishable by design; safe to ship

export const SYNC_ORIGIN = 'https://nhplgoetehrydaeoyrgz.supabase.co';

async function rpc(fn, body) {
  const r = await fetch(`${BASE}/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  const json = text ? JSON.parse(text) : null;
  if (!r.ok) {
    const e = new Error((json && json.message) || `HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return json;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/1/I/O; all valid for the server's [A-Z2-9] check
const random = (n, alphabet) => {
  const limit = 256 - (256 % alphabet.length); // reject biased bytes
  let out = '';
  while (out.length < n) {
    const buf = new Uint8Array(n * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) if (b < limit && out.length < n) out += alphabet[b % alphabet.length];
  }
  return out;
};
export const newCode = () => random(16, ALPHABET);
export const newSecret = () => random(32, ALPHABET + ALPHABET.toLowerCase());

// "abcd-efgh ..." -> "ABCDEFGH..." ; returns '' unless it looks like a join code
export const cleanCode = (s) => {
  const c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z2-9]{16}$/.test(c) ? c : '';
};
export const showCode = (c) => c.replace(/(.{4})(?=.)/g, '$1-');

export const create = (code, owner, data) => rpc('share_create', { p_code: code, p_owner: owner, p_data: data });
export const get = (code, have) => rpc('share_get', { p_code: code, p_have: have || 0 });
export const put = (code, base, data) => rpc('share_put', { p_code: code, p_base: base, p_data: data });
export const del = (code, owner) => rpc('share_delete', { p_code: code, p_owner: owner });
