// ==================== IMPORTS ====================
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  escapeMarkdown,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActivityType
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus
} = require("@discordjs/voice");

const fs = require("fs");
const path = require("path");


// ==================== CONFIG BOT ====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const TOKEN = process.env.TOKEN;
const prefix = "!/";


// ==================== VARIABLES GLOBALES ====================
const connections = new Map();
const players = new Map();
const queues = new Map();
const currentResources = new Map();
const currentMsg = new Map();
const pausedMsg = new Map();
const songHistory = new Map();

const volumesFile = path.join(__dirname, 'volumes.json');
let currentVolume = {};


// ==================== SISTEMA VOLUMEN ====================
if (fs.existsSync(volumesFile)) {
  currentVolume = JSON.parse(fs.readFileSync(volumesFile, 'utf8'));
}

function saveVolumes() {
  fs.writeFileSync(volumesFile, JSON.stringify(currentVolume, null, 2));
}


// ==================== MANEJO GLOBAL DE ERRORES ====================
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));


// ==================== READY ====================
client.once("clientReady", () => {
  console.log("Bot online ✅");
  client.user.setActivity('!/help', { type: ActivityType.Playing });
});


// ==================== HELPERS ====================
const borrarUsuario = async (message, tiempo = 250) =>
  setTimeout(() => message.delete().catch(() => {}), tiempo);

const normalize = (str) =>
  str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const findArtistFolder = (name) => {
  if (!fs.existsSync('./sounds')) return null;
  const folders = fs.readdirSync('./sounds')
    .filter(d => fs.lstatSync(path.join('./sounds', d)).isDirectory());
  return folders.find(f => normalize(f) === normalize(name));
};

const findSong = (artistFolder, input) => {
  const files = fs.readdirSync(path.join('./sounds', artistFolder))
    .filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
  if (!input) return files[0];
  const match = files.find(f => normalize(f).includes(normalize(input)));
  return match || files[0];
};


// ==================== CORE: PLAY SONG ====================
const playSong = async (guildId, channel) => {
  const player = players.get(guildId);
  const queue = queues.get(guildId);
  if (!player || !queue || queue.length === 0) return;

  const song = queue[0];
  if (!song || !song.archivo) {
    queue.shift();
    if (queue.length > 0) playSong(guildId, channel);
    return;
  }

  const { album, archivo, requester } = song;
  const pathActual = path.join("./sounds", album, archivo);

  if (!fs.existsSync(pathActual)) {
    queue.shift();
    if (queue.length > 0) playSong(guildId, channel);
    return;
  }

  let resource;
  try {
    resource = createAudioResource(pathActual, { inlineVolume: true });
  } catch {
    queue.shift();
    if (queue.length > 0) playSong(guildId, channel);
    return;
  }

  const vol = currentVolume[guildId] ?? 100;
  resource.volume.setVolume(vol / 100);
  currentResources.set(guildId, resource);

  if (player.state.status !== AudioPlayerStatus.Idle) {
    if (player.state.resource !== resource) player.stop();
  }

  player.play(resource);

  const fechaHora = new Date().toLocaleString();
  console.log(`|\n[${fechaHora}]\nreproduciendo ${archivo} de ${album}\nserver: ${channel.guild.name} (ID:${channel.guild.id})\npedido por: ${requester}\n|`);

  let siguiente = queue[1]?.archivo ? path.parse(queue[1].archivo).name : "-";
  const embed = new EmbedBuilder()
    .setTitle(`🎵 Reproduciendo: ${escapeMarkdown(path.parse(archivo).name)}`)
    .setDescription(`Siguiente: ${escapeMarkdown(siguiente)}`)
    .addFields({ name: "Pedido por", value: escapeMarkdown(requester) })
    .setColor("Red");

  if (currentMsg.get(guildId)) currentMsg.get(guildId).delete().catch(() => {});
  currentMsg.set(guildId, await channel.send({ embeds: [embed] }));

  player.once("stateChange", (_, newState) => {
    if (newState.status === AudioPlayerStatus.Idle) {
      if (currentMsg.get(guildId)) currentMsg.get(guildId).delete().catch(() => {});
      currentMsg.set(guildId, null);
      queue.shift();
      if (queue.length > 0) playSong(guildId, channel);
    }
  });
};


