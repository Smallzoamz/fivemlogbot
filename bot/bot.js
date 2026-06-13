import { 
  Client, 
  GatewayIntentBits, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  EmbedBuilder, 
  ChannelType, 
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import http from 'http';

// Load env configurations
dotenv.config();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_URL = process.env.BACKEND_API_URL || 'http://localhost:5000/api';
const CATEGORY_ID = process.env.TICKET_CATEGORY_ID || null;
const LOG_CHANNEL_ID = process.env.DISCORD_LOG_CHANNEL_ID || null;
const BOT_API_KEY = process.env.BOT_API_KEY || 'fivem_admin_bot_api_key_xyz123';

if (!TOKEN) {
  console.error('Error: DISCORD_BOT_TOKEN is not defined in bot/.env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const LOGS_PARENT_CATEGORY_ID = '1515425441610203146';

const LOG_CHANNELS_CONFIG = [
  { key: 'fine', name: '💸-log-fine' },
  { key: 'warning', name: '🟨-log-warning' },
  { key: 'orange', name: '🟧-log-orange' },
  { key: 'ban', name: '🟥-log-ban' },
  { key: 'inter_register', name: '✈️-log-inter' },
  { key: 'evidence', name: '📷-log-evidence' },
  { key: 'tickets', name: '🎫-log-tickets' },
  { key: 'errors', name: '🤖-bot-errors' }
];

// Helper to send logs to Discord Log Channel if configured
async function sendToLogChannel(guild, embed) {
  if (!LOG_CHANNEL_ID) return null;
  try {
    const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID) || await guild.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) {
      return await logChannel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error('Failed to send to Discord log channel:', err.message);
  }
  return null;
}

// Helper: Resolve category from channel name
function getCategoryFromChannelName(channelName) {
  const parts = channelName.toLowerCase().split('-');
  if (parts.length > 1) {
    const prefix = parts[0];
    if (prefix === '🟥') return 'ban';
    if (prefix === '🟨') return 'warning';
    if (prefix === '🟧') return 'orange';
    if (prefix === '💸') return 'fine';
    if (prefix === '✈️') return 'inter_register';
    if (prefix === '📷') return 'evidence';
    if (prefix === '📂') {
      return 'tickets'; // Custom categories logged as general tickets logs
    }
  }
  return 'tickets';
}

// Helper: Send log to category log channel
async function sendToCategoryLog(guild, category, embed) {
  try {
    const parentCategory = guild.channels.cache.get(LOGS_PARENT_CATEGORY_ID) || await guild.channels.fetch(LOGS_PARENT_CATEGORY_ID).catch(() => null);
    if (!parentCategory) {
      // Fallback
      return await sendToLogChannel(guild, embed);
    }

    const config = LOG_CHANNELS_CONFIG.find(c => c.key === category);
    const channelName = config ? config.name : '🎫-log-tickets';

    let channel = guild.channels.cache.find(c => c.parentId === LOGS_PARENT_CATEGORY_ID && c.name === channelName);
    if (!channel) {
      channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: LOGS_PARENT_CATEGORY_ID
      });
    }

    if (channel) {
      return await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error(`Failed to send category log for ${category}:`, err.message);
    return await sendToLogChannel(guild, embed);
  }
  return null;
}



// Helper: Send bot error stack trace to Discord errors channel
async function sendBotErrorLog(error) {
  try {
    // Get first guild client is joined to
    const guild = client.guilds.cache.first();
    if (!guild) return;

    const errorEmbed = new EmbedBuilder()
      .setTitle('🤖 Bot Error / รายงานปัญหาบอท')
      .setDescription(`**รายละเอียดความผิดพลาด:**\n\`\`\`js\n${error?.stack || error?.message || error || 'Unknown Error'}\n\`\`\``)
      .setColor(0xFF0000)
      .setTimestamp();

    await sendToCategoryLog(guild, 'errors', errorEmbed);
  } catch (err) {
    console.error('Failed to log bot error to Discord:', err.message);
  }
}

// Helper: Ensure log channels exist under parent category
async function ensureLogChannelsExist(guild) {
  try {
    const parentCategory = guild.channels.cache.get(LOGS_PARENT_CATEGORY_ID) || await guild.channels.fetch(LOGS_PARENT_CATEGORY_ID).catch(() => null);
    if (!parentCategory) {
      console.log(`Logs parent category ${LOGS_PARENT_CATEGORY_ID} not found in guild ${guild.name}. Skipping auto creation.`);
      return;
    }

    for (const config of LOG_CHANNELS_CONFIG) {
      let channel = guild.channels.cache.find(c => c.parentId === LOGS_PARENT_CATEGORY_ID && c.name === config.name);
      if (!channel) {
        await guild.channels.create({
          name: config.name,
          type: ChannelType.GuildText,
          parent: LOGS_PARENT_CATEGORY_ID
        });
        console.log(`Auto-created missing category log channel: ${config.name}`);
      }
    }
  } catch (err) {
    console.error('Failed to ensure log channels exist:', err.message);
  }
}

// Helper: Get components and embed payload for the ticket setup panel
function getTicketSetupPayload() {
  const embed = new EmbedBuilder()
    .setTitle('🎫 FiveM Server Support & Evidence Submission')
    .setDescription('หากท่านต้องการเปิดเคส ส่งข้อมูลหลักฐาน แจ้งปัญหา หรือรายงานผู้เล่น\nกรุณาเลือกหมวดหมู่ที่ต้องการแจ้งเรื่องด้านล่างนี้เพื่อเปิดเคสคุยกับทีมงานเป็นการส่วนตัวครับ')
    .setColor(0x5865F2)
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_ticket_fine')
      .setLabel('💸 ประกาศปรับ')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('open_ticket_warning')
      .setLabel('🟨 ใบเหลือง')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('open_ticket_orange')
      .setLabel('🟧 ใบส้ม')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('open_ticket_ban')
      .setLabel('🟥 ใบแดง')
      .setStyle(ButtonStyle.Danger)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_ticket_inter_register')
      .setLabel('✈️ ต่างประเทศ')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('open_ticket_evidence')
      .setLabel('📷 เก็บหลักฐาน')
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row1, row2] };
}

