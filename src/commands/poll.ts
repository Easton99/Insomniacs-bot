import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandSubcommandBuilder,
} from 'discord.js';

export const POLL_END_PREFIX = 'poll_end:';
export const OPTION_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

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

  const closeTime = Math.floor(Date.now() / 1000) + duration * 3600;

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setTitle(`📊  ${question}`)
    .setDescription(options.map((opt, i) => `${OPTION_EMOJIS[i]}  ${opt}`).join('\n'))
    .addFields({ name: 'Closes', value: `<t:${closeTime}:R>  (<t:${closeTime}:f>)` })
    .setFooter({ text: `Poll by ${interaction.user.displayName}` })
    .setTimestamp();

  const endButton = new ButtonBuilder()
    .setCustomId(`${POLL_END_PREFIX}${interaction.user.id}`)
    .setLabel('End Poll')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(endButton);

  const message = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

  for (let i = 0; i < options.length; i++) {
    try {
      await message.react(OPTION_EMOJIS[i]);
    } catch {
      // Missing reaction permission — poll still works, just without emoji reactions
      break;
    }
  }
}

export async function handlePollEnd(interaction: ButtonInteraction): Promise<void> {
  const creatorId = interaction.customId.slice(POLL_END_PREFIX.length);

  if (interaction.user.id !== creatorId) {
    await interaction.reply({ content: 'Only the person who created this poll can end it.', ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  const msg = await interaction.message.fetch();
  const originalEmbed = msg.embeds[0];
  if (!originalEmbed) return;

  const descLines = (originalEmbed.description ?? '').split('\n').filter(Boolean);

  const resultLines = descLines.map((line, i) => {
    const emoji = OPTION_EMOJIS[i];
    const text = line.replace(`${emoji}  `, '');
    const reaction = msg.reactions.cache.get(emoji);
    const votes = Math.max(0, (reaction?.count ?? 0) - 1);
    return `${emoji}  ${text} — **${votes}** vote${votes !== 1 ? 's' : ''}`;
  });

  const resultsEmbed = new EmbedBuilder()
    .setColor(0x888888)
    .setTitle(`📊  ${originalEmbed.title?.replace('📊  ', '') ?? 'Poll Results'}`)
    .setDescription(resultLines.join('\n'))
    .setFooter({ text: `Poll ended by ${interaction.user.displayName}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [resultsEmbed], components: [] });
}
