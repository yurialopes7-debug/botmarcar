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

let x1List = [];
let msgCount = {};
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
      if (shouldReconnect) {
<<<<<<< HEAD
        setTimeout(() => connectBot(), 3000);
=======
        setTimeout(() => connectBot(), 3000); // reconecta com delay de 3s para maior estabilidade
>>>>>>> 6eec1360a0ab78dd483a0e180c4925154d267a66
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
            mentions: [participant]
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
    if (!msg.message) return;

    const messageTimestamp = (msg.messageTimestamp || 0) * 1000;
    if (Date.now() - messageTimestamp > 60000) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.participant || from;

    msgCount[sender] = (msgCount[sender] || 0) + 1;

    let text = "";
    if (msg.message.conversation) text = msg.message.conversation;
    else if (msg.message.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
    else if (msg.message.imageMessage?.caption) text = msg.message.imageMessage.caption;
    else if (msg.message.videoMessage?.caption) text = msg.message.videoMessage.caption;
    text = text.trim();

    if (!botLigado && sender !== ownerNumber && !["!ligar"].includes(text.toLowerCase())) return;

    // ---------------- Menus ----------------
    if (text.toLowerCase() === "!menu") {
<<<<<<< HEAD
      await sock.sendMessage(from, { text: "📌 *Menu Normal*\n\n👉 !s\n👉 !ship @pessoa1 @pessoa2\n👉 !idgrupo\n👉 !ppt @pessoa\n👉 !top5\n👉 !youtube <link> (PV)\n👉 !piada\n👉 !curiosidade\n👉 !maisgado\n👉 !maiscorno\n👉 !rankgado\n👉 !rankcorno\n👉 !rankbonito\n👉 !rankfeio" });
=======
      await sock.sendMessage(from, { text: "📌 *Menu Normal*\n\n👉 !s\n👉 !ship @pessoa1 @pessoa2\n👉 !idgrupo\n" });
>>>>>>> 6eec1360a0ab78dd483a0e180c4925154d267a66
    }

    if (text.toLowerCase() === "!menux1") {
      await sock.sendMessage(from, { text: "🎮 *Menu X1*\n\n👉 !participardox1\n👉 !sairx1\n👉 !listax1\n👉 !deletelista\n👉 !sortearx1\n👉 !del <número>\n👉 !marcarx1" });
    }

    // ---------------- Sticker ----------------
    if (text.toLowerCase() === "!s" && (msg.message.imageMessage || msg.message.videoMessage)) {
      try {
        const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger: console });
        const outPath = path.join(__dirname, "sticker.webp");

        if (msg.message.imageMessage) {
          await sharp(buffer).webp().toFile(outPath);
        } else if (msg.message.videoMessage) {
          const tempMp4 = path.join(__dirname, "temp.mp4");
          fs.writeFileSync(tempMp4, buffer);
          await new Promise((resolve, reject) => {
            exec(`ffmpeg -i ${tempMp4} -vf "scale=320:320:force_original_aspect_ratio=decrease" -t 10 -f webp ${outPath}`, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          fs.unlinkSync(tempMp4);
        }

        const stickerBuffer = fs.readFileSync(outPath);
        await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });
        fs.unlinkSync(outPath);
      } catch (err) {
        console.error("Erro ao criar figurinha:", err);
        await sock.sendMessage(from, { text: "❌ Erro ao criar figurinha." }, { quoted: msg });
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
        await sock.sendMessage(from, { text: "📢 Marcando todos:\n" + mentions.map((m) => `@${m.split("@")[0]}`).join(" "), mentions }, { quoted: msg });
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

        await sock.sendMessage(from, {
          text: `🎮 *Pedra, Papel e Tesoura*\n\n@${sender.split("@")[0]} escolheu: ${playerChoice}\n@${mentions[0].split("@")[0]} escolheu: ${opponentChoice}\n\n${result}`,
          mentions: [sender, mentions[0]]
        }, { quoted: msg });
      }
    }

    // ---------------- Top 5 ----------------
    if (text.toLowerCase() === "!top5") {
      if (!from.endsWith("@g.us")) {
        await sock.sendMessage(from, { text: "❌ Este comando só funciona em grupos." }, { quoted: msg });
        return;
      }

      const metadata = await sock.groupMetadata(from);
      const groupMembers = metadata.participants.map(p => p.id);

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

    // ---------------- YouTube (PV) ----------------
    if (text.toLowerCase().startsWith("!youtube")) {
      if (from.endsWith("@g.us")) {
        await sock.sendMessage(from, { text: "❌ Este comando só funciona no PV." }, { quoted: msg });
        return;
      }

      const args = text.split(" ");
      if (args.length < 2) {
        await sock.sendMessage(from, { text: "⚠️ Use: !youtube <link>" }, { quoted: msg });
        return;
      }

      const url = args[1];
      if (!ytdl.validateURL(url)) {
        await sock.sendMessage(from, { text: "❌ Link inválido do YouTube." }, { quoted: msg });
        return;
      }

      try {
        const info = await ytdl.getInfo(url);
        const title = info.videoDetails.title;

        const audioStream = ytdl(url, { filter: "audioonly", quality: "highestaudio" });
        let chunks = [];
        audioStream.on("data", (chunk) => chunks.push(chunk));
        audioStream.on("end", async () => {
          const buffer = Buffer.concat(chunks);
          await sock.sendMessage(from, {
            audio: buffer,
            mimetype: "audio/mpeg",
            fileName: `${title}.mp3`
          }, { quoted: msg });
        });
      } catch (err) {
        console.error("Erro no YouTube:", err);
        await sock.sendMessage(from, { text: "❌ Erro ao baixar o áudio." }, { quoted: msg });
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
        const participantes = metadata.participants.map(p => p.id);
        const escolhido = participantes[Math.floor(Math.random() * participantes.length)];
        const porcentagem = Math.floor(Math.random() * 101);
        await sock.sendMessage(from, { 
          text: `🐂 O mais gado do grupo hoje é @${escolhido.split("@")[0]} `, 
          mentions: [escolhido] 
        });
      }
    }

    // ---------------- MAIS CORNO ----------------
    if (text.toLowerCase() === "!maiscorno") {
      if (from.endsWith("@g.us")) {
        const metadata = await sock.groupMetadata(from);
        const participantes = metadata.participants.map(p => p.id);
        const escolhido = participantes[Math.floor(Math.random() * participantes.length)];
        const porcentagem = Math.floor(Math.random() * 101);
        await sock.sendMessage(from, { 
          text: `🦌 O mais corno do grupo hoje é @${escolhido.split("@")[0]} `, 
          mentions: [escolhido] 
        });
      }
    }

    // ---------------- RANK BONITO ----------------
    if (text.toLowerCase() === "!rankbonito") {
      if (from.endsWith("@g.us")) {
        const metadata = await sock.groupMetadata(from);
        const participantes = metadata.participants.map(p => p.id);
        const embaralhados = participantes.sort(() => Math.random() - 0.5);

        let texto = "😎 *Ranking dos mais bonitos:*\n\n";
        embaralhados.forEach((id, i) => {
          texto += `${i + 1}. @${id.split("@")[0]}\n`;
        });

        await sock.sendMessage(from, { text: texto, mentions: participantes });
      }
    }

    // ---------------- RANK FEIO ----------------
    if (text.toLowerCase() === "!rankfeio") {
      if (from.endsWith("@g.us")) {
        const metadata = await sock.groupMetadata(from);
        const participantes = metadata.participants.map(p => p.id);
        const embaralhados = participantes.sort(() => Math.random() - 0.5);

        let texto = "🤢 *Ranking dos mais feios:*\n\n";
        embaralhados.forEach((id, i) => {
          texto += `${i + 1}. @${id.split("@")[0]}\n`;
        });

        await sock.sendMessage(from, { text: texto, mentions: participantes });
      }
    }

    // ---------------- RANK GADO ----------------
    if (text.toLowerCase() === "!rankgado") {
      if (from.endsWith("@g.us")) {
        const metadata = await sock.groupMetadata(from);
        const participantes = metadata.participants.map(p => p.id);

        let texto = "🐂 *Ranking do gado do grupo:*\n\n";
        const comPorcentagem = participantes.map(id => ({
          id,
          porcentagem: Math.floor(Math.random() * 101)
        }));

        comPorcentagem.sort((a, b) => b.porcentagem - a.porcentagem);

        comPorcentagem.forEach((p, i) => {
          texto += `${i + 1}. @${p.id.split("@")[0]} - ${p.porcentagem}% gado\n`;
        });

        await sock.sendMessage(from, { text: texto, mentions: participantes });
      }
    }

    // ---------------- RANK CORNO ----------------
    if (text.toLowerCase() === "!rankcorno") {
      if (from.endsWith("@g.us")) {
        const metadata = await sock.groupMetadata(from);
        const participantes = metadata.participants.map(p => p.id);

        let texto = "🦌 *Ranking dos cornos do grupo:*\n\n";
        const comPorcentagem = participantes.map(id => ({
          id,
          porcentagem: Math.floor(Math.random() * 101)
        }));

        comPorcentagem.sort((a, b) => b.porcentagem - a.porcentagem);

        comPorcentagem.forEach((p, i) => {
          texto += `${i + 1}. @${p.id.split("@")[0]} - ${p.porcentagem}% corno\n`;
        });

        await sock.sendMessage(from, { text: texto, mentions: participantes });
      }
    }

    // ---------------- X1 ----------------
    if (text.toLowerCase() === "!participardox1") {
      if (!x1List.includes(sender)) {
        x1List.push(sender);
        await sock.sendMessage(from, { text: `✅ @${sender.split("@")[0]} entrou no X1!`, mentions: [sender] });
      }
    }

    if (text.toLowerCase() === "!sairx1") {
      x1List = x1List.filter((p) => p !== sender);
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
      x1List = [];
      await sock.sendMessage(from, { text: "🗑️ Lista do X1 apagada!" });
    }

    if (text.toLowerCase() === "!sortearx1") {
      if (x1List.length < 2) {
        await sock.sendMessage(from, { text: "⚠️ É preciso pelo menos 2 participantes no X1." });
      } else {
        const sorteados = [];
        while (sorteados.length < 2) {
          const escolhido = x1List[Math.floor(Math.random() * x1List.length)];
          if (!sorteados.includes(escolhido)) sorteados.push(escolhido);
        }
        await sock.sendMessage(from, { text: `🔥 X1 sorteado: @${sorteados[0].split("@")[0]} vs @${sorteados[1].split("@")[0]}`, mentions: sorteados });
      }
    }

    if (text.toLowerCase().startsWith("!del ")) {
      const index = parseInt(text.split(" ")[1]) - 1;
      if (!isNaN(index) && index >= 0 && index < x1List.length) {
        const removido = x1List.splice(index, 1)[0];
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

<<<<<<< HEAD
    // ---------------- Dono Liga/Desliga ----------------
    if (sender === ownerNumber) {
      if (text.toLowerCase() === "!desligar") {
        botLigado = false;
        await sock.sendMessage(from, { text: "🛑 Bot desligado pelo dono." });
=======
    // ---------------- Mostrar ID do Grupo ----------------
    if (text.toLowerCase() === "!idgrupo") {
      if (from.endsWith("@g.us")) {
        await sock.sendMessage(from, { text: `🆔 O ID deste grupo é:\n${from}` }, { quoted: msg });
      } else {
        await sock.sendMessage(from, { text: "❌ Este comando só funciona em grupos." }, { quoted: msg });
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

        if (mediaMessage.imageMessage) {
          // ----- Sticker de imagem -----
          const buffer = await downloadMediaMessage({ message: mediaMessage, key: mediaKey }, "buffer");
          const metadata = await sharp(buffer).metadata();
          const size = Math.min(metadata.width, metadata.height);

          const webpBuffer = await sharp(buffer)
            .extract({ left: Math.floor((metadata.width - size) / 2), top: Math.floor((metadata.height - size) / 2), width: size, height: size })
            .resize(512, 512)
            .webp()
            .toBuffer();

          await sock.sendMessage(from, { sticker: webpBuffer, mimetype: "image/webp" }, { quoted: msg });
        } else if (mediaMessage.videoMessage) {
          // ----- Sticker de vídeo -----
          const buffer = await downloadMediaMessage({ message: mediaMessage, key: mediaKey }, "buffer");
          const inputPath = path.join(__dirname, "input.mp4");
          const outputPath = path.join(__dirname, "output.webp");
          fs.writeFileSync(inputPath, buffer);

          // Descobre dimensões do vídeo
          exec(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${inputPath}"`, (err, stdout) => {
            if (err) {
              console.error("Erro no ffprobe:", err);
              return sock.sendMessage(from, { text: "❌ Erro ao analisar o vídeo." }, { quoted: msg });
            }

            const [width, height] = stdout.trim().split("x").map(Number);
            const size = Math.min(width, height);

            // Recorta quadrado e gera figurinha
            exec(`ffmpeg -i "${inputPath}" -vf "crop=${size}:${size},scale=512:512,fps=15" -t 6 -an -c:v libwebp -preset picture -q:v 50 -loop 0 "${outputPath}"`, async (err) => {
              if (err) {
                console.error("Erro ao converter vídeo:", err);
                await sock.sendMessage(from, { text: "❌ Erro ao criar figurinha de vídeo." }, { quoted: msg });
                return;
              }
              const webpBuffer = fs.readFileSync(outputPath);
              await sock.sendMessage(from, { sticker: webpBuffer, mimetype: "image/webp" }, { quoted: msg });
              fs.unlinkSync(inputPath);
              fs.unlinkSync(outputPath);
            });
          });
        }
      } catch (err) {
        console.error("Erro ao criar figurinha:", err);
        await sock.sendMessage(from, { text: "❌ Erro ao criar a figurinha." }, { quoted: msg });
>>>>>>> 6eec1360a0ab78dd483a0e180c4925154d267a66
      }
      if (text.toLowerCase() === "!ligar") {
        botLigado = true;
        await sock.sendMessage(from, { text: "✅ Bot ligado pelo dono." });
      }
    }
  });
}

connectBot();
