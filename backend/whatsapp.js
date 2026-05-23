const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');

class WhatsAppManager {
  constructor() {
    this.client = null;
    this.io = null;
    this.status = 'Disconnected'; // Disconnected, QRReady, Connecting, Connected, QRExpired
    this.qrCode = '';
    this.senderNumber = '';
    this.initInProgress = false;
  }

  setSocketIO(io) {
    this.io = io;
  }

  emitStatus() {
    if (this.io) {
      this.io.emit('whatsapp-status', {
        status: this.status,
        qrCode: this.qrCode,
        senderNumber: this.senderNumber
      });
    }
  }

  async initialize() {
    if (this.initInProgress || (this.client && this.status === 'Connected')) {
      return;
    }
    
    this.initInProgress = true;
    this.status = 'Connecting';
    this.qrCode = '';
    this.emitStatus();

    try {
      const sessionPath = path.resolve(__dirname, 'whatsapp-session');
      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
      }

      // 100% STABILITY FIX: Clear any lingering Chromium SingletonLock to prevent profile lock collisions
      const lockPath = path.resolve(sessionPath, 'session', 'SingletonLock');
      if (fs.existsSync(lockPath)) {
        try {
          fs.rmSync(lockPath, { force: true });
          console.log('Cleared lingering Chromium SingletonLock to prevent profile lock collisions.');
        } catch (e) {
          console.warn('Could not clear SingletonLock directly:', e.message);
        }
      }

      const getExecutablePath = () => {
        if (process.platform === 'darwin') {
          const paths = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
            '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
          ];
          for (const p of paths) {
            if (fs.existsSync(p)) {
              console.log(`Auto-detected system browser for Puppeteer on macOS: ${p}`);
              return p;
            }
          }
        }
        return undefined;
      };

      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: sessionPath
        }),
        authTimeoutMs: 90000,
        qrTimeoutMs: 90000,
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
        },
        puppeteer: {
          headless: true,
          executablePath: getExecutablePath(),
          timeout: 90000,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
          ]
        }
      });

      this.client.on('qr', (qr) => {
        this.status = 'QRReady';
        this.qrCode = qr;
        console.log('WhatsApp QR received.');
        this.emitStatus();
      });

      this.client.on('authenticated', () => {
        console.log('WhatsApp Authenticated.');
      });

      this.client.on('auth_failure', (msg) => {
        console.error('WhatsApp Authentication Failure:', msg);
        this.status = 'Disconnected';
        this.qrCode = '';
        this.emitStatus();
      });

      this.client.on('ready', async () => {
        this.status = 'Connected';
        this.qrCode = '';
        this.senderNumber = this.client.info.wid.user;
        console.log('WhatsApp Client Ready. Connected as:', this.senderNumber);
        this.emitStatus();
      });

      this.client.on('disconnected', (reason) => {
        console.log('WhatsApp Disconnected:', reason);
        this.status = 'Disconnected';
        this.qrCode = '';
        this.senderNumber = '';
        this.emitStatus();
      });

      await this.client.initialize();
    } catch (err) {
      console.error('Failed to initialize WhatsApp Web client:', err);
      this.status = 'Disconnected';
      this.qrCode = '';
      this.emitStatus();
    } finally {
      this.initInProgress = false;
    }
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (err) {
        console.error('Error during client destruction:', err);
      }
      this.client = null;
      this.status = 'Disconnected';
      this.qrCode = '';
      this.senderNumber = '';
      this.emitStatus();
      
      // Clear persistent session paths to force clean state
      const sessionPath = path.resolve(__dirname, 'whatsapp-session');
      if (fs.existsSync(sessionPath)) {
        try {
          fs.rmSync(sessionPath, { recursive: true, force: true });
        } catch (e) {
          console.error('Could not completely delete session cache folder:', e.message);
        }
      }
    }
  }

  async sendMessage(rawPhone, text, attachment = null) {
    if (this.status !== 'Connected' || !this.client) {
      throw new Error('WhatsApp client is not connected');
    }

    // Helper to normalize phone number
    const normalizePhoneNumber = (input) => {
      let phone = String(input).replace(/\D/g, "");
      if (phone.length === 10) {
        phone = "91" + phone;
      }
      return phone;
    };

    const phone = normalizePhoneNumber(rawPhone);

    if (phone.length < 11 || phone.length > 15) {
      throw new Error("Invalid phone number format");
    }

    let numberId;
    try {
      numberId = await this.client.getNumberId(phone);
    } catch (err) {
      console.error(`getNumberId failed for ${phone}:`, err.message);
      throw new Error("Failed to check number details on WhatsApp");
    }

    if (!numberId) {
      throw new Error("Number not registered on WhatsApp");
    }

    const recipientJid = numberId._serialized;

    try {
      if (attachment && fs.existsSync(attachment.path)) {
        const media = MessageMedia.fromFilePath(attachment.path);
        return await this.client.sendMessage(recipientJid, media, { caption: text });
      } else {
        return await this.client.sendMessage(recipientJid, text);
      }
    } catch (err) {
      console.error(`sendMessage failed for ${recipientJid}:`, err.message);
      throw new Error("Failed to deliver message via WhatsApp Web");
    }
  }
}

module.exports = new WhatsAppManager();
