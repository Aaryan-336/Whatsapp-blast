const { Campaign, Contact, Blocklist, Setting } = require('./database');
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

      // Check if WhatsApp is connected
      if (whatsappManager.status !== 'Connected') {
        console.log('WhatsApp is not connected. Pausing campaign queue.');
        campaign.status = 'paused';
        await campaign.save();
        io.emit('campaign-status-changed', { campaignId, status: 'paused', reason: 'WhatsApp Disconnected' });
        io.emit('toast-message', { type: 'error', text: 'WhatsApp disconnected! Campaign paused.' });
        this.activeCampaigns.delete(campaignId);
        return;
      }

      // Pick the next pending contact
      const contact = await Contact.findOne({
        where: { campaignId, status: 'pending' },
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

      // Guardrail Check: Automatic pause if safety limit of errors is triggered
      const totalContactsCount = await Contact.count({ where: { campaignId } });
      const failedContactsCount = await Contact.count({ where: { campaignId, status: 'failed' } });
      
      // Stop/pause if failure rate > 20% (only if we have processed at least 5 contacts)
      const processedCount = await Contact.count({
        where: { campaignId, status: ['sent', 'failed'] }
      });

      if (processedCount >= 5) {
        const failureRate = (failedContactsCount / processedCount) * 100;
        if (failureRate > 20) {
          campaign.status = 'paused';
          await campaign.save();
          io.emit('campaign-status-changed', { campaignId, status: 'paused', reason: 'High Failure Rate' });
          io.emit('toast-message', { type: 'error', text: 'Abnormally high error rate (>20%). Queue paused to protect your WhatsApp account.' });
          this.activeCampaigns.delete(campaignId);
          return;
        }
      }

      // Guardrail Check: Blocklist Check
      const blocked = await Blocklist.findOne({ where: { phone: contact.phone } });
      if (blocked) {
        contact.status = 'excluded';
        contact.error = 'Phone number is in blocklist/unsubscribed';
        await contact.save();
        io.emit('log-added', { contact });
        
        // Process next immediately
        this.scheduleNext(campaignId, 100, io);
        return;
      }

      // Compile and personalize campaign message
      let text = campaign.messageTemplate;
      text = text.replace(/{name}/g, contact.name || '');
      text = text.replace(/{phone}/g, contact.phone || '');
      text = text.replace(/{custom1}/g, contact.custom1 || '');
      text = text.replace(/{custom2}/g, contact.custom2 || '');

      let attachmentInfo = null;
      if (campaign.attachmentPath) {
        attachmentInfo = {
          path: campaign.attachmentPath,
          name: campaign.attachmentName,
          mimeType: campaign.attachmentMimeType
        };
      }

      try {
        await whatsappManager.sendMessage(contact.phone, text, attachmentInfo);
        
        // Success
        contact.status = 'sent';
        contact.sentAt = new Date();
        await contact.save();

        // Increment daily count setting
        const updatedSent = currentlySent + 1;
        await Setting.update({ value: String(updatedSent) }, { where: { key: 'dailySentCount' } });
        
        io.emit('log-added', { contact });
        io.emit('campaign-progress', {
          campaignId,
          sent: await Contact.count({ where: { campaignId, status: 'sent' } }),
          failed: await Contact.count({ where: { campaignId, status: 'failed' } }),
          pending: await Contact.count({ where: { campaignId, status: 'pending' } })
        });
      } catch (err) {
        // Classify error type
        if (err.message === "Number not registered on WhatsApp") {
          contact.status = 'excluded';
          contact.error = 'Number not registered on WhatsApp';
        } else {
          contact.status = 'failed';
          contact.error = err.message || 'Unknown error occurred';
        }
        await contact.save();

        io.emit('log-added', { contact });
        io.emit('campaign-progress', {
          campaignId,
          sent: await Contact.count({ where: { campaignId, status: 'sent' } }),
          failed: await Contact.count({ where: { campaignId, status: 'failed' } }),
          pending: await Contact.count({ where: { campaignId, status: 'pending' } })
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
