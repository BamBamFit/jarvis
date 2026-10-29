# J.A.R.V.I.S.

A voice-and-text AI assistant with an Iron Man–style HUD. Runs in any modern browser, installs like an app on desktop and phone, and connects to Google Drive.

## What it does

- **Talk or type.** Tap the reactor (or the mic) and speak. Replies appear on screen and are read aloud.
- **"Jarvis…" wake word** (optional, Chrome/Edge): say "Jarvis, what's on my calendar doc?" hands-free.
- **Google Drive & Docs.** Search, read and summarise your Docs/Sheets/Slides; create new Google Docs (asks you first).
- **Engineering mode.** Deeper reasoning, step-by-step working with equations, units and a sanity check. Every number goes through an exact math engine (units, matrices, complex numbers).
- **Engineering calculator.** Left panel, works offline: `12 kN * 3.5 m to lbf ft`, `100 psi to MPa`, `det([1,2;3,4])`.
- **Memory notes.** "Jarvis, remember my locker code is 4412." Notes persist on the device.
- **Web search** (toggle in Settings).

## Run it on this computer

Double-click **`start-jarvis.bat`**. It opens http://localhost:8777. Close the black window to stop it.

To install it as a desktop app: in Chrome or Edge, click the install icon in the address bar (or menu → *Install J.A.R.V.I.S.*).

## 1. Turn on the AI core (required)

1. Create an API key at https://console.anthropic.com → *API keys*.
2. In JARVIS, click ⚙ (Settings) → paste the key → Save.

The key is stored only in that browser on that device. Usage is billed to your Anthropic account. *Claude Haiku 5.5* is the cheapest model; *Opus 5.5* (default) is best for engineering.

## 2. Connect Google Drive (optional, ~5 minutes)

1. Go to https://console.cloud.google.com, create a project (e.g. "Jarvis").
2. *APIs & Services → Library* → enable **Google Drive API**.
3. *APIs & Services → OAuth consent screen* → External → fill in app name and your email → add yourself under **Test users**.
4. *Credentials → Create credentials → OAuth client ID* → type **Web application**.
   - **Authorized JavaScript origins:** `http://localhost:8777` (plus your hosted URL later, e.g. `https://yourname.github.io`).
5. Copy the **Client ID** into JARVIS → Settings → Google OAuth Client ID → Save.
6. Click **Connect Google Drive** and approve.

JARVIS asks for read access to your Drive and permission to create files. Sign-in is per session; click Connect again after reloading.

## 3. Use it on your phone and other devices

Phones need the app served over **HTTPS** (microphone and install require it). The simplest free option:

1. Put this folder in a GitHub repository and enable **GitHub Pages** (Settings → Pages → deploy from branch).
2. Open `https://<you>.github.io/<repo>/` on your phone → browser menu → **Add to Home Screen**.
3. Add that URL to the Google OAuth client's Authorized JavaScript origins.

Netlify, Vercel or Cloudflare Pages also work (drag-and-drop this folder).

Each device keeps its own settings, API key and notes.

## Voice support

| Browser | Speak to JARVIS | JARVIS speaks | Wake word |
|---|---|---|---|
| Chrome / Edge (desktop, Android) | Yes | Yes | Yes |
| Safari (Mac, iPhone, iPad) | Yes | Yes | Limited |
| Firefox | No (type instead) | Yes | No |

For a better voice on Windows, Edge's "Microsoft Ryan (Natural)" voice is picked automatically when available; choose any voice in Settings.

## Files

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | Layout and HUD styling |
| `hud.js` | Animated reactor rings (react to your voice and JARVIS's) |
| `app.js` | AI brain (Claude + tools), voice, notes, calculator, settings |
| `drive.js` | Google Drive / Docs connection |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Installable app + offline support |
| `serve.ps1`, `start-jarvis.bat` | Local web server for Windows (no installs needed) |

## Ideas for later

- Package as a native desktop app (Tauri or Electron) with a global hotkey.
- Add Gmail and Google Calendar (same Google sign-in, extra scopes).
- A small backend so the API key isn't stored in the browser, and so devices share memory.
