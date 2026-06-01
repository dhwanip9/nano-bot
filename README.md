# NanoBot
<img width="189" height="171" alt="Screenshot 2026-06-01 at 3 13 39 PM" src="https://github.com/user-attachments/assets/503a96c2-c707-4d63-8ffe-5ad3e6e3be29" />

A floating desktop companion that watches your Claude Code and Codex CLI sessions and surfaces the blindspots that novice builders don't know to ask about.

Nano never writes code. It asks the one question you didn't know you needed to ask — then hands you a ready-to-paste prompt to take back to your main chat.

<!-- Replace with a real screenshot or GIF of the app in action -->
<!-- ![NanoBot in action](docs/demo.gif) -->

---

## What Nano does

- **Watches your Claude Code and Codex terminal** automatically — no copy-pasting required
- **Surfaces one nudge at a time** — data storage, auth, destructive commands, API costs, legal requirements, and more
- **Explains in plain language** — no jargon, one analogy, one question
- **Generates a handoff prompt** you can copy and paste directly into Claude or ChatGPT to fix the issue
- **Watches your clipboard** (optional) for manual scanning

---

## Install — 5 minutes, no terminal required

### Step 1 — Download

Go to the [Releases page](https://github.com/dhwanip9/nano-bot/releases) and download:
- **Mac**: `NanoBot-arm64.dmg` (Apple Silicon) or `NanoBot.dmg` (Intel)
- **Windows**: `NanoBot-Setup.exe`
- **Linux**: `NanoBot.AppImage`

### Step 2 — Install

**Mac**: Open the `.dmg` file, drag NanoBot into your Applications folder, double-click to open.
> If Mac says "can't be opened because it's from an unidentified developer": run this once in Terminal:
> `xattr -cr /Applications/NanoBot.app`

**Windows**: Run the `.exe` installer and follow the steps. NanoBot will start automatically.

**Linux**: Make the AppImage executable (`chmod +x NanoBot.AppImage`) then double-click to run.

### Step 3 — Get your API key (one time, ~3 minutes)

NanoBot uses the Anthropic API directly — this is separate from your Claude.ai account.

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create a free account if you don't have one
3. Click **API Keys** in the left sidebar
4. Click **Create Key**, give it a name like "NanoBot"
5. Copy the key (it starts with `sk-ant-`)

**Cost**: Nano uses tiny amounts of API tokens. A full day of heavy use costs under $0.10. Set a spending cap at `console.anthropic.com → Billing → Usage limits` just in case.

### Step 4 — First launch

When NanoBot opens, you'll see three fields:

1. **API key** — paste the key you just copied
2. **What are you building?** — describe your project in plain language. The more detail, the better Nano's nudges will be.
3. **Your experience** — pick honestly; this affects how Nano explains things

Click **Start watching →**

### Step 5 — Grant terminal access (one time, Mac only)

NanoBot will ask for Accessibility permission so it can watch your Claude Code and Codex terminal sessions automatically. Click OK when prompted and enable NanoBot in System Settings → Privacy → Accessibility.

Restart the app once after granting permission — Nano will start watching your terminal from then on.

> **Windows / Linux**: Automatic terminal watching is not available (it uses macOS AppleScript). Use the clipboard watcher or manual paste instead.

---

## How to use it
<img width="385" height="356" alt="Screenshot 2026-06-01 at 3 13 46 PM" src="https://github.com/user-attachments/assets/f3db001e-e3ba-47a4-9019-4be145c569fd" />


**Auto-watch (default, Mac only)**
Open a terminal and run `claude` or `codex` as normal. NanoBot watches in the background and surfaces a nudge when it spots something worth thinking about. No extra steps.

**Manual scan (all platforms)**
Copy any text and paste it into NanoBot's scan box, or toggle "Auto-watch clipboard" to scan automatically when you copy something new.

**When a nudge appears:**
- Tap it to open the explanation
- Read the plain-language breakdown and options
- Reply to Nano's follow-up question if you want more context
- After one exchange, Nano generates a **copy-paste prompt** you take back to your main Claude or ChatGPT chat
- Nano marks that concern resolved and goes back to watching

---

## Running from source

```bash
# Prerequisites: Node.js 18+
git clone https://github.com/dhwanip9/nano-bot.git
cd nano-bot
npm install
npm start
```

To build a distributable:
```bash
npm run build:mac    # macOS .dmg
npm run build:win    # Windows installer
npm run build:linux  # Linux AppImage + deb
```

---

## How it works (for developers)

NanoBot is an Electron app with three layers:

**`main.js`** — the main process. Handles the window, tray, clipboard polling, AppleScript terminal watching, and proxies all Anthropic API calls. The API key never touches the renderer.

**`renderer/nano.js`** — all UI logic. Runs the scan pipeline, manages the speech bubble state machine, handles the 2-exchange conversation flow, and builds handoff prompts.

**`blindspots.v2.json`** — the brain. Contains all 20 blindspot categories, each with keyword triggers, regex patterns, nudge text, plain-language explanations, and handoff prompt templates. Also contains Nano's system prompt and persona rules. **This is the main file to edit if you want to change Nano's behavior, add new categories, or retarget it for a different domain.**

### Want to fork it for your own use case?

The quickest path:
1. Edit `blindspots.v2.json` — change the categories to match your domain, update `system_prompt.nano_persona` to give Nano a different personality or focus
2. Swap `assets/nanobot.png` with your own character (1024×1024 PNG, transparent background)
3. Update `package.json` — change `appId`, `productName`, and the `publish` owner/repo fields
4. Run `npm run build:mac` (or win/linux) to get your own distributable

### Scan pipeline

```
terminal output / clipboard / manual paste
        ↓
detectTriggeredCategories()   — keyword + regex match against all 20 categories
        ↓ (no match)
claudeSoftScan()              — LLM fallback: asks Claude which category fits
        ↓
setPendingNudge()             — picks highest severity unresolved category
        ↓
openNudgeBubble()             — Claude generates a contextual explanation using
                                the actual flagged snippet + project description
        ↓
2-exchange conversation cap   — then generates a filled handoff prompt
```

<img width="348" height="496" alt="Screenshot 2026-06-01 at 3 14 28 PM" src="https://github.com/user-attachments/assets/a4c48afe-176b-418f-8565-ab22c53a2e55" />

<img width="376" height="490" alt="Screenshot 2026-06-01 at 3 15 20 PM" src="https://github.com/user-attachments/assets/f9373b8d-5d06-41a3-8b6e-5e2c4c010df3" />

<img width="308" height="481" alt="Screenshot 2026-06-01 at 3 15 55 PM" src="https://github.com/user-attachments/assets/246199d6-7a05-4e7c-8dd8-e1780417087e" />

---

## Where Nano stores data

Everything stays on your machine:
- Config (API key, project description): `~/.nano-bot/config.json`
- Session memory: `~/.nano-bot/session.json`
- Blindspot knowledge base: bundled with the app at `blindspots.v2.json`

Nano never sends your data anywhere except directly to Anthropic's API when it scans. Your Claude.ai login is never accessed or required.

**Debugging tip**: if Nano is behaving unexpectedly, check `~/.nano-bot/session.json` to see what it has recorded for the current session, or delete it to start fresh (same as "New Session" in the tray menu).

---

## The blindspot categories Nano watches for

| Category | Severity | What it catches |
|---|---|---|
| Data persistence | 🔴 Critical | App loses data on page reload |
| Auth & multi-user | 🔴 Critical | No login when multiple people need it |
| Destructive commands | 🔴 Critical | rm, awk overwrite, DROP TABLE without backup |
| Hardcoded secrets | 🔴 Critical | API keys visible in code |
| Sensitive data | 🔴 Critical | Health/financial data stored carelessly |
| Rate limiting | 🔴 Critical | Paid API with no call cap |
| Error handling | 🟠 High | API calls with no fallback |
| Input validation | 🟠 High | Forms that accept anything |
| Backup & recovery | 🟠 High | No export or backup option |
| CORS & environment | 🟠 High | Works locally but breaks on deploy |
| Version control | 🟠 High | No undo button for the whole project |
| Cost & billing | 🟠 High | No spending cap on paid services |
| Legal & compliance | 🟠 High | Public app with no privacy policy |
| Scale & performance | 🟡 Medium | Loads all records at once |
| Deployment | 🟡 Medium | App trapped on localhost |
| Mobile responsiveness | 🟡 Medium | Broken on phones |
| Race conditions | 🟡 Medium | Double-submit, duplicate records |
| Accessibility | 🟡 Medium | Unusable without a mouse |
| Testing & edge cases | 🟡 Medium | Only tested the happy path |
| Dependencies | 🔵 Low | Unpinned library versions |

---

## License

MIT