// Helper: Centralized function to create category-specific ticket channel and log it
async function createTicketChannelAndLog(interaction, category, displayLabel) {
  const { guild, user } = interaction;
  const ticketChannelName = getNewTicketChannelName(`ticket-${user.username}`, category);

  // Check if ticket category exists
  let parentCategory = null;
  if (CATEGORY_ID) {
    parentCategory = guild.channels.cache.get(CATEGORY_ID);
  }

  // Create Channel with private permissions
  const ticketChannel = await guild.channels.create({
    name: ticketChannelName,
    type: ChannelType.GuildText,
    parent: parentCategory ? parentCategory.id : null,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory
        ]
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels
        ]
      }
    ]
  });

  // Send Welcome Message inside the new channel
  const welcomeEmbed = new EmbedBuilder()
    .setTitle(`🎫 Ticket Open / เปิดเคส [${displayLabel}]`)
    .setDescription(`สวัสดีครับ ${user}\nนี่คือห้องสำหรับแจ้งเรื่องร้องเรียน/ส่งข้อมูลหลักฐานกับทางแอดมินในหมวดหมู่ **[${displayLabel}]** ครับ\n\n**กรุณาทำตามขั้นตอนดังนี้:**\n1. 📷 **ส่งรายละเอียด** แนบรูปภาพ หรือลิงก์หลักฐานได้เลยครับ\n2. 🔒 แอดมินกดปุ่ม **"🔒 Close Ticket"** เมื่อดำเนินการแก้ไขเสร็จเพื่อเก็บบันทึกข้อมูลถาวรครับ`)
    .setColor(0x00FF87)
    .setTimestamp();

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('🔒 Close Ticket (ปิดเคส)')
      .setStyle(ButtonStyle.Danger)
  );

  await ticketChannel.send({
    content: `${user} | <@&${guild.roles.everyone.id}> (Admin Mode)`,
    embeds: [welcomeEmbed],
    components: [closeRow]
  });

  await safeReply(interaction, { content: `เปิดตั๋วหมวดหมู่ **${displayLabel}** เรียบร้อยแล้ว! กรุณาตรวจสอบห้องแชท <#${ticketChannel.id}>` }, 5000);

  // Register Ticket on Backend API (Gracefully - non-blocking!)
  try {
    await api.post('/bot/tickets', {
      channelId: ticketChannel.id,
      userId: user.id,
      username: user.username,
      category: category
    });
  } catch (apiError) {
    console.error('Failed to register ticket in API:', apiError.message);
    await ticketChannel.send({
      content: '⚠️ *ระบบฐานข้อมูลหลังบ้านไม่สามารถติดต่อได้ชั่วคราว ข้อมูลภาพและลิงก์หลักฐานในห้องนี้จะบันทึกเข้าหน้าเว็บไม่ได้ จนกว่าฐานข้อมูลจะกลับมาออนไลน์*'
    });
  }

  // Send Log to Discord Log Channel if configured
  const logEmbed = new EmbedBuilder()
    .setTitle('🎫 Ticket Opened / เปิดเคสใหม่')
    .setDescription(`ผู้เล่น **${user.username}** (ID: ${user.id}) ได้ทำการเปิดตั๋วเคสใหม่\n\n- **ห้องแชท:** <#${ticketChannel.id}>\n- **หมวดหมู่:** [${displayLabel}]\n- **เวลา:** ${new Date().toLocaleString('th-TH')}`)
    .setColor(0x00FF87)
    .setTimestamp();
  await sendToCategoryLog(guild, category, logEmbed);
}

