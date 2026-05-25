const { Campaign, Contact, Blocklist, Setting, AppointmentSlot, MessageLog } = require('./database');
const whatsappManager = require('./whatsapp');

class CampaignQueue {
  constructor() {
    this.activeCampaigns = new Map(); // campaignId -> timeoutReference
  }

  async resetDailyLimitsIfNeeded() {
    const today = new Date().toDateString();
    const lastReset = await Setting.findOne({ where: { key: 'lastResetDate' } });
    
    if (!lastReset || lastReset.value !== today) {
      await Setting.update({ value: '0' }, { where: { key: 'dailySentCount' } });
      await Setting.update({ value: today }, { where: { key: 'lastResetDate' } });
      console.log('Daily limits count reset for new day:', today);
    }
  }

  async startCampaign(campaignId, io) {
    if (this.activeCampaigns.has(campaignId)) {
      console.log(`Campaign ${campaignId} is already running.`);
      return;
    }

    await this.resetDailyLimitsIfNeeded();
    
    // Check if system is in Manual Mode
    const sendingMode = await Setting.findOne({ where: { key: 'sendingMode' } });
    if (sendingMode && sendingMode.value === 'Manual') {
      throw new Error('System is in Manual Mode. Campaigns cannot be automated in Manual Mode.');
    }

    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    campaign.status = 'active';
    await campaign.save();
    
    io.emit('campaign-status-changed', { campaignId, status: 'active' });
    
    // Begin step process loop
    this.processNext(campaignId, io);
  }

  async pauseCampaign(campaignId, io) {
    if (this.activeCampaigns.has(campaignId)) {
      clearTimeout(this.activeCampaigns.get(campaignId));
      this.activeCampaigns.delete(campaignId);
    }
    
    const campaign = await Campaign.findByPk(campaignId);
    if (campaign) {
      campaign.status = 'paused';
      await campaign.save();
      io.emit('campaign-status-changed', { campaignId, status: 'paused' });
    }
  }

  async stopCampaign(campaignId, io) {
    if (this.activeCampaigns.has(campaignId)) {
      clearTimeout(this.activeCampaigns.get(campaignId));
      this.activeCampaigns.delete(campaignId);
    }
    
    const campaign = await Campaign.findByPk(campaignId);
    if (campaign) {
      campaign.status = 'stopped';
      await campaign.save();
      io.emit('campaign-status-changed', { campaignId, status: 'stopped' });
    }
  }

