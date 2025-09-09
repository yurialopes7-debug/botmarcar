// index.js
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage } = require("@whiskeysockets/baileys");
const express = require("express");
const qrcode = require("qrcode-terminal");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const ytdl = require("@distube/ytdl-core");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------- Configurações ----------------
const ownerNumber = "553196929183@s.whatsapp.net"; // dono fixo
const welcomeGroupId = "120363419876804601@g.us"; // grupo de boas-vindas fixo
let botLigado = true;
let msgCount = {};

// ---------------- Persistência do X1 ----------------
const x1File = path.join(__dirname, "x1.json");

function loadX1List() {
  try {
    if (fs.existsSync(x1File)) {
      return JSON.parse(fs.readFileSync(x1File, "utf8"));
    }
    return [];
  } catch (err) {
    console.error("Erro ao carregar x1.json:", err);
    return [];
  }
}

function saveX1List() {
  try {
    fs.writeFileSync(x1File, JSON.stringify(x1List, null, 2), "utf8");
  } catch (err) {
    console.error("Erro ao salvar x1.json:", err);
  }
}

let x1List = loadX1List();

// ---------------- Servidor ----------------
app.get("/", (req, res) => {
  res.send("🤖 Bot está online!");
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor rodando na porta ${PORT}`);
});

// ---------------- Helpers ----------------
async function isAdminInGroup(sock, groupJid, userJid) {
  const metadata = await sock.groupMetadata(groupJid);
  return metadata.participants
    .filter((p) => ["admin", "superadmin"].includes(p.admin))
    .map((p) => p.id)
    .includes(userJid);
}

function getTextFromMsg(msg) {
  if (msg.message?.conversation) return msg.message.conversation;
  if (msg.message?.extendedTextMessage?.text) return msg.message.extendedTextMessage.text;
  if (msg.message?.imageMessage?.caption) return msg.message.imageMessage.caption;
  if (msg.message?.videoMessage?.caption) return msg.message.videoMessage.caption;
  return "";
}

// ---------------- Bot ----------------
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
      if (shouldReconnect) {
        setTimeout(() => connectBot(), 3000);
      }
    } else if (connection === "open") {
      console.log("✅ Bot conectado!");
    }
  });

  // 📢 Boas-vindas
  sock.ev.on("group-participants.update", async (update) => {
    try {
      if (update.id === welcomeGroupId && update.action === "add") {
        for (const participant of update.participants) {
          const message = `Seja bem vindo @${participant.split("@")[0]}, leia as regras e manda pedido pra guilda, id da guilda na desc`;
          await sock.sendMessage(welcomeGroupId, {
            text: message,
            mentions: [participant],
          });
        }
      }
    } catch (err) {
      console.error("Erro ao enviar mensagem de boas-vindas:", err);
    }
  });

  // 📥 Mensagens
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message) return;

    // ignora mensagens antigas (> 60s)
    const messageTimestamp = (msg.messageTimestamp || 0) * 1000;
    if (Date.now() - messageTimestamp > 60000) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.participant || from;

    msgCount[sender] = (msgCount[sender] || 0) + 1;

    let text = getTextFromMsg(msg).trim();

    if (!botLigado && sender !== ownerNumber && text.toLowerCase() !== "!ligar") return;

    // ---------------- Menus ----------------
    if (text.toLowerCase() === "!menu") {
      await sock.sendMessage(from, {
        text:
          "📌 *Menu Normal*\n\n" +
          "👉 !s\n" +
          "👉 !ship @pessoa1 @pessoa2\n" +
          "👉 !idgrupo\n" +
          "👉 !marcar\n" +
          "👉 !ppt @pessoa\n" +
          "👉 !top5\n" +
          "👉 !youtube <link> (PV)\n" +
          "👉 !piada\n" +
          "👉 !curiosidade\n" +
          "👉 !maisgado\n" +
          "👉 !maiscorno\n" +
          "👉 !rankgado\n" +
          "👉 !rankcorno\n" +
          "👉 !rankbonito\n" +
          "👉 !rankfeio\n" +
          "👉 !fechargp (ADM)\n" +
          "👉 !abrirgp (ADM)\n\n" +
          "🎮 *Menu X1*\n" +
          "👉 !menux1",
      });
    }

    if (text.toLowerCase() === "!menux1") {
      await sock.sendMessage(from, {
        text:
          "🎮 *Menu X1*\n\n" +
          "👉 !participardox1\n" +
          "👉 !sairx1\n" +
          "👉 !listax1\n" +
          "👉 !deletelista (ADM)\n" +
          "👉 !sortearx1 (ADM)\n" +
          "👉 !del <número>\n" +
          "👉 !marcarx1",
      });
    }

    // ---------------- Sticker (!s) ----------------
    if (text.toLowerCase() === "!s") {
      try {
        let mediaMessage;
        let mediaKey = msg.key;

        // Se for resposta a outra mensagem com mídia
        if (msg.message.extendedTextMessage?.contextInfo?.quotedMessage) {
          mediaMessage = msg.message.extendedTextMessage.contextInfo.quotedMessage;
          mediaKey = {
            remoteJid: msg.key.remoteJid,
            id: msg.message.extendedTextMessage.contextInfo.stanzaId,
            fromMe: false,
            participant:
              msg.message.extendedTextMessage.contextInfo.participant || msg.key.participant,
          };
        } else {
          mediaMessage = msg.message;
        }

        if (!mediaMessage.imageMessage && !mediaMessage.videoMessage) {
          await sock.sendMessage(
            from,
            { text: "❌ Responda uma imagem/vídeo com !s ou envie uma imagem com legenda !s." },
            { quoted: msg }
          );
          return;
        }

        // IMAGEM -> webp 512x512 com crop quadrado
        if (mediaMessage.imageMessage) {
          const buffer = await downloadMediaMessage(
            { key: mediaKey, message: mediaMessage },
            "buffer"
          );
          const metadata = await sharp(buffer).metadata();
          const size = Math.min(metadata.width, metadata.height);

          const webpBuffer = await sharp(buffer)
            .extract({
              left: Math.floor((metadata.width - size) / 2),
              top: Math.floor((metadata.height - size) / 2),
              width: size,
              height: size,
            })
            .resize(512, 512)
            .webp()
            .toBuffer();

          await sock.sendMessage(from, { sticker: webpBuffer, mimetype: "image/webp" }, { quoted: msg });
        }

        // VÍDEO -> webp 512x512, crop quadrado, até 6s, 15fps
        if (mediaMessage.videoMessage) {
          const buffer = await downloadMediaMessage(
            { key: mediaKey, message: mediaMessage },
            "buffer"
          );
          const inputPath = path.join(__dirname, "input.mp4");
          const outputPath = path.join(__dirname, "output.webp");
          fs.writeFileSync(inputPath, buffer);

          // pega dimensão do vídeo
          exec(
            `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${inputPath}"`,
            (err, stdout) => {
              if (err) {
                console.error("Erro no ffprobe:", err);
                return sock.sendMessage(from, { text: "❌ Erro ao analisar o vídeo." }, { quoted: msg });
              }

              const [width, height] = stdout.trim().split("x").map(Number);
              const size = Math.min(width, height);

              // recorta e gera figurinha
              exec(
                `ffmpeg -i "${inputPath}" -vf "crop=${size}:${size},scale=512:512,fps=15" -t 6 -an -c:v libwebp -preset picture -q:v 50 -loop 0 "${outputPath}"`,
                async (err2) => {
                  if (err2) {
                    console.error("Erro ao converter vídeo:", err2);
                    await sock.sendMessage(from, { text: "❌ Erro ao criar figurinha de vídeo." }, { quoted: msg });
                    try { fs.unlinkSync(inputPath); } catch {}
                    try { fs.unlinkSync(outputPath); } catch {}
                    return;
                  }
                  const webpBuffer = fs.readFileSync(outputPath);
                  await sock.sendMessage(from, { sticker: webpBuffer, mimetype: "image/webp" }, { quoted: msg });
                  try { fs.unlinkSync(inputPath); } catch {}
                  try { fs.unlinkSync(outputPath); } catch {}
                }
              );
            }
          );
        }
      } catch (err) {
        console.error("Erro ao criar figurinha:", err);
        await sock.sendMessage(from, { text: "❌ Erro ao criar a figurinha." }, { quoted: msg });
      }
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

    // ---------------- ID do Grupo ----------------
    if (text.toLowerCase() === "!idgrupo") {
      if (from.endsWith("@g.us")) {
        await sock.sendMessage(from, { text: `🆔 ID do grupo: ${from}` }, { quoted: msg });
      } else {
        await sock.sendMessage(from, { text: "❌ Esse comando só funciona em grupos." }, { quoted: msg });
      }
    }

    // ---------------- Marcar Todos ----------------
    if (text.toLowerCase() === "!marcar") {
      if (from.endsWith("@g.us")) {
        const metadata = await sock.groupMetadata(from);
        const mentions = metadata.participants.map((p) => p.id);
        await sock.sendMessage(
          from,
          { text: "📢 Marcando todos:\n" + mentions.map((m) => `@${m.split("@")[0]}`).join(" "), mentions },
          { quoted: msg }
        );
      }
    }

    // ---------------- Pedra, Papel e Tesoura ----------------
    if (text.toLowerCase().startsWith("!ppt")) {
      const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
      if (mentions.length === 0) {
        await sock.sendMessage(from, { text: "⚠️ Use: !ppt @pessoa" }, { quoted: msg });
      } else {
        const choices = ["Pedra ✊", "Papel ✋", "Tesoura ✌️"];
        const playerChoice = choices[Math.floor(Math.random() * choices.length)];
        const opponentChoice = choices[Math.floor(Math.random() * choices.length)];

        let result;
        if (playerChoice === opponentChoice) {
          result = "🤝 Deu empate!";
        } else if (
          (playerChoice.includes("Pedra") && opponentChoice.includes("Tesoura")) ||
          (playerChoice.includes("Tesoura") && opponentChoice.includes("Papel")) ||
          (playerChoice.includes("Papel") && opponentChoice.includes("Pedra"))
        ) {
          result = `🏆 *@${sender.split("@")[0]}* venceu!`;
        } else {
          result = `🏆 *@${mentions[0].split("@")[0]}* venceu!`;
        }

        await sock.sendMessage(
          from,
          {
            text: `🎮 *Pedra, Papel e Tesoura*\n\n@${sender.split("@")[0]} escolheu: ${playerChoice}\n@${mentions[0].split("@")[0]} escolheu: ${opponentChoice}\n\n${result}`,
            mentions: [sender, mentions[0]],
          },
          { quoted: msg }
        );
      }
    }

    // ---------------- Top 5 ----------------
    if (text.toLowerCase() === "!top5") {
      if (!from.endsWith("@g.us")) {
        await sock.sendMessage(from, { text: "❌ Este comando só funciona em grupos." }, { quoted: msg });
      } else {
        const metadata = await sock.groupMetadata(from);
        const groupMembers = metadata.participants.map((p) => p.id);

        const filtered = Object.entries(msgCount).filter(([user]) => groupMembers.includes(user));
        const sorted = filtered.sort((a, b) => b[1] - a[1]).slice(0, 5);

        if (sorted.length === 0) {
          await sock.sendMessage(from, { text: "📊 Ainda não há registros suficientes." }, { quoted: msg });
        } else {
          let rankText = "🏆 *Top 5 mais ativos do grupo:*\n\n";
          sorted.forEach(([user, count], i) => {
            rankText += `${i + 1}. @${user.split("@")[0]} - ${count} mensagens\n`;
          });
          await sock.sendMessage(from, { text: rankText, mentions: sorted.map((u) => u[0]) }, { quoted: msg });
        }
      }
    }

    // ---------------- YouTube (PV) ----------------
    if (text.toLowerCase().startsWith("!youtube")) {
      if (from.endsWith("@g.us")) {
        await sock.sendMessage(from, { text: "❌ Este comando só funciona no PV." }, { quoted: msg });
      } else {
        const args = text.split(" ");
        if (args.length < 2) {
          await sock.sendMessage(from, { text: "⚠️ Use: !youtube <link>" }, { quoted: msg });
        } else {
          const url = args[1];
          if (!ytdl.validateURL(url)) {
            await sock.sendMessage(from, { text: "❌ Link inválido do YouTube." }, { quoted: msg });
          } else {
            try {
              const info = await ytdl.getInfo(url);
              const title = info.videoDetails.title;

              const audioStream = ytdl(url, { filter: "audioonly", quality: "highestaudio" });
              let chunks = [];
              audioStream.on("data", (chunk) => chunks.push(chunk));
              audioStream.on("end", async () => {
                const buffer = Buffer.concat(chunks);
                await sock.sendMessage(
                  from,
                  { audio: buffer, mimetype: "audio/mpeg", fileName: `${title}.mp3` },
                  { quoted: msg }
                );
              });
              audioStream.on("error", async (e) => {
                console.error("Erro stream YouTube:", e);
                await sock.sendMessage(from, { text: "❌ Erro ao baixar o áudio." }, { quoted: msg });
              });
            } catch (err) {
              console.error("Erro no YouTube:", err);
              await sock.sendMessage(from, { text: "❌ Erro ao baixar o áudio." }, { quoted: msg });
            }
          }
        }
      }
    }

    // ---------------- Piadas ----------------
    if (text.toLowerCase() === "!piada") {
      try {
        const piadas = JSON.parse(fs.readFileSync("piadas.json", "utf8"));
        const aleatoria = piadas[Math.floor(Math.random() * piadas.length)];
        await sock.sendMessage(from, { text: `😂 ${aleatoria}` });
      } catch (err) {
        console.error("Erro ao carregar piadas:", err);
        await sock.sendMessage(from, { text: "❌ Não foi possível carregar uma piada." });
      }
    }

    // ---------------- Curiosidades ----------------
    if (text.toLowerCase() === "!curiosidade") {
      try {
        const curiosidades = JSON.parse(fs.readFileSync("curiosidades.json", "utf8"));
        const aleatoria = curiosidades[Math.floor(Math.random() * curiosidades.length)];
        await sock.sendMessage(from, { text: `🤔 ${aleatoria}` });
      } catch (err) {
        console.error("Erro ao carregar curiosidades:", err);
        await sock.sendMessage(from, { text: "❌ Não foi possível carregar uma curiosidade." });
      }
    }

    // ---------------- MAIS GADO ----------------
    if (text.toLowerCase() === "!maisgado") {
      if (from.endsWith("@g.us")) {
        const metadata = await sock.groupMetadata(from);
        const participantes = metadata.participants.map((p) => p.id);
        const escolhido = participantes[Math.floor(Math.random() * participantes.length)];
        const porcentagem = Math.floor(Math.random() * 101);
        await sock.sendMessage(
          from,
          { text: `🐂 O mais gado do grupo hoje é @${escolhido.split("@")[0]} (${porcentagem}% gado)`, mentions: [escolhido] },
          { quoted: msg }
        );
      }
    }

    // ---------------- MAIS CORNO ----------------
    if (text.toLowerCase() === "!maiscorno") {
      if (from.endsWith("@g.us")) {
        const metadata = await sock.groupMetadata(from);
        const participantes = metadata.participants.map((p) => p.id);
        const escolhido = participantes[Math.floor(Math.random() * participantes.length)];
        const porcentagem = Math.floor(Math.random() * 101);
        await sock.sendMessage(
          from,
          { text: `🦌 O mais corno do grupo hoje é @${escolhido.split("@")[0]} (${porcentagem}% corno)`, mentions: [escolhido] },
          { quoted: msg }
        );
      }
    }

    // ---------------- RANK BONITO ----------------
    if (text.toLowerCase() === "!rankbonito") {
      if (from.endsWith("@g.us")) {
        const metadata = await sock.groupMetadata(from);
        const participantes = metadata.participants.map((p) => p.id);
        const embaralhados = [...participantes].sort(() => Math.random() - 0.5);

        let texto = "😎 *Ranking dos mais bonitos:*\n\n";
        embaralhados.forEach((id, i) => {
          texto += `${i + 1}. @${id.split("@")[0]}\n`;
        });

        await sock.sendMessage(from, { text: texto, mentions: participantes }, { quoted: msg });
      }
    }

    // ---------------- RANK FEIO ----------------
    if (text.toLowerCase() === "!rankfeio") {
      if (from.endsWith("@g.us")) {
        const metadata = await sock.groupMetadata(from);
        const participantes = metadata.participants.map((p) => p.id);
        const embaralhados = [...participantes].sort(() => Math.random() - 0.5);

        let texto = "🤢 *Ranking dos mais feios:*\n\n";
        embaralhados.forEach((id, i) => {
          texto += `${i + 1}. @${id.split("@")[0]}\n`;
        });

        await sock.sendMessage(from, { text: texto, mentions: participantes }, { quoted: msg });
      }
    }

    // ---------------- RANK GADO ----------------
    if (text.toLowerCase() === "!rankgado") {
      if (from.endsWith("@g.us")) {
        const metadata = await sock.groupMetadata(from);
        const participantes = metadata.participants.map((p) => p.id);

        let texto = "🐂 *Ranking do gado do grupo:*\n\n";
        const comPorcentagem = participantes.map((id) => ({
          id,
          porcentagem: Math.floor(Math.random() * 101),
        }));

        comPorcentagem.sort((a, b) => b.porcentagem - a.porcentagem);

        comPorcentagem.forEach((p, i) => {
          texto += `${i + 1}. @${p.id.split("@")[0]} - ${p.porcentagem}% gado\n`;
        });

        await sock.sendMessage(from, { text: texto, mentions: participantes }, { quoted: msg });
      }
    }

    // ---------------- RANK CORNO ----------------
    if (text.toLowerCase() === "!rankcorno") {
      if (from.endsWith("@g.us")) {
        const metadata = await sock.groupMetadata(from);
        const participantes = metadata.participants.map((p) => p.id);

        let texto = "🦌 *Ranking dos cornos do grupo:*\n\n";
        const comPorcentagem = participantes.map((id) => ({
          id,
          porcentagem: Math.floor(Math.random() * 101),
        }));

        comPorcentagem.sort((a, b) => b.porcentagem - a.porcentagem);

        comPorcentagem.forEach((p, i) => {
          texto += `${i + 1}. @${p.id.split("@")[0]} - ${p.porcentagem}% corno\n`;
        });

        await sock.sendMessage(from, { text: texto, mentions: participantes }, { quoted: msg });
      }
    }

    // ---------------- X1 ----------------
    if (text.toLowerCase() === "!participardox1") {
      if (!x1List.includes(sender)) {
        x1List.push(sender);
        saveX1List();
        await sock.sendMessage(from, { text: `✅ @${sender.split("@")[0]} entrou no X1!`, mentions: [sender] });
      }
    }

    if (text.toLowerCase() === "!sairx1") {
      x1List = x1List.filter((p) => p !== sender);
      saveX1List();
      await sock.sendMessage(from, { text: `🚪 @${sender.split("@")[0]} saiu do X1.`, mentions: [sender] });
    }

    if (text.toLowerCase() === "!listax1") {
      if (x1List.length === 0) {
        await sock.sendMessage(from, { text: "📭 A lista do X1 está vazia." });
      } else {
        let lista = "📋 *Lista do X1:*\n";
        x1List.forEach((p, i) => {
          lista += `${i + 1}. @${p.split("@")[0]}\n`;
        });
        await sock.sendMessage(from, { text: lista, mentions: x1List });
      }
    }

    if (text.toLowerCase() === "!deletelista") {
      if (from.endsWith("@g.us")) {
        const isAdmin = await isAdminInGroup(sock, from, sender);
        if (!isAdmin) {
          await sock.sendMessage(from, { text: "🚫 Apenas administradores podem apagar a lista do X1." }, { quoted: msg });
          return;
        }
      }
      x1List = [];
      saveX1List();
      await sock.sendMessage(from, { text: "🗑️ Lista do X1 apagada!" });
    }

    if (text.toLowerCase() === "!sortearx1") {
      if (!from.endsWith("@g.us")) {
        await sock.sendMessage(from, { text: "❌ Esse comando só funciona em grupos." });
      } else {
        const isAdmin = await isAdminInGroup(sock, from, sender);
        if (!isAdmin) {
          await sock.sendMessage(from, { text: "🚫 Apenas administradores podem sortear o X1." }, { quoted: msg });
        } else if (x1List.length < 2) {
          await sock.sendMessage(from, { text: "⚠️ É preciso pelo menos 2 participantes no X1." });
        } else {
          const sorteados = [];
          while (sorteados.length < 2) {
            const escolhido = x1List[Math.floor(Math.random() * x1List.length)];
            if (!sorteados.includes(escolhido)) sorteados.push(escolhido);
          }
          await sock.sendMessage(
            from,
            { text: `🔥 X1 sorteado: @${sorteados[0].split("@")[0]} vs @${sorteados[1].split("@")[0]}`, mentions: sorteados }
          );
        }
      }
    }

    if (text.toLowerCase().startsWith("!del ")) {
      const index = parseInt(text.split(" ")[1]) - 1;
      if (!isNaN(index) && index >= 0 && index < x1List.length) {
        const removido = x1List.splice(index, 1)[0];
        saveX1List();
        await sock.sendMessage(from, { text: `❌ @${removido.split("@")[0]} removido do X1.`, mentions: [removido] });
      }
    }

    if (text.toLowerCase() === "!marcarx1") {
      if (x1List.length === 0) {
        await sock.sendMessage(from, { text: "⚠️ A lista do X1 está vazia." });
      } else {
        await sock.sendMessage(from, { text: "📢 Chamando o X1:\n" + x1List.map((p) => `@${p.split("@")[0]}`).join(" "), mentions: x1List });
      }
    }

    // ---------------- Fechar/Abrir Grupo ----------------
    if (text.toLowerCase() === "!fechargp" || text.toLowerCase() === "!abrirgp") {
      if (!from.endsWith("@g.us")) return;

      const isAdmin = await isAdminInGroup(sock, from, sender);
      if (!isAdmin) {
        await sock.sendMessage(from, { text: "🚫 Apenas administradores podem usar esse comando." }, { quoted: msg });
        return;
      }

      const action = text.toLowerCase() === "!fechargp" ? "announcement" : "not_announcement";
      await sock.groupSettingUpdate(from, action);
      await sock.sendMessage(
        from,
        { text: action === "announcement" ? "🔒 Grupo fechado (apenas admins podem enviar mensagens)." : "🔓 Grupo aberto (todos podem enviar mensagens)." }
      );
    }

    // ---------------- Dono Liga/Desliga ----------------
    if (sender === ownerNumber) {
      if (text.toLowerCase() === "!desligar") {
        botLigado = false;
        await sock.sendMessage(from, { text: "🛑 Bot desligado pelo dono." });
      }
      if (text.toLowerCase() === "!ligar") {
        botLigado = true;
        await sock.sendMessage(from, { text: "✅ Bot ligado pelo dono." });
      }
    }
  });
}

connectBot();
