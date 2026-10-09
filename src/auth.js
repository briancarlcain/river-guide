// Optional accounts (Supabase Auth): email one-time code, Google, Apple.
// Everything works without an account; signing in adds backup and sync across the user's devices.
import { GoTrueClient } from '@supabase/auth-js';
import { Browser } from '@capacitor/browser';
import { isNative } from './native.js';
import { API_KEY, SYNC_ORIGIN, setTokenSource } from './sync.js';

const NATIVE_REDIRECT = 'riverguide://auth-callback';
const redirectTo = () => (isNative ? NATIVE_REDIRECT : location.origin + location.pathname);

// created on first use, i.e. after native.js has restored mirrored storage
let _auth;
const A = () =>
  (_auth ||= new GoTrueClient({
  url: `${SYNC_ORIGIN}/auth/v1`,
  headers: { apikey: API_KEY },
  storageKey: 'riverguide.auth', // mirrored to native Preferences by native.js
  flowType: 'pkce',
  detectSessionInUrl: !isNative,
  autoRefreshToken: true,
  persistSession: true,
  }));

// requests to the sync server use the signed-in user's token (refreshed when needed)
setTokenSource(async () => {
  const { data } = await A().getSession();
  return data && data.session ? data.session.access_token : null;
});

export const getSession = async () => (await A().getSession()).data.session;
export const onSession = (cb) => {
  const { data } = A().onAuthStateChange((_evt, session) => cb(session));
  return () => data.subscription.unsubscribe();
};

// which sign-in methods the server has switched on (so the screen only offers working ones)
export async function loadProviders() {
  try {
    const r = await fetch(`${SYNC_ORIGIN}/auth/v1/settings`, { headers: { apikey: API_KEY } });
    const j = await r.json();
    const ext = j.external || {};
    return { email: !!ext.email, google: !!ext.google, apple: !!ext.apple };
  } catch {
    return { email: false, google: false, apple: false, offline: true };
  }
}

const must = ({ error }) => {
  if (error) throw new Error(error.message || 'Sign-in failed');
};

export const emailCode = async (email) =>
  must(await A().signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true, emailRedirectTo: redirectTo() } }));

export const verifyCode = async (email, token) => must(await A().verifyOtp({ email: email.trim(), token: token.replace(/\s/g, ''), type: 'email' }));

export async function oauth(provider) {
  const { data, error } = await A().signInWithOAuth({ provider, options: { redirectTo: redirectTo(), skipBrowserRedirect: isNative } });
  if (error) throw new Error(error.message);
  if (isNative && data && data.url) await Browser.open({ url: data.url }); // returns to the app via riverguide://auth-callback
}

// riverguide://auth-callback?code=... (OAuth return or an emailed link opened on this device)
export async function handleAuthUrl(url) {
  try {
    const u = new URL(url);
    const err = u.searchParams.get('error_description') || (u.hash && new URLSearchParams(u.hash.slice(1)).get('error_description'));
    if (err) throw new Error(err);
    const code = u.searchParams.get('code');
    if (code) must(await A().exchangeCodeForSession(code));
  } finally {
    if (isNative) Browser.close().catch(() => {});
  }
}

export const signOut = () => A().signOut({ scope: 'local' });
