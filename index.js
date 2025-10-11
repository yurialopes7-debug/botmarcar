// index.js (revisado) — suporte a efêmeras + ranks top 3 + todos comandos
// + !marcar com texto opcional OU citando mensagem (reenviar) — SEM exibir lista de @ no corpo
// + RESTRITO: !marcar somente para administradores do grupo ou o dono (ownerNumber)
// Observação: precisa de ffmpeg no PATH para conversão de vídeos -> stickers animados
// Observação: verificar versão do play-dl/playdl e ytdl se der erro no download do áudio

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
const playdl = require("play-dl"); // ATENÇÃO: API muda entre versões
// const ytdl = require("@distube/ytdl-core"); // removido se não for usado
// const playdl = require("play-dl");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------- Configurações fixas ----------------
const ownerNumber = "553196929183@s.whatsapp.net"; // dono
const welcomeGroupId = "120363419876804601@g.us"; // grupo de boas-vindas
let botLigado = true;

// ---------------- Persistência do X1 + top5 ----------------
const x1File = path.join(__dirname, "x1.json");
const top5File = path.join(__dirname, "top5.json");

function loadJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
    return fallback;
  } catch (err) {
    console.error(`Erro ao carregar ${filePath}:`, err);
    return fallback;
  }
}
function saveJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error(`Erro ao salvar ${filePath}:`, err);
  }
}

let x1List = loadJSON(x1File, []);
let msgCount = loadJSON(top5File, {}); // **persistência do top5**

// ---------------- Server keep-alive ----------------
app.get("/", (_, res) => res.send("🤖 Bot está online!"));
app.listen(PORT, () => console.log(`🌐 Servidor na porta ${PORT}`));

// ---------------- Helpers ----------------

/**
 * Desembrulha mensagens efêmeras e view-once.
 */
function unwrapMessage(message) {
  if (!message) return null;
  if (message.ephemeralMessage) return unwrapMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessageV2) return unwrapMessage(message.viewOnceMessageV2.message);
  if (message.viewOnceMessageV2Extension) return unwrapMessage(message.viewOnceMessageV2Extension.message);
  return message;
}

/**
 * Extrai texto de uma mensagem (conversation, extended, captions, etc).
 * Aceita um objeto tipo { message: ... } (como o upsert) ou um message já desembrulhado.
 */
function getTextFromMsg(msg) {
  // msg pode ser: { message: <inner> } ou o inner message diretamente (no caso de fakeMsg)
  const container = msg && msg.message !== undefined ? msg.message : msg;
  const m = unwrapMessage(container);
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

/**
 * Extrai menções da mensagem (se houver).
 */
function getMentionsFromMsg(msg) {
  const container = msg && msg.message !== undefined ? msg.message : msg;
  const m = unwrapMessage(container);
  return m?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}

/**
 * Verifica se userJid é admin no grupo groupJid.
 */
async function isAdminInGroup(sock, groupJid, userJid) {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    return metadata.participants
      .filter((p) => ["admin", "superadmin"].includes(p.admin))
      .map((p) => p.id)
      .includes(userJid);
  } catch (e) {
    console.error("Erro ao verificar admin:", e);
    return false;
  }
}

/**
 * Baixa mídia (image/video) e retorna como Buffer.
 * Recebe o container interno (imageMessage ou videoMessage) ou a mensagem que contém esses campos.
 */
