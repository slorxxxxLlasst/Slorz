
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const {
  TOKEN,
  CLIENT_ID,
  GUILD_ID,
  SUPPORT_ROLE_ID,
  ADMIN_ROLE_ID,
  CATEGORY_ID,
  LOG_CHANNEL_ID
} = process.env;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing TOKEN, CLIENT_ID, or GUILD_ID in environment variables.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const DB_FILE = path.join(__dirname, 'tickets.json');

function loadTickets() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('Could not read tickets database:', error);
  }
  return {};
}

let tickets = loadTickets();

function saveTickets() {
  fs.writeFileSync(DB_FILE, JSON.stringify(tickets, null, 2));
}

const ticketTypes = {
  technical: 'الدعم الفني',
  complaint: 'الشكاوى',
  partnership: 'الشراكات',
  inquiry: 'الاستفسارات'
};

function isStaff(member) {
  if (!member) return false;

  return Boolean(
    (SUPPORT_ROLE_ID && member.roles.cache.has(SUPPORT_ROLE_ID)) ||
    (ADMIN_ROLE_ID && member.roles.cache.has(ADMIN_ROLE_ID)) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

function panelEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🎫 نظام التذاكر')
    .setDescription(
      'مرحبًا بك في نظام التذاكر.\n' +
      'اختر القسم المناسب من الأزرار أدناه، وسيتم إنشاء تذكرة خاصة بك.\n\n' +
      'يرجى شرح طلبك بوضوح وانتظار أحد أعضاء فريق الدعم.'
    )
    .setFooter({ text: 'Ticket System' })
    .setTimestamp();
}

function panelRows() {
  const firstRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_technical')
      .setLabel('الدعم الفني')
      .setEmoji('🛠️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ticket_complaint')
      .setLabel('شكوى')
      .setEmoji('📢')
      .setStyle(ButtonStyle.Danger)
  );

  const secondRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_partnership')
      .setLabel('شراكة')
      .setEmoji('🤝')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('ticket_inquiry')
      .setLabel('استفسار')
      .setEmoji('❓')
      .setStyle(ButtonStyle.Secondary)
  );

  return [firstRow, secondRow];
}

