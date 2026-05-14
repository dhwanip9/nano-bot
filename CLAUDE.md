# NanoBot — Claude Code Project Briefing

## What this is

NanoBot is a floating desktop companion app (Electron) that runs alongside Claude.ai and Claude Code sessions. It watches what a novice builder is working on and surfaces blindspots they didn't know to ask about — things like missing data persistence, no error handling, hardcoded API keys, destructive commands with no backup, etc.

It is NOT a second Claude chat. It is a spotter. It asks one question, gives one plain-language explanation, then generates a ready-to-paste prompt the user takes back to their main Claude or ChatGPT session.

---

## Core design rules (do not break these)

- **Nano never writes code.** Ever. Under any circumstances.
- **Max 2 exchanges per blindspot** — after 2, always generate a handoff prompt and say "I'll keep watching."
- **One nudge at a time** — surface the highest severity unresolved blindspot only
- **Critical nudges are never silenced** by session caps
- **Handoff prompts are fully filled** — no raw `{placeholders}` ever reach the user
- **The bot is called Nano** in all UI copy. The app is called NanoBot.
- **`window.nano`** is the preload API in the renderer (not `window.buddy` — that was the old name, fully replaced)

---

## File structure

```
nano-bot/
├── main.js                          # Electron main process
│   ├── Window creation (380x400, frameless, always-on-top)
│   ├── Tray icon + context menu
│   ├── Clipboard watcher (polls every 1500ms)
│   ├── IPC handlers for all renderer calls
│   ├── Anthropic API proxy (key never touches renderer)
│   └── Auto-updater (electron-updater, checks GitHub Releases)
│
├── preload.js                       # contextBridge — exposes window.nano
│   └── exposeInMainWorld('nano', { ... })
│
├── renderer/
│   ├── index.html                   # 4-screen UI shell
│   │   ├── screen-onboarding        # First launch: API key + project + skill level
│   │   ├── screen-main              # Feed of nudge cards + scan input
│   │   ├── screen-settings          # Edit config, new session
│   │   └── screen-nudge             # Nudge detail + 2-exchange chat + handoff
│   ├── styles.css                   # Dark warm theme (--bg-base #141210, --accent #e8825a)
│   │   └── CSS classes: nano-avatar, nudge-card, scan-area, handoff-box etc
│   └── nano.js                      # All renderer logic
│       ├── init()                   # Loads config, blindspots, session
│       ├── showScreen(name)         # Screen transitions
│       ├── runScan(text, source)    # Main scan pipeline
│       ├── detectTriggeredCategories(text)  # Keyword + regex matching
│       ├── claudeSoftScan(text)     # LLM fallback scan
│       ├── openNudgeDetail(id)      # Opens detail screen
│       ├── handleUserReply(cat)     # 2-exchange chat logic
│       ├── buildHandoffPrompt(cat)  # Fills template variables from session context
│       ├── summarizeSession()       # Every 5 exchanges, compresses session memory
│       └── initUpdaterUI()          # Shows update banner when new version ready
│
├── blindspots.v2.json               # Knowledge base — THE BRAIN
│   ├── 20 categories (see below)
│   ├── project_type_profiles        # 12 project types → relevant category lists
│   ├── severity_levels              # critical/high/medium/low with cap logic
│   ├── system_prompt                # Nano's persona + hard rules
│   ├── session_summarization        # Trigger every 5 exchanges, max 350 tokens
│   └── nudge_timing                 # Per-severity caps, critical is unlimited
│
├── assets/
│   ├── icon.png                     # Placeholder orange circle (Linux)
│   ├── icon.icns                    # Placeholder orange circle (Mac)
│   ├── icon.ico                     # Placeholder orange circle (Windows)
│   └── tray-icon.png               # Placeholder 16x16 (menu bar)
│   NOTE: These are placeholders. Real NanoBot pixel art is TODO.
│
├── .github/
│   └── workflows/
│       └── build.yml                # CI/CD: builds Mac/Win/Linux on git tag push
│           └── Triggers on: push tags v*
│           └── Publishes to: github.com/dhwanip9/nano-bot/releases
│
├── .gitignore                       # node_modules, dist, .env excluded
├── package.json                     # electron-builder config, publish → dhwanip9/nano-bot
├── CHANGELOG.md
└── README.md                        # Novice-friendly install guide
```

---

## The 20 blindspot categories

Each category has: `id`, `name`, `severity`, `phase`, `triggers` (keywords + code_patterns + regex_absent + llm_check), `resolved_signals`, `nudge` text, `explanation` (plain + analogy + options + follow_up_question), `handoff_prompt_template`, `template_variables` (with source + fallback), `related_categories`.

