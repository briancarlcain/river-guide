# Content review before App Store submission

App Review (guideline 5.2) and the copyright of the people whose work the data came from both matter here.
I can describe what is in the app; **only you know where each piece came from.** Fill in the "Source / permission"
column, then either keep the item, add attribution in `data/sources.json` (shown in General → About → Sources &
credits), or remove it.

| Dataset (Grand Canyon unless noted) | Size | What it is | Risk | Source / permission (you fill in) |
|---|---|---|---|---|
| River miles, camp / rapid / hike **names** and mileposts | 272 camps, 120 rapids, 64 hikes | Facts; names are geographic | Low (facts are not copyrightable) | |
| **Camp size and quality ratings** (0–9) | 254 rated camps | Someone's judgement, compiled in a list | **Medium/High** if from a commercial guide or a private survey | |
| **Rapid difficulty ratings** (1–9) and the "tier" label | 120 rapids | Conventional Grand Canyon scale; per-rapid numbers are someone's compilation | Medium if from a commercial guide | |
| Rapid descriptions | 25 distinct sentences reused across 120 rapids | Generic, written per tier (not copied text) | Low | |
| **Hike notes and ratings** | 59 hikes with notes | Short descriptive notes + time/difficulty/quality | **Medium/High** if paraphrased from a guidebook or forum | |
| Geology (formations, ages, descriptions) | 26 formations | Standard stratigraphy; prose is original | Low | |
| Species guide | 320 entries | Common/scientific names + short original descriptions | Low | |
| Almanac (Indigenous history, exploration, dams, lore) | 39 entries | Original summaries of public history | Low; review the Indigenous-history entries with care and add sources | |
| Permit / park rules | 61 rules | Paraphrase of the NPS Noncommercial River Trip Regulations | Low (U.S. government work) but **go stale**; cite the version/date | |
| Medical conditions | 31 conditions | First-aid guidance | **Apple 1.4.1: cite your sources** | |
| Signals, rescue, swim | 17 items | General river-safety practice | Low; cite a source (e.g. a rescue course) | |
| Gear catalog | 214 items (store build drops outfitter lines) | Generic list with example prices | Low in store build | |
| Smith River, Rogue River | start records | Reach, mileage, put-in / take-out | Low; verify the figures | |
| Background art (rock-art style motifs) | 6 images in the stylesheet | Decorative | **Check licence** | |

## What the store build already does
- Removes the real trip (crew names, payments) and the outfitter's product / price lines from the gear catalog.
- Adds a "Reference only" disclaimer on the Medical tab and a "Safety & sources" note in About.

## What I need from you
1. Where did the **camp ratings, rapid ratings and hike notes** come from? If a commercial guide or a private spreadsheet, either get permission, rewrite them in your own words, or tell me to strip those fields from the store build (the app still works without them: the map and lists just lose the colour/quality cues).
2. Sources for the **medical** and **rescue** content (courses, textbooks, agency guidance) so they can be cited in the app.
3. Where the **background motifs** came from.
4. Anything in the Indigenous-history almanac entries that should be attributed to, or reviewed by, a tribal source.

When you have answers, edit `data/sources.json`: each entry with `"confirmed": true` appears in the app.
