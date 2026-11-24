import {
  ActionRowBuilder,
  AttachmentBuilder,
  AutocompleteInteraction,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Collection,
  EmbedBuilder,
  Message,
  PermissionFlagsBits,
  SlashCommandSubcommandGroupBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  escapeMarkdown,
} from 'discord.js';
import { randomBytes } from 'node:crypto';
import { Movie, Prisma } from '@prisma/client';
import { db } from '../database/client';
import { config } from '../config';
import {
  MAX_TITLE_LENGTH,
  MatchKind,
  classifyMatch,
  cleanTitle,
  fallbackQueries,
  normalizeTitle,
  parseMovieLines,
} from '../utils/movie-utils';
import {
  TmdbMovie,
  getMovieDetails,
  getRatings,
  imdbUrl,
  isOmdbConfigured,
  isTmdbConfigured,
  posterUrl,
  rottenTomatoesUrl,
  searchMovies,
} from '../services/movie-db';
import logger from '../utils/logger';

export const MOVIE_PREFIX = 'mv:';

const ACCENT = 0xff6b35;
const DONE = 0x10b981;
const GREY = 0x888888;
const ERROR = 0xcc3333;
const PAGE_SIZE = 10;
const IMPORT_MAX_MESSAGES = 5000;
const IMPORT_CONCURRENCY = 5;
const PENDING_TTL_MS = 15 * 60 * 1000;
const RATINGS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ENRICH_WAIT_MS = 3500;
const WATCHED_REACTIONS = new Set(['✅', '✔️', '☑️']);

type Show = 'todo' | 'done';
type Sort = 'new' | 'old' | 'az';
type GuildChat = ChatInputCommandInteraction<'cached' | 'raw'>;

const SORT_LABEL: Record<Sort, string> = { new: 'Newest first', old: 'Oldest first', az: 'A–Z' };

