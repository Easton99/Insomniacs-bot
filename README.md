# Insomniacs Bot

A private Discord bot for the **Insomniacs** Discord server, focused on **Counter-Strike 2 / FACEIT statistics**.

> The bot never posts unsolicited messages. Everything shown in Discord is triggered by a user command or interaction.

**Website:** [easton99.github.io/Insomniacs-bot](https://easton99.github.io/Insomniacs-bot)

---

## Commands

All commands live under `/ic`. Type `/ic` in any channel to get started.

| Command | Description |
|---|---|
| `/ic ping` | Check bot status and latency |
| `/ic link` | Link your Discord account to a FACEIT nickname |
| `/ic unlink` | Remove your FACEIT account link |
| `/ic linkstatus` | View a linked account with live ELO and level |
| `/ic stats` | Lifetime stats — ELO, K/D, headshot %, win rate, streaks |
| `/ic recent` | Last N matches with map, score, kills, deaths, K/D |
| `/ic form` | Aggregated performance summary over recent matches |
| `/ic leaderboard` | Server leaderboard with dropdown category switching |
| `/ic compare` | Side-by-side lifetime stats comparison between two players |
| `/ic maps` | Per-map breakdown over last 50 matches |
| `/ic mapstats` | Detailed stats for a specific map over last 100 matches |
| `/ic records` | All-time Insomniacs record book across all linked players |
| `/ic session` | Stats from the most recent play session |
| `/ic chemistry` | Duo win rates and teammate performance |
| `/ic achievements` | Earned achievements calculated from match history |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict, CommonJS, ES2022) |
| Runtime | Node.js 22+ |
| Discord library | discord.js v14 |
| Database | SQLite (local file) |
| ORM | Prisma |
| FACEIT data | FACEIT Data API v4 |
| Logging | pino |
| Website | GitHub Pages |
| Feature request form | Cloudflare Workers → GitHub Issues |

---

## Requirements

- Node.js 22+
- npm
- A Discord application with bot token
- A FACEIT developer API key (server-side)

No database server required — the bot uses a local SQLite file (`prisma/data.db`).

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/Easton99/Insomniacs-bot.git
cd Insomniacs-bot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in the required values — see [Environment Variables](#environment-variables) below.

### 4. Set up the database

Creates `prisma/data.db` and applies the schema:

```bash
npm run prisma:migrate
```

### 5. Register slash commands

```bash
npm run commands:register
```

Commands are registered to the guild specified in `DISCORD_GUILD_ID` so they appear immediately without the 1-hour global propagation delay.

### 6. Start the bot

```bash
npm run dev
```

Uses `tsx --watch` — restarts automatically when you save a source file.

---

## Environment Variables

```env
# Discord application credentials
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=

# FACEIT Data API (server-side key)
FACEIT_API_KEY=

# SQLite file path (default is fine for local dev)
DATABASE_URL=file:./data.db

# Timezone used for session grouping and the "Go To Bed" achievement
BOT_TIMEZONE=Europe/London

# Minimum shared matches before labelling a "best" or "worst" teammate
CHEMISTRY_MIN_MATCHES=10

# Runtime
NODE_ENV=development
LOG_LEVEL=info
```

**Discord credentials:**
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application → add a bot → copy the token into `DISCORD_TOKEN`
3. Copy the Application ID into `DISCORD_CLIENT_ID`
4. Enable Developer Mode in Discord, right-click your server → Copy Server ID → `DISCORD_GUILD_ID`

**FACEIT API key:**
1. Go to [developers.faceit.com](https://developers.faceit.com/)
2. Create an application → generate a **server-side** key → copy into `FACEIT_API_KEY`

---

## npm Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start with hot reload (`tsx --watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled bot from `dist/index.js` |
| `npm run lint` | Run ESLint over `src/` |
| `npm test` | Run Vitest test suite |
| `npm run commands:register` | Register slash commands to `DISCORD_GUILD_ID` |
| `npm run prisma:migrate` | Apply schema and create `data.db` on first run |
| `npm run prisma:generate` | Regenerate Prisma client after schema changes |
| `npm run prisma:studio` | Open Prisma Studio (visual database browser) |

---

## Docker

For running the bot 24/7 on a server. The SQLite file is persisted in a named volume (`bot_data`).

```bash
# Start
docker compose up -d

# Apply migrations (first time only)
docker compose exec bot npm run prisma:migrate

# View logs
docker compose logs -f bot
```

---

## Project Structure

```
insomniacs-bot/
├── docs/                        # GitHub Pages website
│   ├── index.html
│   ├── commands.html
│   ├── feature-request.html     # Form → Cloudflare Worker → GitHub Issues
│   ├── setup.html
│   ├── css/style.css
│   └── js/main.js
├── prisma/
│   └── schema.prisma            # SQLite schema (DiscordUser model)
├── src/
│   ├── commands/                # One file per /ic subcommand
│   │   ├── ping.ts
│   │   ├── link.ts / unlink.ts / linkstatus.ts
│   │   ├── stats.ts / recent.ts / form.ts
│   │   ├── leaderboard.ts / compare.ts
│   │   ├── maps.ts / mapstats.ts
│   │   ├── records.ts / session.ts
│   │   ├── chemistry.ts
│   │   └── achievements.ts
│   ├── services/
│   │   └── faceit.ts            # FACEIT Data API v4 client
│   ├── utils/
│   │   ├── match-utils.ts       # Shared match processing logic
│   │   ├── interaction-handler.ts
│   │   ├── command-loader.ts
│   │   └── logger.ts
│   ├── database/
│   │   └── client.ts            # Prisma client singleton
│   ├── config/
│   │   └── index.ts             # Env parsing and validation
│   ├── scripts/
│   │   └── register-commands.ts
│   ├── types/
│   │   └── index.ts
│   └── index.ts                 # Entry point
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

---

## License

MIT — see [LICENSE](LICENSE).
