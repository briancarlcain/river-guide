# Publishing River Guide on the App Store

The app is the same React code as the website, wrapped with [Capacitor](https://capacitorjs.com) as a native iPhone app.
There are two builds from one codebase:

| Command | Output | Contents |
|---|---|---|
| `npm run build` | `index.html` (GitHub Pages) | Includes the private Grand Canyon 2026 trip |
| `npm run build:app` | `www/index.html` (App Store) | A fictional **sample trip** only; no crew names, payments or outfitter price lines |

Never ship the web build inside the app: `build.mjs` swaps the seed files for the sample when you pass `app`.

## What is already done

- iOS project in `ios/` (bundle ID `com.briancarlcain.riverguide`, iPhone only, portrait, iOS 15+)
- App icon (1024 px) and splash from `resources/icon.svg` (replace `resources/icon.svg` with final artwork any time, then run `node resources/make-assets.mjs`)
- `ITSAppUsesNonExemptEncryption = false`, privacy manifest (`PrivacyInfo.xcprivacy`: no tracking, no data collected)
- Data survives iOS storage clean-up (mirrored to native Preferences)
- Native touches: haptics, share sheet (trip summary, backup file), opt-in trip reminders (local notifications), status bar and keyboard handling
- General → About: version, backup / restore, reminders, safety and sources, privacy policy, support, erase-all-data
- Safety disclaimer on the Medical tab (App Review guideline 1.4.1)
- Privacy policy page: `privacy.html` (published at https://briancarlcain.github.io/river-guide/privacy.html)
- CI that builds and uploads to TestFlight from GitHub (no Mac needed): `.github/workflows/ios-testflight.yml`
- **Crew sync** (Share with crew / Join a trip, no accounts): Supabase project `river-guide-sync`, schema in `supabase/migrations/`, merge logic in `src/merge.js` (tested with `npm test`), `riverguide://join/CODE` links
- **Add to Calendar** (.ics) and **Share trip summary** from a trip's Settings
- **App Store screenshots**: seven 1320 x 2868 PNGs in `store/screenshots/`, regenerated with `npm run screenshots` (headless Edge/Chrome, fake status bar, fictional sample trip)
- **Content review checklist:** `docs/CONTENT_REVIEW.md` (open questions only you can answer)

## What you need to do

1. **Apple Developer Program** ($99/year) at developer.apple.com/programs. Individual enrollment is fine.
2. **Pick the bundle ID.** The placeholder is `com.briancarlcain.riverguide`. If you want another, change `appId` in `capacitor.config.json` and `PRODUCT_BUNDLE_IDENTIFIER` in `ios/App/App.xcodeproj/project.pbxproj` (two places) before registering it.
3. In **App Store Connect → Apps → +**, create the app (iOS, name "River Guide" or whatever is free, primary language English, that bundle ID, SKU anything).
4. **API key for CI:** App Store Connect → Users and Access → Integrations → Team Keys → generate a key with *App Manager* role. Download the `.p8` once. In the GitHub repo (Settings → Secrets and variables → Actions) add:
   `APPLE_TEAM_ID` (Membership page), `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (paste the whole file).
5. **Run the build:** GitHub → Actions → *iOS TestFlight* → Run workflow. About 10–15 minutes later the build appears in App Store Connect → TestFlight. Install it on your phone with the TestFlight app and test.
6. **Fill in the listing** (below), add screenshots, answer the questionnaires, and **Submit for review**.

If you do have a Mac, `npm run ios:sync && npm run ios:open` opens the project in Xcode instead.

## Listing copy (edit freely)

**Name:** River Guide  
**Subtitle (30 chars):** Plan multi-day river trips  
**Category:** Travel (secondary: Sports)  
**Price:** Free  
**Support URL:** https://github.com/briancarlcain/river-guide/issues (a page you control is better)  
**Privacy policy URL:** https://briancarlcain.github.io/river-guide/privacy.html  
**Keywords (100 chars):** rafting,river,canyon,float,whitewater,itinerary,campsite,shuttle,gear,outfitter,permit,crew,kayak,raft

**Promotional text:** Plan the whole trip in one place: crew, boats, camps, meals, gear costs and shuttles.

**Description:**

> River Guide is a planner for multi-day river trips: Grand Canyon, Smith River, Rogue River and any river you add.
>
> TRIPS — Keep as many trips as you like, each tied to a river. Duplicate last year's trip, share a summary with your crew.
>
> ITINERARY — Day-by-day plan with sunrise and sunset, camp picks, rapids you will run, and notes.
>
> CREW & CRAFTS — Roster, roles, who rows which boat, days on the river.
>
> MEALS & GEAR — Menu by day, a shopping list, and a gear list that works out who brings, rents or lends what and splits the cost fairly.
>
> SHUTTLE — Plan vehicles, boats and drivers between put-in, take-out and home on a simple map.
>
> RIVER MAP — A scrollable mile-by-mile map of camps, rapids, hikes and geology, with detail for the Grand Canyon.
>
> SAFETY REFERENCE — Wilderness first-aid and river-rescue quick reference, signals and swim tips, available offline.
>
> PRIVATE & OFFLINE — No account. Your trips stay on your device and the app works without a signal. Back up and restore with a file.
>
> River, camp and medical information is general reference and can be out of date. Always confirm regulations, flows and conditions with the managing agency.

**What's New (1.0):** First release.

### App privacy questionnaire
**Data Collected:** *Contact Info → Email Address* and *User Content → Other User Content* (trips backed up to an account or shared with a join code), *Name* only if Google/Apple provide it. Account data: **linked to the user**, purpose *App Functionality*, **not used for tracking**. Shared-trip copies are stored under a code, not an identity. Everything else: not collected. Tracking: No. No analytics, no advertising identifiers.

### Age rating
Answer "None" to every content question → 4+. (Medical reference: choose *Infrequent/Mild Medical/Treatment Information* if asked.)

### Screenshots (required)
iPhone 6.9" (1320 × 2868) — 3 to 10 images. Already generated in `store/screenshots/` (Trips, Itinerary with sunrise/sunset, Crew & Crafts, Gear, Shuttle, River map, Safety reference). Upload them as-is for the 6.9" slot; App Store Connect scales them for smaller iPhones. Re-run `npm run screenshots` after UI changes. You can swap in real-device screenshots from TestFlight later.

### Notes for App Review
> River Guide needs no login. On first launch it loads a fictional "Sample trip" so every screen has content: Trips tab → Open → Itinerary, Crew & Crafts, Meals, Gear, Shuttle, Ledger, Info. The River tab shows the built-in Grand Canyon, Smith and Rogue guides, and General has the safety reference and About (backup/restore, optional reminders). The app works fully offline. Trip reminders use local notifications and are off until the user turns them on in General → About.

## Review risks to be aware of

- **Guideline 4.2 (minimum functionality):** web-wrapper apps are rejected when they feel like a website. This one is offline, stores data natively, and uses haptics, share sheet, files and local notifications. Keep adding native-feeling features if review pushes back (e.g. widgets, iCloud backup).
- **Guideline 5.2 (intellectual property):** the Grand Canyon camp, rapid and hike data and the species guide were compiled from outside sources (river maps, guidebooks, agency pages). Before publishing, confirm you have the right to redistribute each source, and add attribution in General → About → Safety & sources. Remove or rewrite anything you cannot clear.
- **Guideline 1.4.1 (medical):** disclaimer added; consider citing the source texts for the medical pages.
- **Accounts (optional):** email code, Google and Apple sign-in; backup/sync of all trips; in-app **Delete my account** (guideline 5.1.1(v)). Apple guideline 4.8 means Google sign-in must ship together with Sign in with Apple; the app enforces that. Setup steps for the dashboard, SMTP, Google and Apple are in `docs/ACCOUNTS_SETUP.md`. Give App Review a note that the app works fully without signing in.
- **Crew sync backend:** trips shared with a crew are stored in a Supabase project (`river-guide-sync`, free plan) under an unguessable join code, no accounts. A daily GitHub Action keeps the free project from pausing; move it to the Pro plan ($25/month) before launch so it can never pause. Anyone with a code can edit that trip, which is stated in the app and the privacy policy.
- **Private data in git history:** earlier commits of this public repo contain the real Grand Canyon trip (crew names, payments). The store build excludes it, but the repo and the website still publish it. Make the repo private (note: GitHub Pages then needs a paid plan) or move the private trip file out and rewrite history if that matters.

## Releasing updates

Bump `version` in `package.json` and `MARKETING_VERSION` in the Xcode project for a new store version; the workflow sets the build number automatically. Run the workflow again; add the build to a new version in App Store Connect and resubmit.
