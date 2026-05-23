import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { 
  QrCode, Link2, ShieldAlert, CheckCircle2, AlertTriangle, 
  Play, Pause, Square, FileText, Upload, Copy, Settings as SettingsIcon, 
  Trash2, Plus, Download, RefreshCw, Layers, Check, X, ShieldAlert as AlertIcon,
  Eye, FileSpreadsheet
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5001';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'blocklist', 'settings'
  
  // WhatsApp States
  const [waStatus, setWaStatus] = useState('Disconnected');
  const [waQr, setWaQr] = useState('');
  const [senderNumber, setSenderNumber] = useState('');
  const [isWaLoading, setIsWaLoading] = useState(false);

  // Settings States
  const [senderNickname, setSenderNickname] = useState('My Campaign Sender');
  const [dailyLimit, setDailyLimit] = useState(200);
  const [dailySentCount, setDailySentCount] = useState(0);

  // Campaign Form States
  const [campaignName, setCampaignName] = useState('');
  const [messageTemplate, setMessageTemplate] = useState('Hello {name},\n\nThis is a friendly update regarding your request. Have a great day!');
  const [cooldownMin, setCooldownMin] = useState(5);
  const [cooldownMax, setCooldownMax] = useState(15);
  const [contacts, setContacts] = useState([]);
  const [attachment, setAttachment] = useState(null);
  const [attachmentName, setAttachmentName] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [googleSheetUrl, setGoogleSheetUrl] = useState('');
  const [duplicateCount, setDuplicateCount] = useState(0);

  // Active Campaign Status Tracker
  const [campaignsList, setCampaignsList] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [campaignDetails, setCampaignDetails] = useState(null);
  const [logsList, setLogsList] = useState([]);
  const [logFilter, setLogFilter] = useState('all'); // 'all', 'sent', 'failed', 'pending'

  // Blocklist states
  const [blocklist, setBlocklist] = useState([]);
  const [blockPhone, setBlockPhone] = useState('');
  const [blockReason, setBlockReason] = useState('');

  // UI Toast message
  const [toast, setToast] = useState(null);

  const socketRef = useRef(null);
  const fileInputRef = useRef(null);
  const attachmentInputRef = useRef(null);

  const showToast = (text, type = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Setup Socket Connection
  useEffect(() => {
    socketRef.current = io(API_BASE);

    socketRef.current.on('whatsapp-status', (data) => {
      setWaStatus(data.status);
      setWaQr(data.qrCode);
      setSenderNumber(data.senderNumber);
    });

    socketRef.current.on('campaign-status-changed', ({ campaignId, status, reason }) => {
      if (selectedCampaignId === campaignId) {
        setCampaignDetails(prev => prev ? { ...prev, status } : null);
      }
      loadCampaigns();
      if (reason) {
        showToast(`${reason}`, 'error');
      }
    });

    socketRef.current.on('campaign-progress', ({ campaignId, sent, failed, pending }) => {
      if (selectedCampaignId === campaignId) {
        setCampaignDetails(prev => prev ? { ...prev, sent, failed, pending } : null);
      }
      loadCampaigns();
    });

    socketRef.current.on('log-added', ({ contact }) => {
      if (selectedCampaignId === contact.campaignId) {
        setLogsList(prev => [contact, ...prev.filter(l => l.id !== contact.id)]);
      }
    });

    socketRef.current.on('toast-message', ({ type, text }) => {
      showToast(text, type);
    });

    // Initial Fetch
    loadCampaigns();
    loadBlocklist();
    loadSettings();

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [selectedCampaignId]);

  // Load configuration updates
  useEffect(() => {
    if (selectedCampaignId) {
      loadCampaignDetails(selectedCampaignId);
    }
  }, [selectedCampaignId]);

  const loadSettings = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/settings`);
      if (res.data.senderNickname) setSenderNickname(res.data.senderNickname);
      if (res.data.dailyLimit) setDailyLimit(parseInt(res.data.dailyLimit, 10));
      if (res.data.dailySentCount) setDailySentCount(parseInt(res.data.dailySentCount, 10));
    } catch (e) {
      console.error(e);
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/api/settings`, { senderNickname, dailyLimit });
      showToast('Settings saved successfully');
      loadSettings();
    } catch (e) {
      showToast('Failed to save settings', 'error');
    }
  };

  const loadCampaigns = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/campaigns`);
      setCampaignsList(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  const loadCampaignDetails = async (id) => {
    try {
      const res = await axios.get(`${API_BASE}/api/campaigns/${id}`);
      setCampaignDetails(res.data);
      
      // Calculate sent/failed/pending stats
      const contacts = res.data.contacts || [];
      const sent = contacts.filter(c => c.status === 'sent').length;
      const failed = contacts.filter(c => c.status === 'failed').length;
      const pending = contacts.filter(c => c.status === 'pending').length;
      
      setCampaignDetails(prev => ({
        ...res.data,
        sent,
        failed,
        pending,
        total: contacts.length
      }));

      // Sort logs descending by execution/sent date
      const sortedLogs = [...contacts].sort((a, b) => {
        if (a.status === 'pending') return 1;
        if (b.status === 'pending') return -1;
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });
      setLogsList(sortedLogs);
    } catch (e) {
      showToast('Failed to load campaign data', 'error');
    }
  };

  const loadBlocklist = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/blocklist`);
      setBlocklist(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  const addToBlocklist = async (e) => {
    e.preventDefault();
    if (!blockPhone) return;
    try {
      await axios.post(`${API_BASE}/api/blocklist`, { phone: blockPhone, reason: blockReason });
      showToast('Added number to blocklist');
      setBlockPhone('');
      setBlockReason('');
      loadBlocklist();
    } catch (e) {
      showToast('Failed to block number', 'error');
    }
  };

  const removeFromBlocklist = async (id) => {
    try {
      await axios.delete(`${API_BASE}/api/blocklist/${id}`);
      showToast('Removed number from blocklist');
      loadBlocklist();
    } catch (e) {
      showToast('Failed to remove number', 'error');
    }
  };

  // WhatsApp Connect Request
  const connectWhatsApp = async () => {
    setIsWaLoading(true);
    try {
      await axios.post(`${API_BASE}/api/whatsapp/connect`);
      showToast('Initializing WhatsApp connection');
    } catch (err) {
      showToast('Failed to connect WhatsApp', 'error');
    } finally {
      setIsWaLoading(false);
    }
  };

  // WhatsApp Disconnect Request
  const disconnectWhatsApp = async () => {
    setIsWaLoading(true);
    try {
      await axios.post(`${API_BASE}/api/whatsapp/disconnect`);
      showToast('WhatsApp session cleared');
    } catch (err) {
      showToast('Failed to disconnect WhatsApp', 'error');
    } finally {
      setIsWaLoading(false);
    }
  };

  // File Contact parser trigger
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post(`${API_BASE}/api/contacts/parse`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      processImportedContacts(res.data.contacts);
      showToast(`Parsed ${res.data.contacts.length} contacts successfully`);
    } catch (err) {
      showToast(err.response?.data?.error || 'File parsing error', 'error');
    } finally {
      // Clear file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Manual copy-paste parser
  const handleManualImport = () => {
    if (!manualInput.trim()) return;
    const lines = manualInput.split('\n');
    const imported = [];

    lines.forEach(line => {
      const cols = line.split(/[,\t;]+/);
      if (cols.length > 0) {
        const phone = cols[0].replace(/\D/g, '');
        if (phone) {
          imported.push({
            name: cols[1]?.trim() || '',
            phone,
            custom1: cols[2]?.trim() || '',
            custom2: cols[3]?.trim() || ''
          });
        }
      }
    });

    processImportedContacts(imported);
    setManualInput('');
    showToast(`Added ${imported.length} manual contacts`);
  };

  // Google Sheets Fetch
  const handleGoogleSheetsImport = () => {
    if (!googleSheetUrl) return;
    // Extract sheets spreadsheet ID
    const match = googleSheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) {
      showToast('Invalid Google Sheet URL format', 'error');
      return;
    }
    const key = match[1];
    const exportUrl = `https://docs.google.com/spreadsheets/d/${key}/export?format=csv`;

    showToast('Fetching Google Sheet...');
    axios.get(exportUrl)
      .then(res => {
        // Parse CSV string client-side
        const lines = res.data.split('\n');
        const imported = [];
        const headers = lines[0].split(',').map(h => h.toLowerCase().trim());
        
        const phoneIdx = headers.findIndex(h => h === 'phone' || h === 'number' || h === 'contact');
        const nameIdx = headers.findIndex(h => h === 'name' || h === 'firstname');
        const c1Idx = headers.findIndex(h => h === 'custom1');
        const c2Idx = headers.findIndex(h => h === 'custom2');

        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const cols = lines[i].split(',').map(c => c.replace(/^"|"$/g, '').trim());
          const phone = phoneIdx !== -1 ? cols[phoneIdx]?.replace(/\D/g, '') : cols[0]?.replace(/\D/g, '');
          
          if (phone) {
            imported.push({
              name: nameIdx !== -1 ? cols[nameIdx] : '',
              phone,
              custom1: c1Idx !== -1 ? cols[c1Idx] : '',
              custom2: c2Idx !== -1 ? cols[c2Idx] : ''
            });
          }
        }
        
        processImportedContacts(imported);
        setGoogleSheetUrl('');
        showToast(`Parsed ${imported.length} contacts from Google Sheets`);
      })
      .catch(err => {
        showToast('Google Sheet must be shared public to access', 'error');
      });
  };

  // Duplicate cleaner and contact aggregator
  const processImportedContacts = (newList) => {
    const existingPhones = new Set(contacts.map(c => c.phone));
    const uniqueNew = [];
    let dups = 0;

    newList.forEach(c => {
      if (existingPhones.has(c.phone)) {
        dups++;
      } else {
        uniqueNew.push(c);
        existingPhones.add(c.phone);
      }
    });

    setContacts(prev => [...prev, ...uniqueNew]);
    setDuplicateCount(prev => prev + dups);
  };

  const removeContact = (phone) => {
    setContacts(prev => prev.filter(c => c.phone !== phone));
  };

  const clearContacts = () => {
    setContacts([]);
    setDuplicateCount(0);
  };

  const handleAttachment = (e) => {
    const file = e.target.files[0];
    if (file) {
      setAttachment(file);
      setAttachmentName(file.name);
    }
  };

  // Create Campaign Request
  const createCampaign = async (e) => {
    e.preventDefault();
    if (!campaignName) {
      showToast('Please enter a campaign name', 'error');
      return;
    }
    if (contacts.length === 0) {
      showToast('Please import at least 1 contact', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('name', campaignName);
    formData.append('messageTemplate', messageTemplate);
    formData.append('cooldownMin', cooldownMin);
    formData.append('cooldownMax', cooldownMax);
    formData.append('dailyLimit', dailyLimit);
    formData.append('contacts', JSON.stringify(contacts));
    if (attachment) {
      formData.append('attachment', attachment);
    }

    try {
      const res = await axios.post(`${API_BASE}/api/campaigns`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      showToast('Campaign created successfully!');
      setCampaignName('');
      setContacts([]);
      setAttachment(null);
      setAttachmentName('');
      setDuplicateCount(0);
      loadCampaigns();
      setSelectedCampaignId(res.data.campaignId);
    } catch (e) {
      showToast('Failed to create campaign', 'error');
    }
  };

  // Campaign controls
  const triggerCampaignStart = async (id) => {
    try {
      await axios.post(`${API_BASE}/api/campaigns/${id}/start`);
      showToast('Campaign loop started');
      loadCampaignDetails(id);
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to start campaign', 'error');
    }
  };

  const triggerCampaignPause = async (id) => {
    try {
      await axios.post(`${API_BASE}/api/campaigns/${id}/pause`);
      showToast('Campaign paused');
      loadCampaignDetails(id);
    } catch (e) {
      showToast('Failed to pause campaign', 'error');
    }
  };

  const triggerCampaignStop = async (id) => {
    try {
      await axios.post(`${API_BASE}/api/campaigns/${id}/stop`);
      showToast('Campaign stopped');
      loadCampaignDetails(id);
    } catch (e) {
      showToast('Failed to stop campaign', 'error');
    }
  };

  // Filter logs list
  const filteredLogs = logsList.filter(log => {
    if (logFilter === 'all') return true;
    return log.status === logFilter;
  });

  return (
    <div className="min-h-screen bg-darkBg text-gray-200 font-sans flex flex-col">
      
      {/* Toast Alert */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-2xl border text-sm font-medium transition-all duration-300 transform translate-y-0 ${
          toast.type === 'success' ? 'bg-[#064e3b] text-emerald-300 border-[#047857]' : 
          toast.type === 'warning' ? 'bg-[#78350f] text-amber-300 border-[#b45309]' : 
          'bg-[#7f1d1d] text-rose-300 border-[#b91c1c]'
        }`}>
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
          {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400" />}
          {toast.type === 'error' && <ShieldAlert className="w-5 h-5 text-rose-400" />}
          <span>{toast.text}</span>
        </div>
      )}

      {/* Navigation Headers */}
      <header className="bg-darkCard border-b border-darkBorder sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center text-darkBg font-extrabold text-xl shadow-lg shadow-primary-500/20">
              W
            </div>
            <div>
              <h1 className="font-extrabold text-lg tracking-tight text-white flex items-center gap-2">
                WhatsApp Campaigner <span className="text-xs bg-[#064e3b] text-primary-400 border border-primary-500/20 px-2 py-0.5 rounded-full">Legit-Only v1</span>
              </h1>
              <p className="text-xs text-gray-500 font-medium">Safe bulk communication platform</p>
            </div>
          </div>

          {/* Quick status monitor */}
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2 bg-darkBg/60 border border-darkBorder px-3 py-1.5 rounded-lg">
              <span className={`w-2 h-2 rounded-full ${
                waStatus === 'Connected' ? 'bg-emerald-500 animate-pulse' : 
                waStatus === 'QRReady' || waStatus === 'Connecting' ? 'bg-amber-500 animate-pulse' : 'bg-rose-500'
              }`} />
              <span className="font-semibold text-xs text-gray-300">WhatsApp:</span>
              <span className={`text-xs font-bold ${
                waStatus === 'Connected' ? 'text-emerald-400' : 
                waStatus === 'QRReady' || waStatus === 'Connecting' ? 'text-amber-400' : 'text-gray-400'
              }`}>{waStatus}</span>
              {senderNumber && <span className="text-[10px] text-gray-500 ml-1">({senderNumber})</span>}
            </div>

            <div className="flex items-center gap-2 bg-darkBg/60 border border-darkBorder px-3 py-1.5 rounded-lg">
              <span className="text-xs text-gray-400">Daily:</span>
              <span className="text-xs font-bold text-gray-200">{dailySentCount} / {dailyLimit}</span>
            </div>
          </div>

          <div className="flex gap-1.5 bg-darkBg border border-darkBorder p-1 rounded-xl">
            <button 
              onClick={() => { setActiveTab('dashboard'); setSelectedCampaignId(null); }}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'dashboard' && !selectedCampaignId ? 'bg-primary-600 text-darkBg shadow-md shadow-primary-500/10' : 'text-gray-400 hover:text-white'
              }`}
            >
              Dashboard
            </button>
            <button 
              onClick={() => { setActiveTab('blocklist'); setSelectedCampaignId(null); }}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'blocklist' ? 'bg-primary-600 text-darkBg shadow-md shadow-primary-500/10' : 'text-gray-400 hover:text-white'
              }`}
            >
              Unsubscribe list
            </button>
            <button 
              onClick={() => { setActiveTab('settings'); setSelectedCampaignId(null); }}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'settings' ? 'bg-primary-600 text-darkBg shadow-md shadow-primary-500/10' : 'text-gray-400 hover:text-white'
              }`}
            >
              Settings
            </button>
          </div>
        </div>
      </header>

      {/* Main View Grid */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Anti-spam notice bar */}
        <div className="mb-8 bg-amber-950/20 border border-amber-900/40 p-4 rounded-xl flex items-start gap-3">
          <AlertIcon className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-1">Safety & Legitimate Messaging Guidelines</h4>
            <p className="text-xs text-gray-400 leading-relaxed">
              WhatsApp maintains zero tolerance for spam. Keep contacts opted-in, format dynamic tags to avoid robotic repetitions, and adhere to conservative cooldown ranges (15-60s) to keep your account in good standing. Avoid bulk messaging unsolicited numbers.
            </p>
          </div>
        </div>

        {activeTab === 'dashboard' && !selectedCampaignId && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* LEFT COLUMN: Setup stepper & creation */}
            <div className="lg:col-span-2 space-y-8">
              
              {/* STEP 1: Connect WhatsApp QR */}
              <div className="bg-darkCard border border-darkBorder rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 bg-primary-500 h-full" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary-950 text-primary-400 border border-primary-500/20 flex items-center justify-center text-[10px] font-black">1</span>
                  Connect WhatsApp Web
                </h3>

                <div className="flex flex-col md:flex-row items-center gap-6">
                  {waStatus === 'QRReady' && waQr ? (
                    <div className="bg-white p-3 rounded-2xl flex flex-col items-center shadow-xl border border-emerald-500/30">
                      {/* Generates standard QR representation */}
                      <div className="w-44 h-44 flex items-center justify-center bg-gray-100 rounded-lg">
                        <img 
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(waQr)}`} 
                          alt="WhatsApp QR Code"
                          className="w-40 h-40"
                        />
                      </div>
                      <span className="text-[10px] text-gray-500 font-bold mt-2 uppercase tracking-wide flex items-center gap-1 animate-pulse">
                        <QrCode className="w-3.5 h-3.5 text-emerald-600" /> Scan QR code via WhatsApp
                      </span>
                    </div>
                  ) : (
                    <div className="w-48 h-48 rounded-2xl bg-darkBg border border-darkBorder flex flex-col items-center justify-center text-center p-4">
                      {waStatus === 'Connected' ? (
                        <>
                          <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-2" />
                          <span className="text-xs font-extrabold text-emerald-400 uppercase tracking-wider">Authenticated</span>
                          <span className="text-[10px] text-gray-500 font-semibold mt-1">Ready for sending</span>
                        </>
                      ) : waStatus === 'Connecting' ? (
                        <>
                          <RefreshCw className="w-8 h-8 text-amber-500 animate-spin mb-3" />
                          <span className="text-xs font-bold text-amber-400 animate-pulse">Establishing browser...</span>
                        </>
                      ) : (
                        <>
                          <QrCode className="w-10 h-10 text-gray-600 mb-3" />
                          <span className="text-xs font-semibold text-gray-500">Not Connected</span>
                        </>
                      )}
                    </div>
                  )}

                  <div className="flex-1 space-y-4">
                    <p className="text-xs text-gray-400 leading-relaxed">
                      To connect your device, tap **Menu** or **Settings** on your mobile phone, select **Linked Devices**, and scan the QR code. We store authentication local caches securely.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {waStatus !== 'Connected' && (
                        <button
                          type="button"
                          onClick={connectWhatsApp}
                          disabled={isWaLoading}
                          className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:bg-gray-800 text-darkBg text-xs font-extrabold flex items-center gap-2 transition-all"
                        >
                          {isWaLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Connect WhatsApp'}
                        </button>
                      )}
                      {waStatus !== 'Disconnected' && (
                        <button
                          type="button"
                          onClick={disconnectWhatsApp}
                          disabled={isWaLoading}
                          className="px-4 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/35 text-xs font-extrabold flex items-center gap-2 transition-all"
                        >
                          Clear Session
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* STEP 2: Contacts Import Panel */}
              <div className="bg-darkCard border border-darkBorder rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 bg-primary-500 h-full" />
                <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-primary-950 text-primary-400 border border-primary-500/20 flex items-center justify-center text-[10px] font-black">2</span>
                    Import Receivers
                  </h3>
                  {contacts.length > 0 && (
                    <button 
                      onClick={clearContacts}
                      className="text-[10px] font-extrabold text-rose-400 hover:text-rose-300 bg-rose-950/20 px-2.5 py-1 border border-rose-800/20 rounded-lg flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Clear All ({contacts.length})
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* File parse inputs */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">Excel or CSV File Upload</label>
                      <div className="border border-dashed border-darkBorder hover:border-primary-500/30 rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-colors relative">
                        <Upload className="w-8 h-8 text-gray-500 mb-2" />
                        <span className="text-xs font-bold text-gray-300">Click to Browse File</span>
                        <span className="text-[10px] text-gray-500 mt-1">Accepts CSV, XLSX or XLS formats</span>
                        <input 
                          type="file" 
                          ref={fileInputRef}
                          onChange={handleFileUpload}
                          accept=".csv,.xlsx,.xls"
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">Google Sheet Address</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Link2 className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
                          <input 
                            type="text" 
                            placeholder="Public spreadsheet URL..."
                            value={googleSheetUrl}
                            onChange={(e) => setGoogleSheetUrl(e.target.value)}
                            className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-gray-600 outline-none"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleGoogleSheetsImport}
                          className="px-3 py-2 bg-darkBg border border-darkBorder hover:border-primary-600 text-primary-400 rounded-xl text-xs font-bold flex items-center gap-1 transition-all"
                        >
                          Import
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Manual parse textbox */}
                  <div>
                    <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">Manual Copy-Paste</label>
                    <textarea 
                      placeholder="Enter numbers (phone,name,custom1,custom2) - One per line&#10;Example:&#10;15550199,John,VIP,Standard&#10;15550299,Alice,Standard,Premium"
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      rows={5}
                      className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl p-3 text-xs text-white placeholder-gray-600 outline-none resize-none"
                    />
                    <button 
                      type="button"
                      onClick={handleManualImport}
                      className="mt-2 w-full py-2 bg-darkBg border border-darkBorder hover:border-primary-600 text-primary-400 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" /> Parse Text Lines
                    </button>
                  </div>
                </div>

                {/* Parsed Contacts List Preview */}
                {contacts.length > 0 && (
                  <div className="mt-6 border-t border-darkBorder pt-4">
                    <div className="flex justify-between text-xs text-gray-400 font-bold mb-3">
                      <span>Parsed Contacts ({contacts.length})</span>
                      {duplicateCount > 0 && <span className="text-amber-400 font-semibold">{duplicateCount} duplicates filtered</span>}
                    </div>

                    <div className="max-h-48 overflow-y-auto border border-darkBorder rounded-xl divide-y divide-darkBorder">
                      {contacts.map((contact, idx) => (
                        <div key={idx} className="flex justify-between items-center px-4 py-2.5 text-xs bg-darkBg/30 hover:bg-darkBg/60">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
                            <span className="font-semibold text-white truncate">{contact.name || 'No Name'}</span>
                            <span className="font-mono text-gray-400">{contact.phone}</span>
                            <span className="text-gray-500 truncate text-[10px]">{contact.custom1 || '-'}</span>
                            <span className="text-gray-500 truncate text-[10px]">{contact.custom2 || '-'}</span>
                          </div>
                          <button 
                            onClick={() => removeContact(contact.phone)}
                            className="text-gray-500 hover:text-rose-400 p-1"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* STEP 3 & 4: Compose Template & Cooldown */}
              <form onSubmit={createCampaign} className="space-y-8">
                
                {/* Step 3: Message templates */}
                <div className="bg-darkCard border border-darkBorder rounded-2xl p-6 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 bg-primary-500 h-full" />
                  <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-primary-950 text-primary-400 border border-primary-500/20 flex items-center justify-center text-[10px] font-black">3</span>
                    Write Campaign Message
                  </h3>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">Campaign Name</label>
                      <input 
                        type="text" 
                        placeholder="e.g. VIP Member Product Updates"
                        value={campaignName}
                        onChange={(e) => setCampaignName(e.target.value)}
                        className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2 text-xs text-white placeholder-gray-600 outline-none"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Message Template</label>
                        <div className="flex gap-1.5">
                          {['{name}', '{phone}', '{custom1}', '{custom2}'].map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => setMessageTemplate(prev => prev + tag)}
                              className="text-[9px] font-bold font-mono bg-darkBg border border-darkBorder hover:border-primary-600 text-primary-400 px-2 py-0.5 rounded"
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      </div>

                      <textarea 
                        value={messageTemplate}
                        onChange={(e) => setMessageTemplate(e.target.value)}
                        rows={6}
                        className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl p-4 text-xs text-white placeholder-gray-600 outline-none resize-none leading-relaxed"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">Media Attachment (Optional)</label>
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => attachmentInputRef.current?.click()}
                          className="px-4 py-2 bg-darkBg border border-darkBorder hover:border-primary-600 text-primary-400 text-xs font-bold rounded-xl flex items-center gap-2 transition-all"
                        >
                          <Upload className="w-4 h-4" /> Select File
                        </button>
                        <input 
                          type="file"
                          ref={attachmentInputRef}
                          onChange={handleAttachment}
                          className="hidden"
                        />
                        {attachmentName ? (
                          <div className="flex items-center gap-2 bg-darkBg border border-darkBorder px-3 py-1.5 rounded-xl text-xs">
                            <span className="text-gray-300 truncate max-w-[200px]">{attachmentName}</span>
                            <button 
                              type="button" 
                              onClick={() => { setAttachment(null); setAttachmentName(''); }}
                              className="text-rose-400 hover:text-rose-300"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-500 font-semibold">No media selected (supports Images, Documents, PDFs)</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 4: Cooldown options */}
                <div className="bg-darkCard border border-darkBorder rounded-2xl p-6 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 bg-primary-500 h-full" />
                  <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-primary-950 text-primary-400 border border-primary-500/20 flex items-center justify-center text-[10px] font-black">4</span>
                    Cooldown & Queue Safeguards
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">Random Cooldown Delay</label>
                        <span className="text-xs font-extrabold text-primary-400">{cooldownMin}s – {cooldownMax}s</span>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center justify-between text-[10px] text-gray-500 font-semibold">
                            <span>Min wait: {cooldownMin}s</span>
                            <span>Max wait: {cooldownMax}s</span>
                          </div>
                          <div className="flex gap-4">
                            <input 
                              type="range" 
                              min="5" 
                              max="60" 
                              value={cooldownMin}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                setCooldownMin(val);
                                if (cooldownMax < val) setCooldownMax(val);
                              }}
                              className="w-full accent-primary-500 bg-darkBg"
                            />
                            <input 
                              type="range" 
                              min="5" 
                              max="120" 
                              value={cooldownMax}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                setCooldownMax(Math.max(val, cooldownMin));
                              }}
                              className="w-full accent-primary-500 bg-darkBg"
                            />
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-500 mt-2 font-medium">
                        Ensures a fluctuating delay range. Emulates natural human pauses to bypass account blocks.
                      </p>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">Daily Limit Cap</label>
                        <span className="text-xs font-extrabold text-primary-400">{dailyLimit} msgs</span>
                      </div>
                      <input 
                        type="range" 
                        min="20" 
                        max="500" 
                        step="10"
                        value={dailyLimit}
                        onChange={(e) => setDailyLimit(parseInt(e.target.value, 10))}
                        className="w-full accent-primary-500 bg-darkBg"
                      />
                      <p className="text-[10px] text-gray-500 mt-2 font-medium">
                        Prevents automated spikes. Campaign halts if current-day broadcasts hit this threshold.
                      </p>
                    </div>
                  </div>
                </div>

                {/* STEP 5: Create Campaign Trigger */}
                <div className="bg-darkCard border border-darkBorder rounded-2xl p-6 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 bg-primary-500 h-full" />
                  <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-primary-950 text-primary-400 border border-primary-500/20 flex items-center justify-center text-[10px] font-black">5</span>
                    Pre-Flight Checklist
                  </h3>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-2 text-gray-400 font-semibold">
                        <span className={`w-1.5 h-1.5 rounded-full ${contacts.length > 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        {contacts.length > 0 ? `${contacts.length} Contacts loaded` : 'No contacts imported'}
                      </div>
                      <div className="flex items-center gap-2 text-gray-400 font-semibold">
                        <span className={`w-1.5 h-1.5 rounded-full ${waStatus === 'Connected' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        WhatsApp Device: {waStatus}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={contacts.length === 0 || !campaignName}
                      className="px-6 py-3 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:bg-gray-800 disabled:text-gray-600 text-darkBg text-xs font-extrabold shadow-lg shadow-primary-500/10 hover:shadow-primary-500/20 transition-all flex items-center justify-center gap-2"
                    >
                      <Layers className="w-4 h-4" /> Save & Prepare Campaign
                    </button>
                  </div>
                </div>

              </form>

            </div>

            {/* RIGHT COLUMN: Campaign History List */}
            <div className="space-y-6">
              <div className="bg-darkCard border border-darkBorder rounded-2xl p-6">
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
                  Campaign Directory
                </h3>

                {campaignsList.length === 0 ? (
                  <div className="text-center py-8 border border-dashed border-darkBorder rounded-xl">
                    <FileText className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                    <span className="text-xs text-gray-500 font-bold block">No campaigns created yet</span>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                    {campaignsList.map((camp) => (
                      <div 
                        key={camp.id}
                        onClick={() => setSelectedCampaignId(camp.id)}
                        className={`p-4 border rounded-xl cursor-pointer hover:border-primary-500/40 hover:bg-darkBg/20 transition-all ${
                          selectedCampaignId === camp.id ? 'bg-[#0f172a]/20 border-primary-500/60' : 'bg-darkBg/10 border-darkBorder'
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <h4 className="text-xs font-extrabold text-white truncate max-w-[150px]">{camp.name}</h4>
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                            camp.status === 'completed' ? 'bg-[#064e3b] text-primary-400' :
                            camp.status === 'active' ? 'bg-amber-950 text-amber-400 animate-pulse' :
                            camp.status === 'paused' ? 'bg-slate-800 text-slate-400' :
                            'bg-zinc-900 text-zinc-400'
                          }`}>{camp.status}</span>
                        </div>
                        
                        <div className="flex justify-between items-center mt-3 text-[10px] text-gray-500 font-semibold">
                          <span>Created {new Date(camp.createdAt).toLocaleDateString()}</span>
                          <span className="text-gray-400 flex items-center gap-1">
                            <Eye className="w-3.5 h-3.5 text-primary-400" /> View Details
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {/* Campaign execution & Live Progress view */}
        {activeTab === 'dashboard' && selectedCampaignId && campaignDetails && (
          <div className="space-y-8">
            
            {/* Header / breadcrumb navigation */}
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => { setSelectedCampaignId(null); setCampaignDetails(null); }}
                  className="text-xs font-bold text-primary-400 hover:underline bg-darkCard border border-darkBorder px-3 py-1.5 rounded-xl transition-all"
                >
                  &larr; Back to Dashboard
                </button>
                <span className="text-gray-600 font-bold">/</span>
                <span className="text-xs text-white font-extrabold font-mono">{campaignDetails.name}</span>
              </div>

              <div className="flex gap-2">
                {campaignDetails.status !== 'active' && (
                  <button 
                    onClick={() => triggerCampaignStart(campaignDetails.id)}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-darkBg text-xs font-extrabold rounded-xl flex items-center gap-1.5 transition-all shadow-lg shadow-primary-500/10"
                  >
                    <Play className="w-3.5 h-3.5 fill-darkBg" /> Start Campaign
                  </button>
                )}
                {campaignDetails.status === 'active' && (
                  <button 
                    onClick={() => triggerCampaignPause(campaignDetails.id)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-darkBg text-xs font-extrabold rounded-xl flex items-center gap-1.5 transition-all"
                  >
                    <Pause className="w-3.5 h-3.5 fill-darkBg" /> Pause
                  </button>
                )}
                {campaignDetails.status === 'active' && (
                  <button 
                    onClick={() => triggerCampaignStop(campaignDetails.id)}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold rounded-xl flex items-center gap-1.5 transition-all"
                  >
                    <Square className="w-3.5 h-3.5 fill-white" /> Stop
                  </button>
                )}
                <a 
                  href={`${API_BASE}/api/campaigns/${campaignDetails.id}/export`}
                  className="px-4 py-2 bg-darkCard border border-darkBorder hover:border-emerald-600 text-emerald-400 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all"
                >
                  <Download className="w-3.5 h-3.5" /> Export Logs
                </a>
              </div>
            </div>

            {/* Campaign Parameters metadata */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              
              <div className="bg-darkCard border border-darkBorder rounded-2xl p-5 flex flex-col justify-between">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2">Campaign Status</span>
                <span className={`text-sm font-black uppercase ${
                  campaignDetails.status === 'active' ? 'text-amber-400 animate-pulse' :
                  campaignDetails.status === 'completed' ? 'text-emerald-400' : 'text-gray-400'
                }`}>{campaignDetails.status}</span>
              </div>

              <div className="bg-darkCard border border-darkBorder rounded-2xl p-5 flex flex-col justify-between">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2">Jitter Cooldown</span>
                <span className="text-sm font-extrabold text-white">{campaignDetails.cooldownMin}s – {campaignDetails.cooldownMax}s</span>
              </div>

              <div className="bg-darkCard border border-darkBorder rounded-2xl p-5 flex flex-col justify-between">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2">Daily Threshold limit</span>
                <span className="text-sm font-extrabold text-white">{campaignDetails.dailyLimit} messages</span>
              </div>

              <div className="bg-darkCard border border-darkBorder rounded-2xl p-5 flex flex-col justify-between">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2">Attachment file</span>
                <span className="text-xs font-bold text-gray-300 truncate">{campaignDetails.attachmentName || 'None'}</span>
              </div>

            </div>

            {/* Message Template Draft View */}
            <div className="bg-darkCard border border-darkBorder rounded-2xl p-6">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Message Draft Template</h4>
              <pre className="bg-darkBg border border-darkBorder rounded-xl p-4 text-xs font-mono text-gray-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                {campaignDetails.messageTemplate}
              </pre>
            </div>

            {/* Campaign Counters progress bar */}
            <div className="bg-darkCard border border-darkBorder rounded-2xl p-6">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Transmission metrics</h4>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mb-6">
                
                <div className="bg-darkBg border border-darkBorder p-4 rounded-xl text-center">
                  <span className="text-2xl font-black text-white">{campaignDetails.total || 0}</span>
                  <span className="block text-[10px] text-gray-500 uppercase tracking-wider font-bold mt-1">Total Recipients</span>
                </div>

                <div className="bg-[#022c22]/30 border border-[#047857]/30 p-4 rounded-xl text-center">
                  <span className="text-2xl font-black text-emerald-400">{campaignDetails.sent || 0}</span>
                  <span className="block text-[10px] text-emerald-500 uppercase tracking-wider font-bold mt-1">Dispatched</span>
                </div>

                <div className="bg-[#450a0a]/30 border border-[#b91c1c]/30 p-4 rounded-xl text-center">
                  <span className="text-2xl font-black text-rose-400">{campaignDetails.failed || 0}</span>
                  <span className="block text-[10px] text-rose-500 uppercase tracking-wider font-bold mt-1">Errors</span>
                </div>

                <div className="bg-darkBg border border-darkBorder p-4 rounded-xl text-center">
                  <span className="text-2xl font-black text-gray-400">{campaignDetails.pending || 0}</span>
                  <span className="block text-[10px] text-gray-500 uppercase tracking-wider font-bold mt-1">Remaining</span>
                </div>

              </div>

              {/* Progress Slider */}
              {campaignDetails.total > 0 && (
                <div>
                  <div className="flex justify-between text-[10px] text-gray-500 font-bold mb-2">
                    <span>Progress Tracker</span>
                    <span>{Math.round(((campaignDetails.sent + campaignDetails.failed) / campaignDetails.total) * 100)}% Completed</span>
                  </div>
                  <div className="w-full h-2.5 bg-darkBg rounded-full overflow-hidden flex">
                    <div 
                      className="bg-emerald-500 transition-all duration-300"
                      style={{ width: `${(campaignDetails.sent / campaignDetails.total) * 100}%` }}
                    />
                    <div 
                      className="bg-rose-500 transition-all duration-300"
                      style={{ width: `${(campaignDetails.failed / campaignDetails.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Campaign Logs list table */}
            <div className="bg-darkCard border border-darkBorder rounded-2xl p-6">
              <div className="flex justify-between items-center flex-wrap gap-4 mb-4">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Live Send Log records</h4>
                
                <div className="flex gap-1 bg-darkBg border border-darkBorder p-1 rounded-xl">
                  {['all', 'sent', 'failed', 'pending'].map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setLogFilter(filter)}
                      className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${
                        logFilter === filter ? 'bg-primary-600 text-darkBg' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border border-darkBorder rounded-xl overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-darkBg border-b border-darkBorder text-gray-500 font-bold text-[10px] uppercase">
                      <th className="px-4 py-3">Phone</th>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Dispatched Time</th>
                      <th className="px-4 py-3">Details / Errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-darkBorder">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-gray-500 font-bold">
                          No logs match this filter
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-darkBg/20">
                          <td className="px-4 py-3 font-mono text-white">{log.phone}</td>
                          <td className="px-4 py-3 font-medium">{log.name || '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 text-[9px] font-black uppercase rounded-full ${
                              log.status === 'sent' ? 'bg-[#022c22]/50 text-emerald-400 border border-emerald-950' :
                              log.status === 'failed' ? 'bg-[#450a0a]/50 text-rose-400 border border-rose-950' :
                              log.status === 'excluded' ? 'bg-yellow-950/40 text-yellow-400 border border-yellow-900/30' :
                              'bg-zinc-800 text-zinc-400'
                            }`}>{log.status}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-400 font-medium">
                            {log.sentAt ? new Date(log.sentAt).toLocaleTimeString() : '-'}
                          </td>
                          <td className="px-4 py-3 text-gray-400 max-w-[250px] truncate" title={log.error}>
                            {log.error || '-'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* Tab: Blocklist Manager */}
        {activeTab === 'blocklist' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Form list */}
            <div className="bg-darkCard border border-darkBorder rounded-2xl p-6 h-fit">
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
                Exclude Number
              </h3>

              <form onSubmit={addToBlocklist} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">Phone Number</label>
                  <input 
                    type="text" 
                    placeholder="e.g. 15550199"
                    value={blockPhone}
                    onChange={(e) => setBlockPhone(e.target.value)}
                    className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2 text-xs text-white placeholder-gray-600 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">Reason (Optional)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Unsubscribed from SMS"
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2 text-xs text-white placeholder-gray-600 outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!blockPhone}
                  className="w-full py-2 bg-primary-600 hover:bg-primary-500 disabled:bg-gray-800 disabled:text-gray-600 text-darkBg text-xs font-extrabold rounded-xl flex items-center justify-center gap-1.5 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" /> Block Number
                </button>
              </form>
            </div>

            {/* Blocklist Table list */}
            <div className="lg:col-span-2 bg-darkCard border border-darkBorder rounded-2xl p-6">
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4">
                Blocked Numbers Database ({blocklist.length})
              </h3>

              <div className="border border-darkBorder rounded-xl overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-darkBg border-b border-darkBorder text-gray-500 font-bold text-[10px] uppercase">
                      <th className="px-4 py-3">Phone</th>
                      <th className="px-4 py-3">Block Reason</th>
                      <th className="px-4 py-3">Blocked Date</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-darkBorder">
                    {blocklist.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500 font-bold">
                          No blocked numbers found
                        </td>
                      </tr>
                    ) : (
                      blocklist.map((block) => (
                        <tr key={block.id} className="hover:bg-darkBg/20">
                          <td className="px-4 py-3 font-mono text-white">{block.phone}</td>
                          <td className="px-4 py-3 text-gray-300">{block.reason || '-'}</td>
                          <td className="px-4 py-3 text-gray-400">
                            {new Date(block.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button 
                              onClick={() => removeFromBlocklist(block.id)}
                              className="text-rose-400 hover:text-rose-300 p-1.5 bg-rose-950/20 hover:bg-rose-950/40 rounded-lg transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* Tab: Settings */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto bg-darkCard border border-darkBorder rounded-2xl p-6">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-6">
              Global Campaign Configuration
            </h3>

            <form onSubmit={saveSettings} className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">Sender Profile Nickname</label>
                <input 
                  type="text" 
                  value={senderNickname}
                  onChange={(e) => setSenderNickname(e.target.value)}
                  className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-600 outline-none"
                />
                <p className="text-[10px] text-gray-500 mt-2 font-medium">Used for logging and sender profile identifications.</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">Daily Limit Warning Threshold (Messages)</label>
                <input 
                  type="number" 
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(parseInt(e.target.value, 10))}
                  className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-600 outline-none"
                />
                <p className="text-[10px] text-gray-500 mt-2 font-medium">Stops active transmission if sent count in a single day exceeds this limit.</p>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-primary-600 hover:bg-primary-500 text-darkBg text-xs font-extrabold rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-primary-500/10"
              >
                Save Settings
              </button>
            </form>
          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="bg-darkCard/30 border-t border-darkBorder/60 py-4 text-center mt-12">
        <span className="text-[10px] font-semibold text-gray-600">
          © {new Date().getFullYear()} WhatsApp Web Legit Campaign Dashboard. Built for compliant sender use.
        </span>
      </footer>

    </div>
  );
}
