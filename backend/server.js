const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const csvParser = require('csv-parser');

const { initDatabase, Campaign, Contact, Blocklist, Setting } = require('./database');
const whatsappManager = require('./whatsapp');
const campaignQueue = require('./queue');

// Register global process error handlers to prevent Puppeteer browser issues from killing the Express server
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    methods: ['GET', 'POST', 'DELETE', 'PUT']
  }
});

app.use(cors());
app.use(express.json());

// 0. Dedicated Direct WhatsApp API Gateway Endpoint (Single Send)
app.post('/api/messages/send', async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    if (!message) {
      return res.status(400).json({ error: 'Message text is required' });
    }

    if (whatsappManager.status !== 'Connected') {
      return res.status(503).json({ error: 'WhatsApp is not connected. Please connect/scan the QR code first.' });
    }

    const result = await whatsappManager.sendMessage(phone, message);
    res.json({ success: true, message: 'Message sent successfully', messageId: result.id.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Setup file uploads destination
const uploadPath = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
  }
});
const upload = multer({ storage });

// Bind Socket.io with WhatsApp Manager
whatsappManager.setSocketIO(io);

io.on('connection', (socket) => {
  console.log('Socket client connected:', socket.id);
  
  // Immediately send current connection status
  socket.emit('whatsapp-status', {
    status: whatsappManager.status,
    qrCode: whatsappManager.qrCode,
    senderNumber: whatsappManager.senderNumber
  });

  socket.on('disconnect', () => {
    console.log('Socket client disconnected:', socket.id);
  });
});

// --- API Endpoints ---

// 1. WhatsApp Connection Status
app.get('/api/whatsapp/status', (req, res) => {
  res.json({
    status: whatsappManager.status,
    qrCode: whatsappManager.qrCode,
    senderNumber: whatsappManager.senderNumber
  });
});

