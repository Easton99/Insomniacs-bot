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
import { Prisma } from '@prisma/client';
import { db } from '../database/client';
import { config } from '../config';
import { MAX_TITLE_LENGTH, cleanTitle, normalizeTitle, parseMovieLines } from '../utils/movie-utils';
import logger from '../utils/logger';

export const MOVIE_PREFIX = 'mv:';

const ACCENT = 0xff6b35;
const DONE = 0x10b981;
const GREY = 0x888888;
const ERROR = 0xcc3333;
const PAGE_SIZE = 10;
const IMPORT_MAX_MESSAGES = 5000;
const IMPORT_TTL_MS = 15 * 60 * 1000;
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
        o.setName('title').setDescription('Movie title').setRequired(true).setMaxLength(MAX_TITLE_LENGTH),
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

/** Resolves an autocomplete value (movie id) or free text to a movie in this guild. */
async function findMovie(guildId: string, input: string, watched?: boolean) {
  const where: Prisma.MovieWhereInput = { guildId, ...(watched === undefined ? {} : { watched }) };
  if (/^\d+$/.test(input)) {
    const byId = await db.movie.findFirst({ where: { ...where, id: Number(input) } });
    if (byId) return byId;
  }
  return db.movie.findFirst({ where: { ...where, normalized: normalizeTitle(input) } });
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

  const movies = await db.movie.findMany({
    where: { guildId, watched },
    orderBy: [orderBy, { id: 'asc' }],
    skip: page * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  const lines = movies.map((m, i) => {
    const n = page * PAGE_SIZE + i + 1;
    const title = escapeMarkdown(m.title);
    return watched
      ? `\`${n}.\` ~~${title}~~ · watched ${m.watchedAt ? `<t:${unix(m.watchedAt)}:d>` : ''}`
      : `\`${n}.\` **${title}** · <@${m.addedById}> · <t:${unix(m.addedAt)}:R>`;
  });

  const embed = new EmbedBuilder()
    .setColor(watched ? DONE : ACCENT)
    .setTitle(watched ? '✅ Watched movies' : '🎬 Movie watchlist')
    .setDescription(
      lines.join('\n') ||
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
              label: truncate(`${page * PAGE_SIZE + i + 1}. ${m.title}`, 100),
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

  const [movie] = await db.movie.findMany({ where: pickWhere, skip: Math.floor(Math.random() * count), take: 1 });
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('🎲 Tonight\'s pick')
    .setDescription(`## ${escapeMarkdown(movie.title)}\nAdded by <@${movie.addedById}> <t:${unix(movie.addedAt)}:R>`);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${MOVIE_PREFIX}pick:${movie.id}`).setLabel('✅ Watched it').setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${MOVIE_PREFIX}reroll:${movie.id}`)
      .setLabel('🎲 Reroll')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(total <= 1),
  );
  return { content: '', embeds: [embed], components: [row], allowedMentions: { parse: [] as [] } };
}

// ── Import ───────────────────────────────────────────────

interface ImportItem {
  title: string;
  normalized: string;
  addedById: string;
  addedAt: Date;
  watched: boolean;
  sourceMessageId: string;
}

const pendingImports = new Map<string, { guildId: string; userId: string; items: ImportItem[]; expires: number }>();

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

  const me = interaction.client.user;
  const perms = channel.permissionsFor(me);
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
    await interaction.editReply({
      embeds: [errorEmbed('Missing permissions', `I need **View Channel** and **Read Message History** in <#${channel.id}>.`)],
    });
    return;
  }

  const messages = await fetchAllMessages(channel);
  const userMessages = messages.filter((m) => !m.author.bot);
  const withText = userMessages.filter((m) => m.content.trim().length > 0);

  if (userMessages.length > 0 && withText.length === 0) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          'I can\'t see message text',
          'Discord is hiding message content from the bot. Turn on **Message Content Intent** in the Discord Developer Portal (your app → **Bot** → Privileged Gateway Intents), then run this again.',
        ),
      ],
    });
    return;
  }

  const existing = new Set(
    (await db.movie.findMany({ where: { guildId: interaction.guildId }, select: { normalized: true } })).map((m) => m.normalized),
  );

  // Oldest first, so the earliest mention of a film wins
  const sorted = [...userMessages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const seen = new Set<string>();
  const items: ImportItem[] = [];
  let found = 0;
  let alreadyListed = 0;

  for (const msg of sorted) {
    const watched = msg.reactions.cache.some((r) => r.emoji.name !== null && WATCHED_REACTIONS.has(r.emoji.name));
    for (const title of parseMovieLines(msg.content)) {
      found += 1;
      const normalized = normalizeTitle(title);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      if (existing.has(normalized)) {
        alreadyListed += 1;
        continue;
      }
      items.push({ title, normalized, addedById: msg.author.id, addedAt: msg.createdAt, watched, sourceMessageId: msg.id });
    }
  }

  if (items.length === 0) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(GREY)
          .setTitle('Nothing new to import')
          .setDescription(`Scanned ${messages.length} messages in <#${channel.id}> and found ${found} title(s), ${alreadyListed} already on the list.`),
      ],
    });
    return;
  }

  const token = randomBytes(6).toString('hex');
  pendingImports.set(token, { guildId: interaction.guildId, userId: interaction.user.id, items, expires: Date.now() + IMPORT_TTL_MS });

  const watchedCount = items.filter((i) => i.watched).length;
  const preview = items.map((i) => `${i.watched ? '[watched] ' : ''}${i.title}`).join('\n');
  const file = new AttachmentBuilder(Buffer.from(preview, 'utf8'), { name: 'movie-import-preview.txt' });

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('🎬 Import preview')
    .setDescription(
      [
        `Scanned **${messages.length}** messages in <#${channel.id}>${messages.length >= IMPORT_MAX_MESSAGES ? ' (limit reached)' : ''}.`,
        `Found **${items.length}** new movie(s) to add${watchedCount ? `, ${watchedCount} marked as watched because the message has a ✅ reaction` : ''}.`,
        alreadyListed ? `${alreadyListed} already on the list and ${found - items.length - alreadyListed} duplicate mention(s) skipped.` : '',
        '',
        '**Check the attached list first** — chat lines can slip in. You can remove any with `/ic movie remove` afterwards.',
      ]
        .filter((l) => l !== undefined)
        .join('\n'),
    )
    .addFields({
      name: 'First few',
      value: truncate(items.slice(0, 10).map((i) => `• ${escapeMarkdown(i.title)}`).join('\n'), 1024),
    })
    .setFooter({ text: 'This preview expires in 15 minutes' });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${MOVIE_PREFIX}imp:${token}:ok`).setLabel(`Import ${items.length}`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${MOVIE_PREFIX}imp:${token}:no`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [embed], files: [file], components: [row] });
}

