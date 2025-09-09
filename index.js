// index.js (completo) — suporte a efêmeras + ranks top 3 + todos comandos
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  downloadContentFromMessage,
} = require("@whiskeysockets/baileys");
const express = require("express");
const qrcode = require("qrcode-terminal");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const ytdl = require("@distube/ytdl-core");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------- Configurações fixas ----------------
const ownerNumber = "553196929183@s.whatsapp.net"; // dono
const welcomeGroupId = "120363419876804601@g.us";   // grupo de boas-vindas
let botLigado = true;
let msgCount = {};

// ---------------- Persistência do X1 ----------------
const x1File = path.join(__dirname, "x1.json");
function loadX1List() {
  try {
    if (fs.existsSync(x1File)) return JSON.parse(fs.readFileSync(x1File, "utf8"));
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

// ---------------- Server keep-alive ----------------
app.get("/", (_, res) => res.send("🤖 Bot está online!"));
app.listen(PORT, () => console.log(`🌐 Servidor na porta ${PORT}`));

// ---------------- Helpers ----------------
function unwrapMessage(message) {
  if (!message) return null;
  if (message.ephemeralMessage) return unwrapMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessageV2) return unwrapMessage(message.viewOnceMessageV2.message);
  if (message.viewOnceMessageV2Extension) return unwrapMessage(message.viewOnceMessageV2Extension.message);
  return message;
}

function getTextFromMsg(msg) {
  const m = unwrapMessage(msg.message);
  if (!m) return "";
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  if (m.buttonsResponseMessage?.selectedButtonId) return m.buttonsResponseMessage.selectedButtonId;
  if (m.listResponseMessage?.singleSelectReply?.selectedRowId) return m.listResponseMessage.singleSelectReply.selectedRowId;
  if (m.templateButtonReplyMessage?.selectedId) return m.templateButtonReplyMessage.selectedId;
  return "";
}

function getMentionsFromMsg(msg) {
  const m = unwrapMessage(msg.message);
  return m?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}

async function isAdminInGroup(sock, groupJid, userJid) {
  const metadata = await sock.groupMetadata(groupJid);
  return metadata.participants
    .filter((p) => ["admin", "superadmin"].includes(p.admin))
    .map((p) => p.id)
    .includes(userJid);
}

async function downloadMediaAsBuffer(mediaMessage) {
  // mediaMessage deve ser o objeto interno (ex.: imageMessage ou videoMessage)
  const isImage = !!mediaMessage.imageMessage;
  const isVideo = !!mediaMessage.videoMessage;
  if (!isImage && !isVideo) throw new Error("Mídia não suportada");

  const type = isImage ? "image" : "video";
  const inner = isImage ? mediaMessage.imageMessage : mediaMessage.videoMessage;
  const stream = await downloadContentFromMessage(inner, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
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
      if (shouldReconnect) setTimeout(() => connectBot(), 3000);
    } else if (connection === "open") {
      console.log("✅ Bot conectado!");
    }
  });

  // Boas-vindas no grupo específico
  sock.ev.on("group-participants.update", async (update) => {
    try {
      if (update.id === welcomeGroupId && update.action === "add") {
        for (const participant of update.participants) {
          const message = `Seja bem vindo @${participant.split("@")[0]}, leia as regras e manda pedido pra guilda, id da guilda na desc`;
          await sock.sendMessage(welcomeGroupId, { text: message, mentions: [participant] });
        }
      }
    } catch (err) {
      console.error("Erro ao enviar mensagem de boas-vindas:", err);
    }
  });

  // Mensagens
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages[0];
      if (!msg?.message) return;

      const messageTimestamp = (msg.messageTimestamp || 0) * 1000;
      if (Date.now() - messageTimestamp > 60000) return; // ignora mensagens antigas

      const from = msg.key.remoteJid;
      const sender = msg.key.participant || msg.key.remoteJid;

      // Contagem de mensagens (para !top5)
      msgCount[sender] = (msgCount[sender] || 0) + 1;

      const textRaw = getTextFromMsg(msg).trim();
      const text = textRaw.toLowerCase();
      const mentionsFromMsg = getMentionsFromMsg(msg);

      // Liga/desliga
      if (!botLigado && sender !== ownerNumber && text !== "!ligar") return;

      // ---------------- Menus ----------------
      if (text === "!menu") {
        await sock.sendMessage(from, {
          text:
            "📌 *Menu*\n\n" +
            "👉 !s (sticker de imagem/vídeo)\n" +
            "👉 !ship @pessoa1 @pessoa2\n" +
            "👉 !idgrupo\n" +
            "👉 !marcar (marca todos)\n" +
            "👉 !ppt @pessoa\n" +
            "👉 !top5 (mais ativos)\n" +
            "👉 !youtube <link> (apenas PV)\n" +
            "👉 !piada\n" +
            "👉 !curiosidade\n" +
            "👉 !maisgado\n" +
            "👉 !maiscorno\n" +
            "👉 !rankgado | !rankcorno | !rankbonito | !rankfeio (Top 3)\n" +
            "👉 !fechargp | !abrirgp (ADM)\n\n" +
            "🎮 *Menu X1*\n" +
            "👉 !menux1",
        });
      }

      if (text === "!menux1") {
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
      if (text === "!s") {
        try {
          const raw = unwrapMessage(msg.message);
          // Pega mídia da mensagem citada (se houver) ou da própria
          let mediaContainer = null;

          if (raw?.extendedTextMessage?.contextInfo?.quotedMessage) {
            mediaContainer = unwrapMessage(raw.extendedTextMessage.contextInfo.quotedMessage);
          } else {
            mediaContainer = raw;
          }

          const hasImage = !!mediaContainer?.imageMessage;
          const hasVideo = !!mediaContainer?.videoMessage;

          if (!hasImage && !hasVideo) {
            await sock.sendMessage(from, { text: "❌ Responda uma *imagem ou vídeo* com !s, ou envie com legenda !s." }, { quoted: msg });
            return;
          }

          if (hasImage) {
            // Imagem -> figurinha webp 512x512 com crop central (cover)
            const buffer = await downloadMediaAsBuffer(mediaContainer);
            const webpBuffer = await sharp(buffer)
              .resize(512, 512, { fit: "cover", position: "center" })
              .webp()
              .toBuffer();
            await sock.sendMessage(from, { sticker: webpBuffer, mimetype: "image/webp" }, { quoted: msg });
          } else if (hasVideo) {
            // Vídeo -> figurinha webp até 6s, 15fps, crop quadrado central (sem precisar de ffprobe)
            const buffer = await downloadMediaAsBuffer(mediaContainer);
            const inputPath = path.join(__dirname, "input.mp4");
            const outputPath = path.join(__dirname, "output.webp");
            fs.writeFileSync(inputPath, buffer);

            // usa expressões do ffmpeg pra crop central baseado em iw/ih
            const cmd = `ffmpeg -y -i "${inputPath}" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=512:512:flags=lanczos,fps=15" -t 6 -an -c:v libwebp -preset picture -q:v 50 -loop 0 "${outputPath}"`;
            exec(cmd, async (err) => {
              try {
                if (err) {
                  console.error("Erro ffmpeg:", err);
                  await sock.sendMessage(from, { text: "❌ Erro ao criar figurinha de vídeo." }, { quoted: msg });
                } else {
                  const webpBuffer = fs.readFileSync(outputPath);
                  await sock.sendMessage(from, { sticker: webpBuffer, mimetype: "image/webp" }, { quoted: msg });
                }
              } finally {
                try { fs.unlinkSync(inputPath); } catch {}
                try { fs.unlinkSync(outputPath); } catch {}
              }
            });
          }
        } catch (err) {
          console.error("Erro !s:", err);
          await sock.sendMessage(from, { text: "❌ Ocorreu um erro ao criar a figurinha." }, { quoted: msg });
        }
      }

      // ---------------- Ship ----------------
      if (text.startsWith("!ship")) {
        const mentions = mentionsFromMsg;
        if (mentions.length >= 2) {
          const shipPercentage = Math.floor(Math.random() * 101);
          const response = `💘 Ship entre *@${mentions[0].split("@")[0]}* e *@${mentions[1].split("@")[0]}* é de *${shipPercentage}%*!`;
          await sock.sendMessage(from, { text: response, mentions });
        } else {
          await sock.sendMessage(from, { text: "⚠️ Use: !ship @pessoa1 @pessoa2" }, { quoted: msg });
        }
      }

      // ---------------- ID do Grupo ----------------
      if (text === "!idgrupo") {
        if (from.endsWith("@g.us")) {
          await sock.sendMessage(from, { text: `🆔 ID do grupo: ${from}` }, { quoted: msg });
        } else {
          await sock.sendMessage(from, { text: "❌ Esse comando só funciona em grupos." }, { quoted: msg });
        }
      }

      // ---------------- Marcar Todos ----------------
      if (text === "!marcar") {
        if (!from.endsWith("@g.us")) {
          await sock.sendMessage(from, { text: "❌ Esse comando só funciona em grupos." }, { quoted: msg });
        } else {
          const metadata = await sock.groupMetadata(from);
          const mentions = metadata.participants.map((p) => p.id);
          const texto = "📢 Marcando todos:\n" + mentions.map((m) => `@${m.split("@")[0]}`).join(" ");
          await sock.sendMessage(from, { text: texto, mentions }, { quoted: msg });
        }
      }

      // ---------------- Pedra, Papel e Tesoura ----------------
      if (text.startsWith("!ppt")) {
        const mentions = mentionsFromMsg;
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

          const texto = `🎮 *Pedra, Papel e Tesoura*\n\n@${sender.split("@")[0]} escolheu: ${playerChoice}\n@${mentions[0].split("@")[0]} escolheu: ${opponentChoice}\n\n${result}`;
          await sock.sendMessage(from, { text: texto, mentions: [sender, mentions[0]] }, { quoted: msg });
        }
      }

      // ---------------- Top 5 ----------------
      if (text === "!top5") {
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

      // ---------------- YouTube (apenas PV) ----------------
      if (text.startsWith("!youtube")) {
        if (from.endsWith("@g.us")) {
          await sock.sendMessage(from, { text: "❌ Este comando só funciona no PV." }, { quoted: msg });
        } else {
          const args = textRaw.split(" ");
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

                const chunks = [];
                audioStream.on("data", (c) => chunks.push(c));
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
      if (text === "!piada") {
        try {
          let lista;
          if (fs.existsSync("piadas.json")) {
            lista = JSON.parse(fs.readFileSync("piadas.json", "utf8"));
          } else {
            lista = ["Por que o livro foi ao médico? Porque ele tinha muitas histórias!"];
          }
          const aleatoria = lista[Math.floor(Math.random() * lista.length)];
          await sock.sendMessage(from, { text: `😂 ${aleatoria}` });
        } catch (err) {
          console.error("Erro ao carregar piadas:", err);
          await sock.sendMessage(from, { text: "❌ Não foi possível carregar uma piada." });
        }
      }

      // ---------------- Curiosidades ----------------
      if (text === "!curiosidade") {
        try {
          let lista;
          if (fs.existsSync("curiosidades.json")) {
            lista = JSON.parse(fs.readFileSync("curiosidades.json", "utf8"));
          } else {
            lista = ["O polvo tem três corações."];
          }
          const aleatoria = lista[Math.floor(Math.random() * lista.length)];
          await sock.sendMessage(from, { text: `🤔 ${aleatoria}` });
        } catch (err) {
          console.error("Erro ao carregar curiosidades:", err);
          await sock.sendMessage(from, { text: "❌ Não foi possível carregar uma curiosidade." });
        }
      }

      // ---------------- MAIS GADO / MAIS CORNO ----------------
      if (text === "!maisgado" || text === "!maiscorno") {
        if (!from.endsWith("@g.us")) {
          await sock.sendMessage(from, { text: "❌ Este comando só funciona em grupos." }, { quoted: msg });
        } else {
          const metadata = await sock.groupMetadata(from);
          const participantes = metadata.participants.map((p) => p.id);
          const escolhido = participantes[Math.floor(Math.random() * participantes.length)];
          const porcentagem = Math.floor(Math.random() * 101);
          const label = text === "!maisgado" ? { emoji: "🐂", nome: "gado" } : { emoji: "🦌", nome: "corno" };
          const textoResp = `${label.emoji} O mais ${label.nome} do grupo hoje é @${escolhido.split("@")[0]} (${porcentagem}% ${label.nome})`;
          await sock.sendMessage(from, { text: textoResp, mentions: [escolhido] }, { quoted: msg });
        }
      }

      // ---------------- RANKS (Top 3) ----------------
      if (text === "!rankbonito" || text === "!rankfeio") {
        if (!from.endsWith("@g.us")) {
          await sock.sendMessage(from, { text: "❌ Este comando só funciona em grupos." }, { quoted: msg });
        } else {
          const metadata = await sock.groupMetadata(from);
          const participantes = metadata.participants.map((p) => p.id);
          const top3 = [...participantes].sort(() => Math.random() - 0.5).slice(0, 3);

          const titulo = text === "!rankbonito" ? "😎 *Top 3 dos mais bonitos:*" : "🤢 *Top 3 dos mais feios:*";
          let resp = `${titulo}\n\n`;
          top3.forEach((id, i) => {
            resp += `${i + 1}. @${id.split("@")[0]}\n`;
          });

          await sock.sendMessage(from, { text: resp, mentions: top3 }, { quoted: msg });
        }
      }

      if (text === "!rankgado" || text === "!rankcorno") {
        if (!from.endsWith("@g.us")) {
          await sock.sendMessage(from, { text: "❌ Este comando só funciona em grupos." }, { quoted: msg });
        } else {
          const metadata = await sock.groupMetadata(from);
          const participantes = metadata.participants.map((p) => p.id);

          const comPorcentagem = participantes.map((id) => ({
            id,
            porcentagem: Math.floor(Math.random() * 101),
          }));
          comPorcentagem.sort((a, b) => b.porcentagem - a.porcentagem);
          const top3 = comPorcentagem.slice(0, 3);

          const titulo = text === "!rankgado" ? "🐂 *Top 3 gados do grupo:*" : "🦌 *Top 3 cornos do grupo:*";
          let resp = `${titulo}\n\n`;
          top3.forEach((p, i) => {
            resp += `${i + 1}. @${p.id.split("@")[0]} - ${p.porcentagem}% ${text === "!rankgado" ? "gado" : "corno"}\n`;
          });

          await sock.sendMessage(from, { text: resp, mentions: top3.map((p) => p.id) }, { quoted: msg });
        }
      }

      // ---------------- X1 ----------------
      if (text === "!participardox1") {
        if (!x1List.includes(sender)) {
          x1List.push(sender);
          saveX1List();
          await sock.sendMessage(from, { text: `✅ @${sender.split("@")[0]} entrou no X1!`, mentions: [sender] });
        } else {
          await sock.sendMessage(from, { text: "⚠️ Você já está na lista do X1." }, { quoted: msg });
        }
      }

      if (text === "!sairx1") {
        if (x1List.includes(sender)) {
          x1List = x1List.filter((p) => p !== sender);
          saveX1List();
          await sock.sendMessage(from, { text: `🚪 @${sender.split("@")[0]} saiu do X1.`, mentions: [sender] });
        } else {
          await sock.sendMessage(from, { text: "⚠️ Você não está na lista do X1." }, { quoted: msg });
        }
      }

      if (text === "!listax1") {
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

      if (text === "!deletelista") {
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

      if (text === "!sortearx1") {
        if (!from.endsWith("@g.us")) {
          await sock.sendMessage(from, { text: "❌ Esse comando só funciona em grupos." }, { quoted: msg });
        } else {
          const isAdmin = await isAdminInGroup(sock, from, sender);
          if (!isAdmin) {
            await sock.sendMessage(from, { text: "🚫 Apenas administradores podem sortear o X1." }, { quoted: msg });
          } else if (x1List.length < 2) {
            await sock.sendMessage(from, { text: "⚠️ É preciso pelo menos 2 participantes no X1." }, { quoted: msg });
          } else {
            const sorteados = [];
            while (sorteados.length < 2) {
              const escolhido = x1List[Math.floor(Math.random() * x1List.length)];
              if (!sorteados.includes(escolhido)) sorteados.push(escolhido);
            }
            const textoSorteio = `🔥 X1 sorteado: @${sorteados[0].split("@")[0]} vs @${sorteados[1].split("@")[0]}`;
            await sock.sendMessage(from, { text: textoSorteio, mentions: sorteados });
          }
        }
      }

      if (text.startsWith("!del ")) {
        const index = parseInt(text.split(" ")[1], 10) - 1;
        if (!isNaN(index) && index >= 0 && index < x1List.length) {
          const removido = x1List.splice(index, 1)[0];
          saveX1List();
          await sock.sendMessage(from, { text: `❌ @${removido.split("@")[0]} removido do X1.`, mentions: [removido] });
        } else {
          await sock.sendMessage(from, { text: "⚠️ Número inválido." }, { quoted: msg });
        }
      }

      if (text === "!marcarx1") {
        if (x1List.length === 0) {
          await sock.sendMessage(from, { text: "⚠️ A lista do X1 está vazia." }, { quoted: msg });
        } else {
          const textoX1 = "📢 Chamando o X1:\n" + x1List.map((p) => `@${p.split("@")[0]}`).join(" ");
          await sock.sendMessage(from, { text: textoX1, mentions: x1List }, { quoted: msg });
        }
      }

      // ---------------- Fechar/Abrir Grupo ----------------
      if (text === "!fechargp" || text === "!abrirgp") {
        if (!from.endsWith("@g.us")) return;

        const isAdmin = await isAdminInGroup(sock, from, sender);
        if (!isAdmin) {
          await sock.sendMessage(from, { text: "🚫 Apenas administradores podem usar esse comando." }, { quoted: msg });
          return;
        }

        const action = text === "!fechargp" ? "announcement" : "not_announcement";
        await sock.groupSettingUpdate(from, action);
        await sock.sendMessage(
          from,
          { text: action === "announcement" ? "🔒 Grupo fechado (apenas admins podem enviar mensagens)." : "🔓 Grupo aberto (todos podem enviar mensagens)." }
        );
      }

      // ---------------- Dono Liga/Desliga ----------------
      if (sender === ownerNumber) {
        if (text === "!desligar") {
          botLigado = false;
          await sock.sendMessage(from, { text: "🛑 Bot desligado pelo dono." });
        }
        if (text === "!ligar") {
          botLigado = true;
          await sock.sendMessage(from, { text: "✅ Bot ligado pelo dono." });
        }
      }

      // ---------------- Ping ----------------
      if (text === "!ping") {
        await sock.sendMessage(from, { text: "🏓 pong" }, { quoted: msg });
      }
    } catch (err) {
      console.error("Erro no handler de mensagens:", err);
    }
  });
}

connectBot();