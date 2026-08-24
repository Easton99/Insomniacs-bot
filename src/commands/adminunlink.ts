import { ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('adminunlink')
  .setDescription('(Admin) Remove another user\'s linked FACEIT account')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('The Discord user to unlink').setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xcc3333)
          .setTitle('Permission denied')
          .setDescription('Only server administrators can use this command.'),
      ],
    });
    return;
  }

  const target = interaction.options.getUser('user', true);

  const existing = await db.discordUser.findUnique({ where: { discordId: target.id } });

  if (!existing) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x888888)
          .setTitle('Not linked')
          .setDescription(`<@${target.id}> doesn't have a FACEIT account linked.`),
      ],
    });
    return;
  }

  await db.discordUser.delete({ where: { discordId: target.id } });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xff6b35)
        .setTitle('Unlinked')
        .setDescription(`Removed <@${target.id}>'s link to **${existing.faceitNickname}**.`)
        .setTimestamp(),
    ],
  });
}
