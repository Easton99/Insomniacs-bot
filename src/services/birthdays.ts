import { Client, Guild } from 'discord.js';
import { Birthday } from '@prisma/client';
import { db } from '../database/client';
import { config } from '../config';
import { addDays, formatLongDate, getZonedDate, isBirthdayOn } from '../utils/birthday-utils';
import logger from '../utils/logger';

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const REMINDER_DAYS_BEFORE = 7;

type CalendarDate = { year: number; month: number; day: number };
type Kind = 'birthday' | 'reminder';

let running = false;

function joinMentions(ids: string[]): string {
  const mentions = ids.map((id) => `<@${id}>`);
  if (mentions.length === 1) return mentions[0];
  return `${mentions.slice(0, -1).join(', ')} and ${mentions[mentions.length - 1]}`;
}

function buildMessage(kind: Kind, ids: string[], date: CalendarDate): string {
  const names = joinMentions(ids);
  if (kind === 'birthday') {
    return `🎉🎂 Happy birthday ${names}! Have a great day! 🎂🎉`;
  }
  const whose = ids.length === 1 ? `${names}'s birthday is` : `${names} all have birthdays`;
  return `📅 Heads up — ${whose} in a week, on **${formatLongDate(date)}**! 🎂`;
}

/** Birthdays in this guild falling on `date` that haven't had this kind of post for that year yet. */
async function findDue(guildId: string, kind: Kind, date: CalendarDate): Promise<Birthday[]> {
  const field = kind === 'birthday' ? 'lastAnnouncedYear' : 'lastRemindedYear';
  const candidates = await db.birthday.findMany({
    where: {
      guildId,
      month: date.month,
      // day 29 is included so 29 Feb birthdays are caught on 28 Feb in non-leap years
      day: { in: [date.day, 29] },
      OR: [{ [field]: null }, { [field]: { not: date.year } }],
    },
  });
  return candidates.filter((b) => isBirthdayOn(b.day, b.month, date));
}

async function announce(guild: Guild, channelId: string, kind: Kind, date: CalendarDate): Promise<void> {
  const due = await findDue(guild.id, kind, date);
  if (due.length === 0) return;

  // Skip (but still mark as handled) anyone who has left the server
  const present: string[] = [];
  for (const b of due) {
    const member = await guild.members.fetch(b.discordId).catch(() => null);
    if (member) present.push(b.discordId);
  }

  if (present.length > 0) {
    try {
      const channel = await guild.channels.fetch(channelId);
      if (!channel?.isTextBased()) {
        logger.warn({ guildId: guild.id }, 'Birthday channel missing or not text-based');
        return;
      }
      await channel.send({
        content: buildMessage(kind, present, date),
        // Ping on the day; the week-ahead reminder shows names without pinging
        allowedMentions: { users: kind === 'birthday' ? present : [] },
      });
      logger.info({ guildId: guild.id, users: present, kind }, 'Posted birthday message');
    } catch (err) {
      logger.warn({ err, guildId: guild.id, kind }, 'Failed to post birthday message — will retry next check');
      return;
    }
  }

  await db.birthday.updateMany({
    where: { guildId: guild.id, discordId: { in: due.map((b) => b.discordId) } },
    data: kind === 'birthday' ? { lastAnnouncedYear: date.year } : { lastRemindedYear: date.year },
  });
}

/**
 * Posts a one-week reminder and an on-the-day message in each server's
 * configured birthday channel, from BIRTHDAY_ANNOUNCE_HOUR (UK time by default).
 * lastAnnouncedYear / lastRemindedYear ensure each is posted once per year.
 *
 * NOTE: this is a deliberate, opt-in exception to the bot's "no unsolicited
 * messages" rule — nothing is posted unless an admin has set a birthday channel.
 */
export async function runBirthdayCheck(client: Client): Promise<void> {
  if (running) return;
  running = true;

  try {
    const now = getZonedDate(config.BOT_TIMEZONE);
    if (now.hour < config.BIRTHDAY_ANNOUNCE_HOUR) return;

    const today = { year: now.year, month: now.month, day: now.day };
    const inAWeek = addDays(today, REMINDER_DAYS_BEFORE);

    const guilds = await db.guildSettings.findMany({ where: { birthdayChannelId: { not: null } } });

    for (const settings of guilds) {
      const guild = client.guilds.cache.get(settings.guildId);
      if (!guild || !settings.birthdayChannelId) continue;

      await announce(guild, settings.birthdayChannelId, 'reminder', inAWeek);
      await announce(guild, settings.birthdayChannelId, 'birthday', today);
    }
  } catch (err) {
    logger.error({ err }, 'Birthday check failed');
  } finally {
    running = false;
  }
}

export function startBirthdayScheduler(client: Client): NodeJS.Timeout {
  void runBirthdayCheck(client);
  return setInterval(() => void runBirthdayCheck(client), CHECK_INTERVAL_MS);
}
