import { Client } from 'discord.js';
import { db } from '../database/client';
import { config } from '../config';
import { getZonedDate, isBirthdayOn } from '../utils/birthday-utils';
import logger from '../utils/logger';

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

let running = false;

function joinMentions(ids: string[]): string {
  const mentions = ids.map((id) => `<@${id}>`);
  if (mentions.length === 1) return mentions[0];
  return `${mentions.slice(0, -1).join(', ')} and ${mentions[mentions.length - 1]}`;
}

/**
 * Posts a birthday message in each server's configured birthday channel.
 * Runs from BIRTHDAY_ANNOUNCE_HOUR onwards; lastAnnouncedYear ensures each
 * birthday is announced at most once per year, even across restarts.
 *
 * NOTE: this is a deliberate, opt-in exception to the bot's "no unsolicited
 * messages" rule — nothing is posted unless an admin has set a birthday channel
 * and the user has saved their own birthday in that server.
 */
export async function runBirthdayCheck(client: Client): Promise<void> {
  if (running) return;
  running = true;

  try {
    const today = getZonedDate(config.BOT_TIMEZONE);
    if (today.hour < config.BIRTHDAY_ANNOUNCE_HOUR) return;

    const guilds = await db.guildSettings.findMany({ where: { birthdayChannelId: { not: null } } });

    for (const settings of guilds) {
      const guild = client.guilds.cache.get(settings.guildId);
      if (!guild || !settings.birthdayChannelId) continue;

      // day 29 is included so 29 Feb birthdays are caught on 28 Feb in non-leap years
      const candidates = await db.birthday.findMany({
        where: {
          guildId: settings.guildId,
          month: today.month,
          day: { in: [today.day, 29] },
          OR: [{ lastAnnouncedYear: null }, { lastAnnouncedYear: { not: today.year } }],
        },
      });
      const due = candidates.filter((b) => isBirthdayOn(b.day, b.month, today));
      if (due.length === 0) continue;

      // Skip (but still mark as handled) anyone who has left the server
      const present: string[] = [];
      for (const b of due) {
        const member = await guild.members.fetch(b.discordId).catch(() => null);
        if (member) present.push(b.discordId);
      }

      if (present.length > 0) {
        try {
          const channel = await guild.channels.fetch(settings.birthdayChannelId);
          if (!channel?.isTextBased()) {
            logger.warn({ guildId: guild.id }, 'Birthday channel missing or not text-based');
            continue;
          }

          await channel.send({
            content: `🎉🎂 Happy birthday ${joinMentions(present)}! Have a great day! 🎂🎉`,
            allowedMentions: { users: present },
          });
          logger.info({ guildId: guild.id, users: present }, 'Posted birthday message');
        } catch (err) {
          logger.warn({ err, guildId: guild.id }, 'Failed to post birthday message — will retry next check');
          continue;
        }
      }

      await db.birthday.updateMany({
        where: { guildId: settings.guildId, discordId: { in: due.map((b) => b.discordId) } },
        data: { lastAnnouncedYear: today.year },
      });
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
