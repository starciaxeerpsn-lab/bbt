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

const CONFIG_PATH = path.join(__dirname, "config.json");
function loadConfig() { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); }
function saveConfig(data) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2)); }

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const SESSION_TTL = 60 * 60 * 24 * 30;

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
async function deleteSession(token) { await redis.del(`session:${token}`); }

// ── ALLOWED USERS (stored in Redis) ──
const ALLOWED_KEY = "panel:allowed_users";
async function getAllowedUsers() {
  try {
    const raw = await redis.get(ALLOWED_KEY);
    if (!raw) return null; // null = ไม่ได้ตั้งค่า = ใช้ env แทน
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { return null; }
}
async function saveAllowedUsers(list) {
  await redis.set(ALLOWED_KEY, JSON.stringify(list));
}
function isOwner(userId) {
  // OWNER_ID ใน env = เจ้าของเดียวที่จัดการ whitelist ได้
  const owner = process.env.OWNER_ID || process.env.ADMIN_USER_IDS?.split(",")[0]?.trim();
  return userId === owner;
}

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith("image/") ? cb(null, true) : cb(new Error("Only images allowed")),
});
app.use("/uploads", express.static(uploadsDir));

// Cache permission checks for 60s to avoid Discord rate limits
const _permCache = new Map();
async function checkMemberIsAdmin(guild, userId) {
  const cacheKey = `${guild.id}:${userId}`;
  const cached = _permCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 60000) return cached.ok;

  const member = await guild.members.fetch(userId).catch(() => null);
  const ok = member ? (member.permissions.has("Administrator") || member.permissions.has("ManageGuild")) : false;
  _permCache.set(cacheKey, { ok, ts: Date.now() });
  return ok;
}

async function requireAuth(req, res, next) {
  const token = req.headers["x-session-token"] || req.query.token;
  const session = await getSession(token);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  // Owner always bypasses permission checks
  if (isOwner(session.userId)) {
    req.session = session;
    return next();
  }

  // Re-verify user still has admin permission in the guild (cached 60s)
  try {
    const guild = client.guilds.cache.get(session.guildId);
    if (guild) {
      const isAdmin = await checkMemberIsAdmin(guild, session.userId);
      if (!isAdmin) {
        await deleteSession(token);
        _permCache.delete(`${session.guildId}:${session.userId}`);
        return res.status(401).json({ error: "Permission revoked" });
      }
    }
  } catch (err) {
    console.error("[AUTH] re-verify error:", err);
    // Discord API ล้มเหลวชั่วคราว — ให้ผ่านไปก่อน
  }

  req.session = session;
  next();
}

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const PORT = process.env.PORT || 3000;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

// ── ACCESS DENIED PAGE ──
app.get("/access-denied", (req, res) => {
  res.send(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Access Denied</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;700;800&family=Syne:wght@800&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#050507;font-family:'Noto Sans Thai',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{background:#0d0d12;border:1px solid #1e1e2a;border-radius:20px;padding:52px 44px;text-align:center;max-width:400px;width:90%;position:relative;overflow:hidden}
.box::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,rgba(244,63,94,.6),transparent)}
.icon{font-size:60px;margin-bottom:20px}
h1{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#fff;margin-bottom:10px}
p{font-size:13px;color:#50505e;line-height:1.7;margin-bottom:8px}
.uid{font-size:11px;color:#30303e;font-family:monospace;margin-top:16px;padding:8px 12px;background:#080810;border-radius:8px;border:1px solid #1a1a28}
</style></head><body>
<div class="box">
  <div class="icon">⛔</div>
  <h1>ไม่มีสิทธิ์เข้าถึง</h1>
  <p>คุณไม่ได้รับอนุญาตให้เข้าใช้งาน BBT Panel</p>
  <p style="color:#30303e">กรุณาติดต่อเจ้าของเซิร์ฟเวอร์หากคิดว่านี่เป็นข้อผิดพลาด</p>
</div></body></html>`);
});

app.get("/auth/login", (req, res) => {
  // ถ้ากำหนด ADMIN_USER_IDS ไว้ใน env ต้องตรวจ state token ก่อน
  // แต่เราไม่รู้ userId ก่อน OAuth — ให้ผ่านไปก่อน แล้วตรวจที่ callback
  const params = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: "identify guilds" });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect("/?error=no_code");
  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect("/?error=token_failed");

    const user = await (await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${tokenData.access_token}` } })).json();

    // ตรวจ whitelist — ดูจาก Redis ก่อน ถ้าไม่มีค่อย fallback ไป env
    const redisAllowed = await getAllowedUsers();
    const envAllowed = process.env.ADMIN_USER_IDS ? process.env.ADMIN_USER_IDS.split(",").map(s => s.trim()) : [];
    const ownerIdOnly = process.env.OWNER_ID ? [process.env.OWNER_ID] : [];
    // priority: Redis list → env ADMIN_USER_IDS → OWNER_ID only
    // ไม่มีรายการใดเลย = อนุญาตเฉพาะ OWNER_ID ไม่เปิดให้ทุกคน
    const allowedIds = (redisAllowed && redisAllowed.length > 0)
      ? redisAllowed
      : (envAllowed.length > 0 ? envAllowed : ownerIdOnly);
    if (allowedIds.length > 0 && !allowedIds.includes(user.id)) {
      return res.redirect("/access-denied");
    }

    const guilds = await (await fetch("https://discord.com/api/users/@me/guilds", { headers: { Authorization: `Bearer ${tokenData.access_token}` } })).json();

    const adminGuilds = guilds.filter((g) => (BigInt(g.permissions) & BigInt(0x8)) !== BigInt(0));
    const botGuildIds = [...client.guilds.cache.keys()];
    const matchedGuild = adminGuilds.find((g) => botGuildIds.includes(g.id));
    if (!matchedGuild) return res.redirect("/?error=not_admin");

    const token = await createSession({ userId: user.id, username: user.username, avatar: user.avatar, guildId: matchedGuild.id, guildName: matchedGuild.name });
    res.cookie("session_token", token, { httpOnly: false, maxAge: 1000 * 60 * 60 * 24 * 30, sameSite: "lax", secure: true });
    res.redirect("/index.html?token=" + token);
  } catch (err) {
    console.error("OAuth error:", err);
    res.redirect("/?error=oauth_error");
  }
});