// 2. WhatsApp Connect QR Start
app.post('/api/whatsapp/connect', async (req, res) => {
  try {
    whatsappManager.initialize();
    res.json({ success: true, message: 'Initialization started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. WhatsApp Disconnect
app.post('/api/whatsapp/disconnect', async (req, res) => {
  try {
    await whatsappManager.disconnect();
    res.json({ success: true, message: 'Disconnected successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Contact List Parsing (CSV / Excel Uploads)
app.post('/api/contacts/parse', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();
  const contactsList = [];

  try {
    if (ext === '.csv') {
      fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => {
          // Normalize column headers to lower case
          const normRow = {};
          Object.keys(row).forEach(k => {
            normRow[k.toLowerCase().trim()] = row[k];
          });

          const phone = normRow.phone || normRow.number || normRow.contact || '';
          if (phone) {
            contactsList.push({
              name: normRow.name || normRow.firstname || '',
              phone: phone.toString().replace(/\D/g, ''),
              custom1: normRow.custom1 || '',
              custom2: normRow.custom2 || ''
            });
          }
        })
        .on('end', () => {
          fs.unlinkSync(filePath); // Cleanup file
          res.json({ contacts: contactsList });
        })
        .on('error', (err) => {
          res.status(500).json({ error: err.message });
        });
    } else if (ext === '.xlsx' || ext === '.xls') {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet);

      rows.forEach((row) => {
        const normRow = {};
        Object.keys(row).forEach(k => {
          normRow[k.toLowerCase().trim()] = row[k];
        });

        const phone = normRow.phone || normRow.number || normRow.contact || '';
        if (phone) {
          contactsList.push({
            name: normRow.name || normRow.firstname || '',
            phone: phone.toString().replace(/\D/g, ''),
            custom1: normRow.custom1 || '',
            custom2: normRow.custom2 || ''
          });
        }
      });

      fs.unlinkSync(filePath);
      res.json({ contacts: contactsList });
    } else {
      fs.unlinkSync(filePath);
      res.status(400).json({ error: 'Unsupported file extension. Only CSV and Excel (.xlsx/.xls) supported.' });
    }
  } catch (err) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    res.status(500).json({ error: err.message });
  }
});

// 5. Campaigns Configuration (CRUD)
app.post('/api/campaigns', upload.single('attachment'), async (req, res) => {
  try {
    const { name, messageTemplate, cooldownMin, cooldownMax, dailyLimit, contacts } = req.body;
    
    // Parse contacts list
    let parsedContacts = [];
    if (contacts) {
      parsedContacts = typeof contacts === 'string' ? JSON.parse(contacts) : contacts;
    }

    const campaignData = {
      name,
      messageTemplate,
      cooldownMin: parseInt(cooldownMin, 10) || 5,
      cooldownMax: parseInt(cooldownMax, 10) || 15,
      dailyLimit: parseInt(dailyLimit, 10) || 200,
      status: 'pending'
    };

    if (req.file) {
      campaignData.attachmentPath = req.file.path;
      campaignData.attachmentName = req.file.originalname;
      campaignData.attachmentMimeType = req.file.mimetype;
    }

    const campaign = await Campaign.create(campaignData);

    // Save associated contacts
    if (parsedContacts && parsedContacts.length > 0) {
      const contactsToCreate = parsedContacts.map(c => ({
        campaignId: campaign.id,
        name: c.name || '',
        phone: c.phone.toString().replace(/\D/g, ''),
        custom1: c.custom1 || '',
        custom2: c.custom2 || '',
        status: 'pending'
      }));
      await Contact.bulkCreate(contactsToCreate);
    }

    res.json({ success: true, campaignId: campaign.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/campaigns', async (req, res) => {
  try {
    const campaigns = await Campaign.findAll({
      order: [['createdAt', 'DESC']]
    });
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/campaigns/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findByPk(req.params.id, {
      include: [{ model: Contact, as: 'contacts' }]
    });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Campaign Controllers (Start, Pause, Resume, Stop)
app.post('/api/campaigns/:id/start', async (req, res) => {
  try {
    await campaignQueue.startCampaign(parseInt(req.params.id, 10), io);
    res.json({ success: true, message: 'Campaign started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/campaigns/:id/pause', async (req, res) => {
  try {
    await campaignQueue.pauseCampaign(parseInt(req.params.id, 10), io);
    res.json({ success: true, message: 'Campaign paused' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/campaigns/:id/resume', async (req, res) => {
  try {
    await campaignQueue.startCampaign(parseInt(req.params.id, 10), io);
    res.json({ success: true, message: 'Campaign resumed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/campaigns/:id/stop', async (req, res) => {
  try {
    await campaignQueue.stopCampaign(parseInt(req.params.id, 10), io);
    res.json({ success: true, message: 'Campaign stopped' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Campaign Export Report (CSV Format)
app.get('/api/campaigns/:id/export', async (req, res) => {
  try {
    const campaign = await Campaign.findByPk(req.params.id, {
      include: [{ model: Contact, as: 'contacts' }]
    });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    let csvContent = 'Name,Phone,Custom1,Custom2,Status,Error,SentAt\n';
    campaign.contacts.forEach((c) => {
      const name = `"${(c.name || '').replace(/"/g, '""')}"`;
      const phone = `"${(c.phone || '').replace(/"/g, '""')}"`;
      const c1 = `"${(c.custom1 || '').replace(/"/g, '""')}"`;
      const c2 = `"${(c.custom2 || '').replace(/"/g, '""')}"`;
      const status = `"${c.status}"`;
      const error = `"${(c.error || '').replace(/"/g, '""')}"`;
      const sentAt = `"${c.sentAt ? c.sentAt.toISOString() : ''}"`;
      csvContent += `${name},${phone},${c1},${c2},${status},${error},${sentAt}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=campaign_report_${campaign.id}.csv`);
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Manual Blocklist Management
app.get('/api/blocklist', async (req, res) => {
  try {
    const blocks = await Blocklist.findAll({ order: [['createdAt', 'DESC']] });
    res.json(blocks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/blocklist', async (req, res) => {
  try {
    const { phone, reason } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    const cleanPhone = phone.toString().replace(/\D/g, '');
    const block = await Blocklist.create({ phone: cleanPhone, reason });
    res.json({ success: true, block });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/blocklist/:id', async (req, res) => {
  try {
    await Blocklist.destroy({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Removed from blocklist' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. General Settings Endpoints
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await Setting.findAll();
    const map = {};
    settings.forEach(s => map[s.key] = s.value);
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { senderNickname, dailyLimit } = req.body;
    if (senderNickname !== undefined) {
      await Setting.update({ value: senderNickname }, { where: { key: 'senderNickname' } });
    }
    if (dailyLimit !== undefined) {
      await Setting.update({ value: String(dailyLimit) }, { where: { key: 'dailyLimit' } });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bootstrapping function
const PORT = process.env.PORT || 5001;
async function startServer() {
  await initDatabase();
  server.listen(PORT, () => {
    console.log(`Express server running on port ${PORT}`);
  });
}

startServer();
