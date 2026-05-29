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
const { Redis } = require("@upstash/redis");

require("dotenv").config();

// ============================================================
// REDIS (session + config storage)
// ============================================================
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const CONFIG_KEY = "bot:config";

// Default config — used if Redis has no config yet
const DEFAULT_CONFIG = {
  VERIFY_CHANNEL_NAME: "verify",
  WELCOME_CHANNEL_NAME: "WELCOME",
  GOODBYE_CHANNEL_NAME: "GOODBYE",
  MEMBER_ROLE_ID: "",
  MEMBER_ROLE_NAME: "Member",
  MEMBER_ROLE_COLOR: "#ff6eb4",

  WELCOME_TITLE: "ยินดีต้อนรับ!",
  WELCOME_MESSAGE: "ยินดีต้อนรับ {user} เข้าสู่เซิร์ฟเวอร์ของเรา! 🎉",
  WELCOME_COLOR: "#ff6eb4",
  WELCOME_IMAGE: "",
  WELCOME_SHOW_AVATAR: true,
  MENTION_USER: true,
  WELCOME_THUMBNAIL: "[user]",

  GOODBYE_ENABLED: true,
  GOODBYE_TITLE: "ลาก่อน...",
  GOODBYE_MESSAGE: "{user} ได้ออกจากเซิร์ฟเวอร์แล้ว 😢",
  GOODBYE_COLOR: "#ff4f8b",
  GOODBYE_IMAGE: "",
  GOODBYE_SHOW_AVATAR: true,
  GOODBYE_THUMBNAIL: "[user]",

  VERIFY_EMBED_TITLE: "🌸 ยืนยันตัวตน",
  VERIFY_EMBED_DESC: "กดปุ่มด้านล่างเพื่อกรอกข้อมูลและรับยศของคุณ!",
  VERIFY_EMBED_COLOR: "#ff6eb4",
  VERIFY_BUTTON_LABEL: "✅ ยืนยันตัวตน",
  VERIFY_BUTTON_COLOR: "Primary",
  VERIFY_IMAGE: "",
  VERIFY_THUMBNAIL: "[server]",

  ROLE_CATEGORIES: [
    {
      id: "cat_games",
      name: "🎮 เกมที่เล่น",
      multi: true,
      roles: [
        { id: "r1", emoji: "⛏️", label: "Minecraft", roleId: "", roleName: "Minecraft", color: "#57F287" },
        { id: "r2", emoji: "🔫", label: "Valorant",  roleId: "", roleName: "Valorant",  color: "#FF4655" },
        { id: "r3", emoji: "🟥", label: "Roblox",    roleId: "", roleName: "Roblox",    color: "#E53935" },
      ],
    },
  ],
};

// --- Config helpers (Redis-backed, never touches disk) ---
async function loadConfig() {
  try {
    const raw = await redis.get(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
    console.error("❌ loadConfig error, using default:", err.message);
    return { ...DEFAULT_CONFIG };
  }
}
async function saveConfig(data) {
  await redis.set(CONFIG_KEY, JSON.stringify(data));
}

// --- Session helpers ---
async function createSession(userData) {
  const token = crypto.randomBytes(32).toString("hex");
  await redis.set(`session:${token}`, JSON.stringify(userData), { ex: SESSION_TTL });
  return token;
}
async function getSession(token) {
  if (!token) return null;
  try {
    const raw = await redis.get(`session:${token}`);
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { return null; }
}
async function deleteSession(token) {
  try { await redis.del(`session:${token}`); } catch {}
}

// ============================================================
// EXPRESS
// ============================================================
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Image uploads — stored in memory (multer memoryStorage) and served back as base64 data URL
// because Render's disk is ephemeral. For production, swap to Cloudinary/S3.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith("image/") ? cb(null, true) : cb(new Error("Only images allowed")),
});

// Middleware: require valid session
async function requireAuth(req, res, next) {
  const token = req.headers["x-session-token"] || req.query.token;
  const session = await getSession(token);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  req.session = session;
  next();
}

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const PORT = process.env.PORT || 3000;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;