// Helper: Auto Setup ticket panel by deleting old and injecting a fresh message
async function autoSetupTicket(guild) {
  try {
    const parentId = process.env.TICKET_CATEGORY_ID || CATEGORY_ID;
    if (!parentId) return;

    let ticketChannel = guild.channels.cache.find(c => c.parentId === parentId && c.type === ChannelType.GuildText && c.name === 'ticket');
    if (!ticketChannel) {
      ticketChannel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === 'ticket');
    }

    if (!ticketChannel) {
      console.log(`No 'ticket' text channel found in guild ${guild.name}. Skipping auto setup.`);
      return;
    }

    // Fetch up to 50 messages to delete old bot setup messages
    const messages = await ticketChannel.messages.fetch({ limit: 50 }).catch(() => null);
    if (messages) {
      const oldMessages = messages.filter(msg => {
        const isBot = msg.author.id === client.user.id;
        const hasButton = msg.components.some(row => 
          row.components.some(comp => comp.customId && comp.customId.startsWith('open_ticket'))
        );
        return isBot && hasButton;
      });

      for (const [id, msg] of oldMessages) {
        await msg.delete().catch(() => null);
      }
    }

    const payload = getTicketSetupPayload();
    await ticketChannel.send(payload);
    console.log(`Successfully injected fresh ticket setup in #${ticketChannel.name}`);
  } catch (err) {
    console.error('Failed to auto setup ticket:', err.message);
  }
}

// Helper to safely reply or edit reply to interactions without crashing on expired tokens
async function safeReply(interaction, options, autoDeleteDelay = null) {
  try {
    if (interaction.deferred) {
      await interaction.editReply(options);
    } else if (interaction.replied) {
      await interaction.followUp(options);
    } else {
      await interaction.reply(options);
    }

    if (autoDeleteDelay) {
      setTimeout(async () => {
        try {
          await interaction.deleteReply().catch(() => null);
        } catch (err) {
          // Silent catch
        }
      }, autoDeleteDelay);
    }
  } catch (err) {
    console.error('Failed to safely reply to interaction:', err.message);
  }
}

