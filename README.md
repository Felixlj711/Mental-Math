# Mental Math Drills

A mental-math trainer for consulting interviews. It installs on your phone like an app, works fully offline, and keeps your history on your phone.

- **4 drill modes + Mixed**: multiplication, percentages, growth rates, large-number division. Each has 3 difficulty levels.
- **Never repeats**: every problem is generated from random numbers (no question bank). Anything you've seen in your last 10,000 problems is blocked. The same problem type never comes twice in a row, and the wording and business stories rotate.
- **Realistic numbers**: business-style figures (€2.4M, 36B, 1,250 stores) and consulting stories in € and £. Each story only appears when its numbers make sense.
- **Answer tolerance**: exact, ±2% or ±5%. After every problem you see the answer and a one-line shortcut.
- **Progress**: this week vs last week, 8-week charts, your weakest mode, a daily streak, a calendar, a weekly goal and "Review my mistakes".
- **Backup**: export and import your full history as a file.

---

## What's in the folder

| File | What it does |
|---|---|
| `index.html` | The page structure (all screens) |
| `styles.css` | Look and feel, light and dark mode |
| `js/generators.js` | The 17 problem types: how numbers are picked, the wordings, the shortcuts |
| `js/engine.js` | Picks the next problem, blocks repeats, rotates wording |
| `js/format.js` | Formats numbers (2.4M), reads your answers, checks tolerance |
| `js/stats.js` | Streaks, weekly comparisons, weakest mode, mistakes |
| `js/db.js` | Saves your history on the phone (IndexedDB) |
| `js/chart.js` | The small charts on the Progress screen |
| `js/app.js` | Connects everything: screens, buttons, sessions |
| `sw.js` | The "service worker": keeps a copy of the app on your phone so it works offline |
| `manifest.webmanifest` | Tells the phone the app's name and icon so it can be installed |
| `icons/` | App icons (made by `tools/make-icons.mjs`) |
| `tests/run-tests.mjs` | Automated checks of the maths and the no-repeat logic |

---

## Step 1: Try it on your computer (optional)

