require('dotenv').config();
const { 
    Client, GatewayIntentBits, REST, Routes, EmbedBuilder, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, 
    PermissionFlagsBits, Collection 
} = require('discord.js');
const { OpenAI } = require('openai');
const mongoose = require('mongoose'); // Importa o Banco de Dados 
const http = require('http');

// --- CONEXÃO COM O BANCO DE DADOS --- 
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('🍃 Conectado ao MongoDB!'))
    .catch(err => console.error('❌ Erro ao conectar ao MongoDB:', err));

// Esquema de dados do usuário 
const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    diamantes: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    lastDaily: { type: Date, default: null }
});
const User = mongoose.model('User', UserSchema);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers 
    ] 
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const xpCooldown = new Set();

// Comandos Slash
const commands = [
    { name: 'pergunta', description: 'IA: Faz uma pergunta ao ChatGPT', options: [{ name: 'texto', type: 3, description: 'Sua dúvida', required: true }] },
    { name: 'rank', description: 'Economia: Vê seu nível e diamantes' },
    { name: 'daily', description: 'Economia: Ganha diamantes diários' },
    { name: 'setup-ticket', description: 'Suporte: Painel de tickets' }
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Comandos registrados!');
    } catch (error) { console.error(error); }
})();

// --- SISTEMA DE XP COM SALVAMENTO NO BANCO --- 
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    if (!xpCooldown.has(message.author.id)) {
        // Busca ou cria o usuário no banco de dados 
        let user = await User.findOne({ userId: message.author.id });
        if (!user) user = await User.create({ userId: message.author.id });

        user.xp += Math.floor(Math.random() * 10) + 5;
        if (user.xp >= user.level * 100) {
            user.level++;
            user.xp = 0;
            message.channel.send(`🎉 **Level Up!** ${message.author} subiu para o nível **${user.level}**!`);
        }
        
        await user.save(); // Salva no MongoDB 
        xpCooldown.add(message.author.id);
        setTimeout(() => xpCooldown.delete(message.author.id), 30000);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options } = interaction;

    // IA
    if (commandName === 'pergunta') {
        await interaction.deferReply();
        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: options.getString('texto') }],
            });
            await interaction.editReply(`**🤖 Resposta:**\n${completion.choices[0].message.content}`);
        } catch (e) { await interaction.editReply("❌ Erro na IA."); }
    }

    // RANK DO BANCO DE DADOS 
    if (commandName === 'rank') {
        const user = await User.findOne({ userId: interaction.user.id }) || { diamantes: 0, level: 1, xp: 0 };
        const embed = new EmbedBuilder()
            .setTitle(`🏅 Status de ${interaction.user.username}`)
            .setColor('Gold')
            .addFields(
                { name: '💎 Diamantes', value: `${user.diamantes}`, inline: true },
                { name: '🆙 Nível', value: `${user.level}`, inline: true },
                { name: '✨ XP', value: `${user.xp} / ${user.level * 100}`, inline: false }
            );
        await interaction.reply({ embeds: [embed] });
    }

    // DAILY DO BANCO DE DADOS 
    if (commandName === 'daily') {
        let user = await User.findOne({ userId: interaction.user.id });
        if (!user) user = await User.create({ userId: interaction.user.id });

        const vinteQuatroHoras = 86400000;
        if (user.lastDaily && (Date.now() - user.lastDaily.getTime() < vinteQuatroHoras)) {
            return interaction.reply({ content: "❌ Você já resgatou seu prêmio hoje!", ephemeral: true });
        }

        user.diamantes += 200;
        user.lastDaily = new Date();
        await user.save();
        await interaction.reply("🎁 Você recebeu **200 diamantes**!");
    }
});

// Servidor para a Render
http.createServer((req, res) => { res.write("Bot Online!"); res.end(); }).listen(process.env.PORT || 3000);

client.login(process.env.TOKEN);