export const group = new SlashCommandSubcommandGroupBuilder()
  .setName('movie')
  .setDescription('The group movie watchlist')
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Add a movie to the watchlist')
      .addStringOption((o) =>
        o
          .setName('title')
          .setDescription('Start typing and pick the right film from the suggestions')
          .setRequired(true)
          .setMaxLength(MAX_TITLE_LENGTH)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('list')
      .setDescription('Show the watchlist — mark movies as watched from the menu')
      .addStringOption((o) =>
        o
          .setName('show')
          .setDescription('Which movies to show (default: to watch)')
          .addChoices({ name: 'To watch', value: 'todo' }, { name: 'Watched', value: 'done' }),
      )
      .addStringOption((o) =>
        o
          .setName('sort')
          .setDescription('Order (default: newest first)')
          .addChoices(
            { name: 'Newest first', value: 'new' },
            { name: 'Oldest first', value: 'old' },
            { name: 'A–Z', value: 'az' },
          ),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('watched')
      .setDescription('Mark a movie as watched')
      .addStringOption((o) =>
        o.setName('title').setDescription('Start typing to search the watchlist').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Remove a movie (the person who added it, or an admin)')
      .addStringOption((o) =>
        o.setName('title').setDescription('Start typing to search the watchlist').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((s) => s.setName('random').setDescription('Pick a random movie to watch'))
  .addSubcommand((s) =>
    s
      .setName('import')
      .setDescription('(Admin) One-time import of movie names from a channel')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('The channel people have been posting movies in')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread),
      ),
  );

// ── Helpers ──────────────────────────────────────────────

function isAdmin(i: { user: { id: string }; memberPermissions: Readonly<{ has(p: bigint): boolean }> | null }): boolean {
  return i.user.id === config.BOT_OWNER_ID || Boolean(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

function errorEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(ERROR).setTitle(title).setDescription(description);
}

function unix(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function withYear(title: string, year: number | null | undefined): string {
  return year ? `${title} (${year})` : title;
}

/** Resolves after `ms` with `fallback` if the promise is still pending. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** Resolves an autocomplete value (movie id) or free text to a movie in this guild. */
async function findMovie(guildId: string, input: string, watched?: boolean) {
  const where: Prisma.MovieWhereInput = { guildId, ...(watched === undefined ? {} : { watched }) };
  if (/^\d+$/.test(input)) {
    const byId = await db.movie.findFirst({ where: { ...where, id: Number(input) } });
    if (byId) return byId;
  }
  return db.movie.findFirst({
    where: { ...where, OR: [{ normalized: normalizeTitle(input) }, { normalized: { startsWith: `${normalizeTitle(input)} ` } }] },
  });
}

// ── Searching ────────────────────────────────────────────

/**
 * Searches the movie database for a line of text. If the first search isn't a
 * confident match, retries with parts of the text to get past typos, then
 * returns all results (best first) with how confident the match is.
 */
async function searchWithFallback(text: string, limit = 5) {
  const safeSearch = (q: string) => searchMovies(q, limit).catch((err: unknown) => {
    logger.warn({ err }, 'TMDB search failed');
    return [] as TmdbMovie[];
  });

  let results = await safeSearch(text);
  let match = classifyMatch(text, results);
  if (match.kind !== 'matched') {
    const seen = new Set(results.map((r) => r.id));
    for (const q of fallbackQueries(text)) {
      for (const r of await safeSearch(q)) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          results.push(r);
        }
      }
    }
    match = classifyMatch(text, results);
  }
  if (match.best) results = [match.best, ...results.filter((r) => r.id !== match.best?.id)];
  return { results, ...match };
}

// ── Adding & metadata ────────────────────────────────────

interface AddOptions {
  addedById: string;
  addedAt?: Date;
  watched?: boolean;
  sourceMessageId?: string;
}

/**
 * Adds a film, avoiding duplicates. With TMDB data the official title + year is
 * stored, and an existing free-text entry with the same name is upgraded in place.
 */
async function addMovie(
  guildId: string,
  title: string,
  tmdb: TmdbMovie | null,
  opts: AddOptions,
): Promise<{ movie: Movie; created: boolean; upgraded?: boolean }> {
  const base = {
    guildId,
    addedById: opts.addedById,
    ...(opts.addedAt ? { addedAt: opts.addedAt } : {}),
    watched: opts.watched ?? false,
    watchedAt: opts.watched ? new Date() : null,
    sourceMessageId: opts.sourceMessageId ?? null,
  };

  if (tmdb) {
    const byTmdb = await db.movie.findFirst({ where: { guildId, tmdbId: tmdb.id } });
    if (byTmdb) return { movie: byTmdb, created: false };

    const plain = normalizeTitle(tmdb.title);
    const normalized = tmdb.year ? `${plain} ${tmdb.year}` : plain;
    const meta = { title: tmdb.title, normalized, tmdbId: tmdb.id, year: tmdb.year, posterPath: tmdb.posterPath };

    // Upgrade an earlier free-text entry ("dune") to the real film
    const freeText = await db.movie.findFirst({ where: { guildId, tmdbId: null, normalized: { in: [plain, normalizeTitle(title)] } } });
    if (freeText) return { movie: await db.movie.update({ where: { id: freeText.id }, data: meta }), created: false, upgraded: true };

    const clash = await db.movie.findUnique({ where: { guildId_normalized: { guildId, normalized } } });
    if (clash) return { movie: clash, created: false };

    return { movie: await db.movie.create({ data: { ...base, ...meta } }), created: true };
  }

  const normalized = normalizeTitle(title);
  const existing = await db.movie.findFirst({
    where: { guildId, OR: [{ normalized }, { normalized: { startsWith: `${normalized} ` }, tmdbId: { not: null } }] },
  });
  if (existing) return { movie: existing, created: false };
  return { movie: await db.movie.create({ data: { ...base, title, normalized } }), created: true };
}

function needsEnrichment(m: Movie): boolean {
  if (m.tmdbId && !m.imdbId && isTmdbConfigured()) return true;
  if (m.imdbId && isOmdbConfigured()) {
    return !m.ratingsUpdatedAt || Date.now() - m.ratingsUpdatedAt.getTime() > RATINGS_TTL_MS;
  }
  return false;
}

/** Fills in IMDb id (via TMDB) and IMDb / Rotten Tomatoes ratings (via OMDb), caching for a week. */
async function enrichMovie(m: Movie): Promise<Movie> {
  if (!needsEnrichment(m)) return m;
  const data: Prisma.MovieUpdateInput = {};
  let imdbId = m.imdbId;

  if (m.tmdbId && !imdbId) {
    const details = await getMovieDetails(m.tmdbId);
    if (details) {
      imdbId = details.imdbId;
      Object.assign(data, { imdbId, posterPath: details.posterPath ?? m.posterPath, year: details.year ?? m.year });
    }
  }
  if (imdbId && isOmdbConfigured()) {
    const ratings = await getRatings(imdbId);
    // Record the attempt either way so a missing film isn't re-queried on every view
    Object.assign(data, { ratingsUpdatedAt: new Date(), ...(ratings ?? {}) });
  }
  if (Object.keys(data).length === 0) return m;
  return db.movie.update({ where: { id: m.id }, data }).catch(() => m);
}

/** Enriches a page of movies, waiting at most ENRICH_WAIT_MS; the rest finish in the background. */
async function enrichMovies(movies: Movie[]): Promise<Movie[]> {
  if (!movies.some(needsEnrichment)) return movies;
  const work = Promise.all(movies.map((m) => enrichMovie(m).catch(() => m)));
  return withTimeout(work, ENRICH_WAIT_MS, movies);
}

/** "⭐ 8.5 IMDb · Ⓜ 74 Metacritic · 🍅 92% · IMDb · Rotten Tomatoes" with links; empty for free-text entries. */
function ratingsLine(m: Movie): string {
  const parts: string[] = [];
  if (m.imdbRating) parts.push(`⭐ ${m.imdbRating} IMDb`);
  if (m.metascore) parts.push(`Ⓜ ${m.metascore} Metacritic`);
  if (m.rtRating) parts.push(`🍅 ${m.rtRating}`);
  if (m.imdbId) parts.push(`[IMDb](${imdbUrl(m.imdbId)})`);
  if (m.tmdbId || m.imdbId) parts.push(`[Rotten Tomatoes](${rottenTomatoesUrl(m.title)})`);
  return parts.join(' · ');
}

function movieEmbed(m: Movie, heading: string, color = ACCENT): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: heading })
    .setTitle(truncate(withYear(m.title, m.year), 256))
    .setDescription([ratingsLine(m), `Added by <@${m.addedById}> <t:${unix(m.addedAt)}:R>`].filter(Boolean).join('\n'));
  if (m.imdbId) embed.setURL(imdbUrl(m.imdbId));
  const poster = posterUrl(m.posterPath);
  if (poster) embed.setThumbnail(poster);
  return embed;
}