// Routes
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

app.get("/auth/login", (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds",
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect("/login.html?error=no_code");
  try {
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

    const user = await (await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })).json();
    const guilds = await (await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })).json();

    const adminGuilds = guilds.filter((g) => (BigInt(g.permissions) & BigInt(0x8)) !== BigInt(0));
    const botGuildIds = [...client.guilds.cache.keys()];
    const matchedGuild = adminGuilds.find((g) => botGuildIds.includes(g.id));
    if (!matchedGuild) return res.redirect("/login.html?error=not_admin");

    const token = await createSession({
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

app.get("/auth/logout", async (req, res) => {
  if (req.query.token) await deleteSession(req.query.token);
  res.redirect("/");
});

app.get("/api/status", requireAuth, (req, res) => {
  res.json({
    online: client.isReady(),
    tag: client.user?.tag || "Offline",
    guilds: client.guilds?.cache?.size || 0,
    user: req.session,
  });
});

app.get("/api/config", requireAuth, async (req, res) => {
  try { res.json(await loadConfig()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/config", requireAuth, async (req, res) => {
  try {
    await saveConfig(req.body);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get("/api/roles", requireAuth, (req, res) => {
  const guild = client.guilds.cache.get(req.session.guildId);
  if (!guild) return res.json({ roles: [] });
  const roles = guild.roles.cache
    .filter((r) => r.name !== "@everyone" && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      isAdmin: (BigInt(r.permissions.bitfield) & BigInt(0x8)) !== BigInt(0),
    }));
  res.json({ roles });
});

// Upload: return data URL (no disk write — Render safe)
app.post("/api/upload", requireAuth, upload.single("image"), (req, res) => {
  if (!req.file) return res.json({ ok: false, error: "No file" });
  const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
  res.json({ ok: true, url: dataUrl });
});

app.use((err, req, res, next) => {
  if (err.message === "Only images allowed") return res.status(400).json({ ok: false, error: err.message });
  next(err);
});

app.listen(PORT, () => console.log(`🌐 Dashboard: http://localhost:${PORT}`));

// ============================================================
// BOT
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

// In-memory pending data (verify modal state)
const pendingData = new Map();
function setPendingData(userId, data) {
  if (pendingData.has(userId)) clearTimeout(pendingData.get(userId)._timer);
  const timer = setTimeout(() => pendingData.delete(userId), 10 * 60 * 1000);
  pendingData.set(userId, { ...data, _timer: timer });
}
function getPendingData(userId) {
  const entry = pendingData.get(userId);
  if (!entry) return null;
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
    Primary: ButtonStyle.Primary, primary: ButtonStyle.Primary,
    Secondary: ButtonStyle.Secondary, secondary: ButtonStyle.Secondary,
    Success: ButtonStyle.Success, success: ButtonStyle.Success,
    Danger: ButtonStyle.Danger, danger: ButtonStyle.Danger,
  };
  return map[color] ?? ButtonStyle.Primary;
}
function hexToInt(hex) {
  return parseInt((hex || "#ff6eb4").replace("#", ""), 16);
}

function buildCategoryRows(cfg, selected = new Set()) {
  const rows = [];
  for (const cat of (cfg.ROLE_CATEGORIES || [])) {
    if (!cat.roles?.length) continue;
    for (let i = 0; i < cat.roles.length; i += 5) {
      const chunk = cat.roles.slice(i, i + 5);
      const row = new ActionRowBuilder();
      for (const r of chunk) {
        const key = `${cat.id}:${r.id}`;
        const isOn = selected.has(key);
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`role_toggle:${cat.id}:${r.id}`)
            .setLabel(`${r.emoji ? r.emoji + " " : ""}${r.label}${isOn ? " ✓" : ""}`)
            .setStyle(isOn ? ButtonStyle.Success : ButtonStyle.Secondary)
        );
      }
      rows.push(row);
    }
  }
  return rows;
}

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
  ].map((c) => c.toJSON());

  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
    console.log("✅ Slash commands registered");
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
}

client.once("clientReady", async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await registerCommands();
});

