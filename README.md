# Insomniacs Bot

A private Discord bot for the **Insomniacs** Discord server, focused on **Counter-Strike 2 / FACEIT statistics**.

> The bot never posts unsolicited messages. Everything shown in Discord is triggered by a user command or interaction.

---

## Overview

Insomniacs Bot tracks and presents the CS2 FACEIT history of the Insomniacs friend group. Once players link their FACEIT accounts, the bot builds a local database of match history and surfaces statistics through slash commands.

Features include:

- FACEIT account linking
- Player statistics (kills, deaths, K/D, ADR, headshot %, win rate)
- Recent match history
- Weekly / monthly / all-time stat breakdowns
- Server-wide leaderboards
- Head-to-head player comparisons
- Map statistics (individual and group)
- Personal and server records
- ELO tracking over time
- Win and loss streak tracking
- Session statistics
- Teammate chemistry analysis
- Achievement system
- Discord quote archive

---

## Features

- Slash command interface with interactive buttons and select menus
- Persistent PostgreSQL match history — stats survive API downtime
- Incremental sync — only fetches new matches, not the full history every time
- Pull-based only — the bot **never** posts automatically

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Runtime | Node.js |
| Discord library | discord.js v14 |
| Database | PostgreSQL |
| ORM | Prisma |
| FACEIT data | FACEIT Data API |
| Infrastructure | Docker / Docker Compose |

---

## Requirements

- Node.js 22+
- npm
- PostgreSQL 16+ (or Docker)
- A Discord application with bot token
- A FACEIT developer API key

---

## Setup

### 1. Clone the repository

```bash
git clone <repo-url>
cd insomniacs-bot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in the required values (see [Environment Variables](#environment-variables)).

### 4. Start PostgreSQL

Using Docker (recommended):

```bash
docker compose up -d postgres
```

Or start your own PostgreSQL instance and update `DATABASE_URL`.

### 5. Generate Prisma client

```bash
npm run prisma:generate
```

### 6. Run database migrations

```bash
npm run prisma:migrate
```

### 7. Register Discord slash commands

```bash
npm run commands:register
```

Commands are registered to the guild specified in `DISCORD_GUILD_ID` so they appear immediately.

### 8. Start the bot in development mode

```bash
npm run dev
```

---

## Environment Variables

```env
# Discord application credentials
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=

# FACEIT Data API key
FACEIT_API_KEY=

# PostgreSQL connection string
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/insomniacs

# Bot behaviour
BOT_TIMEZONE=Europe/London
CHEMISTRY_MIN_MATCHES=10

# Runtime
NODE_ENV=development
LOG_LEVEL=info
```

### Getting credentials

**Discord:**
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Add a bot under the Bot tab
4. Copy the bot token into `DISCORD_TOKEN`
5. Copy the Application ID into `DISCORD_CLIENT_ID`
6. Enable the `applications.commands` scope when inviting the bot to your server
7. Right-click your Discord server → Copy Server ID → paste into `DISCORD_GUILD_ID`

**FACEIT:**
1. Go to [FACEIT Developers](https://developers.faceit.com/)
2. Create an application
3. Generate a server-side API key
4. Copy it into `FACEIT_API_KEY`

---

## Docker

Run everything (bot + PostgreSQL) with Docker Compose:

```bash
docker compose up -d
```

The database is persisted in a named Docker volume (`postgres_data`).

On first run, apply migrations manually:

```bash
docker compose exec bot npm run prisma:migrate
```

---

## Commands

| Command | Status | Description |
|---|---|---|
| `/ping` | ✅ | Check bot status and latency |
| `/link` | Planned | Link your Discord account to a FACEIT nickname |
| `/unlink` | Planned | Remove your FACEIT account link |
| `/linkstatus` | Planned | View your current linked account |
| `/stats` | Planned | View player statistics |
| `/recent` | Planned | View recent match history |
| `/form` | Planned | View performance over recent matches |
| `/leaderboard` | Planned | Insomniacs leaderboard |
| `/compare` | Planned | Compare two players |
| `/maps` | Planned | Map statistics |
| `/mapstats` | Planned | Detailed statistics for a specific map |
| `/records` | Planned | Insomniacs record book |
| `/session` | Planned | Most recent play session statistics |
| `/chemistry` | Planned | Teammate chemistry analysis |
| `/achievements` | Planned | View earned achievements |
| `/quote` | Planned | Random quote from the server |

---

## Development

```bash
# Start in development mode (hot reload via tsx)
npm run dev

# Compile TypeScript
npm run build

# Start compiled bot
npm start

# Lint source files
npm run lint

# Run tests
npm test

# Register slash commands with Discord
npm run commands:register

# Run database migrations
npm run prisma:migrate

# Generate Prisma client after schema changes
npm run prisma:generate
```

---

## Project Structure

```
insomniacs-bot/
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── migrations/            # Applied migrations
├── src/
│   ├── commands/              # Slash command handlers
│   ├── components/            # Button and select menu handlers
│   ├── services/
│   │   ├── faceit/            # FACEIT API client
│   │   └── stats/             # Stat calculation services
│   ├── repositories/          # Database query functions
│   ├── database/              # Prisma client singleton
│   ├── utils/                 # Shared utilities
│   ├── types/                 # TypeScript types and interfaces
│   ├── config/                # Configuration and env parsing
│   └── index.ts               # Entry point
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

---

## Status

This is a personal project built for a private Discord server. It is not a public SaaS product and is not designed for general distribution. Development is incremental, following a phased roadmap.

**Current phase: Phase 1 — Foundation**

---

## License

MIT — see [LICENSE](LICENSE).