async function sendPanel(channel) {
  return channel.send({
    embeds: [panelEmbed()],
    components: panelRows()
  });
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('ticketpanel')
      .setDescription('إرسال لوحة التذاكر')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),

    new SlashCommandBuilder()
      .setName('ticketsetup')
      .setDescription('عرض معلومات إعداد نظام التذاكر')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON()
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log('Slash commands registered.');
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error('Could not register slash commands:', error);
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  if (message.content.trim() === '!ticketpanel') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('هذا الأمر مخصص للإدارة فقط.');
    }

    await sendPanel(message.channel);
  }
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'ticketpanel') {
        await interaction.reply({
          content: 'تم إرسال لوحة التذاكر.',
          ephemeral: true
        });

        await sendPanel(interaction.channel);
        return;
      }

      if (interaction.commandName === 'ticketsetup') {
        await interaction.reply({
          content:
            `حالة النظام: يعمل\n` +
            `قسم التذاكر: ${CATEGORY_ID ? 'محدد' : 'غير محدد'}\n` +
            `قناة السجلات: ${LOG_CHANNEL_ID ? 'محددة' : 'غير محددة'}`,
          ephemeral: true
        });
        return;
      }
    }

    if (!interaction.isButton()) return;

    const { guild, member, user, channel } = interaction;

    if (!guild) {
      return interaction.reply({
        content: 'هذا الزر يعمل داخل السيرفر فقط.',
        ephemeral: true
      });
    }

    if (interaction.customId.startsWith('ticket_')) {
      const type = interaction.customId.replace('ticket_', '');

      if (!ticketTypes[type]) return;

      const existing = Object.values(tickets).find(
        ticket =>
          ticket.guildId === guild.id &&
          ticket.userId === user.id &&
          ticket.status !== 'deleted'
      );

      if (existing) {
        const existingChannel = guild.channels.cache.get(existing.channelId);

        if (existingChannel) {
          return interaction.reply({
            content: `لديك تذكرة مفتوحة بالفعل: ${existingChannel}`,
            ephemeral: true
          });
        }

        delete tickets[existing.channelId];
        saveTickets();
      }

      await interaction.deferReply({ ephemeral: true });

      const safeName = user.username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 15) || 'member';

      const permissionOverwrites = [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        }
      ];

      if (SUPPORT_ROLE_ID) {
        permissionOverwrites.push({
          id: SUPPORT_ROLE_ID,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages
          ]
        });
      }

      if (ADMIN_ROLE_ID && ADMIN_ROLE_ID !== SUPPORT_ROLE_ID) {
        permissionOverwrites.push({
          id: ADMIN_ROLE_ID,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages
          ]
        });
      }

      const ticketChannel = await guild.channels.create({
        name: `ticket-${safeName}`,
        type: ChannelType.GuildText,
        parent: CATEGORY_ID || undefined,
        permissionOverwrites,
        topic: `Ticket owner: ${user.id} | Type: ${ticketTypes[type]}`
      });

      tickets[ticketChannel.id] = {
        channelId: ticketChannel.id,
        guildId: guild.id,
        userId: user.id,
        username: user.username,
        type,
        status: 'open',
        claimedBy: null,
        createdAt: new Date().toISOString()
      };

      saveTickets();

      const ticketEmbed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle(`🎫 ${ticketTypes[type]}`)
        .setDescription(
          `أهلًا ${user}، تم إنشاء تذكرتك بنجاح.\n` +
          'اكتب تفاصيل طلبك هنا، وسيقوم فريق الدعم بمساعدتك.\n\n' +
          'يرجى عدم فتح تذاكر متعددة لنفس الموضوع.'
        )
        .addFields(
          { name: 'صاحب التذكرة', value: `${user}`, inline: true },
          { name: 'القسم', value: ticketTypes[type], inline: true },
          { name: 'الحالة', value: 'مفتوحة', inline: true }
        )
        .setTimestamp();

      const controls = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_claim')
          .setLabel('استلام التذكرة')
          .setEmoji('🙋')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('ticket_close')
          .setLabel('إغلاق')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Danger)
      );

      await ticketChannel.send({
        content: `${user}${SUPPORT_ROLE_ID ? ` <@&${SUPPORT_ROLE_ID}>` : ''}`,
        embeds: [ticketEmbed],
        components: [controls]
      });

      await interaction.editReply({
        content: `تم إنشاء تذكرتك: ${ticketChannel}`
      });

      return;
    }

    const ticket = tickets[channel.id];

    if (!ticket) {
      return interaction.reply({
        content: 'لم يتم العثور على بيانات هذه التذكرة.',
        ephemeral: true
      });
    }

    if (interaction.customId === 'ticket_claim') {
      if (!isStaff(member)) {
        return interaction.reply({
          content: 'هذا الإجراء مخصص لفريق الدعم والإدارة.',
          ephemeral: true
        });
      }

      if (ticket.claimedBy) {
        return interaction.reply({
          content: `تم استلام التذكرة مسبقًا بواسطة <@${ticket.claimedBy}>.`,
          ephemeral: true
        });
      }

      ticket.claimedBy = user.id;
      saveTickets();

      await interaction.reply({
        content: `🙋 تم استلام التذكرة بواسطة ${user}.`
      });

      return;
    }

    if (interaction.customId === 'ticket_close') {
      const owner = ticket.userId === user.id;
      const staff = isStaff(member);

      if (!owner && !staff) {
        return interaction.reply({
          content: 'فقط صاحب التذكرة أو فريق الدعم يمكنه إغلاقها.',
          ephemeral: true
        });
      }

      ticket.status = 'closed';
      ticket.closedAt = new Date().toISOString();
      saveTickets();

      const closedControls = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_reopen')
          .setLabel('إعادة فتح')
          .setEmoji('🔓')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('ticket_delete')
          .setLabel('حذف التذكرة')
          .setEmoji('🗑️')
          .setStyle(ButtonStyle.Danger)
      );

      await channel.permissionOverwrites.edit(ticket.userId, {
        SendMessages: false,
        ViewChannel: true
      });

      await interaction.reply({
        content: `🔒 تم إغلاق التذكرة بواسطة ${user}.`
      });

      await channel.send({
        content: 'أُغلقت هذه التذكرة. يمكن لفريق الدعم إعادة فتحها أو حذفها.',
        components: [closedControls]
      });

      return;
    }

    if (interaction.customId === 'ticket_reopen') {
      if (!isStaff(member)) {
        return interaction.reply({
          content: 'فقط فريق الدعم والإدارة يمكنهم إعادة فتح التذكرة.',
          ephemeral: true
        });
      }

      ticket.status = 'open';
      delete ticket.closedAt;
      saveTickets();

      await channel.permissionOverwrites.edit(ticket.userId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true
      });

      await interaction.reply({
        content: `🔓 أعاد ${user} فتح التذكرة.`
      });

      return;
    }

    if (interaction.customId === 'ticket_delete') {
      if (!isStaff(member)) {
        return interaction.reply({
          content: 'فقط فريق الدعم والإدارة يمكنهم حذف التذكرة.',
          ephemeral: true
        });
      }

      await interaction.reply({
        content: 'سيتم حذف التذكرة خلال ثوانٍ.'
      });

      if (LOG_CHANNEL_ID) {
        try {
          const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID);

          if (logChannel && logChannel.isTextBased()) {
            await logChannel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0xE74C3C)
                  .setTitle('🗑️ تم حذف تذكرة')
                  .addFields(
                    { name: 'صاحب التذكرة', value: `<@${ticket.userId}>`, inline: true },
                    { name: 'القسم', value: ticketTypes[ticket.type] || 'غير معروف', inline: true },
                    { name: 'حذف بواسطة', value: `${user}`, inline: true },
                    { name: 'القناة', value: channel.name, inline: true }
                  )
                  .setTimestamp()
              ]
            });
          }
        } catch (error) {
          console.error('Could not send ticket log:', error);
        }
      }

      ticket.status = 'deleted';
      saveTickets();

      setTimeout(() => {
        channel.delete('Ticket deleted by staff').catch(console.error);
      }, 3000);

      return;
    }
  } catch (error) {
    console.error('Interaction error:', error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'حدث خطأ أثناء تنفيذ الطلب. تأكد من إعدادات البوت وصلاحياته.',
        ephemeral: true
      }).catch(() => {});
    }
  }
});

client.login(TOKEN);