app.get("/auth/logout", async (req, res) => {
  if (req.query.token) await deleteSession(req.query.token);
  res.clearCookie("session_token", { path: "/" });
  res.redirect("/");
});

app.get("/api/status", requireAuth, (req, res) => {
  res.json({ online: client.isReady(), tag: client.user?.tag || "Offline", guilds: client.guilds?.cache?.size || 0, user: req.session });
});

// ── WHOAMI (debug: ดู userId ของตัวเอง vs OWNER_ID) ──
app.get("/api/whoami", requireAuth, (req, res) => {
  const ownerEnv = process.env.OWNER_ID || process.env.ADMIN_USER_IDS?.split(",")[0]?.trim() || "";
  res.json({
    userId: req.session.userId,
    username: req.session.username,
    isOwner: req.session.userId === ownerEnv,
    ownerIdConfigured: ownerEnv ? ownerEnv.substring(0, 6) + "..." : "(ไม่ได้ตั้งค่า)",
  });
});

// ── ALLOWED USERS API (owner only) ──
app.get("/api/allowed-users", requireAuth, async (req, res) => {
  if (!isOwner(req.session.userId)) return res.status(403).json({ error: "Owner only" });
  let redisAllowed = await getAllowedUsers();
  const envAllowed = process.env.ADMIN_USER_IDS ? process.env.ADMIN_USER_IDS.split(",").map(s => s.trim()) : [];
  const ownerId = process.env.OWNER_ID || envAllowed[0] || "";
  // ถ้า Redis ว่าง ให้ auto-init ด้วย owner + env list แล้ว save ทันที
  if (!redisAllowed || redisAllowed.length === 0) {
    const initList = [...new Set([ownerId, ...envAllowed].filter(Boolean))];
    if (initList.length > 0) {
      await saveAllowedUsers(initList);
      redisAllowed = initList;
    }
  }
  const users = redisAllowed || envAllowed;
  res.json({ users, isOwner: true, ownerId });
});

app.post("/api/allowed-users", requireAuth, async (req, res) => {
  if (!isOwner(req.session.userId)) return res.status(403).json({ error: "Owner only" });
  const { users } = req.body; // array of { id, label }
  if (!Array.isArray(users)) return res.status(400).json({ error: "Invalid" });
  // owner ต้องอยู่ใน list เสมอ
  const ownerId = process.env.OWNER_ID || process.env.ADMIN_USER_IDS?.split(",")[0]?.trim();
  const ids = users.map(u => typeof u === "string" ? u : u.id).filter(Boolean);
  if (ownerId && !ids.includes(ownerId)) ids.unshift(ownerId);
  await saveAllowedUsers(ids);
  res.json({ ok: true, users: ids });
});
app.get("/api/config", requireAuth, (req, res) => {
  try { res.json(loadConfig()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/config", requireAuth, (req, res) => {
  try { saveConfig(req.body); res.json({ ok: true }); } catch (e) { res.json({ ok: false, error: e.message }); }
});
app.get("/api/roles", requireAuth, (req, res) => {
  const guild = client.guilds.cache.get(req.session.guildId);
  if (!guild) return res.json({ roles: [] });
  const roles = guild.roles.cache
    .filter((r) => r.name !== "@everyone" && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color, isAdmin: (BigInt(r.permissions.bitfield) & BigInt(0x8)) !== BigInt(0) }));
  res.json({ roles });
});
app.get("/api/channels", requireAuth, (req, res) => {
  const guild = client.guilds.cache.get(req.session.guildId);
  if (!guild) return res.json({ channels: [] });
  const channels = guild.channels.cache
    .filter((c) => c.type === 0) // text channels only
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({ id: c.id, name: c.name }));
  res.json({ channels });
});
app.post("/api/upload", requireAuth, upload.single("image"), (req, res) => {
  if (!req.file) return res.json({ ok: false, error: "No file" });
  res.json({ ok: true, url: `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}` });
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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.GuildMember],
});

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
function formatMsg(template, member) { return template.replace(/\{user\}/g, `${member}`); }
function resolveButtonStyle(color = "Primary") {
  const map = { Primary: ButtonStyle.Primary, primary: ButtonStyle.Primary, Secondary: ButtonStyle.Secondary, secondary: ButtonStyle.Secondary, Success: ButtonStyle.Success, success: ButtonStyle.Success, Danger: ButtonStyle.Danger, danger: ButtonStyle.Danger };
  return map[color] ?? ButtonStyle.Primary;
}
function hexToInt(hex) { return parseInt((hex || "#ff6eb4").replace("#", ""), 16); }

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
    new SlashCommandBuilder().setName("setup").setDescription("ส่ง Verify embed ในห้องนี้").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("dashboard").setDescription("รับลิงก์เข้า Dashboard (Admin เท่านั้น)").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ].map((c) => c.toJSON());
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
    console.log("✅ Slash commands registered");
  } catch (err) { console.error("❌ Failed to register commands:", err); }
}