// Helper: Extract a short display name from a long URL
function getShortFileName(url, index) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || '';
    const extMatch = lastSegment.match(/\.(png|jpg|jpeg|gif|webp|bmp|svg|mp4|mov|avi|pdf)$/i);
    const ext = extMatch ? extMatch[0] : '.png';
    return `image${String(index + 1).padStart(2, '0')}${ext}`;
  } catch {
    return `file${String(index + 1).padStart(2, '0')}`;
  }
}

// Helper: Check if details content contains close ticket keywords to skip storing it
function shouldSkipLog(text) {
  if (!text) return false;
  const lowercaseText = text.toLowerCase();
  const skipKeywords = [
    'ปิดทิกเกทสำเร็จ',
    'ปิดทิกเก็ตสำเร็จ',
    'ปิดเคสสำเร็จ',
    'ปิดเคสเรียบร้อย',
    'ปิดตั๋วเคส',
    'ticket closed'
  ];
  return skipKeywords.some(keyword => lowercaseText.includes(keyword));
}

// Helper: Get new ticket channel name with emoji and abbreviation based on category
function getNewTicketChannelName(currentName, category) {
  let username = 'user';
  const parts = currentName.split('-');
  if (parts.length > 1) {
    if (['🟥', '🟨', '🟧', '💸', '✈️', '📷', '📂'].includes(parts[0])) {
      username = parts.slice(2).join('-');
    } else {
      username = parts.slice(1).join('-');
    }
  } else {
    username = currentName;
  }

  const mappings = {
    ban: { emoji: '🟥', abbr: 'ban' },
    warning: { emoji: '🟨', abbr: 'warn' },
    orange: { emoji: '🟧', abbr: 'orange' },
    fine: { emoji: '💸', abbr: 'fine' },
    inter_register: { emoji: '✈️', abbr: 'inter' },
    evidence: { emoji: '📷', abbr: 'evidence' }
  };

  const map = mappings[category];
  if (map) {
    return `${map.emoji}-${map.abbr}-${username}`.toLowerCase();
  } else {
    // Custom category
    const cleanCategory = category.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `📂-${cleanCategory || 'custom'}-${username}`.toLowerCase();
  }
}

// Configure Axios instance for backend communications
const api = axios.create({
  baseURL: API_URL,
  headers: {
    'x-bot-token': BOT_API_KEY
  }
});

// Register commands
client.once('ready', async () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  
  // Register Slash Commands
  const commands = [
    new SlashCommandBuilder()
      .setName('setup-ticket')
      .setDescription('Create a Ticket Setup Embed with an open button')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }

  // Ensure all log channels exist and auto setup ticket panels in all guilds
  for (const [guildId, guild] of client.guilds.cache) {
    await ensureLogChannelsExist(guild);
    await autoSetupTicket(guild);
  }
});

