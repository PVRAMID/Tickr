# Repository Guidelines

## Project Structure & Module Organization
This repository is a Manifest V3 Chrome extension with a flat layout. `manifest.json` defines permissions, content script matches, icons, and the background service worker. `popup.html` and `popup.js` power the extension popup. `content.js` contains the Ticketmaster page tracker and in-page status UI. `background.js` handles Telegram messaging. Static assets live in `icons/`. There is no separate `src/`, `dist/`, or test directory.

## Build, Test, and Development Commands
There is no bundled build step or package manager script set up in this repo.

- `git clone https://github.com/Anaimmags/Tickr.git`: fetch the project locally.
- Open `chrome://extensions`: enable `Developer mode`, then use `Load unpacked` and select the repo folder.
- Click `Reload` on the Tickr extension after each code change: refreshes the updated scripts and manifest.
- Open the target Ticketmaster page and the extension popup: primary manual verification flow.

## Coding Style & Naming Conventions
Use 2-space indentation in HTML, JSON, and JavaScript. Existing JS favors `const` by default, `let` when state changes, double quotes, semicolons, and camelCase names such as `updateUI`, `sendTelegram`, and `trackerStatus`. Keep files focused on one runtime context: popup, background, or content script. Prefer small helper functions over deeply nested event handlers.

## Testing Guidelines
Automated tests are not configured yet, so treat manual validation as required. After each change, reload the unpacked extension, verify popup actions, and test tracking behavior on a supported Ticketmaster URL. When touching Telegram logic, use the popup's `Test Telegram` action. If you add automated coverage later, place tests in a dedicated `tests/` folder and name files `*.test.js`.

## Commit & Pull Request Guidelines
Recent history uses short, imperative commit messages such as `Add status panel and tracker state UI` and `Fix manifest.json structure`. Follow that pattern: one clear action per commit. Pull requests should include a brief summary, affected files, manual test steps, and screenshots or short recordings for popup or in-page UI changes. Link related issues when applicable and call out any permission or manifest updates explicitly.

## Security & Configuration Tips
Do not commit real Telegram bot tokens or chat IDs. Keep permission changes minimal and review `manifest.json` carefully before merging, since host permissions directly affect extension scope.