| ID | Severity | Phase |
|---|---|---|
| `data_persistence` | critical | architecture |
| `multi_user_auth` | critical | architecture |
| `destructive_commands` | critical | execution |
| `hardcoded_secrets` | critical | execution |
| `sensitive_data` | critical | architecture |
| `rate_limiting` | critical | architecture |
| `error_handling` | high | execution |
| `input_validation` | high | execution |
| `backup_and_recovery` | high | architecture |
| `cors_and_environment` | high | deployment |
| `version_control` | high | architecture |
| `cost_and_billing` | high | architecture |
| `legal_and_compliance` | high | architecture |
| `scalability` | medium | architecture |
| `deployment_and_sharing` | medium | deployment |
| `mobile_responsiveness` | medium | execution |
| `race_conditions` | medium | execution |
| `accessibility` | medium | execution |
| `testing` | medium | execution |
| `dependency_and_maintenance` | low | maintenance |

---

## Key technical decisions made

**Why Electron:** Needs to float over any app the user has open. Web app can't do that.

**Why API proxy in main.js:** The Anthropic API key must never touch the renderer process (security). All `window.nano.chat()` calls go through IPC to main.js which makes the actual API call.

**Why 2-exchange limit:** Nano is a spotter not a solver. If the user needs more help, that conversation belongs in their main Claude chat where the project context already lives. Nano generates a filled handoff prompt to make the transition seamless.

**Why session summarization:** After 5 exchanges the raw session log gets too long for the API context. Every 5 exchanges Nano summarizes to 3 bullets (max 350 tokens) and uses that as the context going forward.

**Nudge cap logic:**
- critical: unlimited (never silenced)
- high: max 4 per session
- medium: max 3 per session
- low: max 1 per session

**Storage paths:**
- Config: `~/.nano-bot/config.json`
- Session: `~/.nano-bot/session.json`

**Clipboard watcher:** Polls every 1500ms. Only fires scan if text > 50 chars and text has changed. User must explicitly opt in via toggle.

---

## What's done vs todo

### Done ✅
- Full Electron app structure
- All 4 screens (onboarding, main, settings, nudge detail)
- Scan engine with keyword + regex + LLM fallback
- 2-exchange chat with handoff prompt generation
- Session memory + auto-summarization
- Auto-updater wired to GitHub Releases
- GitHub Actions CI/CD pipeline
- Placeholder icons in all formats
- All naming consistent: NanoBot / Nano / nano throughout
- Code pushed to github.com/dhwanip9/nano-bot

### Todo — blocking for v1.0.0 launch
- [ ] Tag v1.0.0 to trigger the build pipeline
  ```bash
  git tag v1.0.0
  git push origin v1.0.0
  ```

### Todo — post v1.0.0
- [ ] **NanoBot pixel art icons** — replace placeholder orange circles with real pixel dog art
  - Need: icon.png (512x512), icon.icns (Mac), icon.ico (Win), tray-icon.png (16x16)
  - Reference image: Nanobot_v2.png (pixel art beagle with face markings, NanoBot badge)
  - Previous approach of SVG pixel grid extraction was shelved — animations didn't match
  - Recommended new approach: use a proper pixel art → SVG tool or Figma
- [ ] **Onboarding inline error states** — bad API key currently shows `alert()`, needs inline UI error
- [ ] **Animated NanoBot avatar** — replace the CSS circle avatar with the animated pixel art SVG
  - Groups needed: ear-left, ear-right, eye-left, eye-right, head, body
  - States needed: idle (breathe + blink), thinking (scan + ear-tilt), nudge (ear-perk + bounce), happy (bob + squint), alert (shake + wide-eye)
- [ ] **Test auto-updater** — publish v1.0.1 and verify update banner appears in app

---

## Repo details

- GitHub: https://github.com/dhwanip9/nano-bot
- Owner: dhwanip9
- App ID: com.dhwanip9.nanobot
- Build output: `dist/`
- Release trigger: push a tag matching `v*`

---

## How to run locally

```bash
npm install
npm start
```

## How to build installers

```bash
npm run build:mac    # → dist/NanoBot-*.dmg
npm run build:win    # → dist/NanoBot-Setup-*.exe
npm run build:linux  # → dist/NanoBot-*.AppImage
```

## How to publish a release

```bash
git tag v1.0.x
git push origin v1.0.x
# GitHub Actions builds all three platforms and publishes to Releases automatically
```
