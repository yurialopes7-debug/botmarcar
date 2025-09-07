const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage } = require("@whiskeysockets/baileys");
const express = require("express");
const qrcode = require("qrcode-terminal");
const sharp = require("sharp");

const app = express();
const PORT = process.env.PORT || 3000;

let x1List = [];
const ownerNumber = "553196929183@s.whatsapp.net"; // dono fixo
let botLigado = true;

const welcomeGroupId = "120363419876804601@g.us"; // grupo de boas-vindas fixo

app.get("/", (req, res) => {
  res.send("🤖 Bot está online!");
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor rodando na porta ${PORT}`);
});

async function connectBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const sock = makeWASocket({ auth: state });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log("📱 Escaneie o QR Code:");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("❌ Conexão encerrada. Reconectando?", shouldReconnect);
      if (shouldReconnect) connectBot();
    } else if (connection === "open") {
      console.log("✅ Bot conectado!");
    }
  });

  // Mensagens de boas-vindas
  sock.ev.on("group-participants.update", async (update) => {
    try {
      if (update.id === welcomeGroupId && update.action === "add") {
        for (const participant of update.participants) {
          const message = `Seja bem vindo @${participant.split("@")[0]}, leia as regras e manda pedido pra guilda, id da guilda na desc`;
          await sock.sendMessage(welcomeGroupId, {
            text: message,
            mentions: [participant]
          });
        }
      }
    } catch (err) {
      console.error("Erro ao enviar mensagem de boas-vindas:", err);
    }
  });

  // Tratamento de mensagens
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    // Ignora mensagens antigas (>60s)
    const messageTimestamp = (msg.messageTimestamp || 0) * 1000;
    const now = Date.now();
    if (now - messageTimestamp > 60000) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.participant || from;
    let text = "";
    if (msg.message.conversation) text = msg.message.conversation;
    else if (msg.message.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
    else if (msg.message.imageMessage?.caption) text = msg.message.imageMessage.caption;
    else if (msg.message.videoMessage?.caption) text = msg.message.videoMessage.caption;
    text = text.trim();

    // Se bot desligado, ignora (menos comandos do dono)
    if (!botLigado && sender !== ownerNumber && !["!ligar"].includes(text.toLowerCase())) return;

    // ---------------- Menus ----------------
    if (text.toLowerCase() === "!menu") {
      await sock.sendMessage(from, { text: "📌 *Menu Normal*\n\n👉 !s\n👉 !ship @pessoa1 @pessoa2\n" });
    }

    if (text.toLowerCase() === "!menux1") {
      await sock.sendMessage(from, { text: "🎮 *Menu X1*\n\n👉 !participardox1\n👉 !sairx1\n👉 !listax1\n👉 !deletelista\n👉 !sortearx1\n👉 !del <número>\n👉 !marcarx1" });
    }

    // ---------------- Ship ----------------
    if (text.toLowerCase().startsWith("!ship")) {
      const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
      if (mentions.length >= 2) {
        const shipPercentage = Math.floor(Math.random() * 101);
        const response = `💘 Ship entre *@${mentions[0].split("@")[0]}* e *@${mentions[1].split("@")[0]}* é de *${shipPercentage}%*!`;
        await sock.sendMessage(from, { text: response, mentions });
      } else {
        await sock.sendMessage(from, { text: "⚠️ Use: !ship @pessoa1 @pessoa2" });
      }
    }

    // ---------------- X1 ----------------
    if (text.toLowerCase() === "!participardox1") {
      if (!x1List.includes(sender)) {
        x1List.push(sender);
        await sock.sendMessage(from, { text: `✅ *@${sender.split("@")[0]}* entrou na lista do X1!`, mentions: [sender] });
      } else {
        await sock.sendMessage(from, { text: `⚠️ *@${sender.split("@")[0]}* já está na lista!`, mentions: [sender] });
      }
    }

    if (text.toLowerCase() === "!sairx1") {
      if (x1List.includes(sender)) {
        x1List = x1List.filter(p => p !== sender);
        await sock.sendMessage(from, { text: `🚪 *@${sender.split("@")[0]}* saiu da lista do X1!`, mentions: [sender] });
      } else {
        await sock.sendMessage(from, { text: `⚠️ *@${sender.split("@")[0]}* não está na lista!`, mentions: [sender] });
      }
    }

    if (text.toLowerCase() === "!listax1") {
      if (x1List.length === 0) {
        await sock.sendMessage(from, { text: "📋 A lista de X1 está vazia!" });
      } else {
        const listText = x1List.map((p, i) => `${i + 1}. @${p.split("@")[0]}`).join("\n");
        await sock.sendMessage(from, { text: `📋 *Lista de Participantes do X1:*\n\n${listText}`, mentions: x1List });
      }
    }

    if (text.toLowerCase() === "!deletelista") {
      if (sender === ownerNumber) {
        x1List = [];
        await sock.sendMessage(from, { text: "🗑️ A lista de X1 foi deletada pelo dono!" });
      } else {
        await sock.sendMessage(from, { text: "❌ Apenas o dono pode usar esse comando!" });
      }
    }

    if (text.toLowerCase() === "!sortearx1") {
      if (x1List.length < 2) {
        await sock.sendMessage(from, { text: "⚠️ Não há participantes suficientes para sortear." });
      } else {
        const shuffled = [...x1List].sort(() => Math.random() - 0.5);
        let result = "🎲 *Sorteio de X1:*\n\n";
        for (let i = 0; i < shuffled.length; i += 2) {
          if (shuffled[i + 1]) {
            result += `👉 @${shuffled[i].split("@")[0]} vs @${shuffled[i + 1].split("@")[0]}\n`;
          } else {
            result += `👉 @${shuffled[i].split("@")[0]} ficou sem adversário.\n`;
          }
        }
        await sock.sendMessage(from, { text: result, mentions: shuffled });
      }
    }

    if (text.toLowerCase().startsWith("!del ")) {
      const num = parseInt(text.split(" ")[1]);
      if (!isNaN(num) && num > 0 && num <= x1List.length) {
        const removed = x1List.splice(num - 1, 1)[0];
        await sock.sendMessage(from, { text: `🗑️ *@${removed.split("@")[0]}* foi removido da lista.`, mentions: [removed] });
      }
    }

    if (text.toLowerCase() === "!marcarx1") {
      if (x1List.length === 0) {
        await sock.sendMessage(from, { text: "⚠️ A lista de X1 está vazia." });
      } else {
        await sock.sendMessage(from, { text: "🔔 Chamada geral da lista de X1!", mentions: x1List });
      }
    }

    // ---------------- Sticker ----------------
    if (text.toLowerCase() === "!s") {
      try {
        let mediaMessage;
        let mediaKey = msg.key;

        if (msg.message.extendedTextMessage?.contextInfo?.quotedMessage) {
          mediaMessage = msg.message.extendedTextMessage.contextInfo.quotedMessage;
          mediaKey = {
            remoteJid: msg.key.remoteJid,
            id: msg.message.extendedTextMessage.contextInfo.stanzaId,
            fromMe: false,
            participant: msg.message.extendedTextMessage.contextInfo.participant || msg.key.participant
          };
        } else {
          mediaMessage = msg.message;
        }

        if (!mediaMessage.imageMessage && !mediaMessage.videoMessage) {
          await sock.sendMessage(from, { text: "❌ Responda uma imagem ou vídeo com !s ou envie uma imagem com legenda !s." }, { quoted: msg });
          return;
        }

        const buffer = await downloadMediaMessage({ message: mediaMessage, key: mediaKey }, "buffer");
        const metadata = await sharp(buffer).metadata();
        const size = Math.min(metadata.width, metadata.height);

        const webpBuffer = await sharp(buffer)
          .extract({ left: Math.floor((metadata.width - size) / 2), top: Math.floor((metadata.height - size) / 2), width: size, height: size })
          .resize(512, 512)
          .webp()
          .toBuffer();

        await sock.sendMessage(from, { sticker: webpBuffer, mimetype: "image/webp" }, { quoted: msg });
      } catch (err) {
        console.error("Erro ao criar figurinha:", err);
        await sock.sendMessage(from, { text: "❌ Erro ao criar a figurinha." }, { quoted: msg });
      }
    }

    // ---------------- Marcar todos ----------------
    if (from.endsWith("@g.us") && text.startsWith("!marcar")) {
      const metadata = await sock.groupMetadata(from);
      const senderMeta = metadata.participants.find(p => p.id === sender);
      const isAdmin = senderMeta?.admin === "admin" || senderMeta?.admin === "superadmin";
      if (!isAdmin) {
        await sock.sendMessage(from, { text: "❌ Apenas administradores podem usar este comando." }, { quoted: msg });
        return;
      }

      const participants = metadata.participants.map(p => p.id);

      // Se for resposta a uma mensagem
      if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quoted = msg.message.extendedTextMessage.contextInfo;
        await sock.sendMessage(from, {
          forward: quoted.stanzaId ? { key: { remoteJid: from, id: quoted.stanzaId, fromMe: false }, message: quoted.quotedMessage } : quoted.quotedMessage,
          mentions: participants
        }, { quoted: msg });
      } else {
        // Texto simples
        const extraText = text.replace("!marcar", "").trim() || "🔔 Marcação geral";
        await sock.sendMessage(from, { text: extraText, mentions: participants }, { quoted: msg });
      }
    }

    // ---------------- Ligar / Desligar ----------------
    if (text.toLowerCase() === "!desligar" && sender === ownerNumber) {
      botLigado = false;
      await sock.sendMessage(from, { text: "🛑 Bot desligado!" });
    }

    if (text.toLowerCase() === "!ligar" && sender === ownerNumber) {
      botLigado = true;
      await sock.sendMessage(from, { text: "✅ Bot ligado!" });
    }
  });
}

connectBot();
