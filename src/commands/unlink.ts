import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('unlink')
  .setDescription('Remove your linked FACEIT account');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const existing = await db.discordUser.findUnique({ where: { discordId: interaction.user.id } });

  if (!existing) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x888888)
          .setTitle('Not linked')
          .setDescription("You don't have a FACEIT account linked. Use `/ic link` to add one."),
      ],
    });
    return;
  }

  await db.discordUser.delete({ where: { discordId: interaction.user.id } });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xff6b35)
        .setTitle('Unlinked')
        .setDescription(`Your link to **${existing.faceitNickname}** has been removed.`)
        .setTimestamp(),
    ],
  });
}