client.once("clientReady", async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await registerCommands();
});

client.on("guildMemberAdd", async (member) => {
  try {
    const cfg = loadConfig();
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
      new ButtonBuilder().setCustomId("open_verify_modal").setLabel(cfg.VERIFY_BUTTON_LABEL || "✅ ยืนยันตัวตน").setStyle(resolveButtonStyle(cfg.VERIFY_BUTTON_COLOR))
    );
    await ch.send({ embeds: [embed], components: [btn] });
  } catch (err) { console.error("❌ guildMemberAdd:", err); }
});

client.on("guildMemberRemove", async (member) => {
  try {
    const cfg = loadConfig();
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
  const cfg = loadConfig();

  // /setup
  if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const embed = new EmbedBuilder()
        .setColor(hexToInt(cfg.VERIFY_EMBED_COLOR))
        .setTitle(cfg.VERIFY_EMBED_TITLE || "🌸 ยืนยันตัวตน")
        .setDescription(cfg.VERIFY_EMBED_DESC || "กดปุ่มด้านล่างเพื่อกรอกข้อมูลและรับยศของคุณ!");
      if (cfg.VERIFY_THUMBNAIL === "[server]" && interaction.guild.iconURL()) embed.setThumbnail(interaction.guild.iconURL());
      else if (cfg.VERIFY_THUMBNAIL && cfg.VERIFY_THUMBNAIL !== "[user]") embed.setThumbnail(cfg.VERIFY_THUMBNAIL);
      if (cfg.VERIFY_IMAGE) embed.setImage(cfg.VERIFY_IMAGE);
      const btn = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("open_verify_modal").setLabel(cfg.VERIFY_BUTTON_LABEL || "✅ ยืนยันตัวตน").setStyle(resolveButtonStyle(cfg.VERIFY_BUTTON_COLOR))
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
    const dashUrl = (process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`).replace("/auth/callback", "/auth/login");
    await interaction.editReply({ content: `🔗 **Dashboard**\n${dashUrl}` });
    return;
  }

  // Button: เปิด modal
  if (interaction.isButton() && interaction.customId === "open_verify_modal") {
    const modal = new ModalBuilder().setCustomId("verify_modal").setTitle("📋 กรอกข้อมูลของคุณ");
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("name").setLabel("ชื่อที่ใช้เรียก").setStyle(TextInputStyle.Short).setPlaceholder("เช่น ไอซ์, Korn").setRequired(true).setMaxLength(32)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("age").setLabel("อายุ").setStyle(TextInputStyle.Short).setPlaceholder("เช่น 18").setRequired(true).setMaxLength(3)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("gender").setLabel("เพศ").setStyle(TextInputStyle.Short).setPlaceholder("ชาย / หญิง / ไม่ระบุ").setRequired(true).setMaxLength(10))
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

    // สร้าง embed แสดงหมวดหมู่
    const catList = categories.map((c) => `**${c.name}**\n${(c.roles||[]).map((r) => `${r.emoji || "•"} ${r.label}`).join("  ")}`).join("\n\n");
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

  // Button: confirm
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
    if (!memberRole && cfg.MEMBER_ROLE_NAME) memberRole = guild.roles.cache.find((r) => r.name === cfg.MEMBER_ROLE_NAME);
    if (memberRole) rolesToAdd.push(memberRole);

    const addedRoleNames = [];
    for (const key of (pending.selectedRoles || [])) {
      const [catId, roleId] = key.split(":");
      const cat = (cfg.ROLE_CATEGORIES || []).find((c) => c.id === catId);
      const roleInfo = (cat?.roles || []).find((r) => r.id === roleId);
      if (!roleInfo) continue;
      let dr = roleInfo.roleId ? guild.roles.cache.get(roleInfo.roleId) : guild.roles.cache.find((r) => r.name === (roleInfo.roleName || roleInfo.label));
      if (!dr) {
        dr = await guild.roles.create({ name: roleInfo.roleName || roleInfo.label, color: hexToInt(roleInfo.color), reason: "Auto-created by verify bot" });
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

client.login(process.env.DISCORD_TOKEN);
