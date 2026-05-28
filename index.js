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

require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember],
});

// ============================================================
// ⚙️  CONFIG — แก้ตรงนี้ให้ตรงกับ server ของคุณ
// ============================================================
const CONFIG = {
  VERIFY_CHANNEL_NAME: "verify",         // ชื่อห้องสำหรับ verify
  WELCOME_CHANNEL_NAME: "welcome",       // ชื่อห้อง welcome
  MEMBER_ROLE_NAME: "Member",            // ยศหลัก (ได้ทุกคนหลัง verify)

  // ยศเกม — ชื่อต้องตรงกับ Role ใน Discord server ของคุณ
  GAME_ROLES: {
    minecraft: "Minecraft",
    valorant: "Valorant",
    lol: "League of Legends",
    roblox: "Roblox",
    other: "Other Games",
  },
};
// ============================================================

// เก็บข้อมูลชั่วคราว (ชื่อ+อายุ+เพศ) ก่อนเลือกเกม
const pendingData = new Map();

// ─── บอทพร้อมทำงาน ───────────────────────────────────────────
client.once("clientReady", () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
});

// ─── สมาชิกใหม่เข้า server ──────────────────────────────────
client.on("guildMemberAdd", async (member) => {
  const verifyChannel = member.guild.channels.cache.find(
    (c) => c.name === CONFIG.VERIFY_CHANNEL_NAME
  );
  if (!verifyChannel) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("👋 ยินดีต้อนรับ!")
    .setDescription(
      `สวัสดี ${member}!\nกดปุ่มด้านล่างเพื่อยืนยันตัวตนและเข้าถึงห้องทั้งหมด`
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: "กรอกข้อมูลให้ครบเพื่อรับยศ" });

  const button = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("open_verify_modal")
      .setLabel("✅ ยืนยันตัวตน")
      .setStyle(ButtonStyle.Primary)
  );

  await verifyChannel.send({ embeds: [embed], components: [button] });
});

// ─── ส่ง verify embed ด้วยคำสั่ง !setup (Admin เท่านั้น) ────
client.on("messageCreate", async (message) => {
  if (message.content !== "!setup") return;
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎮 ยืนยันตัวตน")
    .setDescription("กดปุ่มด้านล่างเพื่อกรอกข้อมูลและรับยศของคุณ!");

  const button = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("open_verify_modal")
      .setLabel("✅ ยืนยันตัวตน")
      .setStyle(ButtonStyle.Primary)
  );

  await message.channel.send({ embeds: [embed], components: [button] });
  await message.delete().catch(() => {});
});

// ─── กดปุ่ม ─────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {

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
      .setLabel("เกมที่เล่น (กรอกก่อน แล้วเลือกยศด้านล่าง)")
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

  // 2) รับ Modal → แสดง dropdown เลือกยศเกม
  if (interaction.isModalSubmit() && interaction.customId === "verify_modal") {
    const name = interaction.fields.getTextInputValue("name");
    const age = interaction.fields.getTextInputValue("age");
    const gender = interaction.fields.getTextInputValue("gender");
    const gameText = interaction.fields.getTextInputValue("game_text");

    // เก็บข้อมูลไว้ก่อน
    pendingData.set(interaction.user.id, { name, age, gender, gameText });

    const select = new StringSelectMenuBuilder()
      .setCustomId("select_game_role")
      .setPlaceholder("🎮 เลือกเกมที่คุณเล่นหลัก")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("⛏️ Minecraft")
          .setValue("minecraft"),
        new StringSelectMenuOptionBuilder()
          .setLabel("🔫 Valorant")
          .setValue("valorant"),
        new StringSelectMenuOptionBuilder()
          .setLabel("🧙 League of Legends")
          .setValue("lol"),
        new StringSelectMenuOptionBuilder()
          .setLabel("🟥 Roblox")
          .setValue("roblox"),
        new StringSelectMenuOptionBuilder()
          .setLabel("🎮 เกมอื่นๆ")
          .setValue("other")
      );

    const row = new ActionRowBuilder().addComponents(select);

    await interaction.reply({
      content: `✅ ได้รับข้อมูลแล้ว! เลือกยศเกมของคุณด้านล่าง:`,
      components: [row],
      ephemeral: true,
    });
    return;
  }

  // 3) เลือกยศเกม → ให้ยศ + welcome
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "select_game_role"
  ) {
    const member = interaction.member;
    const guild = interaction.guild;
    const selectedGame = interaction.values[0];
    const data = pendingData.get(interaction.user.id) || {};

    // หา/สร้าง Member role
    let memberRole = guild.roles.cache.find(
      (r) => r.name === CONFIG.MEMBER_ROLE_NAME
    );
    if (!memberRole) {
      memberRole = await guild.roles.create({
        name: CONFIG.MEMBER_ROLE_NAME,
        color: 0x57f287,
        reason: "Auto-created by verify bot",
      });
    }

    // หา/สร้าง Game role
    const gameRoleName = CONFIG.GAME_ROLES[selectedGame];
    let gameRole = guild.roles.cache.find((r) => r.name === gameRoleName);
    if (!gameRole) {
      gameRole = await guild.roles.create({
        name: gameRoleName,
        reason: "Auto-created by verify bot",
      });
    }

    // ให้ยศ
    await member.roles.add([memberRole, gameRole]).catch(console.error);

    // ลบข้อมูลชั่วคราว
    pendingData.delete(interaction.user.id);

    // ยืนยันกับ user
    const gameEmoji = {
      minecraft: "⛏️",
      valorant: "🔫",
      lol: "🧙",
      roblox: "🟥",
      other: "🎮",
    };

    await interaction.update({
      content: `🎉 ยินดีต้อนรับ **${data.name}**! คุณได้รับยศ **${gameRoleName}** แล้ว`,
      components: [],
    });

    // ส่งข้อความ welcome
    const welcomeChannel = guild.channels.cache.find(
      (c) => c.name === CONFIG.WELCOME_CHANNEL_NAME
    );
    if (welcomeChannel) {
      const welcomeEmbed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`${gameEmoji[selectedGame]} สมาชิกใหม่มาถึงแล้ว!`)
        .setDescription(`ยินดีต้อนรับ ${member} เข้าสู่เซิร์ฟเวอร์! 🎊`)
        .addFields(
          { name: "ชื่อ", value: data.name || "-", inline: true },
          { name: "อายุ", value: data.age || "-", inline: true },
          { name: "เพศ", value: data.gender || "-", inline: true },
          { name: "เกม", value: gameRoleName, inline: true }
        )
        .setThumbnail(interaction.user.displayAvatarURL())
        .setTimestamp();

      await welcomeChannel.send({ embeds: [welcomeEmbed] });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
