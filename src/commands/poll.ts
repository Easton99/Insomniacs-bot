import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';

const OPTION_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('poll')
  .setDescription('Create a poll')
  .addStringOption((opt) =>
    opt.setName('question').setDescription('The poll question').setRequired(true).setMaxLength(300),
  )
  .addStringOption((opt) =>
    opt.setName('option1').setDescription('First option').setRequired(true).setMaxLength(100),
  )
  .addStringOption((opt) =>
    opt.setName('option2').setDescription('Second option').setRequired(true).setMaxLength(100),
  )
  .addStringOption((opt) =>
    opt.setName('option3').setDescription('Third option').setRequired(false).setMaxLength(100),
  )
  .addStringOption((opt) =>
    opt.setName('option4').setDescription('Fourth option').setRequired(false).setMaxLength(100),
  )
  .addStringOption((opt) =>
    opt.setName('option5').setDescription('Fifth option').setRequired(false).setMaxLength(100),
  )
  .addIntegerOption((opt) =>
    opt
      .setName('duration')
      .setDescription('How long the poll runs in hours (default 24)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(168),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const question = interaction.options.getString('question', true);
  const duration = interaction.options.getInteger('duration') ?? 24;

  const options = [
    interaction.options.getString('option1'),
    interaction.options.getString('option2'),
    interaction.options.getString('option3'),
    interaction.options.getString('option4'),
    interaction.options.getString('option5'),
  ].filter((o): o is string => o !== null);

  const optionLines = options.map((opt, i) => `${OPTION_EMOJIS[i]}  ${opt}`).join('\n');

  const closeTime = Math.floor(Date.now() / 1000) + duration * 3600;

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setTitle(`📊  ${question}`)
    .setDescription(optionLines)
    .addFields({ name: 'Closes', value: `<t:${closeTime}:R>  (<t:${closeTime}:f>)` })
    .setFooter({ text: `Poll by ${interaction.user.displayName}` })
    .setTimestamp();

  const message = await interaction.reply({ embeds: [embed], fetchReply: true });

  for (let i = 0; i < options.length; i++) {
    await message.react(OPTION_EMOJIS[i]);
  }
}
