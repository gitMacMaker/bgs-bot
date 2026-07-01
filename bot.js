const {
  Client, GatewayIntentBits, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, ChannelType, PermissionFlagsBits
} = require('discord.js');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = '1517706658581712896';
const BLAKE_ID = '1311800649742291034';
const REQUESTS_CHANNEL_ID = '1519512329882960004'; // #game-item-requests
const APPROVAL_CHANNEL_ID = '1520501299236438046'; // #item-requests-approval

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ]
});

client.once('clientReady', async () => {
  console.log(`BGS Notifier is online as ${client.user.tag}`);
  try { await postRequestButton(); } catch(e) { console.error('postRequestButton failed:', e.message); }
});

async function postRequestButton() {
  const channel = await client.channels.fetch(REQUESTS_CHANNEL_ID);
  if (!channel) return console.error('Could not find channel');

  const messages = await channel.messages.fetch({ limit: 10 });
  const existing = messages.find(m => m.author.id === client.user.id);
  if (existing) return console.log('Button already posted');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🔔 Get Notified for Restocks')
    .setDescription("Want to know when a specific item is back in stock? Click below, tell me what you're looking for, and I'll ping you as soon as it's available!")
    .setFooter({ text: "Blake's Game Store" });

  const btn = new ButtonBuilder()
    .setCustomId('open_request')
    .setLabel('Request an Item')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('🔔');

  await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
  console.log('Request button posted');
}

client.on('interactionCreate', async (interaction) => {
  try {

  // ── Button: open modal ───────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'open_request') {
    const modal = new ModalBuilder()
      .setCustomId('request_modal')
      .setTitle('Item Restock Request');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('item')
          .setLabel('What item do you want to be notified for?')
          .setPlaceholder('e.g. Ice Serpent, Moon Bloom Seed...')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('game')
          .setLabel('Which game is it from?')
          .setPlaceholder('e.g. Grow a Garden 2')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );

    await interaction.showModal(modal);
  }

  // ── Modal submit ─────────────────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'request_modal') {
    const item = interaction.fields.getTextInputValue('item');
    const game = interaction.fields.getTextInputValue('game');

    const guild = await client.guilds.fetch(GUILD_ID);
    const roleName = `Notify: ${item}`;

    // If role already exists, just assign it — no approval needed
    let existingRole = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (existingRole) {
      const member = await guild.members.fetch(interaction.user.id);
      if (member.roles.cache.has(existingRole.id)) {
        return interaction.reply({ content: `✅ You're already on the waitlist for **${item}**! You'll be pinged when it's back.`, ephemeral: true });
      }
      await member.roles.add(existingRole);
      return interaction.reply({ content: `✅ Added you to the waitlist for **${item}**! You'll be pinged when it's back in stock.`, ephemeral: true });
    }

    // New item — send to Blake for approval
    await interaction.reply({ content: `📬 Request sent! Blake will review it and add you to the waitlist if approved.`, ephemeral: true });

    const approvalChannel = await client.channels.fetch(APPROVAL_CHANNEL_ID);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🔔 Waitlist Request')
      .addFields(
        { name: 'User', value: `<@${interaction.user.id}> (${interaction.user.username})`, inline: true },
        { name: 'Game', value: `\`${game}\``, inline: true },
        { name: 'Item', value: `\`${item}\`` }
      )
      .setFooter({ text: `User ID: ${interaction.user.id}` })
      .setTimestamp();

    const approveBtn = new ButtonBuilder()
      .setCustomId(`approve_${interaction.user.id}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅');

    const denyBtn = new ButtonBuilder()
      .setCustomId(`deny_${interaction.user.id}`)
      .setLabel('Deny')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌');

    await approvalChannel.send({
      content: `<@${BLAKE_ID}>`,
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(approveBtn, denyBtn)]
    });
  }

  // ── Approve ──────────────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('approve_')) {
    if (interaction.user.id !== BLAKE_ID) {
      return interaction.reply({ content: '❌ Only Blake can approve requests.', ephemeral: true });
    }

    const embed = interaction.message.embeds[0];
    const item = embed.fields.find(f => f.name === 'Item')?.value.replace(/`/g, '') || 'Unknown';
    const userIdMatch = embed.fields.find(f => f.name === 'User')?.value.match(/<@(\d+)>/);
    const userId = userIdMatch?.[1];
    if (!userId) return interaction.reply({ content: '❌ Could not find user.', ephemeral: true });

    const guild = await client.guilds.fetch(GUILD_ID);
    const roleName = `Notify: ${item}`;

    let role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) {
      role = await guild.roles.create({
        name: roleName,
        color: 0x5865f2,
        mentionable: true,
        reason: `Waitlist for ${item}`
      });
    }

    const member = await guild.members.fetch(userId);
    await member.roles.add(role);

    await interaction.update({
      embeds: [EmbedBuilder.from(embed).setColor(0x52b788).setTitle(`✅ Approved — ${embed.title}`)],
      components: []
    });

    try { await member.send(`✅ Your waitlist request for **${item}** was approved! You'll be pinged as \`@${roleName}\` when it's back in stock.`); }
    catch (e) { console.log('Could not DM user'); }
  }

  // ── Deny ─────────────────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('deny_')) {
    if (interaction.user.id !== BLAKE_ID) {
      return interaction.reply({ content: '❌ Only Blake can deny requests.', ephemeral: true });
    }

    const embed = interaction.message.embeds[0];
    const userIdMatch = embed.fields.find(f => f.name === 'User')?.value.match(/<@(\d+)>/);
    const userId = userIdMatch?.[1];

    await interaction.update({
      embeds: [EmbedBuilder.from(embed).setColor(0xff0000).setTitle(`❌ Denied — ${embed.title}`)],
      components: []
    });

    if (userId) {
      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(userId);
        await member.send(`❌ Your waitlist request wasn't approved this time.`);
      } catch (e) { console.log('Could not DM user'); }
    }
  }
  } catch(e) {
    console.error('Interaction error:', e.message, e.stack);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: '❌ Something went wrong. Please try again.', ephemeral: true });
      } else {
        await interaction.reply({ content: '❌ Something went wrong. Please try again.', ephemeral: true });
      }
    } catch(_) {}
  }
});

client.on('error', (err) => {
  console.error('Discord client error:', err.message);
});

client.login(BOT_TOKEN);
