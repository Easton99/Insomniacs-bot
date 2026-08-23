import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('ping')
  .setDescription('Check bot status and latency');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sent = await interaction.reply({ content: 'Measuring…', fetchReply: true });

  const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
  const ws = interaction.client.ws.ping;

  const embed = new EmbedBuilder()
    .setTitle('Insomniacs Bot — Status')
    .setColor(0xff6b35)
    .addFields(
      { name: 'Round-trip', value: `${roundtrip}ms`, inline: true },
      { name: 'WebSocket', value: `${ws >= 0 ? ws + 'ms' : 'N/A'}`, inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ content: '', embeds: [embed] });
}
