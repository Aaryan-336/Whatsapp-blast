const axios = require('axios');
const { Setting } = require('./database');

class WhatsAppManager {
  constructor() {
    this.status = 'API Mode';
    this.senderNumber = '';
  }

  setSocketIO(io) {
    this.io = io;
  }

  emitStatus() {
    if (this.io) {
      this.io.emit('whatsapp-status', {
        status: this.status,
        qrCode: '',
        senderNumber: this.senderNumber
      });
    }
  }

  async initialize() {
    // No-op since we use official API
    this.status = 'API Mode';
    this.emitStatus();
  }

  async disconnect() {
    // No-op since we use official API
    this.emitStatus();
  }

  // Get credentials from DB settings or process.env
  async getCredentials() {
    const accessTokenSetting = await Setting.findOne({ where: { key: 'whatsappAccessToken' } });
    const phoneNumberIdSetting = await Setting.findOne({ where: { key: 'whatsappPhoneNumberId' } });
    const businessAccountIdSetting = await Setting.findOne({ where: { key: 'whatsappBusinessAccountId' } });
    const sendingModeSetting = await Setting.findOne({ where: { key: 'sendingMode' } });

    return {
      accessToken: accessTokenSetting?.value || process.env.WHATSAPP_ACCESS_TOKEN || '',
      phoneNumberId: phoneNumberIdSetting?.value || process.env.WHATSAPP_PHONE_NUMBER_ID || '',
      businessAccountId: businessAccountIdSetting?.value || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
      sendingMode: sendingModeSetting?.value || 'Manual'
    };
  }

  // Send message using Meta Cloud API
  async sendMessage(rawPhone, text, campaignTemplateConfig = null) {
    const creds = await this.getCredentials();
    
    if (creds.sendingMode === 'Manual') {
      throw new Error('System is in Manual Mode. Use prefilled WhatsApp Web link instead.');
    }

    if (!creds.accessToken || !creds.phoneNumberId) {
      throw new Error('WhatsApp API Credentials are not configured. Go to Settings to set them.');
    }

    // Normalize phone number: strip non-digits
    let phone = String(rawPhone).replace(/\D/g, "");
    
    // Ensure country code is present. WhatsApp Cloud API requires country code.
    if (phone.length === 10) {
      phone = "91" + phone; // Default country code (e.g. India)
    }

    const url = `https://graph.facebook.com/v20.0/${creds.phoneNumberId}/messages`;
    const headers = {
      'Authorization': `Bearer ${creds.accessToken}`,
      'Content-Type': 'application/json'
    };

    let data;

    if (campaignTemplateConfig && campaignTemplateConfig.useTemplate && campaignTemplateConfig.templateName) {
      // Send Template Message
      data = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'template',
        template: {
          name: campaignTemplateConfig.templateName,
          language: {
            code: campaignTemplateConfig.templateLanguage || 'en'
          }
        }
      };

      // Add template parameters if provided
      if (campaignTemplateConfig.parameters && campaignTemplateConfig.parameters.length > 0) {
        data.template.components = [
          {
            type: 'body',
            parameters: campaignTemplateConfig.parameters
          }
        ];
      }
    } else {
      // Send Text Message (as fallback / draft mode)
      data = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'text',
        text: {
          preview_url: false,
          body: text
        }
      };
    }

    console.log(`Sending Meta Cloud API request to ${phone}:`, JSON.stringify(data));

    try {
      const response = await axios.post(url, data, { headers });
      console.log('Meta Cloud API response:', response.data);
      if (response.data && response.data.messages && response.data.messages.length > 0) {
        return {
          success: true,
          messageId: response.data.messages[0].id
        };
      }
      return { success: true };
    } catch (err) {
      const errorData = err.response?.data || {};
      console.error('Meta Cloud API Error:', JSON.stringify(errorData));
      const errorMessage = errorData.error?.message || err.message || 'Unknown Meta API error';
      throw new Error(errorMessage);
    }
  }
}

module.exports = new WhatsAppManager();
