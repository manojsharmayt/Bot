const {ChannelType,PermissionFlagsBits,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
const {api}=require('./apiService');
async function createTicket(interaction,panelId,subject='Support request'){
 const guild=interaction.guild, member=interaction.member;
 const panelData=await api('panels','GET',null,`guild_id=${guild.id}`);
 const panel=panelData.panels.find(p=>Number(p.id)===Number(panelId));
 if(!panel) throw new Error('This ticket panel is no longer available.');
 const safe=(interaction.user.username||'user').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,18)||'user';
 const channel=await guild.channels.create({name:`ticket-${safe}`,type:ChannelType.GuildText,parent:panel.category_id||undefined,permissionOverwrites:[
  {id:guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel]},
  {id:interaction.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles]},
  ...(panel.support_role_id?[{id:panel.support_role_id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}]:[])
 ]});
 try {
  const record=await api('ticket-create','POST',{panel_id:Number(panel.id),discord_user_id:interaction.user.id,discord_username:interaction.user.username,subject,channel_id:channel.id});
  const embed=new EmbedBuilder().setColor(panel.embed_color||'#e11d48').setTitle(record.ticket_code).setDescription(`Hello <@${interaction.user.id}>. Support staff will be with you shortly.`).addFields({name:'Subject',value:subject},{name:'Department',value:panel.department||'General Support'}).setTimestamp();
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket:claim:${record.ticket_id}`).setLabel('Claim').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`ticket:close:${record.ticket_id}`).setLabel('Close').setStyle(ButtonStyle.Danger));
  await channel.send({content:panel.support_role_id?`<@&${panel.support_role_id}>`:'',embeds:[embed],components:[row]});
  await interaction.editReply({content:`Your ticket has been created: ${channel}`});
 } catch(e) { await channel.delete('Ticket creation failed').catch(()=>{}); throw e; }
}
async function ticketAction(interaction,action,ticketId){
 if(!['claim','close'].includes(action)) return;
 // Acknowledge the button immediately so the Discord interaction does not time out
 // while the dashboard API is processing the update.
 await interaction.deferReply();

 if(action==='claim'){
  await api('ticket-update','POST',{
   ticket_id:Number(ticketId),
   status:'claimed',
   claimed_by:interaction.user.id
  });
  await interaction.editReply({content:`Ticket claimed by ${interaction.user}.`});
 } else if(action==='close'){
  await api('ticket-update','POST',{
   ticket_id:Number(ticketId),
   status:'closed',
   closed_by:interaction.user.id
  });
  await interaction.channel.permissionOverwrites.edit(
   interaction.guild.roles.everyone,
   {ViewChannel:false}
  ).catch(()=>{});
  await interaction.editReply({
   content:'Ticket closed. This channel will remain available to authorized staff for review.'
  });
 }
}
module.exports={createTicket,ticketAction};