// ── Interactive list ─────────────────────────────────────

interface ListState {
  show: Show;
  sort: Sort;
  page: number;
}

function listId(action: string, s: ListState): string {
  return `${MOVIE_PREFIX}${action}:${s.show}:${s.sort}:${s.page}`;
}

function parseState(parts: string[]): ListState {
  const show: Show = parts[0] === 'done' ? 'done' : 'todo';
  const sort: Sort = parts[1] === 'old' || parts[1] === 'az' ? parts[1] : 'new';
  const page = Number.parseInt(parts[2] ?? '0', 10);
  return { show, sort, page: Number.isFinite(page) ? page : 0 };
}

async function renderList(guildId: string, state: ListState, note?: string) {
  const watched = state.show === 'done';
  const [todoCount, doneCount] = await Promise.all([
    db.movie.count({ where: { guildId, watched: false } }),
    db.movie.count({ where: { guildId, watched: true } }),
  ]);
  const total = watched ? doneCount : todoCount;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(state.page, 0), pages - 1);
  const s: ListState = { ...state, page };

  const dateField = watched ? 'watchedAt' : 'addedAt';
  const orderBy: Prisma.MovieOrderByWithRelationInput =
    s.sort === 'az' ? { normalized: 'asc' } : { [dateField]: s.sort === 'old' ? 'asc' : 'desc' };

  const movies = await enrichMovies(
    await db.movie.findMany({
      where: { guildId, watched },
      orderBy: [orderBy, { id: 'asc' }],
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  );

  const lines = movies.map((m, i) => {
    const n = page * PAGE_SIZE + i + 1;
    const name = escapeMarkdown(withYear(m.title, m.year));
    const head = watched
      ? `\`${n}.\` ~~${name}~~ · watched ${m.watchedAt ? `<t:${unix(m.watchedAt)}:d>` : ''}`
      : `\`${n}.\` **${name}** · <@${m.addedById}> <t:${unix(m.addedAt)}:R>`;
    const meta = ratingsLine(m);
    return meta ? `${head}\n↳ ${meta}` : head;
  });

  const embed = new EmbedBuilder()
    .setColor(watched ? DONE : ACCENT)
    .setTitle(watched ? '✅ Watched movies' : '🎬 Movie watchlist')
    .setDescription(
      truncate(lines.join('\n'), 4096) ||
        (watched ? 'Nothing watched yet.' : 'The watchlist is empty — add one with `/ic movie add`.'),
    )
    .setFooter({
      text: `${todoCount} to watch · ${doneCount} watched · Page ${page + 1}/${pages} · ${SORT_LABEL[s.sort]}`,
    });

  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

  if (movies.length > 0) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(listId('mark', s))
          .setPlaceholder(watched ? '↩️ Move back to the watchlist…' : '✅ Mark as watched…')
          .setMinValues(1)
          .setMaxValues(movies.length)
          .addOptions(
            movies.map((m, i) => ({
              label: truncate(`${page * PAGE_SIZE + i + 1}. ${withYear(m.title, m.year)}`, 100),
              value: String(m.id),
            })),
          ),
      ),
    );
  }

  rows.push(
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${MOVIE_PREFIX}sort:${s.show}`)
        .addOptions(
          (Object.keys(SORT_LABEL) as Sort[]).map((key) => ({
            label: `Sort: ${SORT_LABEL[key]}`,
            value: key,
            default: key === s.sort,
          })),
        ),
    ),
  );

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(listId('v', { ...s, page: page - 1 }))
        .setLabel('◀ Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(listId('v', { ...s, page: page + 1 }))
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pages - 1),
      new ButtonBuilder()
        .setCustomId(listId('v', { show: watched ? 'todo' : 'done', sort: s.sort, page: 0 }))
        .setLabel(watched ? '🎬 Show to-watch' : `✅ Show watched (${doneCount})`)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${MOVIE_PREFIX}rand`)
        .setLabel('🎲 Random pick')
        .setStyle(ButtonStyle.Success)
        .setDisabled(todoCount === 0),
    ),
  );

  return { content: note ?? '', embeds: [embed], components: rows, allowedMentions: { parse: [] as [] } };
}