async function downloadMediaAsBuffer(mediaContainer) {
  // mediaContainer pode ser a mensagem interna (com imageMessage/videoMessage) ou diretamente imageMessage/videoMessage
  const possible = mediaContainer.imageMessage ? mediaContainer.imageMessage : mediaContainer.videoMessage ? mediaContainer.videoMessage : mediaContainer;
  const isImage = !!possible?.mimetype && possible?.mimetype.startsWith("image");
  const isVideo = !!possible?.mimetype && possible?.mimetype.startsWith("video");
  // fallback: checar por propriedades
  const hasImageField = !!(mediaContainer && mediaContainer.imageMessage);
  const hasVideoField = !!(mediaContainer && mediaContainer.videoMessage);

  const type = hasImageField || isImage ? "image" : hasVideoField || isVideo ? "video" : null;
  if (!type) throw new Error("Mídia não suportada");

  const inner = hasImageField ? mediaContainer.imageMessage : hasVideoField ? mediaContainer.videoMessage : mediaContainer;
  const stream = await downloadContentFromMessage(inner, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Extrai a mensagem citada (se houver) a partir de uma msg.
 * Retorna a mensagem já desembrulhada (inner).
 */
function getQuotedMessageRaw(msg) {
  const container = msg && msg.message !== undefined ? msg.message : msg;
  const raw = unwrapMessage(container);
  const quoted = raw?.extendedTextMessage?.contextInfo?.quotedMessage;
  return quoted ? unwrapMessage(quoted) : null;
}

/**
 * Extrai o JID do autor da mensagem citada (se fornecido no contextInfo).
 */
function getQuotedParticipant(msg) {
  const container = msg && msg.message !== undefined ? msg.message : msg;
  const raw = unwrapMessage(container);
  return raw?.extendedTextMessage?.contextInfo?.participant || null;
}

/**
 * Clona conteúdo textual da mensagem citada (se houver) como string.
 * Retorna "" se não houver texto na citada.
 */
function getQuotedText(msg) {
  const q = getQuotedMessageRaw(msg);
  if (!q) return "";
  return getTextFromMsg(q) || "";
}

/**
 * Informa se a mensagem citada contém mídia (image/video) e retorna detalhes.
 * Retorna { hasMedia: false } se não houver mídia.
 */
function getQuotedMediaInfo(msg) {
  const q = getQuotedMessageRaw(msg);
  if (!q) return { hasMedia: false };
  const hasImage = !!q.imageMessage;
  const hasVideo = !!q.videoMessage;
  if (!hasImage && !hasVideo) return { hasMedia: false };
  const caption =
    (q.imageMessage && q.imageMessage.caption) ||
    (q.videoMessage && q.videoMessage.caption) ||
    "";
  return {
    hasMedia: true,
    isImage: hasImage,
    isVideo: hasVideo,
    quotedMessage: q,
    caption: caption || "",
  };
}

/**
 * Reenvia mídia citada (imagem/vídeo) mantendo (ou não) a legenda,
 * mas adicionando "mentions" de todos participantes do grupo.
 * Requisito do usuário: não imprimir a lista de @ no corpo explicitamente.
 */
async function resendQuotedMediaWithMentions(sock, chatId, msg, mentions) {
  const mediaInfo = getQuotedMediaInfo(msg);
  if (!mediaInfo.hasMedia) return false;

  try {
    const buf = await downloadMediaAsBuffer(mediaInfo.quotedMessage);

    if (mediaInfo.isImage) {
      await sock.sendMessage(
        chatId,
        {
          image: buf,
          caption: mediaInfo.caption || "",
          mentions,
        },
        { quoted: msg }
      );
      return true;
    }

    if (mediaInfo.isVideo) {
      await sock.sendMessage(
        chatId,
        {
          video: buf,
          caption: mediaInfo.caption || "",
          mentions,
        },
        { quoted: msg }
      );
      return true;
    }

    return false;
  } catch (e) {
    console.error("Erro ao reenviar mídia citada com menções:", e);
    return false;
  }
}

/**
 * Cria figurinha estática (imagem -> webp 512x512, cover).
 */
async function makeStickerFromImageBuffer(buffer) {
  const webpBuffer = await sharp(buffer)
    .resize(512, 512, { fit: "cover", position: "center" })
    .webp()
    .toBuffer();
  return webpBuffer;
}

/**
 * Cria figurinha animada de vídeo (até 6s, 15fps, crop central quadrado, 512x512).
 * Requer ffmpeg instalado no sistema.
 */
function makeStickerFromVideoBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const inputPath = path.join(__dirname, "input_temp.mp4");
    const outputPath = path.join(__dirname, "output_temp.webp");
    try {
      fs.writeFileSync(inputPath, buffer);
    } catch (e) {
      return reject(e);
    }

    const cmd =
      `ffmpeg -y -i "${inputPath}" ` +
      `-vf "crop='min(iw,ih)':'min(iw,ih)',scale=512:512:flags=lanczos,fps=15" ` +
      `-t 6 -an -c:v libwebp -preset picture -q:v 50 -loop 0 "${outputPath}"`;

    exec(cmd, (err, stdout, stderr) => {
      try {
        if (err) {
          return reject(err);
        }
        const webpBuffer = fs.readFileSync(outputPath);
        resolve(webpBuffer);
      } catch (e) {
        reject(e);
      } finally {
        try { fs.unlinkSync(inputPath); } catch {}
        try { fs.unlinkSync(outputPath); } catch {}
      }
    });
  });
}