You need [Python](https://www.python.org/downloads/), which is usually already installed on Mac and Linux.

1. Open a terminal in this folder.
2. Run `python3 -m http.server 8000`
3. Open <http://localhost:8000> in Chrome.
4. Press `Ctrl+C` in the terminal to stop.

> Opening `index.html` by double-clicking it won't work. The app has to be served by a web server, even a local one.

To run the automated tests (needs [Node.js](https://nodejs.org)): `node tests/run-tests.mjs`. It takes about a minute and should end with `0 failures`.

---

## Step 2: Put it online for free with GitHub Pages

You do this once. It takes about 10 minutes and needs no command line.

1. **Create a GitHub account** at <https://github.com/signup>. Then turn on two-factor authentication: profile picture → **Settings → Password and authentication → Enable two-factor authentication**. This matters because whoever controls this account controls the code your phone runs (see [Security](#security-and-privacy)).
2. **Create a repository.** Click **+** (top right) → **New repository**.
   - Name: `mental-math` (this becomes part of the web address)
   - Visibility: **Public** (free GitHub Pages needs a public repository; see the security notes below)
   - Click **Create repository**.
3. **Upload the files.** On the new repository page, click **uploading an existing file**. Then drag in *the contents* of this folder: `index.html`, `styles.css`, `sw.js`, `manifest.webmanifest`, `README.md`, `package.json` and the folders `js`, `icons`, `tests` and `tools`.
   - Make sure `index.html` sits at the top level of the repository, not inside another folder.
   - Click **Commit changes**.
4. **Turn on Pages.** In the repository go to **Settings → Pages**:
   - Source: **Deploy from a branch**
   - Branch: **main**, folder **/ (root)** → **Save**
5. Wait 1–2 minutes and refresh that page. It will show **"Your site is live at `https://YOUR-USERNAME.github.io/mental-math/`"**.
6. On the same page, tick **Enforce HTTPS** if it isn't already ticked.

Open the address in your computer's browser to check that it works.

---

## Step 3: Install it on your Android phone

1. On your phone, open **Chrome** and go to `https://YOUR-USERNAME.github.io/mental-math/`.
2. Wait a few seconds. This first visit downloads the whole app onto the phone.
3. Tap the **⋮** menu (top right) → **Install app** (on some phones it says **Add to Home screen** → **Install**).
4. The **Math Drills** icon appears on your home screen and in your app drawer. Open it from there from now on. It runs full-screen, without the browser bar.

> Use Chrome (or Samsung Internet). Some other browsers can only add a shortcut, which doesn't work offline as reliably.

---

## Step 4: Check that it works in airplane mode

1. Open the app from the home screen once while you're online. Do 2–3 problems, then close it.
2. Turn on **airplane mode**.
3. Open the app again from the home screen. It should load straight away.
4. Start a session and answer a few problems. The Progress screen should update too.
5. Turn airplane mode off.

If it doesn't load offline, open it once more while online, wait about 10 seconds, and try again. The offline copy is saved in the background on the first visit.

---

## Keeping your data safe

Your history is stored **only on your phone**, inside Chrome's storage for this app. That makes it private, but it can be lost:

- **Lost if**: you clear Chrome's data or site data, reset the phone, or (on some phones) uninstall the app.
- **Not lost if**: you close the app, restart the phone, update Chrome, or are offline for weeks.

**Make backups**: go to **Settings → Export** every week or two. It saves `mental-math-backup-YYYY-MM-DD.json` in your **Downloads** folder. Copy it somewhere safe, for example Google Drive or an email to yourself. The Progress screen reminds you if you haven't backed up for 14 days.

**To restore** (new phone, or after clearing data): **Settings → Import** and pick the backup file. Import *merges*, so nothing already on the phone is lost or duplicated.

The app also asks Chrome to mark its storage as "persistent", so Chrome won't delete it on its own when space runs low. If Settings shows a red warning, Chrome refused. That's another reason to export now and then.

---

## Security and privacy

- **No data leaves your phone.** The app has no server, no account, no analytics and no tracking. It never sends your answers anywhere. GitHub only serves the app files.
- **The code is public; your data isn't.** With free GitHub Pages anyone can see the code and open the app's address, but they get their own empty copy. They can never see your history. The code contains no passwords or personal information.
- **Locked down by design.** The page has a strict Content Security Policy: it refuses to run any code that doesn't come from your own site, and it loads nothing from other websites. Backup files you import are checked and cleaned before being stored, so a tampered file can't inject code.
- **No special permissions.** It's not an APK, so you never "install from unknown sources". It doesn't ask for your camera, location, contacts or notifications. You can uninstall it like any other app.
- **Always HTTPS.** GitHub Pages serves it encrypted, so nobody on the network can change the app on its way to your phone.
- **The main risk is your GitHub account.** Whoever can change the repository can change the code your phone downloads on its next update. Protect the account with a strong, unique password and two-factor authentication (Step 2.1). Don't add other people as collaborators.
- **Only install from your own address** (`YOUR-USERNAME.github.io/...`). If someone sends you a link to a copy, it's a different app with different code.

---

## Changing or updating the app

1. Edit the files on your computer.
2. **Important:** open `sw.js` and bump the version, e.g. `const VERSION = 'v1.0.1';`. That's how phones notice there's an update.
3. Upload the changed files to GitHub: repository → **Add file → Upload files** → **Commit changes**.
4. The next time you open the app while online, a banner says **"A new version is ready"**. Tap **Update**. Your history is kept.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| No "Install app" in Chrome's menu | Make sure the address starts with `https://`. Reload the page, wait a few seconds, and check the menu again. |
| The site shows a 404 error | Check that `index.html` is at the top level of the repository and that Pages is set to **main / (root)**. Wait 2 minutes after each upload. |
| My changes don't appear | Did you bump `VERSION` in `sw.js`? Open the app while online, wait, then tap **Update** on the banner. |
| Doesn't work offline | Open it online once and wait about 10 seconds, so the offline copy can finish downloading. |
| History disappeared | Import your latest backup: **Settings → Import**. |

---

## How the "never repeat" guarantee works

- Every problem has a fingerprint: its type plus its exact numbers, e.g. `div.clean|4200000/350`. Different wordings of the same numbers count as the same problem.
- Fingerprints of your last **10,000** problems are rebuilt from your saved history every time the app starts. Any new problem with a matching fingerprint is thrown away and regenerated.
- The same problem type never appears twice in a row, and in Mixed mode the mode changes every time. Answer sizes are varied, and the least recently used wordings and stories are picked first.
- `tests/run-tests.mjs` measures how many different problems each type and level can produce. Most have tens or hundreds of thousands. The smallest pools (easy "2-digit × 1-digit" ~560 and "rule of 72" core rates) are small by nature: there are only so many easy problems. They are still blocked from repeating, and the app moves to other types when one runs dry.