// ── Random pick ──────────────────────────────────────────

async function renderRandom(guildId: string, excludeId?: number) {
  const where: Prisma.MovieWhereInput = { guildId, watched: false };
  const total = await db.movie.count({ where });
  // On reroll, avoid showing the same film again when there's a choice
  const pickWhere: Prisma.MovieWhereInput = total > 1 && excludeId ? { ...where, id: { not: excludeId } } : where;
  const count = pickWhere === where ? total : await db.movie.count({ where: pickWhere });

  if (count <= 0) {
    return {
      content: '',
      embeds: [new EmbedBuilder().setColor(GREY).setTitle('🎲 Nothing to pick').setDescription('The watchlist is empty — add one with `/ic movie add`.')],
      components: [],
    };
  }

  const [picked] = await db.movie.findMany({ where: pickWhere, skip: Math.floor(Math.random() * count), take: 1 });
  const [movie] = await enrichMovies([picked]);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${MOVIE_PREFIX}pick:${movie.id}`).setLabel('✅ Watched it').setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${MOVIE_PREFIX}reroll:${movie.id}`)
      .setLabel('🎲 Reroll')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(total <= 1),
  );
  return { content: '', embeds: [movieEmbed(movie, '🎲 Tonight\'s pick')], components: [row], allowedMentions: { parse: [] as [] } };
}

// ── Add (with "did you mean" picker) ─────────────────────

const pendingAdds = new Map<string, { guildId: string; userId: string; title: string; options: TmdbMovie[]; expires: number }>();

function prunePending(): void {
  const now = Date.now();
  for (const [k, v] of pendingAdds) if (v.expires < now) pendingAdds.delete(k);
  for (const [k, v] of pendingImports) if (v.expires < now) pendingImports.delete(k);
}