// -------------------- COMANDOS --------------------
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;
  borrarUsuario(message);

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const guildId = message.guild.id;

  if (!queues.has(guildId)) queues.set(guildId, []);
  if (!(guildId in currentVolume)) currentVolume[guildId] = 100;
  if (!songHistory.has(guildId)) songHistory.set(guildId, []);
  const queue = queues.get(guildId);

  // ==================== INFO / TEXTO ====================

  // -------------------- HELP --------------------
  if (command === "help") {
    const helpEmbed = new EmbedBuilder()
      .setTitle("Comandos del Bot")
      .setDescription("Aquí tienes todos los comandos:")
      .setColor("Red")
      .addFields(
        { name: " Música", value: "`!/play <album> <cancion>`\n`!/random <album>`" },
        { name: " Cola", value: "`!/queue`\n`!/queue add <album> <cancion>`\n`!/queue remove <1-10>`" },
        { name: " Listas", value: "`!/list`\n`!/list <album>`" },
        { name: " Utilidad", value: "`!/volume`, `!/volume <1-100>`\n`!/pause`, `!/resume`, `!/stop`, `!/skip`" }
      )
      .setFooter({ text: "v1.1" });

    message.author.send({ embeds: [helpEmbed] })
      .then(() => {
        message.channel.send("✅ Revisa tu DM.")
          .then(msg => setTimeout(() => msg.delete().catch(() => {}), 2000));
      })
      .catch(() => {
        message.channel.send("❌ No pude enviarte un DM.")
          .then(msg => setTimeout(() => msg.delete().catch(() => {}), 2000));
      });
  }

  // -------------------- LIST --------------------
  if (command === "list") {
    const albums = fs.existsSync('./sounds')
      ? fs.readdirSync('./sounds').filter(d => fs.lstatSync(path.join('./sounds', d)).isDirectory())
      : [];

    if (!args[0]) {
      if (!albums.length) return message.channel.send("❌ No hay albums disponibles")
        .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));

      const descripcion = albums.map(a => {
        const carpeta = path.join('./sounds', a);
        const canciones = fs.existsSync(carpeta)
          ? fs.readdirSync(carpeta).filter(f => f.endsWith('.mp3') || f.endsWith('.wav')).length
          : 0;
        return `• ${a} (${canciones} canciones)`;
      }).join("\n");

      const embed = new EmbedBuilder()
        .setTitle(" Lista de albums")
        .setColor("Red")
        .setDescription(descripcion);

      const botMsg = await message.channel.send({ embeds: [embed] });
      setTimeout(() => botMsg.delete().catch(() => {}), 30000);
    } else {
      const album = findArtistFolder(args[0]);
      if (!album) return message.channel.send("❌ album no disponible")
        .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));

      const carpeta = path.join('./sounds', album);
      const canciones = fs.existsSync(carpeta)
        ? fs.readdirSync(carpeta).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'))
        : [];

      if (!canciones.length) return message.channel.send("❌ Este album no tiene canciones")
        .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));

      const itemsPorPagina = 10;
      let pagina = 0;

      const generarEmbed = (pagina) => {
        const start = pagina * itemsPorPagina;
        const end = start + itemsPorPagina;
        const cancionesPagina = canciones.slice(start, end);

        return new EmbedBuilder()
          .setTitle(` Canciones de ${album}`)
          .setColor("Red")
          .setDescription(cancionesPagina.map((c, i) =>
            `**${start + i + 1}.** ${path.parse(c).name}`).join("\n"))
          .setFooter({ text: `Página ${pagina + 1} de ${Math.ceil(canciones.length / itemsPorPagina)}` });
      };

      const botones = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("prev").setLabel("⬅ Anterior").setStyle(ButtonStyle.Primary).setDisabled(true),
        new ButtonBuilder().setCustomId("next").setLabel("Siguiente ➡").setStyle(ButtonStyle.Primary)
          .setDisabled(canciones.length <= itemsPorPagina)
      );

      const botMsg = await message.channel.send({ embeds: [generarEmbed(pagina)], components: [botones] });
      const collector = botMsg.createMessageComponentCollector({ time: 30000 });

      collector.on("collect", async (interaction) => {
        if (!interaction.isButton()) return;
        if (interaction.customId === "next") pagina++;
        if (interaction.customId === "prev") pagina--;

        botones.components[0].setDisabled(pagina === 0);
        botones.components[1].setDisabled((pagina + 1) * itemsPorPagina >= canciones.length);

        await interaction.update({ embeds: [generarEmbed(pagina)], components: [botones] });
      });

      collector.on("end", () => {
        botones.components.forEach(b => b.setDisabled(true));
        botMsg.edit({ components: [botones] }).catch(() => {});
        botMsg.delete().catch(() => {});
      });
    }
  }

  // -------------------- QUEUE (VER) --------------------
  if (command === "queue" && !["add", "remove"].includes(args[0])) {
    const currentResource = currentResources.get(guildId);
    if ((!queue || queue.length === 0) && !currentResource) {
      return message.channel.send("❌ La cola está vacía y no hay reproducción activa")
        .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }

    const embed = new EmbedBuilder().setTitle(" Cola de reproducción").setColor("Red");
    let descripcion = "";

    if (currentResource && queue && queue[0]) {
      descripcion += `▶ **Ahora reproduciendo:** ${escapeMarkdown(path.parse(queue[0].archivo).name)} - Pedido por: ${escapeMarkdown(queue[0].requester)}\n\n`;
    }

    if (queue && queue.length > 1) {
      const mostrar = queue.slice(1, 11);
      descripcion += mostrar.map((item, index) =>
        `**${index + 1}.** ${escapeMarkdown(path.parse(item.archivo).name)} - Pedido por: ${escapeMarkdown(item.requester)}`
      ).join("\n");

      if (queue.length > 11) {
        embed.addFields([{ name: "…y más", value: `Total en cola: ${queue.length - 1} canciones` }]);
      }
    }

    embed.setDescription(descripcion || "La cola está vacía");
    const botMsg = await message.channel.send({ embeds: [embed] });
    setTimeout(() => botMsg.delete().catch(() => {}), 10000);
  }

  // ==================== CONEXIÓN VC ====================

  // -------------------- JOIN --------------------
  if (command === "join") {
    // Si ya estoy en un canal de voz
    if (connections.has(guildId)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription("❌ Ya estoy en un canal de voz")
            .setColor("Red");
        return message.channel.send({ embeds: [errorEmbed] })
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 2000));
    }

    const vc = message.member.voice.channel;

    // Si el usuario no está en VC
    if (!vc) {
        const errorEmbed = new EmbedBuilder()
            .setDescription("❌ Entra a un canal de voz primero")
            .setColor("Red");
        return message.channel.send({ embeds: [errorEmbed] })
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 2000));
    }

    // Verificar permisos del bot
    const permisos = vc.permissionsFor(message.guild.members.me);
    if (!permisos.has(["Connect", "Speak"])) {
        const errorEmbed = new EmbedBuilder()
            .setDescription("❌ No tengo permisos para unirme o hablar en este canal")
            .setColor("Red");
        return message.channel.send({ embeds: [errorEmbed] })
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }

    // Conexión al VC y creación del player
    const connection = joinVoiceChannel({
        channelId: vc.id,
        guildId: vc.guild.id,
        adapterCreator: vc.guild.voiceAdapterCreator,
        selfDeaf: false,
    });

    const player = createAudioPlayer();
    connection.subscribe(player);

    connections.set(guildId, connection);
    players.set(guildId, player);

    // Mensaje de éxito
    const successEmbed = new EmbedBuilder()
        .setDescription("✅ Entré a VC")
        .setColor("Red");
    return message.channel.send({ embeds: [successEmbed] })
        .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
  }


  // -------------------- LEAVE --------------------
  if (command === "leave") {
    const connection = connections.get(guildId);
    const player = players.get(guildId);
    if (connection && player) {
      player.stop();
      connection.destroy();
      connections.delete(guildId);
      players.delete(guildId);
      queues.set(guildId, []);
      currentResources.set(guildId, null);
      if (currentMsg.get(guildId)) { currentMsg.get(guildId).delete().catch(() => {}); currentMsg.set(guildId, null); }
      if (pausedMsg.get(guildId)) { pausedMsg.get(guildId).delete().catch(() => {}); pausedMsg.set(guildId, null); }

      const embed = new EmbedBuilder()
          .setDescription("👋 Salí del VC")
          .setColor("Red");

      message.channel.send({ embeds: [embed] })
          .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));

    }
  }

  // ==================== REPRODUCCIÓN / COLA ====================

  // -------------------- PLAY / RANDOM --------------------
  if (command === "play" || command === "random") {
    const player = players.get(guildId);

    // Error: no está en VC
    if (!player) {
        const errorEmbed = new EmbedBuilder()
            .setDescription("❌ No estoy en VC")
            .setColor("Red");
        return message.channel.send({ embeds: [errorEmbed] })
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }

    // Error: no se ingresó nombre del álbum
    if (!args[0]) {
        const errorEmbed = new EmbedBuilder()
            .setDescription("❌ Debes poner el nombre del álbum")
            .setColor("Red");
        return message.channel.send({ embeds: [errorEmbed] })
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }

    const album = findArtistFolder(args[0]);

    // Error: álbum no disponible
    if (!album) {
        const errorEmbed = new EmbedBuilder()
            .setDescription("❌ Álbum no disponible")
            .setColor("Red");
        return message.channel.send({ embeds: [errorEmbed] })
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }

    const carpeta = path.join("./sounds", album);
    const archivos = fs.readdirSync(carpeta).filter(f => f.endsWith(".mp3") || f.endsWith(".wav"));

    // Error: no hay canciones
    if (!archivos.length) {
        const errorEmbed = new EmbedBuilder()
            .setDescription("❌ No hay canciones disponibles")
            .setColor("Red");
        return message.channel.send({ embeds: [errorEmbed] })
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }

    let elegido;

    // Elegir canción aleatoria
    if (command === "random") {
        const history = songHistory.get(guildId) || [];
        const filtradas = archivos.filter(f => !history.includes(f));
        elegido = filtradas[Math.floor(Math.random() * filtradas.length)] || archivos[0];
        history.push(elegido);
        if (history.length > 10) history.shift();
        songHistory.set(guildId, history);
    } else {
        const cancionInput = args.slice(1).join(" ");
        elegido = findSong(album, cancionInput);
    }
    queue.unshift({ album, archivo: elegido, requester: message.author.tag });

    playSong(guildId, message.channel);
  }

  // -------------------- QUEUE ADD --------------------
  if (command === "queue" && args[0] === "add") {
    if (!args[1]) return message.channel.send("❌ Debes poner el album").then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
    const album = findArtistFolder(args[1]);
    if (!album) return message.channel.send("❌ album no disponible").then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));

    const carpeta = path.join("./sounds", album);
    const archivos = fs.readdirSync(carpeta).filter(f => f.endsWith(".mp3") || f.endsWith(".wav"));
    if (!archivos.length) return message.channel.send("❌ No hay canciones disponibles").then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));

    let elegido;
    const cancionInput = args.slice(2).join(" ");
    if (cancionInput) {
      elegido = findSong(album, cancionInput);
    } else {
      const history = songHistory.get(guildId);
      const filtradas = archivos.filter(f => !history.includes(f));
      elegido = filtradas[Math.floor(Math.random() * filtradas.length)] || archivos[0];
      history.push(elegido);
      if (history.length > 10) history.shift();
      songHistory.set(guildId, history);
    }

    queue.push({ album, archivo: elegido, requester: message.author.tag });
    const embed = new EmbedBuilder()
      .setTitle(" Canción agregada a la cola")
      .setDescription(`${escapeMarkdown(path.parse(elegido).name)} - Pedido por: ${escapeMarkdown(message.author.tag)}`)
      .setColor("Red");

    const botMsg = await message.channel.send({ embeds: [embed] });
    setTimeout(() => botMsg.delete().catch(() => {}), 5000);
  }

    // -------------------- QUEUE REMOVE --------------------
  if (command === "queue" && args[0] === "remove") {
    // Si no hay canciones en la cola
    if (!queue || queue.length <= 1) {
        const errorEmbed = new EmbedBuilder()
            .setDescription("❌ No hay canciones en la cola para eliminar")
            .setColor("Red");
        return message.channel.send({ embeds: [errorEmbed] })
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }

    let input = args[1];

    // Si no se especifica número o rango
    if (!input) {
        const errorEmbed = new EmbedBuilder()
            .setDescription("❌ Debes poner el número de la canción o rango")
            .setColor("Red");
        return message.channel.send({ embeds: [errorEmbed] })
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }

    // Parseo de índices
    let startIndex = parseInt(input.split('-')[0], 10);
    let endIndex = input.includes('-') ? parseInt(input.split('-')[1], 10) : startIndex;

    if (isNaN(startIndex) || isNaN(endIndex)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription("❌ Número inválido")
            .setColor("Red");
        return message.channel.send({ embeds: [errorEmbed] })
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }

    // Ajuste de rangos válidos
    if (startIndex < 1) startIndex = 1;
    if (endIndex >= queue.length) endIndex = queue.length - 1;
    if (startIndex > endIndex) [startIndex, endIndex] = [endIndex, startIndex];

    // Eliminación de canciones
    for (let i = endIndex; i >= startIndex; i--) queue.splice(i, 1);

    // Mensaje de éxito en embed
    const successEmbed = new EmbedBuilder()
        .setDescription(`✅ Eliminadas canciones de la posición ${startIndex} a ${endIndex}`)
        .setColor("Red");
    return message.channel.send({ embeds: [successEmbed] })
        .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
  }

  // ==================== CONTROLES ====================

   // -------------------- PAUSE --------------------
   if (command === "pause") {
     const player = players.get(guildId);
 
     // Si no se está reproduciendo
     if (!player || player.state.status !== AudioPlayerStatus.Playing) {
         const errorEmbed = new EmbedBuilder()
             .setDescription("❌ No se está reproduciendo")
             .setColor("Red");
         return message.channel.send({ embeds: [errorEmbed] })
             .then(msg => setTimeout(() => msg.delete().catch(() => {}), 2000));
     }
 
     // Pausa la reproducción
     player.pause();
 
     // Borra mensaje de pausa anterior si existe
     if (pausedMsg.get(guildId)) pausedMsg.get(guildId).delete().catch(() => {});
 
     // Envia mensaje de confirmación de pausa
     const embed = new EmbedBuilder()
         .setDescription("⏸ Pausado")
         .setColor("Red");
     const botMsg = await message.channel.send({ embeds: [embed] });
 
     // Guardamos el mensaje para poder borrarlo o actualizarlo luego
     pausedMsg.set(guildId, botMsg);
   }

  // -------------------- RESUME --------------------
  if (command === "resume") {
    const player = players.get(guildId);

    // Si no hay reproductor o no está pausado
    if (!player || player.state.status !== AudioPlayerStatus.Paused) {
        const errorEmbed = new EmbedBuilder()
            .setDescription("❌ No está pausado")
            .setColor("Red");
        return message.channel.send({ embeds: [errorEmbed] })
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 2000));
    }

    // Reanuda la reproducción
    player.unpause();

    // Borra mensaje de pausa anterior si existe
    if (pausedMsg.get(guildId)) {
        pausedMsg.get(guildId).delete().catch(() => {});
        pausedMsg.set(guildId, null);
    }

    // Embed de confirmación
    const embed = new EmbedBuilder()
        .setDescription("▶ Reanudado")
        .setColor("Red");

    const botMsg = await message.channel.send({ embeds: [embed] });
    setTimeout(() => botMsg.delete().catch(() => {}), 2000);
  }

  // -------------------- SKIP --------------------
  if (command === "skip") {
    const player = players.get(guildId);

    // Si no hay canción siguiente
    if (!player || queue.length === 0) {
        const embed = new EmbedBuilder()
            .setDescription("❌ No hay canción siguiente")
            .setColor("Red");
        return message.channel.send({ embeds: [embed] })
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 2000));
    }

    // Borra mensaje anterior si existe
    if (currentMsg.get(guildId)) currentMsg.get(guildId).delete().catch(() => {});

    // Salta la canción
    queue.shift();

    // Si hay más canciones, reproduce la siguiente
    if (queue.length > 0) {
        playSong(guildId, message.channel);
    }
  }

   // -------------------- STOP --------------------
   if (command === "stop") {
     const player = players.get(guildId);
     if (!player) return;
     player.stop();
     queues.set(guildId, []);
     currentResources.set(guildId, null);
     if (currentMsg.get(guildId)) { currentMsg.get(guildId).delete().catch(() => {}); currentMsg.set(guildId, null); }
     if (pausedMsg.get(guildId)) { pausedMsg.get(guildId).delete().catch(() => {}); pausedMsg.set(guildId, null); }
     
       const embed = new EmbedBuilder()
           .setDescription("⏹ Reproducción detenida")
           .setColor("Red");
 
       message.channel.send({ embeds: [embed] })
           .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
   }

  // ==================== CONFIG ====================

  // -------------------- VOLUMEN --------------------
  if (command === "volume") {
    const resource = currentResources.get(guildId);

    // Error: no hay canción reproduciéndose
    if (!resource) {
        const errorEmbed = new EmbedBuilder()
            .setDescription("❌ No hay canción reproduciéndose")
            .setColor("Red");
        return message.channel.send({ embeds: [errorEmbed] })
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }

    // Si no se pasa argumento, mostrar volumen actual
    if (!args[0]) {
        const currentVol = currentVolume[guildId] || 100;
        const embed = new EmbedBuilder()
            .setTitle("🔊 Volumen actual")
            .setDescription(`Está en **${currentVol}%**`)
            .setColor("Red");
        return message.channel.send({ embeds: [embed] })
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }

    // Parsear el nuevo volumen
    let newVolume = parseInt(args[0]?.replace('%', ''), 10);

    // Validar
    if (isNaN(newVolume) || newVolume < 1 || newVolume > 100) {
        const errorEmbed = new EmbedBuilder()
            .setDescription("❌ Ingresa un valor entre 1 y 100")
            .setColor("Red");
        return message.channel.send({ embeds: [errorEmbed] })
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }

    // Guardar volumen y persistir
    currentVolume[guildId] = newVolume;
    saveVolumes();
    resource.volume.setVolume(newVolume / 100);


    // Embed de confirmación
    const successEmbed = new EmbedBuilder()
        .setTitle("🔊 Volumen")
        .setDescription(`Se ha ajustado a **${newVolume}%**`)
        .setColor("Red");
    return message.channel.send({ embeds: [successEmbed] })
        .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
  }

});


// ==================== LOGIN ====================
client.login(TOKEN);