client.on("guildMemberAdd", async (member) => {
  try {
    const cfg = await loadConfig();
    const ch = member.guild.channels.cache.find((c) => c.name === cfg.VERIFY_CHANNEL_NAME);
    if (!ch) return;
    const embed = new EmbedBuilder()
      .setColor(hexToInt(cfg.VERIFY_EMBED_COLOR))
      .setTitle(cfg.VERIFY_EMBED_TITLE)
      .setDescription(`สวัสดี ${member}!\n${cfg.VERIFY_EMBED_DESC}`);
    if (cfg.VERIFY_THUMBNAIL === "[user]") embed.setThumbnail(member.user.displayAvatarURL());
    else if (cfg.VERIFY_THUMBNAIL === "[server]" && member.guild.iconURL()) embed.setThumbnail(member.guild.iconURL());
    else if (cfg.VERIFY_THUMBNAIL) embed.setThumbnail(cfg.VERIFY_THUMBNAIL);
    if (cfg.VERIFY_IMAGE) embed.setImage(cfg.VERIFY_IMAGE);
    const btn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("open_verify_modal")
        .setLabel(cfg.VERIFY_BUTTON_LABEL || "✅ ยืนยันตัวตน")
        .setStyle(resolveButtonStyle(cfg.VERIFY_BUTTON_COLOR))
    );
    await ch.send({ embeds: [embed], components: [btn] });
  } catch (err) { console.error("❌ guildMemberAdd:", err); }
});

client.on("guildMemberRemove", async (member) => {
  try {
    const cfg = await loadConfig();
    if (!cfg.GOODBYE_ENABLED) return;
    const ch = member.guild.channels.cache.find((c) => c.name === cfg.GOODBYE_CHANNEL_NAME);
    if (!ch) return;
    const embed = new EmbedBuilder()
      .setColor(hexToInt(cfg.GOODBYE_COLOR))
      .setTitle(cfg.GOODBYE_TITLE)
      .setDescription(formatMsg(cfg.GOODBYE_MESSAGE, member.user.username));
    if (cfg.GOODBYE_SHOW_AVATAR) embed.setThumbnail(member.user.displayAvatarURL());
    if (cfg.GOODBYE_IMAGE) embed.setImage(cfg.GOODBYE_IMAGE);
    await ch.send({ embeds: [embed] });
  } catch (err) { console.error("❌ guildMemberRemove:", err); }
});

