const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

// ============================================================
// 📁 CONFIG — โหลดจาก config.json (แก้ผ่าน Dashboard ได้เลย)
// ============================================================
const CONFIG_PATH = path.join(__dirname, "config.json");

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

// ============================================================
// 🌐 EXPRESS — Dashboard Web UI
// ============================================================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// GET /api/config → ส่ง config ให้ Dashboard
app.get("/api/config", (req, res) => {
  try {
    res.json(loadConfig());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/config → รับค่าจาก Dashboard และบันทึก
app.post("/api/config", (req, res) => {
  try {
    saveConfig(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// GET /api/status → สถานะบอทสำหรับ Dashboard
app.get("/api/status", (req, res) => {
  res.json({
    tag: client.user?.tag || "Offline",
    online: client.isReady(),
    guilds: client.guilds?.cache?.size || 0,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Dashboard: http://localhost:${PORT}`);
});

// ============================================================
// 🤖 DISCORD BOT
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember],
});

// เก็บข้อมูลชั่วคราวก่อนเลือกเกม
const pendingData = new Map();

// ─── Helper: แทน {user} ด้วย mention จริง ───────────────────
function formatMsg(template, member) {
  return template.replace(/\{user\}/g, `${member}`);
}

// ─── Helper: แปลง ButtonColor string → ButtonStyle ──────────
function resolveButtonStyle(color = "Primary") {
  const map = {
    Primary: ButtonStyle.Primary,
    primary: ButtonStyle.Primary,
    Secondary: ButtonStyle.Secondary,
    secondary: ButtonStyle.Secondary,
    Success: ButtonStyle.Success,
    success: ButtonStyle.Success,
    Danger: ButtonStyle.Danger,
    danger: ButtonStyle.Danger,
  };
  return map[color] ?? ButtonStyle.Primary;
}

// ─── บอทพร้อมทำงาน ───────────────────────────────────────────
client.once("clientReady", () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
});

// ─── สมาชิกใหม่เข้า server ──────────────────────────────────
client.on("guildMemberAdd", async (member) => {
  const cfg = loadConfig();

  // ส่ง Verify embed ในห้อง verify
  const verifyChannel = member.guild.channels.cache.find(
    (c) => c.name === cfg.VERIFY_CHANNEL_NAME
  );
  if (verifyChannel) {
    const embed = new EmbedBuilder()
      .setColor(parseInt(cfg.VERIFY_EMBED_COLOR.replace("#", ""), 16))
      .setTitle(cfg.VERIFY_EMBED_TITLE)
      .setDescription(
        `สวัสดี ${member}!\n${cfg.VERIFY_EMBED_DESC}`
      )
      .setThumbnail(member.user.displayAvatarURL());

    const button = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("open_verify_modal")
        .setLabel(cfg.VERIFY_BUTTON_LABEL)
        .setStyle(resolveButtonStyle(cfg.VERIFY_BUTTON_COLOR))
    );

    await verifyChannel.send({ embeds: [embed], components: [button] });
  }
});

// ─── สมาชิกออกจาก server ────────────────────────────────────
client.on("guildMemberRemove", async (member) => {
  const cfg = loadConfig();
  if (!cfg.GOODBYE_ENABLED) return;

  const goodbyeChannel = member.guild.channels.cache.find(
    (c) => c.name === cfg.GOODBYE_CHANNEL_NAME
  );
  if (!goodbyeChannel) return;

  const embed = new EmbedBuilder()
    .setColor(parseInt(cfg.GOODBYE_COLOR.replace("#", ""), 16))
    .setTitle(cfg.GOODBYE_TITLE)
    .setDescription(formatMsg(cfg.GOODBYE_MESSAGE, member));

  if (cfg.GOODBYE_SHOW_AVATAR) {
    embed.setThumbnail(member.user.displayAvatarURL());
  }
  if (cfg.GOODBYE_IMAGE) {
    embed.setImage(cfg.GOODBYE_IMAGE);
  }

  await goodbyeChannel.send({ embeds: [embed] });
});

// ─── คำสั่ง !setup (Admin เท่านั้น) ─────────────────────────
client.on("messageCreate", async (message) => {
  if (message.content !== "!setup") return;
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

  const cfg = loadConfig();

  const embed = new EmbedBuilder()
    .setColor(parseInt(cfg.VERIFY_EMBED_COLOR.replace("#", ""), 16))
    .setTitle(cfg.VERIFY_EMBED_TITLE)
    .setDescription(cfg.VERIFY_EMBED_DESC);

  const button = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("open_verify_modal")
      .setLabel(cfg.VERIFY_BUTTON_LABEL)
      .setStyle(resolveButtonStyle(cfg.VERIFY_BUTTON_COLOR))
  );

  await message.channel.send({ embeds: [embed], components: [button] });
  await message.delete().catch(() => {});
});

// ─── Interactions ────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  const cfg = loadConfig();

  // 1) เปิด Modal
  if (interaction.isButton() && interaction.customId === "open_verify_modal") {
    const modal = new ModalBuilder()
      .setCustomId("verify_modal")
      .setTitle("📋 กรอกข้อมูลของคุณ");

    const nameInput = new TextInputBuilder()
      .setCustomId("name")
      .setLabel("ชื่อที่ใช้เรียก")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("เช่น ไอซ์, Korn, Minnie")
      .setRequired(true)
      .setMaxLength(32);

    const ageInput = new TextInputBuilder()
      .setCustomId("age")
      .setLabel("อายุ")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("เช่น 18")
      .setRequired(true)
      .setMaxLength(3);

    const genderInput = new TextInputBuilder()
      .setCustomId("gender")
      .setLabel("เพศ")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("ชาย / หญิง / ไม่ระบุ")
      .setRequired(true)
      .setMaxLength(10);

    const gameInput = new TextInputBuilder()
      .setCustomId("game_text")
      .setLabel("เกมที่เล่น")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("เช่น Minecraft, Valorant, Roblox")
      .setRequired(false)
      .setMaxLength(50);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(ageInput),
      new ActionRowBuilder().addComponents(genderInput),
      new ActionRowBuilder().addComponents(gameInput)
    );

    await interaction.showModal(modal);
    return;
  }

  // 2) รับ Modal → dropdown เลือกยศเกม (ดึงจาก config)
  if (interaction.isModalSubmit() && interaction.customId === "verify_modal") {
    const name = interaction.fields.getTextInputValue("name");
    const age = interaction.fields.getTextInputValue("age");
    const gender = interaction.fields.getTextInputValue("gender");
    const gameText = interaction.fields.getTextInputValue("game_text");

    pendingData.set(interaction.user.id, { name, age, gender, gameText });

    // สร้าง dropdown จาก GAME_ROLES ใน config
    const gameRoles = cfg.GAME_ROLES || {};
    const options = Object.entries(gameRoles).map(([key, val]) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${val.emoji} ${val.name}`)
        .setValue(key)
    );

    if (options.length === 0) {
      await interaction.reply({
        content: "⚠️ ยังไม่มียศเกมในระบบ กรุณาติดต่อ Admin",
        ephemeral: true,
      });
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId("select_game_role")
      .setPlaceholder("🎮 เลือกเกมที่คุณเล่นหลัก")
      .addOptions(options);

    await interaction.reply({
      content: "✅ ได้รับข้อมูลแล้ว! เลือกยศเกมของคุณด้านล่าง:",
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: true,
    });
    return;
  }

  // 3) เลือกยศเกม → ให้ยศ + welcome embed
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "select_game_role"
  ) {
    const member = interaction.member;
    const guild = interaction.guild;
    const selectedGame = interaction.values[0];
    const data = pendingData.get(interaction.user.id) || {};
    const gameRoles = cfg.GAME_ROLES || {};
    const gameInfo = gameRoles[selectedGame];

    if (!gameInfo) {
      await interaction.update({ content: "⚠️ ไม่พบยศเกมนี้", components: [] });
      return;
    }

    // หา/สร้าง Member role
    let memberRole = guild.roles.cache.find((r) => r.name === cfg.MEMBER_ROLE_NAME);
    if (!memberRole) {
      memberRole = await guild.roles.create({
        name: cfg.MEMBER_ROLE_NAME,
        color: parseInt((cfg.MEMBER_ROLE_COLOR || "#57F287").replace("#", ""), 16),
        reason: "Auto-created by verify bot",
      });
    }

    // หา/สร้าง Game role
    let gameRole = guild.roles.cache.find((r) => r.name === gameInfo.name);
    if (!gameRole) {
      gameRole = await guild.roles.create({
        name: gameInfo.name,
        color: parseInt((gameInfo.color || "#5865F2").replace("#", ""), 16),
        reason: "Auto-created by verify bot",
      });
    }

    await member.roles.add([memberRole, gameRole]).catch(console.error);
    pendingData.delete(interaction.user.id);

    await interaction.update({
      content: `🎉 ยินดีต้อนรับ **${data.name}**! คุณได้รับยศ **${gameInfo.name}** แล้ว`,
      components: [],
    });

    // ส่ง Welcome embed
    const welcomeChannel = guild.channels.cache.find(
      (c) => c.name === cfg.WELCOME_CHANNEL_NAME
    );
    if (welcomeChannel) {
      const welcomeEmbed = new EmbedBuilder()
        .setColor(parseInt(cfg.WELCOME_COLOR.replace("#", ""), 16))
        .setTitle(cfg.WELCOME_TITLE)
        .setDescription(formatMsg(cfg.WELCOME_MESSAGE, member))
        .addFields(
          { name: "ชื่อ", value: data.name || "-", inline: true },
          { name: "อายุ", value: data.age || "-", inline: true },
          { name: "เพศ", value: data.gender || "-", inline: true },
          { name: "เกม", value: `${gameInfo.emoji} ${gameInfo.name}`, inline: true }
        )
        .setTimestamp();

      if (cfg.WELCOME_SHOW_AVATAR) {
        welcomeEmbed.setThumbnail(interaction.user.displayAvatarURL());
      }
      if (cfg.WELCOME_IMAGE) {
        welcomeEmbed.setImage(cfg.WELCOME_IMAGE);
      }
      if (cfg.MENTION_USER) {
        await welcomeChannel.send({ content: `${member}`, embeds: [welcomeEmbed] });
      } else {
        await welcomeChannel.send({ embeds: [welcomeEmbed] });
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
