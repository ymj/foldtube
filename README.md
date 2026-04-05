# FoldTube — YouTube Tab Manager

> Instantly declutter your browser. Collapse all your open YouTube tabs into a clean, organized dashboard.

---

FoldTube is a powerful YouTube tab manager that helps you take back control of your browser. Instead of losing track of dozens of open YouTube tabs, fold them all into a sleek, persistent dark-mode dashboard where you can search, sort, filter, and reopen them whenever you're ready.

---

## Features

- **One-click collapse** via the toolbar icon or `Ctrl+Shift+Y` (Windows/Linux) / `Cmd+Shift+Y` (Mac)
- **Organized dashboard** with separate sections for Videos and Shorts
- **Real-time search**, multiple sorting options, and duration filter pills
- **Bulk actions** — select, open, or remove multiple tabs at once
- **Auto-collapse on browser exit** with smart duplicate detection on restore
- **Metadata enrichment** via the YouTube Data API v3 (channel names, durations for sleeping tabs)
- **Import / Export** your library as JSON or a shareable HTML bookmark page
- **Instant Undo** for accidental deletions

---

## Installation

### Chrome / Brave / Edge
**Chrome Web Store:** `https://chromewebstore.google.com/detail/phkhokoagdgofaaofmecfaibcnnahhoh?utm_source=item-share-cb`

### Firefox
**Mozilla Add-ons (AMO):** *Coming soon*

### Manual / Developer Install

#### Chrome / Chromium-based browsers
1. Download or clone this repository
2. Open `chrome://extensions` (or `brave://extensions`) in your browser
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the root of this repository
5. Pin FoldTube to your toolbar and you're ready to go

#### Firefox
1. Download or clone this repository
2. Run `./package.sh firefox` to build the Firefox package
3. Open `about:debugging#/runtime/this-firefox`
4. Click **Load Temporary Add-on** and select the generated zip from the `dist/` folder
5. For permanent installation, install from the Mozilla Add-ons store (once published)

---

## Usage

| Action | How |
|---|---|
| Collapse all YouTube tabs | Click the FoldTube toolbar icon, or press `Ctrl+Shift+Y` (Windows/Linux) / `Cmd+Shift+Y` (Mac) |
| Open a saved video | Click any card on the dashboard |
| Delete a card | Click the `×` button on the card |
| Undo a deletion | Click **Undo** in the toast that appears |
| Bulk select | Click any card checkbox, then use the action bar |
| Filter by duration | Use the pill buttons above the grid |
| Settings | Click the `⚙️` icon in the top right of the dashboard |

---

## Optional: YouTube API Enrichment

By default, FoldTube extracts all metadata (title, channel, duration) directly from the page DOM. For tabs that were sleeping, discarded, or auto-collapsed on browser exit, some metadata may be unavailable.

To enable automatic backfilling:

1. Generate a free **YouTube Data API v3** key at [console.cloud.google.com](https://console.cloud.google.com)
2. Open FoldTube Settings (`⚙️`) → **API & Enrichment**
3. Paste your key and click **Save Key**

FoldTube will automatically enrich any cards with missing data in the background. Your API key never leaves your device.

---

## Privacy

FoldTube collects **no user data**. Everything is stored locally on your device using `chrome.storage.local`. No analytics, no telemetry, no external servers — unless you optionally enable the YouTube API enrichment feature using your own key, in which case your browser communicates directly with Google's servers.

---

## Building Packages

FoldTube ships a single codebase that works on both Chrome and Firefox. The `package.sh` script produces browser-specific zip files ready for store submission:

```bash
./package.sh                # Build both Chrome and Firefox packages
./package.sh chrome         # Chrome only
./package.sh firefox        # Firefox only
./package.sh --output DIR   # Custom output directory (default: ./dist)
```

The script transforms the manifest per browser — Chrome gets `background.service_worker`, Firefox gets `background.scripts` — so the source `manifest.json` stays Chrome-native for local development.

---

## Tech Stack

- **Manifest V3** extension — compatible with Chrome, Brave, Edge, and Firefox (128+)
- Vanilla HTML / CSS / JavaScript — zero dependencies, zero frameworks
- `chrome.storage.local` for persistence
- `chrome.scripting` for DOM metadata extraction (with `world: 'MAIN'` for ad-safe duration capture)
- `chrome.tabs` + `chrome.notifications` for tab management and user feedback

---

## License

MIT
