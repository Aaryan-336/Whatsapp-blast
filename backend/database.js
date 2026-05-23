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
  status: {
    type: DataTypes.ENUM('pending', 'active', 'paused', 'completed', 'stopped'),
    defaultValue: 'pending'
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
  attachmentPath: {
    type: DataTypes.STRING,
    allowNull: true
  },
  attachmentName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  attachmentMimeType: {
    type: DataTypes.STRING,
    allowNull: true
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
  custom1: {
    type: DataTypes.STRING,
    allowNull: true
  },
  custom2: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'sent', 'failed', 'excluded'),
    defaultValue: 'pending'
  },
  error: {
    type: DataTypes.STRING,
    allowNull: true
  },
  sentAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
});

// Associations
Campaign.hasMany(Contact, { as: 'contacts', foreignKey: 'campaignId', onDelete: 'CASCADE' });
Contact.belongsTo(Campaign, { foreignKey: 'campaignId' });

// Initialize database
async function initDatabase() {
  await sequelize.sync();
  console.log('Database synced successfully (SQLite).');
  
  // Set default configurations if they don't exist
  await Setting.findOrCreate({
    where: { key: 'senderNickname' },
    defaults: { value: 'My Campaign Sender' }
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
}

module.exports = {
  sequelize,
  Setting,
  Blocklist,
  Campaign,
  Contact,
  initDatabase
};