/** Saves the film, then posts a public "added" message and removes the private working reply. */
async function finishAdd(
  interaction: GuildChat | StringSelectMenuInteraction,
  guildId: string,
  typed: string,
  tmdb: TmdbMovie | null,
): Promise<void> {
  const { movie, created, upgraded } = await addMovie(guildId, typed, tmdb, { addedById: interaction.user.id });

  if (!created) {
    const name = `**${escapeMarkdown(withYear(movie.title, movie.year))}**`;
    const status = movie.watched
      ? `${name} was already watched${movie.watchedAt ? ` <t:${unix(movie.watchedAt)}:R>` : ''}.`
      : `${name} was added by <@${movie.addedById}> <t:${unix(movie.addedAt)}:R>.`;
    await interaction.editReply({
      content: '',
      embeds: [
        new EmbedBuilder()
          .setColor(GREY)
          .setTitle('Already on the list')
          .setDescription(upgraded ? `${status}\nI've updated it to the film's proper title, so it now shows ratings.` : status),
      ],
      components: [],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const [enriched] = await enrichMovies([movie]);
  const todo = await db.movie.count({ where: { guildId, watched: false } });
  const embed = movieEmbed(enriched, '🎬 Added to the watchlist').setFooter({ text: `${todo} to watch · /ic movie list` });

  await interaction.followUp({ embeds: [embed], allowedMentions: { parse: [] } });
  await interaction.deleteReply().catch(() => undefined);
}

async function handleAdd(interaction: GuildChat): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  prunePending();

  const input = cleanTitle(interaction.options.getString('title', true));

  // Picked from the autocomplete suggestions
  const tmdbMatch = /^tmdb:(\d+)$/.exec(input);
  if (tmdbMatch) {
    const details = await getMovieDetails(Number(tmdbMatch[1]));
    if (details) return finishAdd(interaction, interaction.guildId, details.title, details);
  }

  if (!normalizeTitle(input) || tmdbMatch) {
    await interaction.editReply({ embeds: [errorEmbed('Invalid title', 'Give the movie a name with some letters or numbers.')] });
    return;
  }

  if (!isTmdbConfigured()) return finishAdd(interaction, interaction.guildId, input, null);
  const found = await searchWithFallback(input, 5);
  const results = found.results.slice(0, 10);

  // Nothing found: add exactly as typed
  if (results.length === 0) return finishAdd(interaction, interaction.guildId, input, null);

  // One clear exact match: add it straight away
  const exact = results.filter((r) => normalizeTitle(r.title) === normalizeTitle(input));
  if (found.kind === 'matched' && found.best && exact.length <= 1) return finishAdd(interaction, interaction.guildId, input, found.best);

  // Otherwise ask which film they meant
  const token = randomBytes(6).toString('hex');
  pendingAdds.set(token, { guildId: interaction.guildId, userId: interaction.user.id, title: input, options: results, expires: Date.now() + PENDING_TTL_MS });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${MOVIE_PREFIX}addpick:${token}`)
    .setPlaceholder('Pick the right film…')
    .addOptions([
      ...results.map((r) => ({
        label: truncate(withYear(r.title, r.year), 100),
        ...(r.originalTitle !== r.title ? { description: truncate(r.originalTitle, 100) } : {}),
        value: `tmdb:${r.id}`,
      })),
      { label: truncate(`Add "${input}" exactly as typed`, 100), value: 'raw', emoji: '➕' },
    ]);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle('Which film did you mean?')
        .setDescription(`Results for **${escapeMarkdown(input)}** — pick one so it's saved with its proper name and ratings.`),
    ],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

async function handleAddPick(interaction: StringSelectMenuInteraction, token: string): Promise<void> {
  const pending = pendingAdds.get(token);
  if (!pending || pending.expires < Date.now() || pending.userId !== interaction.user.id) {
    await interaction.update({ content: 'This choice has expired — run `/ic movie add` again.', embeds: [], components: [] });
    return;
  }
  pendingAdds.delete(token);
  await interaction.deferUpdate();

  const value = interaction.values[0];
  const tmdb = value.startsWith('tmdb:') ? pending.options.find((o) => o.id === Number(value.slice(5))) ?? null : null;
  await finishAdd(interaction, pending.guildId, tmdb ? tmdb.title : pending.title, tmdb);
}

// ── Import ───────────────────────────────────────────────

interface ImportItem {
  text: string; // the line as written in the channel
  title: string; // what will be saved
  tmdb: TmdbMovie | null;
  kind: MatchKind;
  addedById: string;
  addedAt: Date;
  watched: boolean;
  sourceMessageId: string;
}

const pendingImports = new Map<string, { guildId: string; userId: string; matched: ImportItem[]; unsure: ImportItem[]; expires: number }>();

async function fetchAllMessages(channel: { messages: { fetch(o: { limit: number; before?: string }): Promise<Collection<string, Message>> } }) {
  const all: Message[] = [];
  let before: string | undefined;
  while (all.length < IMPORT_MAX_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    all.push(...batch.values());
    before = batch.lastKey();
    if (batch.size < 100) break;
  }
  return all;
}

async function handleImport(interaction: GuildChat): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  prunePending();

  if (!isAdmin(interaction)) {
    await interaction.editReply({ embeds: [errorEmbed('Permission denied', 'You need the **Manage Server** permission to import movies.')] });
    return;
  }

  const option = interaction.options.getChannel('channel', true);
  const channel = await interaction.client.channels.fetch(option.id).catch(() => null);
  if (!channel || !('messages' in channel) || channel.isDMBased()) {
    await interaction.editReply({ embeds: [errorEmbed('Can\'t read that channel', 'Pick a text channel in this server.')] });
    return;
  }

  const perms = channel.permissionsFor(interaction.client.user);
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
    await interaction.editReply({
      embeds: [errorEmbed('Missing permissions', `I need **View Channel** and **Read Message History** in <#${channel.id}>.`)],
    });
    return;
  }

  await interaction.editReply({ content: `Reading messages in <#${channel.id}>…` });
  const messages = await fetchAllMessages(channel);
  const userMessages = messages.filter((m) => !m.author.bot);

  if (userMessages.length > 0 && userMessages.every((m) => m.content.trim().length === 0)) {
    await interaction.editReply({
      content: '',
      embeds: [
        errorEmbed(
          'I can\'t see message text',
          'Discord is hiding message content from the bot. Turn on **Message Content Intent** in the Discord Developer Portal (your app → **Bot** → Privileged Gateway Intents), then run this again.',
        ),
      ],
    });
    return;
  }

  // Oldest first, so the earliest mention of a film wins
  const sorted = [...userMessages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const seenText = new Set<string>();
  const candidates: Omit<ImportItem, 'title' | 'tmdb' | 'kind'>[] = [];
  for (const msg of sorted) {
    const watched = msg.reactions.cache.some((r) => r.emoji.name !== null && WATCHED_REACTIONS.has(r.emoji.name));
    for (const text of parseMovieLines(msg.content)) {
      const key = normalizeTitle(text);
      if (!key || seenText.has(key)) continue;
      seenText.add(key);
      candidates.push({ text, addedById: msg.author.id, addedAt: msg.createdAt, watched, sourceMessageId: msg.id });
    }
  }

  // Match each line against the movie database (or take lines as-is without it)
  const useTmdb = isTmdbConfigured();
  let done = 0;
  let lastProgress = Date.now();
  const items: ImportItem[] = await mapLimit(candidates, IMPORT_CONCURRENCY, async (c) => {
    if (!useTmdb) return { ...c, title: c.text, tmdb: null, kind: 'matched' as MatchKind };
    const { kind, best } = await searchWithFallback(c.text, 5);
    done += 1;
    if (Date.now() - lastProgress > 4000) {
      lastProgress = Date.now();
      await interaction.editReply({ content: `Matching against the movie database… ${done}/${candidates.length}` }).catch(() => undefined);
    }
    return { ...c, title: best && kind !== 'none' ? best.title : c.text, tmdb: kind !== 'none' ? best : null, kind };
  });

  // Skip films already on the list and repeat mentions of the same film
  const existing = await db.movie.findMany({ where: { guildId: interaction.guildId }, select: { normalized: true, tmdbId: true } });
  const haveTmdb = new Set(existing.map((m) => m.tmdbId).filter((id): id is number => id !== null));
  const haveNorm = new Set(existing.map((m) => m.normalized));
  const seenTmdb = new Set<number>();
  const matched: ImportItem[] = [];
  const unsure: ImportItem[] = [];
  const notFound: ImportItem[] = [];
  let alreadyListed = 0;

  for (const item of items) {
    if (item.kind === 'none') {
      notFound.push(item);
      continue;
    }
    if (item.tmdb) {
      if (haveTmdb.has(item.tmdb.id)) { alreadyListed += 1; continue; }
      if (seenTmdb.has(item.tmdb.id)) continue;
      seenTmdb.add(item.tmdb.id);
    } else if (haveNorm.has(normalizeTitle(item.title))) {
      alreadyListed += 1;
      continue;
    }
    (item.kind === 'matched' ? matched : unsure).push(item);
  }

  if (matched.length === 0 && unsure.length === 0) {
    await interaction.editReply({
      content: '',
      embeds: [
        new EmbedBuilder()
          .setColor(GREY)
          .setTitle('Nothing new to import')
          .setDescription(`Scanned ${messages.length} messages in <#${channel.id}>. ${alreadyListed} film(s) already on the list, ${notFound.length} line(s) didn't look like films.`),
      ],
    });
    return;
  }

  const token = randomBytes(6).toString('hex');
  pendingImports.set(token, { guildId: interaction.guildId, userId: interaction.user.id, matched, unsure, expires: Date.now() + PENDING_TTL_MS });

  const fmt = (i: ImportItem) =>
    `${i.watched ? '[watched] ' : ''}${i.tmdb ? `${withYear(i.tmdb.title, i.tmdb.year)}` : i.title}${i.tmdb && normalizeTitle(i.text) !== normalizeTitle(i.tmdb.title) ? `   ← "${i.text}"` : ''}`;
  const report = [
    `MATCHED — will be imported (${matched.length})`,
    ...matched.map(fmt),
    '',
    `NEEDS A CHECK — best guess, only imported if you choose "matched + guesses" (${unsure.length})`,
    ...unsure.map(fmt),
    '',
    `NOT FILMS / NOT FOUND — skipped (${notFound.length})`,
    ...notFound.map((i) => i.text),
  ].join('\n');
  const file = new AttachmentBuilder(Buffer.from(report, 'utf8'), { name: 'movie-import-preview.txt' });

  const sample = (list: ImportItem[]) =>
    truncate(list.slice(0, 8).map((i) => `• ${escapeMarkdown(fmt(i))}`).join('\n') || '—', 1024);

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('🎬 Import preview')
    .setDescription(
      [
        `Scanned **${messages.length}** messages in <#${channel.id}>${messages.length >= IMPORT_MAX_MESSAGES ? ' (limit reached)' : ''}.`,
        useTmdb
          ? `✅ **${matched.length}** matched a film · ❓ **${unsure.length}** best guesses to check · 🚫 **${notFound.length}** skipped as chat/not found`
          : `Found **${matched.length}** line(s). Movie database not configured, so they'll be saved exactly as written.`,
        alreadyListed ? `${alreadyListed} already on the list.` : '',
        'Films with a ✅ reaction in the channel are imported as watched.',
        '**The attached file lists everything** — check the guesses before including them.',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .addFields({ name: `Matched (${matched.length})`, value: sample(matched) })
    .setFooter({ text: 'This preview expires in 15 minutes' });
  if (unsure.length) embed.addFields({ name: `Best guesses (${unsure.length})`, value: sample(unsure) });

  const buttons = [
    new ButtonBuilder().setCustomId(`${MOVIE_PREFIX}imp:${token}:m`).setLabel(`Import ${matched.length} matched`).setStyle(ButtonStyle.Success).setDisabled(matched.length === 0),
  ];
  if (unsure.length) {
    buttons.push(
      new ButtonBuilder().setCustomId(`${MOVIE_PREFIX}imp:${token}:mu`).setLabel(`Import matched + ${unsure.length} guesses`).setStyle(ButtonStyle.Primary),
    );
  }
  buttons.push(new ButtonBuilder().setCustomId(`${MOVIE_PREFIX}imp:${token}:no`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));

  await interaction.editReply({ content: '', embeds: [embed], files: [file], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)] });
}

async function confirmImport(interaction: ButtonInteraction, token: string, mode: string): Promise<void> {
  const pending = pendingImports.get(token);
  if (!pending || pending.expires < Date.now()) {
    pendingImports.delete(token);
    await interaction.update({ content: 'This import preview has expired — run `/ic movie import` again.', embeds: [], components: [], files: [] });
    return;
  }
  if (pending.userId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the person who started the import can confirm it.', ephemeral: true });
    return;
  }
  pendingImports.delete(token);

  if (mode === 'no') {
    await interaction.update({ content: 'Import cancelled — nothing was added.', embeds: [], components: [], files: [] });
    return;
  }

  await interaction.update({ content: 'Importing…', embeds: [], components: [], files: [] });
  const toAdd = mode === 'mu' ? [...pending.matched, ...pending.unsure] : pending.matched;
  let added = 0;
  for (const item of toAdd) {
    const { created } = await addMovie(pending.guildId, item.title, item.tmdb, {
      addedById: item.addedById,
      addedAt: item.addedAt,
      watched: item.watched,
      sourceMessageId: item.sourceMessageId,
    }).catch((err: unknown) => {
      logger.warn({ err, title: item.title }, 'Skipped movie during import');
      return { created: false };
    });
    if (created) added += 1;
  }

  logger.info({ guildId: pending.guildId, added }, 'Imported movies');
  await interaction.editReply({
    content: '',
    embeds: [
      new EmbedBuilder()
        .setColor(DONE)
        .setTitle(`✅ Imported ${added} movie(s)`)
        .setDescription('Use `/ic movie list` to see the watchlist — ratings fill in as you browse it.'),
    ],
  });
}

// ── Other slash command handlers ─────────────────────────

async function handleWatched(interaction: GuildChat): Promise<void> {
  const movie = await findMovie(interaction.guildId, interaction.options.getString('title', true), false);
  if (!movie) {
    await interaction.reply({ embeds: [errorEmbed('Not found', 'That movie isn\'t on the to-watch list. Pick one from the suggestions.')], ephemeral: true });
    return;
  }
  await db.movie.update({ where: { id: movie.id }, data: { watched: true, watchedAt: new Date(), watchedById: interaction.user.id } });
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(DONE).setDescription(`✅ **${escapeMarkdown(withYear(movie.title, movie.year))}** marked as watched by <@${interaction.user.id}>`)],
    allowedMentions: { parse: [] },
  });
}