client.on("interactionCreate", async (interaction) => {
  const cfg = await loadConfig();

  // /setup
  if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const embed = new EmbedBuilder()
        .setColor(hexToInt(cfg.VERIFY_EMBED_COLOR))
        .setTitle(cfg.VERIFY_EMBED_TITLE || "🌸 ยืนยันตัวตน")
        .setDescription(cfg.VERIFY_EMBED_DESC || "กดปุ่มด้านล่างเพื่อกรอกข้อมูลและรับยศของคุณ!");
      if (cfg.VERIFY_THUMBNAIL === "[server]" && interaction.guild.iconURL())
        embed.setThumbnail(interaction.guild.iconURL());
      else if (cfg.VERIFY_THUMBNAIL && cfg.VERIFY_THUMBNAIL !== "[user]")
        embed.setThumbnail(cfg.VERIFY_THUMBNAIL);
      if (cfg.VERIFY_IMAGE) embed.setImage(cfg.VERIFY_IMAGE);
      const btn = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("open_verify_modal")
          .setLabel(cfg.VERIFY_BUTTON_LABEL || "✅ ยืนยันตัวตน")
          .setStyle(resolveButtonStyle(cfg.VERIFY_BUTTON_COLOR))
      );
      await interaction.channel.send({ embeds: [embed], components: [btn] });
      await interaction.editReply({ content: "✅ ส่ง Verify embed แล้ว!" });
    } catch (err) {
      console.error("❌ /setup:", err);
      await interaction.editReply({ content: "❌ เกิดข้อผิดพลาด: " + err.message });
    }
    return;
  }

  // /dashboard
  if (interaction.isChatInputCommand() && interaction.commandName === "dashboard") {
    await interaction.deferReply({ ephemeral: true });
    const dashUrl = (process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`)
      .replace("/auth/callback", "/auth/login");
    await interaction.editReply({ content: `🔗 **Dashboard**\n${dashUrl}` });
    return;
  }

  // Button: open verify modal
  if (interaction.isButton() && interaction.customId === "open_verify_modal") {
    const modal = new ModalBuilder().setCustomId("verify_modal").setTitle("📋 กรอกข้อมูลของคุณ");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("ชื่อที่ใช้เรียก")
          .setStyle(TextInputStyle.Short).setPlaceholder("เช่น ไอซ์, Korn").setRequired(true).setMaxLength(32)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("age").setLabel("อายุ")
          .setStyle(TextInputStyle.Short).setPlaceholder("เช่น 18").setRequired(true).setMaxLength(3)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("gender").setLabel("เพศ")
          .setStyle(TextInputStyle.Short).setPlaceholder("ชาย / หญิง / ไม่ระบุ").setRequired(true).setMaxLength(10)
      )
    );
    await interaction.showModal(modal);
    return;
  }

  // Modal submit
  if (interaction.isModalSubmit() && interaction.customId === "verify_modal") {
    const name = interaction.fields.getTextInputValue("name");
    const age = interaction.fields.getTextInputValue("age");
    const gender = interaction.fields.getTextInputValue("gender");
    setPendingData(interaction.user.id, { name, age, gender, selectedRoles: [] });

    const categories = cfg.ROLE_CATEGORIES || [];
    if (categories.length === 0) {
      await completeVerify(interaction, cfg, true);
      return;
    }

    const rows = buildCategoryRows(cfg, new Set());
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("verify_confirm").setLabel("✅ ยืนยันและเข้าเซิร์ฟเวอร์").setStyle(ButtonStyle.Success)
    );
    const catList = categories
      .map((c) => `**${c.name}**\n${(c.roles || []).map((r) => `${r.emoji || "•"} ${r.label}`).join("  ")}`)
      .join("\n\n");
    const embed = new EmbedBuilder()
      .setColor(hexToInt(cfg.VERIFY_EMBED_COLOR))
      .setTitle("🎉 ยินดีต้อนรับ " + name + "!")
      .setDescription("กดปุ่มเพื่อเลือกยศที่ต้องการ (กดได้หลายอัน)\nแล้วกด **✅ ยืนยัน** เพื่อเข้าสู่เซิร์ฟเวอร์\n\n" + catList);
    await interaction.reply({ embeds: [embed], components: [...rows, confirmRow], ephemeral: true });
    return;
  }

  // Button: toggle role
  if (interaction.isButton() && interaction.customId.startsWith("role_toggle:")) {
    const [, catId, roleId] = interaction.customId.split(":");
    const pending = getPendingData(interaction.user.id);
    if (!pending) {
      await interaction.reply({ content: "⚠️ Session หมดอายุ กรุณากด Verify ใหม่", ephemeral: true });
      return;
    }
    const selected = new Set(pending.selectedRoles || []);
    const key = `${catId}:${roleId}`;
    const cat = (cfg.ROLE_CATEGORIES || []).find((c) => c.id === catId);
    if (cat && !cat.multi) {
      for (const s of [...selected]) { if (s.startsWith(catId + ":")) selected.delete(s); }
    }
    if (selected.has(key)) selected.delete(key); else selected.add(key);
    setPendingData(interaction.user.id, { ...pending, selectedRoles: [...selected] });

    const rows = buildCategoryRows(cfg, selected);
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("verify_confirm").setLabel("✅ ยืนยันและเข้าเซิร์ฟเวอร์").setStyle(ButtonStyle.Success)
    );
    await interaction.update({ components: [...rows, confirmRow] });
    return;
  }

  // Button: confirm verify
  if (interaction.isButton() && interaction.customId === "verify_confirm") {
    await completeVerify(interaction, cfg, false);
    return;
  }
});

async function completeVerify(interaction, cfg, isModal = false) {
  try {
    const member = interaction.member;
    const guild = interaction.guild;
    const pending = getPendingData(interaction.user.id);
    if (!pending) {
      const msg = { content: "⚠️ Session หมดอายุ กรุณากด Verify ใหม่", components: [], embeds: [] };
      isModal ? await interaction.reply({ ...msg, ephemeral: true }) : await interaction.update(msg);
      return;
    }

    const rolesToAdd = [];
    let memberRole = cfg.MEMBER_ROLE_ID ? guild.roles.cache.get(cfg.MEMBER_ROLE_ID) : null;
    if (!memberRole && cfg.MEMBER_ROLE_NAME)
      memberRole = guild.roles.cache.find((r) => r.name === cfg.MEMBER_ROLE_NAME);
    if (memberRole) rolesToAdd.push(memberRole);

    const addedRoleNames = [];
    for (const key of (pending.selectedRoles || [])) {
      const [catId, roleId] = key.split(":");
      const cat = (cfg.ROLE_CATEGORIES || []).find((c) => c.id === catId);
      const roleInfo = (cat?.roles || []).find((r) => r.id === roleId);
      if (!roleInfo) continue;
      let dr = roleInfo.roleId
        ? guild.roles.cache.get(roleInfo.roleId)
        : guild.roles.cache.find((r) => r.name === (roleInfo.roleName || roleInfo.label));
      if (!dr) {
        dr = await guild.roles.create({
          name: roleInfo.roleName || roleInfo.label,
          color: hexToInt(roleInfo.color),
          reason: "Auto-created by verify bot",
        });
      }
      rolesToAdd.push(dr);
      addedRoleNames.push(`${roleInfo.emoji || ""} ${roleInfo.label}`.trim());
    }

    if (rolesToAdd.length > 0) await member.roles.add(rolesToAdd).catch(console.error);
    deletePendingData(interaction.user.id);

    const roleText = addedRoleNames.length > 0 ? `\n🎭 ยศที่ได้รับ: ${addedRoleNames.join(", ")}` : "";
    const doneMsg = { content: `🎉 ยินดีต้อนรับ **${pending.name}**!${roleText}`, components: [], embeds: [] };
    isModal ? await interaction.reply({ ...doneMsg, ephemeral: true }) : await interaction.update(doneMsg);

    // Welcome embed
    const wch = guild.channels.cache.find((c) => c.name === cfg.WELCOME_CHANNEL_NAME);
    if (wch) {
      const we = new EmbedBuilder()
        .setColor(hexToInt(cfg.WELCOME_COLOR))
        .setTitle(cfg.WELCOME_TITLE || "ยินดีต้อนรับ!")
        .setDescription(formatMsg(cfg.WELCOME_MESSAGE || "ยินดีต้อนรับ {user}!", member))
        .addFields(
          { name: "ชื่อ", value: pending.name || "-", inline: true },
          { name: "อายุ", value: pending.age || "-", inline: true },
          { name: "เพศ", value: pending.gender || "-", inline: true }
        )
        .setTimestamp();
      if (addedRoleNames.length > 0) we.addFields({ name: "ยศ", value: addedRoleNames.join(", "), inline: false });
      if (cfg.WELCOME_SHOW_AVATAR) we.setThumbnail(interaction.user.displayAvatarURL());
      if (cfg.WELCOME_IMAGE) we.setImage(cfg.WELCOME_IMAGE);
      await wch.send({ content: cfg.MENTION_USER ? `${member}` : undefined, embeds: [we] });
    }
  } catch (err) {
    console.error("❌ completeVerify:", err);
    try {
      const errMsg = { content: "❌ เกิดข้อผิดพลาด กรุณาติดต่อ Admin", components: [], embeds: [] };
      isModal ? await interaction.reply({ ...errMsg, ephemeral: true }) : await interaction.update(errMsg);
    } catch {}
  }
}

// ============================================================
// CRASH GUARD — prevent Render restart loop
// ============================================================
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("⚠️ Uncaught Exception:", err);
  // Do NOT exit — let the process keep running on Render
});

client.login(process.env.DISCORD_TOKEN);
