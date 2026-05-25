const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const fs = require('fs');

const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const dbPath = path.resolve(__dirname, 'database.sqlite');
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false
});

// Models Definition
const Setting = sequelize.define('Setting', {
  key: {
    type: DataTypes.STRING,
    primaryKey: true,
    unique: true
  },
  value: {
    type: DataTypes.TEXT,
    allowNull: false
  }
});

const Blocklist = sequelize.define('Blocklist', {
  phone: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false
  },
  reason: {
    type: DataTypes.STRING,
    allowNull: true
  }
});

const Campaign = sequelize.define('Campaign', {
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('draft', 'active', 'paused', 'completed', 'stopped'),
    defaultValue: 'draft'
  },
  messageTemplate: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  cooldownMin: {
    type: DataTypes.INTEGER,
    defaultValue: 5
  },
  cooldownMax: {
    type: DataTypes.INTEGER,
    defaultValue: 15
  },
  dailyLimit: {
    type: DataTypes.INTEGER,
    defaultValue: 200
  },
  useTemplate: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  templateName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  templateLanguage: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'en'
  }
});

const AppointmentSlot = sequelize.define('AppointmentSlot', {
  campaignId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  date: {
    type: DataTypes.STRING, // YYYY-MM-DD
    allowNull: false
  },
  time: {
    type: DataTypes.STRING, // HH:MM
    allowNull: false
  },
  maxBookings: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  },
  currentBookings: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
});

const Contact = sequelize.define('Contact', {
  campaignId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  messageStatus: {
    type: DataTypes.ENUM('pending', 'queued', 'sent', 'delivered', 'read', 'failed', 'replied'),
    defaultValue: 'pending'
  },
  selectedReply: {
    type: DataTypes.STRING,
    allowNull: true
  },
  appointmentSlotId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  callStatus: {
    type: DataTypes.ENUM('pending', 'confirmed', 'reschedule_needed', 'cancelled', 'no_answer', 'not_interested', 'opted_out'),
    defaultValue: 'pending'
  },
  lastCalledAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  callNotes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  optIn: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  metaMessageId: {
    type: DataTypes.STRING,
    allowNull: true
  }
});

const PresetReply = sequelize.define('PresetReply', {
  campaignId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  label: {
    type: DataTypes.STRING, // e.g. "1" or "Yes"
    allowNull: false
  },
  value: {
    type: DataTypes.STRING, // e.g. "Book appointment"
    allowNull: false
  },
  action: {
    type: DataTypes.ENUM('Book appointment', 'Mark not interested', 'Mark follow-up needed', 'Mark talk to human', 'Mark reschedule needed'),
    allowNull: false
  }
});

const Booking = sequelize.define('Booking', {
  campaignId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  contactId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  appointmentSlotId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  bookingStatus: {
    type: DataTypes.ENUM('Pending Confirmation', 'Confirmed', 'Reschedule Needed', 'Cancelled', 'No Answer'),
    defaultValue: 'Pending Confirmation'
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  }
});

const MessageLog = sequelize.define('MessageLog', {
  contactId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  direction: {
    type: DataTypes.ENUM('incoming', 'outgoing'),
    allowNull: false
  },
  messageText: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
});

// Associations
Campaign.hasMany(Contact, { as: 'contacts', foreignKey: 'campaignId', onDelete: 'CASCADE' });
Contact.belongsTo(Campaign, { foreignKey: 'campaignId' });

Campaign.hasMany(PresetReply, { as: 'presetReplies', foreignKey: 'campaignId', onDelete: 'CASCADE' });
PresetReply.belongsTo(Campaign, { foreignKey: 'campaignId' });

Campaign.hasMany(AppointmentSlot, { as: 'appointmentSlots', foreignKey: 'campaignId', onDelete: 'CASCADE' });
AppointmentSlot.belongsTo(Campaign, { foreignKey: 'campaignId' });

Contact.belongsTo(AppointmentSlot, { as: 'appointmentSlot', foreignKey: 'appointmentSlotId' });

Contact.hasMany(Booking, { as: 'bookings', foreignKey: 'contactId', onDelete: 'CASCADE' });
Booking.belongsTo(Contact, { foreignKey: 'contactId' });
Booking.belongsTo(Campaign, { foreignKey: 'campaignId' });
Booking.belongsTo(AppointmentSlot, { foreignKey: 'appointmentSlotId' });

Contact.hasMany(MessageLog, { as: 'logs', foreignKey: 'contactId', onDelete: 'CASCADE' });
MessageLog.belongsTo(Contact, { foreignKey: 'contactId' });

// Initialize database
async function initDatabase() {
  await sequelize.sync({ alter: true });
  console.log('Database synced successfully (SQLite).');
  
  // Set default configurations if they don't exist
  await Setting.findOrCreate({
    where: { key: 'senderNickname' },
    defaults: { value: 'My Outreach Assistant' }
  });
  
  await Setting.findOrCreate({
    where: { key: 'dailyLimit' },
    defaults: { value: '200' }
  });

  await Setting.findOrCreate({
    where: { key: 'dailySentCount' },
    defaults: { value: '0' }
  });

  await Setting.findOrCreate({
    where: { key: 'lastResetDate' },
    defaults: { value: new Date().toDateString() }
  });

  await Setting.findOrCreate({
    where: { key: 'businessName' },
    defaults: { value: 'My Business' }
  });

  await Setting.findOrCreate({
    where: { key: 'sendingMode' },
    defaults: { value: 'Manual' } // Defaults to Manual mode for safety, user can toggle to API
  });

  await Setting.findOrCreate({
    where: { key: 'whatsappAccessToken' },
    defaults: { value: process.env.WHATSAPP_ACCESS_TOKEN || '' }
  });

  await Setting.findOrCreate({
    where: { key: 'whatsappPhoneNumberId' },
    defaults: { value: process.env.WHATSAPP_PHONE_NUMBER_ID || '' }
  });

  await Setting.findOrCreate({
    where: { key: 'whatsappBusinessAccountId' },
    defaults: { value: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '' }
  });

  await Setting.findOrCreate({
    where: { key: 'whatsappVerifyToken' },
    defaults: { value: process.env.WHATSAPP_VERIFY_TOKEN || 'my_verify_token_123' }
  });

  await Setting.findOrCreate({
    where: { key: 'optOutKeyword' },
    defaults: { value: 'STOP' }
  });

  await Setting.findOrCreate({
    where: { key: 'disclaimerText' },
    defaults: { value: 'Disclaimer: Use only with contacts who have consented to receive WhatsApp messages.' }
  });

  await Setting.findOrCreate({
    where: { key: 'messageCostRate' },
    defaults: { value: '0.01' }
  });
}

module.exports = {
  sequelize,
  Setting,
  Blocklist,
  Campaign,
  Contact,
  PresetReply,
  AppointmentSlot,
  Booking,
  MessageLog,
  initDatabase
};
