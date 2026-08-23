import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check bot status and latency');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sent = await interaction.reply({ content: 'Measuring…', fetchReply: true });

  const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
  const ws = interaction.client.ws.ping;

  const embed = new EmbedBuilder()
    .setTitle('Insomniacs Bot — Status')
    .setColor(0x5865f2)
    .addFields(
      { name: 'Round-trip latency', value: `${roundtrip}ms`, inline: true },
      { name: 'WebSocket latency', value: `${ws >= 0 ? ws + 'ms' : 'N/A'}`, inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ content: '', embeds: [embed] });
}
