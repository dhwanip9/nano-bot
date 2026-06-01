# Nano Bot 🤖

A floating desktop companion that watches your Claude/Codex sessions and surfaces the blindspots that novice builders don't know to ask about.

Nano Bot never writes code. It asks the one question you didn't know you needed to ask — then hands you a ready-to-paste prompt to take back to your main chat.

---

## What Nano Bot does

- **Scans your prompts and code** for missing pieces you haven't thought about yet
- **Surfaces one nudge at a time** — data storage, auth, destructive commands, API costs, legal requirements, and more
- **Explains in plain language** — no jargon, one analogy, one question
- **Generates a handoff prompt** you can copy and paste directly into Claude or ChatGPT to fix the issue
- **Watches your clipboard** (optional) so you don't have to paste anything manually

---

## Install — 5 minutes, no terminal required

### Step 1 — Download

Go to the [Releases page](https://github.com/your-repo/claude-buddy/releases) and download:
- **Mac**: `Claude-Buddy-mac.dmg`
- **Windows**: `Claude-Buddy-Setup.exe`
- **Linux**: `Claude-Buddy.AppImage`

### Step 2 — Install

**Mac**: Open the `.dmg` file, drag Claude Buddy into your Applications folder, double-click to open.
> If Mac says "can't be opened because it's from an unidentified developer": right-click the app → Open → Open anyway.

**Windows**: Run the `.exe` installer and follow the steps. Claude Buddy will start automatically.

**Linux**: Make the AppImage executable (`chmod +x Claude-Buddy.AppImage`) then double-click to run.

### Step 3 — Get your API key (one time, ~3 minutes)

Buddy uses the Anthropic API directly — this is separate from your Claude.ai account.

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create a free account if you don't have one
3. Click **API Keys** in the left sidebar
4. Click **Create Key**, give it a name like "Claude Buddy"
5. Copy the key (it starts with `sk-ant-`)

**Cost**: Buddy uses tiny amounts of API tokens. A full day of heavy use costs under $0.10. Set a spending cap at `console.anthropic.com → Billing → Usage limits` just in case.

### Step 4 — First launch

When Buddy opens, you'll see three fields:

1. **API key** — paste the key you just copied
2. **What are you building?** — describe your project in plain language. The more detail, the better Buddy's nudges will be.
3. **Your experience** — pick honestly; this affects how Buddy explains things

Click **Start watching →**

---

## How to use it

**Option A — Paste to scan (recommended)**
Copy your prompt or Claude's response, paste it into Buddy's scan box, click Scan. Buddy will flag anything worth thinking about.

**Option B — Auto-watch clipboard**
Toggle "Auto-watch clipboard" and Buddy will scan automatically every time you copy something new. No extra steps.

**When a nudge appears:**
- Tap it to open the explanation
- Read the plain-language breakdown and options
- Reply to Buddy's follow-up question if you want more context
- After one exchange, Buddy generates a **copy-paste prompt** you take back to your main Claude or ChatGPT chat
- Buddy marks that concern resolved and goes back to watching

---

## Running from source (developers)

```bash
# Prerequisites: Node.js 18+
git clone https://github.com/your-repo/claude-buddy.git
cd claude-buddy
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

## Where Buddy stores data

Everything stays on your machine:
- Config (API key, project description): `~/.claude-buddy/config.json`
- Session memory: `~/.claude-buddy/session.json`
- Blindspot knowledge base: bundled with the app

Buddy never sends your data anywhere except directly to Anthropic's API when you trigger a scan. Your Claude.ai login is never accessed or required.

---

## The blindspot categories Buddy watches for

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
