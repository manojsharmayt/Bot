const {SlashCommandBuilder,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
const {api}=require('../services/apiService');
module.exports={
 data:new SlashCommandBuilder().setName('ticket-panel').setDescription('Publish a saved dashboard ticket panel').addIntegerOption(o=>o.setName('panel_id').setDescription('Panel ID from dashboard').setRequired(true)),
 async execute(interaction){
  await interaction.deferReply({ephemeral:true});
  const id=interaction.options.getInteger('panel_id');
  const result=await api('panels','GET',null,`guild_id=${interaction.guildId}`);
  const p=result.panels.find(x=>Number(x.id)===id);
  if(!p) return interaction.editReply('Panel not found or not enabled.');
  const channel=await interaction.guild.channels.fetch(p.channel_id);
  if(!channel) return interaction.editReply('Configured target channel was not found.');
  const embed=new EmbedBuilder().setColor(p.embed_color||'#e11d48').setTitle(p.name).setDescription(p.description||'Click below to open a private support ticket.');
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`panel:create:${p.id}`).setLabel(p.button_label||'Create Ticket').setStyle(ButtonStyle.Primary));
  const message=p.message_id?await channel.messages.fetch(p.message_id).catch(()=>null):null;
  const posted=message?await message.edit({embeds:[embed],components:[row]}):await channel.send({embeds:[embed],components:[row]});
  await api('panel-publish','POST',{panel_id:p.id,message_id:posted.id,channel_id:channel.id});
  await interaction.editReply(`Panel ${p.name} published in ${channel}.`);
 }
};