// ---------------- Bot ----------------
async function connectBot() {
  // usa pasta auth_info/ com useMultiFileAuthState
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, "auth_info"));
  const sock = makeWASocket({ auth: state });

  // marca o tempo de start (usado para ignorar mensagens antigas/backlog)
  sock.startTime = Date.now();

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    try {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log("📱 Escaneie o QR Code:");
        qrcode.generate(qr, { small: true });
      }
      if (connection === "close") {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log("❌ Conexão encerrada. Reconectando?", shouldReconnect);
        if (shouldReconnect) {
          // Ao reconectar, uma nova instância de socket será criada,
          // e essa nova instância terá startTime atual, assim não reprocessamos backlog.
          setTimeout(() => connectBot(), 3000);
        }
      } else if (connection === "open") {
        console.log("✅ Bot conectado!");
        // atualiza startTime para ignorar mensagens anteriores à abertura
        sock.startTime = Date.now();
      }
    } catch (e) {
      console.error("Erro no connection.update:", e);
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

      // timestamp da mensagem (ms)
      const messageTimestamp = (msg.messageTimestamp || 0) * 1000;

      // Ignorar mensagens mais antigas que a inicialização do socket (evita reprocessar backlog)
      if (messageTimestamp < (sock.startTime || 0)) return;

      // Ignora mensagens muito antigas (fallback de segurança)
      if (Date.now() - messageTimestamp > 1000 * 60 * 60 * 24) return; // > 24h

      const from = msg.key.remoteJid;
      const sender = msg.key.participant || msg.key.remoteJid;

      // Contagem de mensagens (para !top5) — persistente agora
      try {
        msgCount[sender] = (msgCount[sender] || 0) + 1;
        saveJSON(top5File, msgCount);
      } catch (e) {
        console.error("Erro ao atualizar contador msgCount:", e);
      }

      const textRaw = (getTextFromMsg(msg) || "").trim();
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
            "👉 !marcar (marca todos / ver ajuda com !ajudamarcar) [ADM]\n" +
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

      if (text === "!ajudamarcar") {
        await sock.sendMessage(from, {
          text:
            "ℹ️ *Ajuda do !marcar* (somente ADM/dono)\n\n" +
            "• `!marcar <texto>` → envia o texto informado e marca todos (não imprime a lista de @ no corpo).\n" +
            "• `!marcar` *respondendo uma mensagem* → copia a mensagem citada (texto ou mídia) e reenviará marcando todos (não imprime a lista de @ no corpo).\n" +
            "• `!marcar` (sem texto e sem citação) → lista @ de todos no corpo (modo antigo).\n",
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
          } else if (hasImage) {
            const buffer = await downloadMediaAsBuffer(mediaContainer);
            const webpBuffer = await makeStickerFromImageBuffer(buffer);
            await sock.sendMessage(from, { sticker: webpBuffer, mimetype: "image/webp" }, { quoted: msg });
          } else if (hasVideo) {
            const buffer = await downloadMediaAsBuffer(mediaContainer);
            try {
              const webpBuffer = await makeStickerFromVideoBuffer(buffer);
              await sock.sendMessage(from, { sticker: webpBuffer, mimetype: "image/webp" }, { quoted: msg });
            } catch (err) {
              console.error("Erro ffmpeg:", err);
              await sock.sendMessage(from, { text: "❌ Erro ao criar figurinha de vídeo (verifique se ffmpeg está instalado e no PATH)." }, { quoted: msg });
            }
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
          await sock.sendMessage(from, { text: response, mentions: [mentions[0], mentions[1]] });
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

      // ---------------- Marcar Todos (ATUALIZADO + RESTRITO) ----------------
      if (text.startsWith("!marcar")) {
        if (!from.endsWith("@g.us")) {
          await sock.sendMessage(from, { text: "❌ Esse comando só funciona em grupos." }, { quoted: msg });
        } else {
          const isAdm = await isAdminInGroup(sock, from, sender);
          if (sender !== ownerNumber && !isAdm) {
            await sock.sendMessage(from, { text: "🚫 Apenas administradores podem usar esse comando." }, { quoted: msg });
          } else {
            const metadata = await sock.groupMetadata(from);
            const mentions = metadata.participants.map((p) => p.id);

            const argsTexto = textRaw.slice("!marcar".length).trim();

            // Caso 1: texto opcional
            if (argsTexto.length > 0) {
              await sock.sendMessage(from, { text: argsTexto, mentions }, { quoted: msg });
            } else {
              // Caso 2: verificar se há mensagem citada
              const quotedRaw = getQuotedMessageRaw(msg);
              if (quotedRaw) {
                // Tenta reenviar mídia (image/video) se houver
                const reenviado = await resendQuotedMediaWithMentions(sock, from, msg, mentions);
                if (!reenviado) {
                  // Se não era mídia (ou falhou), tenta reenviar texto
                  const quotedText = getQuotedText(msg);
                  if (quotedText && quotedText.trim().length > 0) {
                    await sock.sendMessage(from, { text: quotedText, mentions }, { quoted: msg });
                  } else {
                    // Sem texto, sem mídia: cai para comportamento antigo
                    const textoAntigo = "📢 Marcando todos:\n" + mentions.map((m) => `@${m.split("@")[0]}`).join(" ");
                    await sock.sendMessage(from, { text: textoAntigo, mentions }, { quoted: msg });
                  }
                }
              } else {
                // Caso 3: sem texto e sem citação -> comportamento antigo
                const textoAntigo = "📢 Marcando todos:\n" + mentions.map((m) => `@${m.split("@")[0]}`).join(" ");
                await sock.sendMessage(from, { text: textoAntigo, mentions }, { quoted: msg });
              }
            }
          }
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

          const textoPPT = `🎮 *Pedra, Papel e Tesoura*\n\n@${sender.split("@")[0]} escolheu: ${playerChoice}\n@${mentions[0].split("@")[0]} escolheu: ${opponentChoice}\n\n${result}`;
          await sock.sendMessage(from, { text: textoPPT, mentions: [sender, mentions[0]] }, { quoted: msg });
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
    return;
  }

  const args = textRaw.split(" ");
  if (args.length < 2) {
    await sock.sendMessage(from, { text: "⚠️ Use: !youtube <link>" }, { quoted: msg });
    return;
  }

  const url = args[1];

  try {
    // 🔹 Carrega e limpa cookies
    let cookies = fs.readFileSync("./cookies.txt", "utf-8");
    cookies = cookies
      .replace(/\r?\n|\r/g, "; ")
      .replace(/\t/g, " ")
      .replace(/"+/g, "")
      .replace(/;+$/g, "")
      .trim();

    await playdl.setToken({ youtube: { cookie: cookies } });
    console.log("✅ Cookies do YouTube carregados com sucesso!");

    // 🔹 Validação básica do link
    if (typeof playdl.yt_validate === "function") {
      if (!playdl.yt_validate(url)) {
        await sock.sendMessage(from, { text: "❌ Link inválido do YouTube." }, { quoted: msg });
        return;
      }
    }

    // 🔹 Obtém informações do vídeo
    const info = await playdl.video_info(url);
    const title = info?.video_details?.title || "audio";

    // 🔹 Baixa o áudio
    const stream = await playdl.stream(url, { quality: 128 });
    const reader = stream.stream;
    const chunks = [];
    reader.on("data", (chunk) => chunks.push(chunk));
    reader.on("end", async () => {
      try {
        const buffer = Buffer.concat(chunks);
        await sock.sendMessage(
          from,
          { audio: buffer, mimetype: "audio/mpeg", fileName: `${title}.mp3` },
          { quoted: msg }
        );
      } catch (e) {
        console.error("Erro ao enviar áudio:", e);
        await sock.sendMessage(from, { text: "❌ Erro ao enviar o áudio." }, { quoted: msg });
      }
    });

    reader.on("error", async (e) => {
      console.error("Erro stream YouTube:", e);
      await sock.sendMessage(from, { text: "❌ Erro ao baixar o áudio." }, { quoted: msg });
    });

  } catch (err) {
    console.error("Erro no YouTube:", err);
    await sock.sendMessage(from, { text: "❌ Erro ao baixar o áudio (verifique se o cookie está válido)." }, { quoted: msg });
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
          saveJSON(x1File, x1List);
          await sock.sendMessage(from, { text: `✅ @${sender.split("@")[0]} entrou no X1!`, mentions: [sender] });
        } else {
          await sock.sendMessage(from, { text: "⚠️ Você já está na lista do X1." }, { quoted: msg });
        }
      }

      if (text === "!sairx1") {
        if (x1List.includes(sender)) {
          x1List = x1List.filter((p) => p !== sender);
          saveJSON(x1File, x1List);
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
          } else {
            x1List = [];
            saveJSON(x1File, x1List);
            await sock.sendMessage(from, { text: "🗑️ Lista do X1 apagada!" });
          }
        } else {
          // no PV, dono pode limpar também (opcional manter)
          x1List = [];
          saveJSON(x1File, x1List);
          await sock.sendMessage(from, { text: "🗑️ Lista do X1 apagada!" });
        }
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
          saveJSON(x1File, x1List);
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
        } else {
          const action = text === "!fechargp" ? "announcement" : "not_announcement";
          try {
            await sock.groupSettingUpdate(from, action);
            await sock.sendMessage(
              from,
              { text: action === "announcement" ? "🔒 Grupo fechado (apenas admins podem enviar mensagens)." : "🔓 Grupo aberto (todos podem enviar mensagens)." }
            );
          } catch (e) {
            console.error("Erro ao atualizar configuração do grupo:", e);
            await sock.sendMessage(from, { text: "❌ Erro ao alterar as configurações do grupo." }, { quoted: msg });
          }
        }
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

  // retorna sock caso queira manipular externamente (não usado aqui)
  return sock;
}

connectBot().catch((e) => {
  console.error("Erro ao conectar bot:", e);
});
