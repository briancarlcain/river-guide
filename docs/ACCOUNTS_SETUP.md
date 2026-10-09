# Turning on accounts (one-time setup in the Supabase dashboard)

The app code and database are finished and tested (email code sign-in, trip backup/sync across devices, sign out,
**delete account** as Apple requires). What is left are settings that live in the Supabase dashboard and in Google /
Apple's consoles, because they need your secrets. Until you do them, the Account screen only offers the methods the
server reports as enabled (today: email) and hides the rest.

Project: **river-guide-sync** · dashboard: https://supabase.com/dashboard/project/nhplgoetehrydaeoyrgz

## 1. Redirect URLs (required)
Authentication → URL Configuration
- **Site URL:** `https://briancarlcain.github.io/river-guide/`
- **Redirect URLs** (add both): `https://briancarlcain.github.io/river-guide/` and `riverguide://auth-callback`

## 2. Email: send a code, not just a link (required)
Authentication → Emails → Templates. Edit **Magic Link** *and* **Confirm signup** so the email shows the six-digit code
(the app has a box for it; the link alone only works when opened on the same device). Suggested body:

```html
<h2>Your River Guide code</h2>
<p>Enter this code in the app to sign in:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:4px">{{ .Token }}</p>
<p>If you did not ask for this, you can ignore this email.</p>
```

## 3. Custom SMTP (required before real users)
Supabase's built-in mailer only sends a couple of emails an hour and, on new projects, only to your own team's addresses.
Authentication → Emails → **SMTP Settings** → enable custom SMTP with a provider such as Resend, Postmark or SendGrid
(you need a domain you can add DNS records to; use a sender like `no-reply@yourdomain`). Then raise
Authentication → Rate Limits → *Emails sent per hour* to something sensible.

## 4. Sign in with Google (optional)
1. Google Cloud Console → APIs & Services → OAuth consent screen (External; app name River Guide; add your privacy-policy URL).
2. Credentials → Create credentials → **OAuth client ID** → *Web application*.
   Authorized redirect URI: `https://nhplgoetehrydaeoyrgz.supabase.co/auth/v1/callback`
3. Supabase → Authentication → Sign In / Providers → **Google** → paste the client ID and secret → enable.

## 5. Sign in with Apple (required if you turn on Google)
App Store rule 4.8: an iPhone app that offers Google sign-in must also offer Sign in with Apple. The app enforces this: on
iPhone it hides the Google button unless Apple is enabled too.
1. Apple Developer → Identifiers → your App ID `com.briancarlcain.riverguide` → enable **Sign in with Apple**.
2. Identifiers → **Services IDs** → create e.g. `com.briancarlcain.riverguide.signin` → enable Sign in with Apple → Configure:
   primary App ID above, domain `nhplgoetehrydaeoyrgz.supabase.co`, return URL `https://nhplgoetehrydaeoyrgz.supabase.co/auth/v1/callback`.
3. Keys → create a key with Sign in with Apple enabled; download the `.p8`; note the Key ID and your Team ID.
4. Supabase → Authentication → Sign In / Providers → **Apple** → Client ID = the Services ID; paste the secret key JWT
   (Supabase's docs link a generator). **Apple's client secret expires every 6 months**; put a reminder in your calendar.

## 6. App Store Connect
- App Privacy: *Contact Info → Email Address* (linked to the user, App Functionality) and *User Content → Other User Content* (linked to the user, App Functionality). Tracking: No.
- Review notes: give the reviewer a way in. Easiest: tell them accounts are optional and the whole app works without signing in.

## What the account does
- Signed in, every trip on the device is backed up and kept in sync on the user's other devices (same merge engine as crew sharing).
- A trip shared with a join code belongs to the account, so the owner can stop sharing from any device.
- Signing out keeps the trips on the device (or removes them if the user chooses). **Delete my account** erases the account, its backed-up trips and any trips it shared, on the server.
- The fictional sample trip is never uploaded.

## Test accounts
The app has no password login. Once SMTP is set up, test with your own email. Before that, you can create a user in the dashboard (Authentication → Users → Add user, auto-confirm) to check the database side.