async function confirmImport(interaction: ButtonInteraction, token: string, ok: boolean): Promise<void> {
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

  if (!ok) {
    await interaction.update({ content: 'Import cancelled — nothing was added.', embeds: [], components: [], files: [] });
    return;
  }

  // Re-check against the list in case movies were added while the preview was open
  const existing = new Set(
    (await db.movie.findMany({ where: { guildId: pending.guildId }, select: { normalized: true } })).map((m) => m.normalized),
  );
  const toAdd = pending.items.filter((i) => !existing.has(i.normalized));
  const now = new Date();

  await db.movie.createMany({
    data: toAdd.map((i) => ({
      guildId: pending.guildId,
      title: i.title,
      normalized: i.normalized,
      addedById: i.addedById,
      addedAt: i.addedAt,
      watched: i.watched,
      watchedAt: i.watched ? now : null,
      sourceMessageId: i.sourceMessageId,
    })),
  });

  logger.info({ guildId: pending.guildId, count: toAdd.length }, 'Imported movies');
  await interaction.update({
    content: '',
    embeds: [
      new EmbedBuilder()
        .setColor(DONE)
        .setTitle(`✅ Imported ${toAdd.length} movie(s)`)
        .setDescription('Use `/ic movie list` to see the watchlist.'),
    ],
    components: [],
    files: [],
  });
}

// ── Slash command handlers ───────────────────────────────