async function handleRemove(interaction: GuildChat): Promise<void> {
  const movie = await findMovie(interaction.guildId, interaction.options.getString('title', true));
  if (!movie) {
    await interaction.reply({ embeds: [errorEmbed('Not found', 'That movie isn\'t on the list. Pick one from the suggestions.')], ephemeral: true });
    return;
  }
  if (movie.addedById !== interaction.user.id && !isAdmin(interaction)) {
    await interaction.reply({
      embeds: [errorEmbed('Permission denied', 'Only the person who added it, or someone with **Manage Server**, can remove it.')],
      ephemeral: true,
    });
    return;
  }
  await db.movie.delete({ where: { id: movie.id } });
  await interaction.reply({ content: `🗑️ Removed **${escapeMarkdown(withYear(movie.title, movie.year))}** from the list.`, ephemeral: true });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'The movie list only works inside a server.', ephemeral: true });
    return;
  }

  switch (interaction.options.getSubcommand()) {
    case 'add':
      return handleAdd(interaction);
    case 'list': {
      await interaction.deferReply();
      const state = parseState([interaction.options.getString('show') ?? 'todo', interaction.options.getString('sort') ?? 'new', '0']);
      await interaction.editReply(await renderList(interaction.guildId, state));
      return;
    }
    case 'watched':
      return handleWatched(interaction);
    case 'remove':
      return handleRemove(interaction);
    case 'random':
      await interaction.deferReply();
      await interaction.editReply(await renderRandom(interaction.guildId));
      return;
    case 'import':
      return handleImport(interaction);
  }
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guildId) return interaction.respond([]);
  const typed = String(interaction.options.getFocused()).trim();
  const sub = interaction.options.getSubcommand(false);

  if (sub === 'add') {
    if (!isTmdbConfigured() || typed.length < 2) return interaction.respond([]);
    let results = await searchMovies(typed, 8, 1400).catch(() => [] as TmdbMovie[]);
    // Typo? Try the longest word instead ("harrpy potter" → "potter")
    const retry = fallbackQueries(typed)[0];
    if (results.length === 0 && retry) results = await searchMovies(retry, 8, 1200).catch(() => [] as TmdbMovie[]);
    return interaction.respond([
      ...results.map((r) => ({ name: truncate(withYear(r.title, r.year), 100), value: `tmdb:${r.id}` })),
      { name: truncate(`➕ "${typed}" (as typed)`, 100), value: truncate(typed, 100) },
    ]);
  }

  const query = normalizeTitle(typed);
  const movies = await db.movie.findMany({
    where: {
      guildId: interaction.guildId,
      ...(sub === 'watched' ? { watched: false } : {}),
      ...(query ? { normalized: { contains: query } } : {}),
    },
    orderBy: { normalized: 'asc' },
    take: 25,
  });
  await interaction.respond(
    movies.map((m) => ({ name: truncate(`${m.watched ? '✅ ' : ''}${withYear(m.title, m.year)}`, 100), value: String(m.id) })),
  );
}