// Handle Commands and Buttons (interactions)
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'setup-ticket') {
      try {
        await interaction.deferReply({ ephemeral: true });
        
        const embed = new EmbedBuilder()
          .setTitle('🎫 FiveM Server Support & Evidence Submission')
          .setDescription('หากท่านต้องการเปิดเคส ส่งข้อมูลหลักฐาน แจ้งปัญหา หรือรายงานผู้เล่น\nกรุณาคลิกปุ่ม **"📩 Open Ticket (เปิดเคส)"** ด้านล่างนี้เพื่อพูดคุยกับทีมงานแอดมินเป็นการส่วนตัวครับ')
          .setColor(0x5865F2)
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('open_ticket')
            .setLabel('📩 Open Ticket (เปิดเคส)')
            .setStyle(ButtonStyle.Primary)
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        await safeReply(interaction, { content: 'สร้างโพสต์ระบบตั๋วเรียบร้อยแล้ว!' }, 5000);
      } catch (err) {
        console.error('Error in setup-ticket command:', err.message);
      }
    }
  }

  // Handle Select Menu category choice
  if (interaction.isStringSelectMenu()) {
    const { customId, guild, user } = interaction;
    if (customId === 'select_category') {
      const category = interaction.values[0];
      if (category === 'custom') {
        const modalButtonRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('open_custom_category_btn')
            .setLabel('✍️ พิมพ์ระบุหมวดหมู่ใหม่ (Specify Custom Category)')
            .setStyle(ButtonStyle.Primary)
        );
        await interaction.reply({
          content: 'กรุณาคลิกปุ่มด้านล่างเพื่อกรอกหมวดหมู่ใหม่ที่ต้องการสร้างครับ:',
          components: [modalButtonRow],
          ephemeral: true
        });
      } else {
        try {
          await interaction.deferReply({ ephemeral: true });
          await api.put(`/bot/tickets/${interaction.channel.id}/category`, { category });
          
          // Rename the channel to match the selected category
          const newChannelName = getNewTicketChannelName(interaction.channel.name, category);
          await interaction.channel.setName(newChannelName).catch(err => {
            console.error('Failed to rename channel to:', newChannelName, err.message);
          });
          
          const labels = {
            ban: '🟥 ใบแดง',
            warning: '🟨 ใบเหลือง',
            orange: '🟧 ใบส้ม',
            fine: '💸 ประกาศปรับ',
            inter_register: '✈️ ลงทะเบียนต่างประเทศ',
            evidence: '📷 เก็บหลักฐาน'
          };
          const selectedLabel = labels[category] || category;
          
          await safeReply(interaction, {
            content: `📂 ตั้งค่าหมวดหมู่ของตั๋วร้องเรียนนี้เป็น: **[${selectedLabel}]** เรียบร้อยแล้ว ข้อมูลทั้งหมดจะถูกส่งลงหน้าเว็บในแท็บนี้`
          }, 5000);

          // Log to Discord Log Channel
          const categoryLogEmbed = new EmbedBuilder()
            .setTitle('📂 ตั้งค่าหมวดหมู่ตั๋วร้องเรียน')
            .setDescription(`ตั๋วเคส **#${interaction.channel.name}** ถูกจัดหมวดหมู่เป็น: **[${selectedLabel}]**\n- **ตั้งโดย:** ${user.username}`)
            .setColor(0x00FF87)
            .setTimestamp();
          await sendToCategoryLog(guild, category, categoryLogEmbed);
        } catch (err) {
          console.error('Failed to update ticket category:', err.message);
          await safeReply(interaction, { content: 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิฟเวอร์ API หลังบ้านเพื่อตั้งค่าหมวดหมู่' });
        }
      }
    }
  }

  // Handle Modal submissions (for custom categories)
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'custom_category_modal') {
      try {
        await interaction.deferReply({ ephemeral: true });
        const customCategory = interaction.fields.getTextInputValue('category_name_input').trim();
        const normalized = customCategory.toLowerCase().replace(/\s+/g, '_');
        
        await api.put(`/bot/tickets/${interaction.channel.id}/category`, { category: normalized });
        
        // Rename the channel to match the custom category
        const newChannelName = getNewTicketChannelName(interaction.channel.name, normalized);
        await interaction.channel.setName(newChannelName).catch(err => {
          console.error('Failed to rename channel to custom category:', newChannelName, err.message);
        });

        await safeReply(interaction, {
          content: `✅ สร้างและตั้งค่าตั๋วร้องเรียนนี้เป็นหมวดหมู่ใหม่: **[📂 ${customCategory}]** เรียบร้อยแล้ว ข้อมูลทั้งหมดจะถูกบันทึกเข้าหน้าเว็บแท็บนี้อัตโนมัติ!`
        }, 5000);

        // Log to Discord Log Channel
        const categoryLogEmbed = new EmbedBuilder()
          .setTitle('📂 สร้างหมวดหมู่ตั๋วร้องเรียนใหม่')
          .setDescription(`ตั๋วเคส **#${interaction.channel.name}** ตั้งหมวดหมู่ใหม่เป็น: **[📂 ${customCategory}]**\n- **สร้างโดย:** ${interaction.user.username}`)
          .setColor(0x00FF87)
          .setTimestamp();
        await sendToCategoryLog(interaction.guild, 'tickets', categoryLogEmbed);
      } catch (err) {
        console.error('Failed to update custom ticket category:', err.message);
        await safeReply(interaction, { content: 'เกิดข้อผิดพลาดในการบันทึกหมวดหมู่ใหม่ลงเซิฟเวอร์ API' });
      }
    }
  }

  // Handle Button Clicks
  if (interaction.isButton()) {
    const { customId, guild, user } = interaction;

    if (customId === 'open_custom_category_btn') {
      const modal = new ModalBuilder()
        .setCustomId('custom_category_modal')
        .setTitle('สร้างหมวดหมู่ใหม่');

      const categoryNameInput = new TextInputBuilder()
        .setCustomId('category_name_input')
        .setLabel("ชื่อหมวดหมู่ใหม่ (เช่น กิจกรรม, เคสยึดรถ)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('พิมพ์ชื่อหมวดหมู่ (เช่น Event, Vehicle Seized)...')
        .setRequired(true)
        .setMaxLength(20);

      const actionRow = new ActionRowBuilder().addComponents(categoryNameInput);
      modal.addComponents(actionRow);

      await interaction.showModal(modal);
      return;
    }

    if (customId.startsWith('open_ticket_')) {
      try {
        await interaction.deferReply({ ephemeral: true });

        const category = customId.replace('open_ticket_', '');
        
        const labels = {
          fine: '💸 ประกาศปรับ',
          warning: '🟨 ใบเหลือง',
          orange: '🟧 ใบส้ม',
          ban: '🟥 ใบแดง',
          inter_register: '✈️ ลงทะเบียนต่างประเทศ',
          evidence: '📷 เก็บหลักฐาน'
        };
        const displayLabel = labels[category] || category;

        await createTicketChannelAndLog(interaction, category, displayLabel);
      } catch (error) {
        console.error('Error opening ticket:', error);
        await safeReply(interaction, { content: 'ไม่สามารถเปิดตั๋วได้ในขณะนี้ กรุณาติดต่อแอดมินโดยตรง' });
      }
    }

    if (customId === 'close_ticket') {
      try {
        await interaction.deferReply({ ephemeral: false });

        const channel = interaction.channel;
        
        // Call backend API to close ticket
        const response = await api.put(`/bot/tickets/${channel.id}/close`, {
          closedBy: user.username
        });

        const closeEmbed = new EmbedBuilder()
          .setTitle('🔒 Ticket Closed / ปิดเคสเรียบร้อย')
          .setDescription(`บันทึกข้อมูลและรายงานหลักฐานเข้าฐานข้อมูลเรียบร้อยแล้ว\n\n- **ปิดเคสโดย:** ${user.username}\n- **จำนวนข้อความ/หลักฐานที่บันทึก:** ${response.data.logCount} รายการ\n\n*ห้องนี้จะถูกลบอัตโนมัติภายใน 5 วินาที*`)
          .setColor(0xFF2E93)
          .setTimestamp();

        await safeReply(interaction, { embeds: [closeEmbed] });

        // Send Log to Discord Log Channel if configured
        const closeLogEmbed = new EmbedBuilder()
          .setTitle('🔒 Ticket Closed / ปิดตั๋วเคส')
          .setDescription(`ตั๋วเคส **#${channel.name}** ถูกปิดลงเรียบร้อย\n\n- **ปิดโดย:** ${user.username}\n- **จำนวนรายการที่บันทึก:** ${response.data.logCount} รายการ\n- **ลิงก์หน้าเว็บ:** ${process.env.FRONTEND_URL || 'http://localhost:5173'}`)
          .setColor(0xFF2E93)
          .setTimestamp();
        await sendToCategoryLog(guild, getCategoryFromChannelName(channel.name), closeLogEmbed);

        // Wait 5 seconds and delete channel
        setTimeout(async () => {
          try {
            await channel.delete();
          } catch (err) {
            console.error('Failed to delete ticket channel:', err);
          }
        }, 5000);

      } catch (error) {
        console.error('Error closing ticket:', error.response?.data || error.message);
        await safeReply(interaction, { content: 'เกิดข้อผิดพลาดในการบันทึกและปิดเคสกับเซิฟเวอร์ API' });
      }
    }
  }
});

