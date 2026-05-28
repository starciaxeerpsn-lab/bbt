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
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

require("dotenv").config();

// ============================================================
// 📁 CONFIG
// ============================================================
const CONFIG_PATH = path.join(__dirname, "config.json");

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

// ============================================================
// 🔐 SESSION STORE (file-based — survives restarts)
// sessions[token] = { userId, username, avatar, guildId, expiry }
// ============================================================
const SESSIONS_PATH = path.join(__dirname, "sessions.json");

function loadSessions() {
  try {
    if (!fs.existsSync(SESSIONS_PATH)) return {};
    return JSON.parse(fs.readFileSync(SESSIONS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveSessions(data) {
  try {
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(data));
  } catch (e) {
    console.error("❌ Failed to save sessions:", e.message);
  }
}

function createSession(userData) {
  const token = crypto.randomBytes(32).toString("hex");
  const data = loadSessions();
  data[token] = {
    ...userData,
    expiry: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 วัน
  };
  saveSessions(data);
  return token;
}

function getSession(token) {
  if (!token) return null;
  const data = loadSessions();
  const s = data[token];
  if (!s) return null;
  if (Date.now() > s.expiry) {
    deleteSession(token);
    return null;
  }
  return s;
}

function deleteSession(token) {
  const data = loadSessions();
  delete data[token];
  saveSessions(data);
}

// ล้าง session หมดอายุทุก 1 ชั่วโมง
setInterval(() => {
  const data = loadSessions();
  const now = Date.now();
  let changed = false;
  for (const [token, s] of Object.entries(data)) {
    if (now > s.expiry) { delete data[token]; changed = true; }
  }
  if (changed) saveSessions(data);
}, 1000 * 60 * 60);

// ============================================================
// 🌐 EXPRESS
// ============================================================
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// สร้างโฟลเดอร์ uploads อัตโนมัติถ้ายังไม่มี
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer สำหรับ upload รูป
const storage = multer.diskStorage({
  destination: path.join(__dirname, "uploads"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only images allowed"));
  },
});
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ── Auth middleware ──────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.headers["x-session-token"] || req.query.token;
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  req.session = session;
  next();
}

// ── Discord OAuth2 ───────────────────────────────────────────
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${process.env.PORT || 3000}/auth/callback`;

// GET / → login page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// GET /auth/login → redirect to Discord OAuth
app.get("/auth/login", (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds",
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// GET /auth/callback → exchange code → verify admin → create session
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect("/login.html?error=no_code");

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect("/login.html?error=token_failed");

    // Get user info
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();

    // Get user's guilds
    const guildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const guilds = await guildsRes.json();

    // หา guild ที่ user เป็น Admin (ADMINISTRATOR permission = 0x8)
    const adminGuilds = guilds.filter(
      (g) => (BigInt(g.permissions) & BigInt(0x8)) !== BigInt(0)
    );

    // ตรวจว่าเป็น Admin ใน guild ที่บอทอยู่
    const botGuildIds = [...client.guilds.cache.keys()];
    const matchedGuild = adminGuilds.find((g) => botGuildIds.includes(g.id));

    if (!matchedGuild) {
      return res.redirect("/login.html?error=not_admin");
    }

    const token = createSession({
      userId: user.id,
      username: user.username,
      avatar: user.avatar,
      guildId: matchedGuild.id,
      guildName: matchedGuild.name,
    });

    res.redirect(`/dashboard.html?token=${token}`);
  } catch (err) {
    console.error("OAuth error:", err);
    res.redirect("/login.html?error=oauth_error");
  }
});

// GET /auth/logout
app.get("/auth/logout", (req, res) => {
  const token = req.query.token;
  if (token) deleteSession(token);
  res.redirect("/");
});

// ── API: สถานะบอท ────────────────────────────────────────────
app.get("/api/status", requireAuth, (req, res) => {
  res.json({
    online: client.isReady(),
    tag: client.user?.tag || "Offline",
    guilds: client.guilds?.cache?.size || 0,
    user: {
      userId: req.session.userId,
      username: req.session.username,
      avatar: req.session.avatar,
      guildName: req.session.guildName,
    },
  });
});

// ── API: Config ──────────────────────────────────────────────
app.get("/api/config", requireAuth, (req, res) => {
  try {
    res.json(loadConfig());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/config", requireAuth, (req, res) => {
  try {
    saveConfig(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── API: ดึงยศจาก Discord ────────────────────────────────────
app.get("/api/roles", requireAuth, (req, res) => {
  const guildId = req.session.guildId;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return res.json({ roles: [] });

  const DANGEROUS = BigInt(0x8) | BigInt(0x20) | BigInt(0x10); // ADMINISTRATOR | MANAGE_GUILD | MANAGE_ROLES

  const roles = guild.roles.cache
    .filter((r) => r.name !== "@everyone" && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => {
      const perms = BigInt(r.permissions.bitfield);
      const isAdmin = (perms & BigInt(0x8)) !== BigInt(0);
      const isDangerous = !isAdmin && (perms & DANGEROUS) !== BigInt(0);
      return {
        id: r.id,
        name: r.name,
        color: r.color,
        isAdmin,
        isDangerous,
      };
    });

  res.json({ roles });
});

// ── API: Upload รูป ──────────────────────────────────────────
app.post("/api/upload", requireAuth, upload.single("image"), (req, res) => {
  if (!req.file) return res.json({ ok: false, error: "No file" });
  const url = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  res.json({ ok: true, url });
});

// ── Error handler สำหรับ multer ──────────────────────────────
app.use((err, req, res, next) => {
  if (err.message === "Only images allowed") {
    return res.status(400).json({ ok: false, error: err.message });
  }
  next(err);
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

const pendingData = new Map();

// Auto-cleanup pendingData ที่ค้างเกิน 10 นาที
function setPendingData(userId, data) {
  // ถ้ามี timer เก่าอยู่ ยกเลิกก่อน
  if (pendingData.has(userId)) {
    clearTimeout(pendingData.get(userId)._timer);
  }
  const timer = setTimeout(() => {
    pendingData.delete(userId);
  }, 10 * 60 * 1000); // 10 นาที
  pendingData.set(userId, { ...data, _timer: timer });
}

function getPendingData(userId) {
  const entry = pendingData.get(userId);
  if (!entry) return {};
  const { _timer, ...data } = entry;
  return data;
}

function deletePendingData(userId) {
  const entry = pendingData.get(userId);
  if (entry?._timer) clearTimeout(entry._timer);
  pendingData.delete(userId);
}

function formatMsg(template, member) {
  return template.replace(/\{user\}/g, `${member}`);
}

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

// ── Register Slash Commands ──────────────────────────────────
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("ส่ง Verify embed ในห้องนี้")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName("dashboard")
      .setDescription("รับลิงก์เข้า Dashboard (Admin เท่านั้น)")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ].map((cmd) => cmd.toJSON());

  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), {
      body: commands,
    });
    console.log("✅ Slash commands registered");
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
}

// ── Bot Ready ────────────────────────────────────────────────
client.once("clientReady", async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await registerCommands();
});

// ── guildMemberAdd ───────────────────────────────────────────
client.on("guildMemberAdd", async (member) => {
  try {
    const cfg = loadConfig();
    const verifyChannel = member.guild.channels.cache.find(
      (c) => c.name === cfg.VERIFY_CHANNEL_NAME
    );
    if (!verifyChannel) return;

    const embed = new EmbedBuilder()
      .setColor(parseInt(cfg.VERIFY_EMBED_COLOR.replace("#", ""), 16))
      .setTitle(cfg.VERIFY_EMBED_TITLE)
      .setDescription(`สวัสดี ${member}!\n${cfg.VERIFY_EMBED_DESC}`);

    if (cfg.VERIFY_THUMBNAIL === '[user]' || !cfg.VERIFY_THUMBNAIL) embed.setThumbnail(member.user.displayAvatarURL());
    else if (cfg.VERIFY_THUMBNAIL === '[server]' && member.guild.iconURL()) embed.setThumbnail(member.guild.iconURL());
    else if (cfg.VERIFY_THUMBNAIL) embed.setThumbnail(cfg.VERIFY_THUMBNAIL);
    if (cfg.VERIFY_IMAGE) embed.setImage(cfg.VERIFY_IMAGE);

    const button = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("open_verify_modal")
        .setLabel(cfg.VERIFY_BUTTON_LABEL)
        .setStyle(resolveButtonStyle(cfg.VERIFY_BUTTON_COLOR))
    );

    await verifyChannel.send({ embeds: [embed], components: [button] });
  } catch (err) {
    console.error("❌ guildMemberAdd error:", err);
  }
});

// ── guildMemberRemove ────────────────────────────────────────
client.on("guildMemberRemove", async (member) => {
  try {
    const cfg = loadConfig();
    if (!cfg.GOODBYE_ENABLED) return;

    const goodbyeChannel = member.guild.channels.cache.find(
      (c) => c.name === cfg.GOODBYE_CHANNEL_NAME
    );
    if (!goodbyeChannel) return;

    const embed = new EmbedBuilder()
      .setColor(parseInt(cfg.GOODBYE_COLOR.replace("#", ""), 16))
      .setTitle(cfg.GOODBYE_TITLE)
      .setDescription(formatMsg(cfg.GOODBYE_MESSAGE, member.user.username));

    if (cfg.GOODBYE_SHOW_AVATAR) embed.setThumbnail(member.user.displayAvatarURL());
    if (cfg.GOODBYE_IMAGE) embed.setImage(cfg.GOODBYE_IMAGE);

    await goodbyeChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error("❌ guildMemberRemove error:", err);
  }
});

// ── Interactions ─────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  const cfg = loadConfig();

  // ── Slash: /setup ─────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
    await interaction.deferReply({ ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(parseInt(cfg.VERIFY_EMBED_COLOR.replace("#", ""), 16))
      .setTitle(cfg.VERIFY_EMBED_TITLE)
      .setDescription(cfg.VERIFY_EMBED_DESC);

    if (cfg.VERIFY_THUMBNAIL === '[server]' && interaction.guild.iconURL()) embed.setThumbnail(interaction.guild.iconURL());
    else if (cfg.VERIFY_THUMBNAIL && cfg.VERIFY_THUMBNAIL !== '[user]') embed.setThumbnail(cfg.VERIFY_THUMBNAIL);
    if (cfg.VERIFY_IMAGE) embed.setImage(cfg.VERIFY_IMAGE);

    const button = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("open_verify_modal")
        .setLabel(cfg.VERIFY_BUTTON_LABEL)
        .setStyle(resolveButtonStyle(cfg.VERIFY_BUTTON_COLOR))
    );

    await interaction.channel.send({ embeds: [embed], components: [button] });
    await interaction.editReply({ content: "✅ ส่ง Verify embed แล้ว!" });
    return;
  }

  // ── Slash: /dashboard ────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === "dashboard") {
    await interaction.deferReply({ ephemeral: true });
    const dashUrl = process.env.REDIRECT_URI
      ? process.env.REDIRECT_URI.replace("/auth/callback", "/auth/login")
      : `http://localhost:${PORT}/auth/login`;
    await interaction.editReply({
      content: `🔗 **Dashboard Link**\n${dashUrl}\n\n_ลิงก์นี้จะพาไปหน้า Login ด้วย Discord_`,
    });
    return;
  }

  // ── Button: เปิด Verify Modal ─────────────────────────────
  if (interaction.isButton() && interaction.customId === "open_verify_modal") {
    const modal = new ModalBuilder()
      .setCustomId("verify_modal")
      .setTitle("📋 กรอกข้อมูลของคุณ");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("ชื่อที่ใช้เรียก")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("เช่น ไอซ์, Korn, Minnie")
          .setRequired(true)
          .setMaxLength(32)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("age")
          .setLabel("อายุ")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("เช่น 18")
          .setRequired(true)
          .setMaxLength(3)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("gender")
          .setLabel("เพศ")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("ชาย / หญิง / ไม่ระบุ")
          .setRequired(true)
          .setMaxLength(10)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("game_text")
          .setLabel("เกมที่เล่น (optional)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("เช่น Minecraft, Valorant, Roblox")
          .setRequired(false)
          .setMaxLength(50)
      )
    );

    await interaction.showModal(modal);
    return;
  }

  // ── Modal Submit: verify_modal ────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === "verify_modal") {
    const name = interaction.fields.getTextInputValue("name");
    const age = interaction.fields.getTextInputValue("age");
    const gender = interaction.fields.getTextInputValue("gender");
    const gameText = interaction.fields.getTextInputValue("game_text");

    setPendingData(interaction.user.id, { name, age, gender, gameText });

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

  // ── Select Menu: เลือกยศเกม ───────────────────────────────
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "select_game_role"
  ) {
    const member = interaction.member;
    const guild = interaction.guild;
    const selectedGame = interaction.values[0];
    const data = getPendingData(interaction.user.id);
    const gameRoles = cfg.GAME_ROLES || {};
    const gameInfo = gameRoles[selectedGame];

    if (!gameInfo) {
      await interaction.update({ content: "⚠️ ไม่พบยศเกมนี้", components: [] });
      return;
    }

    // หา Member role — ใช้ ID ก่อน, fallback ชื่อ, fallback สร้างใหม่
    let memberRole = cfg.MEMBER_ROLE_ID
      ? guild.roles.cache.get(cfg.MEMBER_ROLE_ID)
      : guild.roles.cache.find((r) => r.name === cfg.MEMBER_ROLE_NAME);
    if (!memberRole) {
      memberRole = await guild.roles.create({
        name: cfg.MEMBER_ROLE_NAME,
        color: parseInt((cfg.MEMBER_ROLE_COLOR || "#57F287").replace("#", ""), 16),
        reason: "Auto-created by verify bot",
      });
    }

    // หา Game role — ใช้ roleId ก่อน, fallback ชื่อ, fallback สร้างใหม่
    let gameRole = gameInfo.roleId
      ? guild.roles.cache.get(gameInfo.roleId)
      : guild.roles.cache.find((r) => r.name === gameInfo.name);
    if (!gameRole) {
      gameRole = await guild.roles.create({
        name: gameInfo.name,
        color: parseInt((gameInfo.color || "#5865F2").replace("#", ""), 16),
        reason: "Auto-created by verify bot",
      });
    }

    await member.roles.add([memberRole, gameRole]).catch(console.error);
    deletePendingData(interaction.user.id);

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

      const content = cfg.MENTION_USER ? `${member}` : undefined;
      await welcomeChannel.send({ content, embeds: [welcomeEmbed] });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