async function handleAdd(interaction: GuildChat): Promise<void> {
  const title = cleanTitle(interaction.options.getString('title', true));
  const normalized = normalizeTitle(title);
  if (!normalized) {
    await interaction.reply({ embeds: [errorEmbed('Invalid title', 'Give the movie a name with some letters or numbers.')], ephemeral: true });
    return;
  }

  const existing = await db.movie.findUnique({ where: { guildId_normalized: { guildId: interaction.guildId, normalized } } });
  if (existing) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(GREY)
          .setTitle('Already on the list')
          .setDescription(
            existing.watched
              ? `**${escapeMarkdown(existing.title)}** was already watched${existing.watchedAt ? ` <t:${unix(existing.watchedAt)}:R>` : ''}.`
              : `**${escapeMarkdown(existing.title)}** was added by <@${existing.addedById}> <t:${unix(existing.addedAt)}:R>.`,
          ),
      ],
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }

  try {
    await db.movie.create({ data: { guildId: interaction.guildId, title, normalized, addedById: interaction.user.id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      await interaction.reply({ content: `**${escapeMarkdown(title)}** is already on the list.`, ephemeral: true });
      return;
    }
    throw err;
  }

  const todo = await db.movie.count({ where: { guildId: interaction.guildId, watched: false } });
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(ACCENT)
        .setDescription(`🎬 **${escapeMarkdown(title)}** added to the watchlist by <@${interaction.user.id}>`)
        .setFooter({ text: `${todo} to watch · /ic movie list` }),
    ],
    allowedMentions: { parse: [] },
  });
}

async function handleWatched(interaction: GuildChat): Promise<void> {
  const movie = await findMovie(interaction.guildId, interaction.options.getString('title', true), false);
  if (!movie) {
    await interaction.reply({ embeds: [errorEmbed('Not found', 'That movie isn\'t on the to-watch list. Pick one from the suggestions.')], ephemeral: true });
    return;
  }
  await db.movie.update({ where: { id: movie.id }, data: { watched: true, watchedAt: new Date(), watchedById: interaction.user.id } });
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(DONE).setDescription(`✅ **${escapeMarkdown(movie.title)}** marked as watched by <@${interaction.user.id}>`)],
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
  await interaction.reply({ content: `🗑️ Removed **${escapeMarkdown(movie.title)}** from the list.`, ephemeral: true });
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
      const state = parseState([interaction.options.getString('show') ?? 'todo', interaction.options.getString('sort') ?? 'new', '0']);
      await interaction.reply(await renderList(interaction.guildId, state));
      return;
    }
    case 'watched':
      return handleWatched(interaction);
    case 'remove':
      return handleRemove(interaction);
    case 'random':
      await interaction.reply(await renderRandom(interaction.guildId));
      return;
    case 'import':
      return handleImport(interaction);
  }
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guildId) return interaction.respond([]);
  const query = normalizeTitle(String(interaction.options.getFocused()));
  const sub = interaction.options.getSubcommand(false);
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
    movies.map((m) => ({ name: truncate(`${m.watched ? '✅ ' : ''}${m.title}`, 100), value: String(m.id) })),
  );
}

// ── Buttons & menus ──────────────────────────────────────

export async function handleMovieComponent(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;
  const [action, ...parts] = interaction.customId.slice(MOVIE_PREFIX.length).split(':');

  switch (action) {
    case 'v': // page / toggle watched view
      await interaction.update(await renderList(guildId, parseState(parts)));
      return;

    case 'sort': {
      if (!interaction.isStringSelectMenu()) return;
      await interaction.update(await renderList(guildId, parseState([parts[0], interaction.values[0], '0'])));
      return;
    }

    case 'mark': {
      if (!interaction.isStringSelectMenu()) return;
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
      await interaction.update(await renderList(guildId, state, note));
      return;
    }

    case 'rand':
      await interaction.reply(await renderRandom(guildId));
      return;

    case 'reroll':
      await interaction.update(await renderRandom(guildId, Number(parts[0])));
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
            .setDescription(movie ? `✅ **${escapeMarkdown(movie.title)}** marked as watched by <@${interaction.user.id}>` : 'That movie is no longer on the list.'),
        ],
        components: [],
        allowedMentions: { parse: [] },
      });
      return;
    }

    case 'imp':
      if (interaction.isButton()) await confirmImport(interaction, parts[0], parts[1] === 'ok');
      return;
  }
}
