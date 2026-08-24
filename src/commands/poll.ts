import { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from 'discord.js';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('poll')
  .setDescription('Create a poll')
  .addStringOption((opt) =>
    opt.setName('question').setDescription('The poll question').setRequired(true).setMaxLength(300),
  )
  .addStringOption((opt) =>
    opt.setName('option1').setDescription('First option').setRequired(true).setMaxLength(55),
  )
  .addStringOption((opt) =>
    opt.setName('option2').setDescription('Second option').setRequired(true).setMaxLength(55),
  )
  .addStringOption((opt) =>
    opt.setName('option3').setDescription('Third option').setRequired(false).setMaxLength(55),
  )
  .addStringOption((opt) =>
    opt.setName('option4').setDescription('Fourth option').setRequired(false).setMaxLength(55),
  )
  .addStringOption((opt) =>
    opt.setName('option5').setDescription('Fifth option').setRequired(false).setMaxLength(55),
  )
  .addIntegerOption((opt) =>
    opt
      .setName('duration')
      .setDescription('How long the poll runs in hours (default 24, max 168)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(168),
  )
  .addBooleanOption((opt) =>
    opt.setName('multiselect').setDescription('Allow voting for multiple options (default: no)').setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const question = interaction.options.getString('question', true);
  const duration = interaction.options.getInteger('duration') ?? 24;
  const allowMultiselect = interaction.options.getBoolean('multiselect') ?? false;

  const rawOptions = [
    interaction.options.getString('option1'),
    interaction.options.getString('option2'),
    interaction.options.getString('option3'),
    interaction.options.getString('option4'),
    interaction.options.getString('option5'),
  ].filter((o): o is string => o !== null);

  if (!interaction.channel || !('send' in interaction.channel)) {
    await interaction.reply({ content: 'Cannot create a poll in this channel.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  await interaction.channel.send({
    poll: {
      question: { text: question },
      answers: rawOptions.map((text) => ({ text })),
      duration,
      allowMultiselect,
    },
  });

  await interaction.deleteReply();
}
