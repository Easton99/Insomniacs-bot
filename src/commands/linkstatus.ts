import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';
import { FaceitNotFoundError, FaceitRateLimitError, getPlayerById } from '../services/faceit';
import logger from '../utils/logger';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('linkstatus')
  .setDescription('Show the FACEIT account linked to a Discord user')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Discord user to check (defaults to you)').setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getUser('user') ?? interaction.user;
  const isSelf = target.id === interaction.user.id;

  const linked = await db.discordUser.findUnique({ where: { discordId: target.id } });

  if (!linked) {
    const msg = isSelf
      ? "You don't have a FACEIT account linked. Use `/ic link` to add one."
      : `<@${target.id}> hasn't linked a FACEIT account.`;
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x888888).setTitle('Not linked').setDescription(msg)],
    });
    return;
  }

  let player;
  try {
    player = await getPlayerById(linked.faceitId);
  } catch (err) {
    if (err instanceof FaceitRateLimitError) throw err;
    if (err instanceof FaceitNotFoundError) {
      await interaction.editReply({
        content: `Linked to **${linked.faceitNickname}** but FACEIT returned no data — the account may have been deleted or renamed.`,
      });
      return;
    }
    logger.error({ err }, 'FACEIT API error during /ic linkstatus');
    await interaction.editReply({ content: 'Could not reach the FACEIT API right now. Try again in a moment.' });
    return;
  }

  const cs2 = player.games?.cs2;
  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setTitle(isSelf ? 'Your FACEIT Link' : `${target.displayName}'s FACEIT Link`)
    .setDescription(
      `Linked to **[${player.nickname}](https://www.faceit.com/en/players/${encodeURIComponent(player.nickname)})**`,
    )
    .addFields(
      { name: 'ELO', value: cs2 ? cs2.faceit_elo.toString() : 'N/A', inline: true },
      { name: 'Level', value: cs2 ? cs2.skill_level.toString() : 'N/A', inline: true },
      { name: 'Linked', value: `<t:${Math.floor(linked.linkedAt.getTime() / 1000)}:R>`, inline: true },
    )
    .setTimestamp();

  if (player.avatar) embed.setThumbnail(player.avatar);

  await interaction.editReply({ embeds: [embed] });
}
