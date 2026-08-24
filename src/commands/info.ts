import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('info')
  .setDescription('Show bot info and links');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setTitle('Insomniacs Bot')
    .setDescription('A Discord bot built for friend groups. Check FACEIT stats, run polls, and more.')
    .addFields(
      { name: '🌐 Website', value: '[hipphamster.online](https://www.hipphamster.online)', inline: true },
      { name: '📖 Commands', value: '[All commands](https://www.hipphamster.online/commands.html)', inline: true },
      { name: '💡 Feature Requests', value: '[Suggest something](https://www.hipphamster.online/feature-request.html)', inline: true },
    )
    .setFooter({ text: 'Use /ic link to connect your FACEIT account and get started' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
