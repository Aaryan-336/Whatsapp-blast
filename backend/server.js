const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csvParser = require('csv-parser');
const xlsx = require('xlsx');
const { Sequelize } = require('sequelize');

const {
  initDatabase,
  Setting,
  Blocklist,
  Campaign,
  Contact,
  PresetReply,
  AppointmentSlot,
  Booking,
  MessageLog
} = require('./database');
const whatsappManager = require('./whatsapp');
const campaignQueue = require('./queue');

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

// Setup file uploads memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Bind Socket.io with WhatsApp Manager
whatsappManager.setSocketIO(io);

io.on('connection', (socket) => {
  console.log('Socket client connected:', socket.id);
  
  // Immediately send current connection status
  socket.emit('whatsapp-status', {
    status: whatsappManager.status,
    qrCode: '',
    senderNumber: whatsappManager.senderNumber
  });

  socket.on('disconnect', () => {
    console.log('Socket client disconnected:', socket.id);
  });
});

// --- WHATSAPP CLOUD API WEBHOOKS ---

// Webhook Verification (GET)
app.get('/api/whatsapp/webhook', async (req, res) => {
  try {
    const verifyTokenSetting = await Setting.findOne({ where: { key: 'whatsappVerifyToken' } });
    const verifyToken = verifyTokenSetting?.value || 'my_verify_token_123';

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === verifyToken) {
        console.log('Webhook verified successfully.');
        return res.status(200).send(challenge);
      } else {
        console.log('Webhook verification failed: Token mismatch.');
        return res.sendStatus(403);
      }
    }
    return res.sendStatus(400);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Webhook Event Receiver (POST)
app.post('/api/whatsapp/webhook', async (req, res) => {
  // Respond immediately to Meta
  res.sendStatus(200);

  try {
    const body = req.body;
    console.log('Incoming Webhook Event:', JSON.stringify(body));

    if (body.object !== 'whatsapp_business_account') {
      return;
    }

    const changes = body.entry?.[0]?.changes?.[0]?.value;
    if (!changes) return;

    // 1. Status Updates (sent, delivered, read, failed)
    if (changes.statuses && changes.statuses.length > 0) {
      for (const statusObj of changes.statuses) {
        const metaMessageId = statusObj.id;
        const status = statusObj.status; // sent, delivered, read, failed
        
        const contact = await Contact.findOne({ where: { metaMessageId } });
        if (contact) {
          contact.messageStatus = status === 'read' ? 'read' : 
                                 (status === 'delivered' ? 'delivered' : 
                                 (status === 'sent' ? 'sent' : 'failed'));
          if (status === 'failed') {
            const errorMsg = statusObj.errors?.[0]?.title || 'Meta sending failed';
            contact.notes = (contact.notes || '') + `\nStatus error: ${errorMsg}`;
          }
          await contact.save();
          
          // Emit socket notifications
          io.emit('campaign-progress', {
            campaignId: contact.campaignId,
            sent: await Contact.count({ where: { campaignId: contact.campaignId, messageStatus: 'sent' } }),
            failed: await Contact.count({ where: { campaignId: contact.campaignId, messageStatus: 'failed' } }),
            pending: await Contact.count({ where: { campaignId: contact.campaignId, messageStatus: 'pending' } })
          });
          io.emit('log-added', { contact });
        }
      }
    }

    // 2. Incoming Messages
    if (changes.messages && changes.messages.length > 0) {
      for (const msg of changes.messages) {
        const fromPhoneRaw = msg.from; // e.g. "919876543210"
        const msgText = msg.text?.body?.trim();
        if (!msgText) continue;

        const fromPhone = fromPhoneRaw.replace(/\D/g, '');

        // Search contact matching last 10 digits to bypass varying country codes
        let contact = null;
        if (fromPhone.length >= 10) {
          const trailing = fromPhone.slice(-10);
          contact = await Contact.findOne({
            where: {
              phone: { [Sequelize.Op.like]: `%${trailing}` },
              callStatus: { [Sequelize.Op.ne]: 'opted_out' }
            },
            order: [['createdAt', 'DESC']]
          });
        } else {
          contact = await Contact.findOne({
            where: { phone: fromPhone, callStatus: { [Sequelize.Op.ne]: 'opted_out' } },
            order: [['createdAt', 'DESC']]
          });
        }

        if (!contact) {
          console.log(`No active contact matches sender: ${fromPhone}`);
          continue;
        }

        // Save message log
        await MessageLog.create({
          contactId: contact.id,
          direction: 'incoming',
          messageText: msgText
        });

        // Check opt-out keyword
        const optOutSetting = await Setting.findOne({ where: { key: 'optOutKeyword' } });
        const optOutKeyword = optOutSetting?.value || 'STOP';

        if (msgText.toUpperCase() === optOutKeyword.toUpperCase()) {
          contact.callStatus = 'opted_out';
          contact.messageStatus = 'replied';
          contact.notes = (contact.notes || '') + `\nUser replied ${optOutKeyword}. Opted out.`;
          await contact.save();

          await Blocklist.findOrCreate({
            where: { phone: contact.phone },
            defaults: { reason: 'Opted out via STOP keyword' }
          });

          io.emit('log-added', { contact });
          continue;
        }

        // Match reply to Campaign Preset Replies
        const presetReplies = await PresetReply.findAll({ where: { campaignId: contact.campaignId } });
        let matched = null;

        for (const pr of presetReplies) {
          const label = pr.label.trim().toLowerCase();
          const valText = pr.value.trim().toLowerCase();
          const input = msgText.trim().toLowerCase();

          if (input === label || input === valText || input.startsWith(label + ' ') || input.includes(valText)) {
            matched = pr;
            break;
          }
        }

        contact.messageStatus = 'replied';
        if (matched) {
          contact.selectedReply = matched.value;
          contact.notes = (contact.notes || '') + `\nMatched Reply: ${matched.value}`;

          if (matched.action === 'Book appointment') {
            contact.callStatus = 'pending_confirmation';
            // Auto-assign first available slot
            const slot = await AppointmentSlot.findOne({
              where: {
                campaignId: contact.campaignId,
                currentBookings: { [Sequelize.Op.lt]: Sequelize.col('maxBookings') }
              },
              order: [['date', 'ASC'], ['time', 'ASC']]
            });

            if (slot) {
              slot.currentBookings += 1;
              await slot.save();

              contact.appointmentSlotId = slot.id;

              await Booking.create({
                campaignId: contact.campaignId,
                contactId: contact.id,
                appointmentSlotId: slot.id,
                bookingStatus: 'Pending Confirmation',
                notes: 'Auto-booked via incoming WhatsApp reply matching'
              });
              contact.notes = (contact.notes || '') + `\nAuto-booked slot ${slot.date} ${slot.time}`;
            } else {
              contact.notes = (contact.notes || '') + '\nRequested booking but no capacity slots available.';
            }
          } else if (matched.action === 'Mark not interested') {
            contact.callStatus = 'not_interested';
          } else if (matched.action === 'Mark follow-up needed' || matched.action === 'Mark talk to human') {
            contact.callStatus = 'pending';
            contact.notes = (contact.notes || '') + '\nFollow-up requested.';
          } else if (matched.action === 'Mark reschedule needed') {
            contact.callStatus = 'reschedule_needed';
          }
        } else {
          contact.notes = (contact.notes || '') + `\nIncoming message: "${msgText}"`;
        }

        await contact.save();
        io.emit('log-added', { contact });
        io.emit('toast-message', { type: 'success', text: `New reply from ${contact.name || contact.phone}: "${msgText.slice(0, 30)}"` });
      }
    }
  } catch (err) {
    console.error('Error handling webhook event:', err);
  }
});

// --- API ROUTES ---

// 1. Settings Endpoints
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
    const body = req.body;
    for (const key of Object.keys(body)) {
      await Setting.upsert({ key, value: String(body[key]) });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Blocklist Management
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
    if (!phone) return res.status(400).json({ error: 'Phone is required' });
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
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Campaign & Dashboard CRUD
app.get('/api/campaigns', async (req, res) => {
  try {
    const campaigns = await Campaign.findAll({
      order: [['createdAt', 'DESC']],
      include: [
        { model: Contact, as: 'contacts' },
        { model: PresetReply, as: 'presetReplies' },
        { model: AppointmentSlot, as: 'appointmentSlots' }
      ]
    });
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/campaigns/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findByPk(req.params.id, {
      include: [
        { model: Contact, as: 'contacts', include: [{ model: Booking, as: 'bookings' }] },
        { model: PresetReply, as: 'presetReplies' },
        { model: AppointmentSlot, as: 'appointmentSlots' }
      ]
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/campaigns', async (req, res) => {
  try {
    const {
      name,
      description,
      messageTemplate,
      cooldownMin,
      cooldownMax,
      dailyLimit,
      useTemplate,
      templateName,
      templateLanguage,
      contacts,
      presetReplies,
      appointmentSlots
    } = req.body;

    const campaign = await Campaign.create({
      name,
      description,
      messageTemplate,
      cooldownMin: parseInt(cooldownMin, 10) || 5,
      cooldownMax: parseInt(cooldownMax, 10) || 15,
      dailyLimit: parseInt(dailyLimit, 10) || 200,
      useTemplate: !!useTemplate,
      templateName: templateName || null,
      templateLanguage: templateLanguage || 'en',
      status: 'draft'
    });

    if (contacts && contacts.length > 0) {
      const contactsToCreate = contacts.map(c => ({
        campaignId: campaign.id,
        name: c.name || '',
        phone: c.phone.toString().replace(/\D/g, ''),
        notes: c.notes || '',
        messageStatus: 'pending',
        callStatus: 'pending',
        optIn: c.optIn !== undefined ? c.optIn : true
      }));
      await Contact.bulkCreate(contactsToCreate);
    }

    if (presetReplies && presetReplies.length > 0) {
      const repliesToCreate = presetReplies.map(r => ({
        campaignId: campaign.id,
        label: r.label,
        value: r.value,
        action: r.action
      }));
      await PresetReply.bulkCreate(repliesToCreate);
    }

    if (appointmentSlots && appointmentSlots.length > 0) {
      const slotsToCreate = appointmentSlots.map(s => ({
        campaignId: campaign.id,
        date: s.date,
        time: s.time,
        maxBookings: parseInt(s.maxBookings, 10) || 1,
        currentBookings: 0
      }));
      await AppointmentSlot.bulkCreate(slotsToCreate);
    }

    res.json({ success: true, campaignId: campaign.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/campaigns/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findByPk(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const { name, description, messageTemplate, cooldownMin, cooldownMax, dailyLimit, useTemplate, templateName, templateLanguage, status } = req.body;
    await campaign.update({
      name: name !== undefined ? name : campaign.name,
      description: description !== undefined ? description : campaign.description,
      messageTemplate: messageTemplate !== undefined ? messageTemplate : campaign.messageTemplate,
      cooldownMin: cooldownMin !== undefined ? parseInt(cooldownMin, 10) : campaign.cooldownMin,
      cooldownMax: cooldownMax !== undefined ? parseInt(cooldownMax, 10) : campaign.cooldownMax,
      dailyLimit: dailyLimit !== undefined ? parseInt(dailyLimit, 10) : campaign.dailyLimit,
      useTemplate: useTemplate !== undefined ? !!useTemplate : campaign.useTemplate,
      templateName: templateName !== undefined ? templateName : campaign.templateName,
      templateLanguage: templateLanguage !== undefined ? templateLanguage : campaign.templateLanguage,
      status: status !== undefined ? status : campaign.status
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/campaigns/:id', async (req, res) => {
  try {
    await Campaign.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Campaign Controls (Automated Mode Queue triggers)
app.post('/api/campaigns/:id/start', async (req, res) => {
  try {
    await campaignQueue.startCampaign(parseInt(req.params.id, 10), io);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/campaigns/:id/pause', async (req, res) => {
  try {
    await campaignQueue.pauseCampaign(parseInt(req.params.id, 10), io);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/campaigns/:id/stop', async (req, res) => {
  try {
    await campaignQueue.stopCampaign(parseInt(req.params.id, 10), io);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Contact Handlers
app.post('/api/campaigns/:id/contacts', async (req, res) => {
  try {
    const { name, phone, notes, optIn } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });
    const cleanPhone = phone.toString().replace(/\D/g, '');

    const contact = await Contact.create({
      campaignId: parseInt(req.params.id, 10),
      name: name || '',
      phone: cleanPhone,
      notes: notes || '',
      messageStatus: 'pending',
      callStatus: 'pending',
      optIn: optIn !== undefined ? !!optIn : true
    });
    res.json({ success: true, contact });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/contacts/:id', async (req, res) => {
  try {
    const contact = await Contact.findByPk(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const { name, phone, notes, messageStatus, selectedReply, appointmentSlotId, callStatus, callNotes, optIn } = req.body;
    
    // Manage appointment slot increment/decrement if slot changes
    let prevSlotId = contact.appointmentSlotId;
    
    await contact.update({
      name: name !== undefined ? name : contact.name,
      phone: phone !== undefined ? phone.toString().replace(/\D/g, '') : contact.phone,
      notes: notes !== undefined ? notes : contact.notes,
      messageStatus: messageStatus !== undefined ? messageStatus : contact.messageStatus,
      selectedReply: selectedReply !== undefined ? selectedReply : contact.selectedReply,
      appointmentSlotId: appointmentSlotId !== undefined ? appointmentSlotId : contact.appointmentSlotId,
      callStatus: callStatus !== undefined ? callStatus : contact.callStatus,
      callNotes: callNotes !== undefined ? callNotes : contact.callNotes,
      optIn: optIn !== undefined ? !!optIn : contact.optIn,
      lastCalledAt: callStatus !== undefined && callStatus !== contact.callStatus ? new Date() : contact.lastCalledAt
    });

    // Update appointment booking details accordingly
    if (appointmentSlotId !== undefined && appointmentSlotId !== prevSlotId) {
      if (prevSlotId) {
        const prevSlot = await AppointmentSlot.findByPk(prevSlotId);
        if (prevSlot) {
          prevSlot.currentBookings = Math.max(0, prevSlot.currentBookings - 1);
          await prevSlot.save();
        }
        await Booking.destroy({ where: { contactId: contact.id, appointmentSlotId: prevSlotId } });
      }

      if (appointmentSlotId) {
        const newSlot = await AppointmentSlot.findByPk(appointmentSlotId);
        if (newSlot) {
          newSlot.currentBookings += 1;
          await newSlot.save();
        }
        await Booking.create({
          campaignId: contact.campaignId,
          contactId: contact.id,
          appointmentSlotId,
          bookingStatus: 'Pending Confirmation',
          notes: 'Manually booked via CRM interface'
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/contacts/:id', async (req, res) => {
  try {
    const contact = await Contact.findByPk(req.params.id);
    if (contact) {
      if (contact.appointmentSlotId) {
        const slot = await AppointmentSlot.findByPk(contact.appointmentSlotId);
        if (slot) {
          slot.currentBookings = Math.max(0, slot.currentBookings - 1);
          await slot.save();
        }
      }
      await contact.destroy();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSV Contacts Parser (Client uploaded lists)
app.post('/api/contacts/parse', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const ext = path.extname(req.file.originalname).toLowerCase();
  const contactsList = [];

  try {
    if (ext === '.csv') {
      const { Readable } = require('stream');
      const csvStream = Readable.from([req.file.buffer.toString('utf-8')]);

      await new Promise((resolve, reject) => {
        csvStream
          .pipe(csvParser())
          .on('data', (row) => {
            try {
              const norm = {};
              Object.keys(row).forEach(k => {
                const cleanKey = k.replace(/^\ufeff/, '').toLowerCase().trim();
                norm[cleanKey] = row[k];
              });
              const phone = norm.phone || norm.number || norm.contact || '';
              if (phone) {
                contactsList.push({
                  name: norm.name || norm.firstname || '',
                  phone: phone.toString().replace(/\D/g, ''),
                  notes: norm.notes || norm.custom1 || ''
                });
              }
            } catch (err) {
              reject(err);
            }
          })
          .on('end', resolve)
          .on('error', reject);
      });

      res.json({ contacts: contactsList });
    } else if (ext === '.xlsx' || ext === '.xls') {
      const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
      const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      rows.forEach((row) => {
        const norm = {};
        Object.keys(row).forEach(k => {
          const cleanKey = k.replace(/^\ufeff/, '').toLowerCase().trim();
          norm[cleanKey] = row[k];
        });
        const phone = norm.phone || norm.number || norm.contact || '';
        if (phone) {
          contactsList.push({
            name: norm.name || norm.firstname || '',
            phone: phone.toString().replace(/\D/g, ''),
            notes: norm.notes || norm.custom1 || ''
          });
        }
      });
      res.json({ contacts: contactsList });
    } else {
      res.status(400).json({ error: 'Only CSV/Excel formats supported.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error processing file.' });
  }
});

// 5. Preset Replies CRUD
app.post('/api/campaigns/:id/replies', async (req, res) => {
  try {
    const { label, value, action } = req.body;
    const reply = await PresetReply.create({
      campaignId: parseInt(req.params.id, 10),
      label,
      value,
      action
    });
    res.json({ success: true, reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/preset-replies/:id', async (req, res) => {
  try {
    await PresetReply.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Slots CRUD
app.post('/api/campaigns/:id/slots', async (req, res) => {
  try {
    const { date, time, maxBookings } = req.body;
    const slot = await AppointmentSlot.create({
      campaignId: parseInt(req.params.id, 10),
      date,
      time,
      maxBookings: parseInt(maxBookings, 10) || 1,
      currentBookings: 0
    });
    res.json({ success: true, slot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/appointment-slots/:id', async (req, res) => {
  try {
    const slot = await AppointmentSlot.findByPk(req.params.id);
    if (slot) {
      // Release slot associations on contacts
      await Contact.update({ appointmentSlotId: null }, { where: { appointmentSlotId: slot.id } });
      await Booking.destroy({ where: { appointmentSlotId: slot.id } });
      await slot.destroy();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Bookings Management Endpoints
app.get('/api/bookings', async (req, res) => {
  try {
    const bookings = await Booking.findAll({
      order: [['createdAt', 'DESC']],
      include: [
        { model: Contact },
        { model: Campaign },
        { model: AppointmentSlot }
      ]
    });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/bookings/:id', async (req, res) => {
  try {
    const booking = await Booking.findByPk(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const { bookingStatus, notes } = req.body;
    await booking.update({
      bookingStatus: bookingStatus !== undefined ? bookingStatus : booking.bookingStatus,
      notes: notes !== undefined ? notes : booking.notes
    });

    // Also update associated contact callStatus
    if (bookingStatus) {
      let mappedCallStatus = 'pending_confirmation';
      if (bookingStatus === 'Confirmed') mappedCallStatus = 'confirmed';
      else if (bookingStatus === 'Reschedule Needed') mappedCallStatus = 'reschedule_needed';
      else if (bookingStatus === 'Cancelled') mappedCallStatus = 'cancelled';
      else if (bookingStatus === 'No Answer') mappedCallStatus = 'no_answer';

      await Contact.update(
        { callStatus: mappedCallStatus },
        { where: { id: booking.contactId } }
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    const booking = await Booking.findByPk(req.params.id);
    if (booking) {
      const slot = await AppointmentSlot.findByPk(booking.appointmentSlotId);
      if (slot) {
        slot.currentBookings = Math.max(0, slot.currentBookings - 1);
        await slot.save();
      }
      await Contact.update(
        { appointmentSlotId: null, callStatus: 'pending' },
        { where: { id: booking.contactId } }
      );
      await booking.destroy();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Contact Call Confirmation result
app.post('/api/contacts/:id/call', async (req, res) => {
  try {
    const { status, notes } = req.body;
    const contact = await Contact.findByPk(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    await contact.update({
      callStatus: status,
      callNotes: notes,
      lastCalledAt: new Date()
    });

    // Sync booking status if booking exists
    const booking = await Booking.findOne({ where: { contactId: contact.id } });
    if (booking) {
      let mappedBookingStatus = 'Pending Confirmation';
      if (status === 'confirmed') mappedBookingStatus = 'Confirmed';
      else if (status === 'reschedule_needed') mappedBookingStatus = 'Reschedule Needed';
      else if (status === 'cancelled') mappedBookingStatus = 'Cancelled';
      else if (status === 'no_answer') mappedBookingStatus = 'No Answer';

      await booking.update({ bookingStatus: mappedBookingStatus });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single Message Manual Dispatch Log Endpoint
app.post('/api/contacts/:id/manual-sent', async (req, res) => {
  try {
    const contact = await Contact.findByPk(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    contact.messageStatus = 'sent';
    await contact.save();

    // Create outgoing log entry
    const campaign = await Campaign.findByPk(contact.campaignId);
    const bizNameSetting = await Setting.findOne({ where: { key: 'businessName' } });
    const businessName = bizNameSetting?.value || 'Our Business';

    let text = campaign?.messageTemplate || 'Message sent';
    text = text.replace(/{{name}}/g, contact.name || '');
    text = text.replace(/{{phone}}/g, contact.phone || '');
    text = text.replace(/{{businessName}}/g, businessName);

    await MessageLog.create({
      contactId: contact.id,
      direction: 'outgoing',
      messageText: text
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Contact Message History
app.get('/api/contacts/:id/logs', async (req, res) => {
  try {
    const logs = await MessageLog.findAll({
      where: { contactId: req.params.id },
      order: [['timestamp', 'ASC']]
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Reports / CSV exports
app.get('/api/reports/contacts', async (req, res) => {
  try {
    const contacts = await Contact.findAll({ include: [{ model: Campaign }] });
    let csv = 'Name,Phone,Campaign,Notes,OptIn,MessageStatus,CallStatus\n';
    contacts.forEach(c => {
      csv += `"${c.name || ''}","${c.phone || ''}","${c.Campaign?.name || ''}","${(c.notes || '').replace(/"/g, '""')}","${c.optIn ? 'Yes' : 'No'}","${c.messageStatus}","${c.callStatus}"\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=all_contacts_report.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/api/reports/campaign/:campaignId/contacts', async (req, res) => {
  try {
    const contacts = await Contact.findAll({
      where: { campaignId: req.params.campaignId },
      include: [{ model: Campaign }]
    });
    let csv = 'Name,Phone,Notes,OptIn,MessageStatus,CallStatus\n';
    contacts.forEach(c => {
      csv += `"${c.name || ''}","${c.phone || ''}","${(c.notes || '').replace(/"/g, '""')}","${c.optIn ? 'Yes' : 'No'}","${c.messageStatus}","${c.callStatus}"\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=campaign_contacts_report_${req.params.campaignId}.csv`);
    res.send(csv);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/api/reports/replies', async (req, res) => {
  try {
    const contacts = await Contact.findAll({
      where: { messageStatus: 'replied' },
      include: [{ model: Campaign }]
    });
    let csv = 'CustomerName,Phone,Campaign,SelectedReply,Notes\n';
    contacts.forEach(c => {
      csv += `"${c.name || ''}","${c.phone || ''}","${c.Campaign?.name || ''}","${c.selectedReply || ''}","${(c.notes || '').replace(/"/g, '""')}"\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=replies_report.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/api/reports/bookings', async (req, res) => {
  try {
    const bookings = await Booking.findAll({
      include: [{ model: Contact }, { model: Campaign }, { model: AppointmentSlot }]
    });
    let csv = 'CustomerName,Phone,Campaign,SlotDate,SlotTime,BookingStatus,Notes\n';
    bookings.forEach(b => {
      csv += `"${b.Contact?.name || ''}","${b.Contact?.phone || ''}","${b.Campaign?.name || ''}","${b.AppointmentSlot?.date || ''}","${b.AppointmentSlot?.time || ''}","${b.bookingStatus}","${(b.notes || '').replace(/"/g, '""')}"\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=bookings_report.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/api/reports/calls', async (req, res) => {
  try {
    const contacts = await Contact.findAll({
      where: { callStatus: ['pending_confirmation', 'confirmed', 'reschedule_needed', 'no_answer', 'cancelled'] },
      include: [{ model: Campaign }]
    });
    let csv = 'CustomerName,Phone,Campaign,CallStatus,LastCalledAt,CallNotes\n';
    contacts.forEach(c => {
      csv += `"${c.name || ''}","${c.phone || ''}","${c.Campaign?.name || ''}","${c.callStatus}","${c.lastCalledAt ? c.lastCalledAt.toISOString() : ''}","${(c.callNotes || '').replace(/"/g, '""')}"\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=calls_report.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).send(err.message);
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