// ── Buttons & menus ──────────────────────────────────────

export async function handleMovieComponent(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;
  const [action, ...parts] = interaction.customId.slice(MOVIE_PREFIX.length).split(':');

  switch (action) {
    case 'v': // page / toggle watched view
      await interaction.deferUpdate();
      await interaction.editReply(await renderList(guildId, parseState(parts)));
      return;

    case 'sort': {
      if (!interaction.isStringSelectMenu()) return;
      await interaction.deferUpdate();
      await interaction.editReply(await renderList(guildId, parseState([parts[0], interaction.values[0], '0'])));
      return;
    }

    case 'mark': {
      if (!interaction.isStringSelectMenu()) return;
      await interaction.deferUpdate();
      const state = parseState(parts);
      const ids = interaction.values.map(Number).filter(Number.isInteger);
      const markWatched = state.show === 'todo';
      const movies = await db.movie.findMany({ where: { guildId, id: { in: ids }, watched: !markWatched } });
      await db.movie.updateMany({
        where: { id: { in: movies.map((m) => m.id) } },
        data: markWatched
          ? { watched: true, watchedAt: new Date(), watchedById: interaction.user.id }
          : { watched: false, watchedAt: null, watchedById: null },
      });
      const names = movies.map((m) => `**${escapeMarkdown(m.title)}**`).join(', ');
      const note = movies.length
        ? `${markWatched ? '✅' : '↩️'} <@${interaction.user.id}> ${markWatched ? 'marked' : 'moved back'} ${truncate(names, 1500)}${markWatched ? ' as watched' : ' to the watchlist'}`
        : undefined;
      await interaction.editReply(await renderList(guildId, state, note));
      return;
    }

    case 'rand':
      await interaction.deferReply();
      await interaction.editReply(await renderRandom(guildId));
      return;

    case 'reroll':
      await interaction.deferUpdate();
      await interaction.editReply(await renderRandom(guildId, Number(parts[0])));
      return;

    case 'pick': {
      const movie = await db.movie.findFirst({ where: { guildId, id: Number(parts[0]) } });
      if (movie && !movie.watched) {
        await db.movie.update({ where: { id: movie.id }, data: { watched: true, watchedAt: new Date(), watchedById: interaction.user.id } });
      }
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(DONE)
            .setDescription(
              movie
                ? `✅ **${escapeMarkdown(withYear(movie.title, movie.year))}** marked as watched by <@${interaction.user.id}>`
                : 'That movie is no longer on the list.',
            ),
        ],
        components: [],
        allowedMentions: { parse: [] },
      });
      return;
    }

    case 'addpick':
      if (interaction.isStringSelectMenu()) await handleAddPick(interaction, parts[0]);
      return;

    case 'imp':
      if (interaction.isButton()) await confirmImport(interaction, parts[0], parts[1]);
      return;
  }
}