// Listen to Messages in Ticket Channels to log Evidence
client.on('messageCreate', async (message) => {
  // Ignore bots
  if (message.author.bot) return;

  const channel = message.channel;
  
  // Identify if this is a ticket channel (either by database validation or channel name prefix)
  const isTicket = channel.name.startsWith('ticket-') || 
                   ['🟥', '🟨', '🟧', '💸', '✈️', '📷', '📂'].some(emoji => channel.name.startsWith(`${emoji}-`));
  if (channel.type === ChannelType.GuildText && isTicket) {
    if (shouldSkipLog(message.content)) return;
    try {
      const localAttachments = [];
      const extractedLinks = [];

      // 1. Process attachments (Images)
      if (message.attachments.size > 0) {
        for (const [id, attachment] of message.attachments) {
          const contentType = attachment.contentType || '';
          // Only process images (jpeg, png, gif, webp)
          if (contentType.startsWith('image/')) {
            try {
              // Download image attachment from Discord
              const imageResponse = await axios.get(attachment.url, { responseType: 'arraybuffer' });
              
              // Prepare FormData to upload to Backend
              const form = new FormData();
              form.append('file', Buffer.from(imageResponse.data), {
                filename: attachment.name,
                contentType: attachment.contentType
              });

              // Upload to Backend
              const uploadResponse = await api.post(`/bot/tickets/${channel.id}/upload`, form, {
                headers: {
                  ...form.getHeaders()
                }
              });

              localAttachments.push(uploadResponse.data.filename);
            } catch (err) {
              console.error(`Failed to download/upload attachment ${attachment.name}:`, err.message);
            }
          }
        }
      }

      // 2. Extract links
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const matches = message.content.match(urlRegex);
      if (matches) {
        extractedLinks.push(...matches);
      }

      // 3. Post Message Log to Backend API
      // If there's text or attachments or links, send to API
      if (message.content.trim() || localAttachments.length > 0) {
        // Determine category based on context or set to general "ticket"
        let category = 'ticket';
        if (localAttachments.length > 0 || extractedLinks.length > 0) {
          category = 'evidence';
        }

        const response = await api.post(`/bot/tickets/${channel.id}/messages`, {
          authorName: message.author.username,
          authorId: message.author.id,
          content: message.content,
          attachments: localAttachments,
          links: extractedLinks,
          category: category
        });

        // Get the resolved category from the backend response
        const resolvedCategory = response.data?.category?.toLowerCase() || '';

        // Check for IP and GeoIP fake registration check
        let isFakeRegistration = false;
        let resolvedCountry = '';
        if (resolvedCategory === 'inter_register' || resolvedCategory.includes('inter') || resolvedCategory.includes('ต่างประเทศ')) {
          const ipRegex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
          const ipMatch = message.content.match(ipRegex);
          if (ipMatch) {
            const extractedIp = ipMatch[0];
            try {
              const geoResponse = await axios.get(`https://freeipapi.com/api/json/${extractedIp}`, { timeout: 3000 });
              if (geoResponse.data && geoResponse.data.countryCode) {
                resolvedCountry = geoResponse.data.countryName || geoResponse.data.countryCode;
                if (geoResponse.data.countryCode === 'TH') {
                  isFakeRegistration = true;
                }
              }
            } catch (err) {
              console.error('GeoIP lookup error in bot validation:', err.message);
            }
          }
        }

        // React with checkmark to signify successful upload to backend database/website
        await message.react('✅').catch(err => console.error('Failed to react with checkmark:', err.message));

        // Add additional emoji reactions based on category
        if (resolvedCategory === 'ban' || resolvedCategory.includes('red') || resolvedCategory.includes('แดง')) {
          await message.react('🟥').catch(err => {});
          await message.react('🚨').catch(err => {});
        } else if (resolvedCategory.includes('orange') || resolvedCategory.includes('ส้ม')) {
          await message.react('🟧').catch(err => {});
        } else if (resolvedCategory === 'warning' || resolvedCategory.includes('yellow') || resolvedCategory.includes('เหลือง')) {
          await message.react('🟨').catch(err => {});
          await message.react('⚠️').catch(err => {});
        } else if (resolvedCategory === 'inter_register' || resolvedCategory.includes('inter') || resolvedCategory.includes('ต่างประเทศ')) {
          await message.react('✈️').catch(err => {});
          await message.react('🌐').catch(err => {});
          if (isFakeRegistration) {
            await message.react('❌').catch(err => {});
          }
        } else if (resolvedCategory === 'fine' || resolvedCategory.includes('fine') || resolvedCategory.includes('ปรับ')) {
          await message.react('💸').catch(err => {});
        }

        // Send Log to Discord Log Channel if it is evidence (images or links) OR if it is an international registration
        if (category === 'evidence' || resolvedCategory === 'inter_register') {
          const logCategory = getCategoryFromChannelName(channel.name);
          const embedTitle = isFakeRegistration 
            ? '🚨 [FAKE IP / ข้อมูลปลอม] Evidence Submitted' 
            : '📷 Evidence Submitted / แนบหลักฐานใหม่';

          const evidenceEmbed = new EmbedBuilder()
            .setTitle(embedTitle)
            .setDescription(`**ผู้ส่ง:** ${message.author.username} (ห้อง <#${channel.id}>)\n\n**ข้อความ:** ${message.content || '*ไม่มี*'}`)
            .setColor(isFakeRegistration ? 0xFF0000 : 0xa855f7)
            .setTimestamp();

          if (isFakeRegistration && resolvedCountry) {
            evidenceEmbed.addFields({ name: 'ตรวจสอบข้อมูลประเทศ (IP GeoIP)', value: `❌ **ตรวจพบ IP อยู่ประเทศไทย (${resolvedCountry})**` });
          }

          if (localAttachments.length > 0) {
            const fileLinks = localAttachments.map((file, idx) => {
              const url = file.startsWith('http') ? file : `${API_URL.replace('/api', '')}/uploads/${file}`;
              return `[${getShortFileName(url, idx)}](${url})`;
            });
            const firstRawLink = localAttachments[0].startsWith('http') ? localAttachments[0] : `${API_URL.replace('/api', '')}/uploads/${localAttachments[0]}`;
            evidenceEmbed.addFields({ name: 'รูปภาพหลักฐาน', value: fileLinks.join('\n') });
            evidenceEmbed.setThumbnail(firstRawLink);
          }
          if (extractedLinks.length > 0) {
            const linkList = extractedLinks.map((link, idx) => `[ลิงก์อ้างอิง ${String(idx + 1).padStart(2, '0')}](${link})`);
            evidenceEmbed.addFields({ name: 'ลิงก์ที่แนบ', value: linkList.join('\n') });
          }
          const logMsg = await sendToCategoryLog(message.guild, logCategory, evidenceEmbed);
          if (logMsg && isFakeRegistration) {
            await logMsg.react('❌').catch(err => {});
          }
        }
      }

    } catch (error) {
      console.error('Error logging message in ticket channel:', error.response?.data || error.message);
    }
  }
});

// Prefix text command fallback setup: !setup-ticket
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) return;

  if (message.content === '!setup-ticket') {
    try {
      const payload = getTicketSetupPayload();
      await message.channel.send(payload);
      await message.delete().catch(() => {});
    } catch (err) {
      console.error('Error with !setup-ticket command:', err);
    }
  }
});

// Global Client & Process Error Handlers to log Bot Issues to Discord errors channel
client.on('error', async (error) => {
  console.error('Discord client error:', error);
  await sendBotErrorLog(error);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  await sendBotErrorLog(reason);
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  await sendBotErrorLog(error);
});

// Login Discord Bot
client.login(TOKEN);

// Simple HTTP health check server for Koyeb/Render/Railway
const healthPort = process.env.PORT || 8000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord Bot is alive!');
}).listen(healthPort, () => {
  console.log(`Koyeb Health Check Server listening on port ${healthPort}`);
});