  async processNext(campaignId, io) {
    try {
      await this.resetDailyLimitsIfNeeded();

      // Retrieve campaign settings
      const campaign = await Campaign.findByPk(campaignId);
      if (!campaign || campaign.status !== 'active') {
        this.activeCampaigns.delete(campaignId);
        return;
      }

      // Check system-wide sending mode double check
      const sendingMode = await Setting.findOne({ where: { key: 'sendingMode' } });
      if (sendingMode && sendingMode.value === 'Manual') {
        console.log('Sending mode changed to Manual. Pausing queue.');
        campaign.status = 'paused';
        await campaign.save();
        io.emit('campaign-status-changed', { campaignId, status: 'paused', reason: 'Mode changed to Manual' });
        this.activeCampaigns.delete(campaignId);
        return;
      }

      // Check daily safety thresholds
      const dailySentSetting = await Setting.findOne({ where: { key: 'dailySentCount' } });
      const dailyLimitVal = parseInt(campaign.dailyLimit || '200', 10);
      const currentlySent = parseInt(dailySentSetting ? dailySentSetting.value : '0', 10);

      if (currentlySent >= dailyLimitVal) {
        console.log(`Daily send limit of ${dailyLimitVal} reached. Pausing campaign.`);
        campaign.status = 'paused';
        await campaign.save();
        io.emit('campaign-status-changed', { campaignId, status: 'paused', reason: 'Daily limit reached' });
        io.emit('toast-message', { type: 'warning', text: 'Daily limit reached! Campaign paused.' });
        this.activeCampaigns.delete(campaignId);
        return;
      }

      // Pick the next pending contact
      const contact = await Contact.findOne({
        where: { campaignId, messageStatus: 'pending', optIn: true },
        order: [['id', 'ASC']]
      });

      if (!contact) {
        // Campaign Complete!
        campaign.status = 'completed';
        await campaign.save();
        io.emit('campaign-status-changed', { campaignId, status: 'completed' });
        io.emit('toast-message', { type: 'success', text: 'Campaign completed successfully!' });
        this.activeCampaigns.delete(campaignId);
        return;
      }

      // Guardrail Check: Blocklist Check
      const blocked = await Blocklist.findOne({ where: { phone: contact.phone } });
      if (blocked) {
        contact.messageStatus = 'failed';
        contact.notes = (contact.notes || '') + '\nExcluded: Number in opt-out blocklist.';
        await contact.save();
        io.emit('log-added', { contact });
        
        // Process next immediately
        this.scheduleNext(campaignId, 100, io);
        return;
      }

      // Resolve business nickname
      const bizNameSetting = await Setting.findOne({ where: { key: 'businessName' } });
      const businessName = bizNameSetting?.value || 'Our Business';

      // Resolve date/time if there's an appointment slot
      let appointmentDate = '';
      let appointmentTime = '';
      if (contact.appointmentSlotId) {
        const slot = await AppointmentSlot.findByPk(contact.appointmentSlotId);
        if (slot) {
          appointmentDate = slot.date;
          appointmentTime = slot.time;
        }
      }

      // Compile and personalize campaign message text
      let text = campaign.messageTemplate;
      text = text.replace(/{{name}}/g, contact.name || '');
      text = text.replace(/{{phone}}/g, contact.phone || '');
      text = text.replace(/{{businessName}}/g, businessName);
      text = text.replace(/{{campaignName}}/g, campaign.name || '');
      text = text.replace(/{{date}}/g, appointmentDate);
      text = text.replace(/{{time}}/g, appointmentTime);

      // Map template variables for Meta Cloud API template messages if configured
      let campaignTemplateConfig = null;
      if (campaign.useTemplate && campaign.templateName) {
        // Extract variables in order of appearance
        const regex = /{{[a-zA-Z0-9_]+}}/g;
        const matches = campaign.messageTemplate.match(regex) || [];
        const parameters = matches.map(match => {
          const varName = match.replace(/[{}]/g, '');
          let val = '';
          if (varName === 'name') val = contact.name || '';
          else if (varName === 'phone') val = contact.phone || '';
          else if (varName === 'businessName') val = businessName;
          else if (varName === 'campaignName') val = campaign.name || '';
          else if (varName === 'date') val = appointmentDate;
          else if (varName === 'time') val = appointmentTime;
          return { type: 'text', text: val };
        });

        campaignTemplateConfig = {
          useTemplate: true,
          templateName: campaign.templateName,
          templateLanguage: campaign.templateLanguage || 'en',
          parameters
        };
      }

      try {
        // Mark contact as queued while dispatching
        contact.messageStatus = 'queued';
        await contact.save();

        const result = await whatsappManager.sendMessage(contact.phone, text, campaignTemplateConfig);
        
        // Success
        contact.messageStatus = 'sent';
        contact.metaMessageId = result.messageId || null;
        await contact.save();

        // Increment daily count setting
        const updatedSent = currentlySent + 1;
        await Setting.update({ value: String(updatedSent) }, { where: { key: 'dailySentCount' } });
        
        // Log outgoing message in history
        await MessageLog.create({
          contactId: contact.id,
          direction: 'outgoing',
          messageText: text
        });

        io.emit('log-added', { contact });
        io.emit('campaign-progress', {
          campaignId,
          sent: await Contact.count({ where: { campaignId, messageStatus: 'sent' } }),
          failed: await Contact.count({ where: { campaignId, messageStatus: 'failed' } }),
          pending: await Contact.count({ where: { campaignId, messageStatus: 'pending' } })
        });
      } catch (err) {
        contact.messageStatus = 'failed';
        contact.notes = (contact.notes || '') + `\nSend failed: ${err.message}`;
        await contact.save();

        io.emit('log-added', { contact });
        io.emit('campaign-progress', {
          campaignId,
          sent: await Contact.count({ where: { campaignId, messageStatus: 'sent' } }),
          failed: await Contact.count({ where: { campaignId, messageStatus: 'failed' } }),
          pending: await Contact.count({ where: { campaignId, messageStatus: 'pending' } })
        });
      }

      // Safety Cooldown Delay: Fixed Minimum Cooldown + Jitter delay
      const minS = campaign.cooldownMin || 5;
      const maxS = campaign.cooldownMax || 15;
      const diff = Math.max(0, maxS - minS);
      const randomSeconds = minS + (Math.random() * diff);
      const delayMs = Math.round(randomSeconds * 1000);

      this.scheduleNext(campaignId, delayMs, io);
    } catch (err) {
      console.error('Queue processing iteration error:', err);
      // Wait slightly and retry next
      this.scheduleNext(campaignId, 5000, io);
    }
  }

  scheduleNext(campaignId, delayMs, io) {
    const timer = setTimeout(() => {
      this.processNext(campaignId, io);
    }, delayMs);
    this.activeCampaigns.set(campaignId, timer);
  }
}

module.exports = new CampaignQueue();
