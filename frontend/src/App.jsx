import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { 
  Layers, Users, Calendar, Phone, Settings as SettingsIcon, Plus, Trash2, 
  Download, Upload, Play, Pause, Square, Search, Filter, Clock, X, 
  ExternalLink, MessageSquare, AlertTriangle, CheckCircle2, Copy, Check, 
  ChevronRight, PhoneCall, AlertCircle, RefreshCw, BarChart2, CheckSquare, 
  FileText, Shield, Sparkles, UserPlus
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5001';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'campaigns', 'contacts', 'bookings', 'settings'
  const [toast, setToast] = useState(null);

  // Core Data Lists
  const [campaignsList, setCampaignsList] = useState([]);
  const [bookingsList, setBookingsList] = useState([]);
  const [contactsList, setContactsList] = useState([]); // global contacts preview
  const [blocklist, setBlocklist] = useState([]);

  // Settings
  const [settings, setSettings] = useState({
    businessName: 'My Business',
    sendingMode: 'Manual',
    whatsappAccessToken: '',
    whatsappPhoneNumberId: '',
    whatsappBusinessAccountId: '',
    whatsappVerifyToken: 'my_verify_token_123',
    optOutKeyword: 'STOP',
    disclaimerText: 'Consent is required for outreach campaign messages.',
    messageCostRate: '0.01',
    dailyLimit: '200',
    dailySentCount: '0'
  });

  // Selected details
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [campaignDetails, setCampaignDetails] = useState(null);

  // Forms / Modals
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);
  const [newCampaign, setNewCampaign] = useState({
    name: '',
    description: '',
    messageTemplate: 'Hi {{name}}, this is {{businessName}}. We are confirming appointments for {{campaignName}}. Reply with:\n1. Book appointment\n2. Reschedule\n3. Not interested\n4. Talk to human',
    cooldownMin: 5,
    cooldownMax: 15,
    dailyLimit: 200,
    useTemplate: false,
    templateName: '',
    templateLanguage: 'en',
    presetReplies: [
      { label: '1', value: 'Book appointment', action: 'Book appointment' },
      { label: '2', value: 'Reschedule', action: 'Mark reschedule needed' },
      { label: '3', value: 'Not interested', action: 'Mark not interested' },
      { label: '4', value: 'Talk to human', action: 'Mark talk to human' }
    ],
    appointmentSlots: [],
    contacts: []
  });

  const [newSlot, setNewSlot] = useState({ date: '', time: '', maxBookings: 1 });
  const [newReply, setNewReply] = useState({ label: '', value: '', action: 'Book appointment' });
  const [manualContactInput, setManualContactInput] = useState('');
  
  // Single manual Contact form
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [manualContact, setManualContact] = useState({ name: '', phone: '', notes: '', optIn: true });

  // Manual Reply Recording Modal
  const [recordingContact, setRecordingContact] = useState(null);
  const [selectedReplyVal, setSelectedReplyVal] = useState('');
  const [recordNotes, setRecordNotes] = useState('');
  const [bookingSlotId, setBookingSlotId] = useState('');

  // Call Confirmation Drawer
  const [callingContact, setCallingContact] = useState(null);
  const [callStatusResult, setCallStatusResult] = useState('confirmed');
  const [callNotes, setCallNotes] = useState('');

  // Settings Edit Form
  const [settingsForm, setSettingsForm] = useState({});

  // Blocklist inputs
  const [blockPhone, setBlockPhone] = useState('');
  const [blockReason, setBlockReason] = useState('');

  // Dashboard Filters
  const [dashFilterCampaign, setDashFilterCampaign] = useState('all');
  const [dashFilterReply, setDashFilterReply] = useState('all');
  const [dashFilterDate, setDashFilterDate] = useState('');
  const [dashFilterStatus, setDashFilterStatus] = useState('all');

  // References
  const fileInputRef = useRef(null);
  const socketRef = useRef(null);

  const showToast = (text, type = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Socket setup & initial load
  useEffect(() => {
    socketRef.current = io(API_BASE);

    socketRef.current.on('campaign-status-changed', ({ campaignId, status, reason }) => {
      if (selectedCampaignId === campaignId) {
        setCampaignDetails(prev => prev ? { ...prev, status } : null);
      }
      loadCampaigns();
      if (reason) {
        showToast(`Campaign queue paused: ${reason}`, 'warning');
      }
    });

    socketRef.current.on('campaign-progress', ({ campaignId }) => {
      if (selectedCampaignId === campaignId) {
        loadCampaignDetails(campaignId);
      }
      loadCampaigns();
    });

    socketRef.current.on('log-added', () => {
      loadAllData();
      if (selectedCampaignId) {
        loadCampaignDetails(selectedCampaignId);
      }
    });

    socketRef.current.on('toast-message', ({ type, text }) => {
      showToast(text, type);
    });

    loadAllData();

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [selectedCampaignId]);

  const loadAllData = async () => {
    loadCampaigns();
    loadBookings();
    loadSettings();
    loadBlocklist();
  };

  const loadSettings = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/settings`);
      setSettings(res.data);
      setSettingsForm(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  const loadCampaigns = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/campaigns`);
      setCampaignsList(res.data);
      // Flat list of all contacts for general tab
      const allC = [];
      res.data.forEach(camp => {
        if (camp.contacts) {
          camp.contacts.forEach(c => allC.push({ ...c, campaignName: camp.name }));
        }
      });
      setContactsList(allC);
    } catch (e) {
      console.error(e);
    }
  };

  const loadCampaignDetails = async (id) => {
    try {
      const res = await axios.get(`${API_BASE}/api/campaigns/${id}`);
      setCampaignDetails(res.data);
    } catch (e) {
      showToast('Failed to load campaign details', 'error');
    }
  };

  const loadBookings = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/bookings`);
      setBookingsList(res.data);
    } catch (e) {
      console.error(e);
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

  // Selection view toggler
  const selectCampaign = (id) => {
    setSelectedCampaignId(id);
    if (id) {
      loadCampaignDetails(id);
    } else {
      setCampaignDetails(null);
    }
  };

  // CSV Contacts Parser
  const handleCSVUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post(`${API_BASE}/api/contacts/parse`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const parsed = res.data.contacts;
      setNewCampaign(prev => ({
        ...prev,
        contacts: [...prev.contacts, ...parsed]
      }));
      showToast(`Successfully parsed ${parsed.length} contacts.`, 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'CSV parsing failed.', 'error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Parse manual numbers text
  const parseManualContactsInput = () => {
    if (!manualContactInput.trim()) return;
    const lines = manualContactInput.split('\n');
    const list = [];
    lines.forEach(line => {
      const cols = line.split(/[,\t;]+/);
      const phone = cols[0]?.replace(/\D/g, '');
      if (phone) {
        list.push({
          name: cols[1]?.trim() || '',
          phone,
          notes: cols[2]?.trim() || '',
          optIn: true
        });
      }
    });
    setNewCampaign(prev => ({
      ...prev,
      contacts: [...prev.contacts, ...list]
    }));
    setManualContactInput('');
    showToast(`Added ${list.length} contacts manually.`, 'success');
  };

  // Add Preset Reply Inline
  const addPresetReplyForm = () => {
    if (!newReply.label || !newReply.value) return;
    setNewCampaign(prev => ({
      ...prev,
      presetReplies: [...prev.presetReplies, { ...newReply }]
    }));
    setNewReply({ label: '', value: '', action: 'Book appointment' });
  };

  // Remove Preset Reply Inline
  const removePresetReplyForm = (idx) => {
    setNewCampaign(prev => ({
      ...prev,
      presetReplies: prev.presetReplies.filter((_, i) => i !== idx)
    }));
  };

  // Add Appointment Slot Inline
  const addSlotForm = () => {
    if (!newSlot.date || !newSlot.time) return;
    setNewCampaign(prev => ({
      ...prev,
      appointmentSlots: [...prev.appointmentSlots, { ...newSlot }]
    }));
    setNewSlot({ date: '', time: '', maxBookings: 1 });
  };

  // Remove Slot Inline
  const removeSlotForm = (idx) => {
    setNewCampaign(prev => ({
      ...prev,
      appointmentSlots: prev.appointmentSlots.filter((_, i) => i !== idx)
    }));
  };

  // Create Campaign API
  const handleCreateCampaign = async (e) => {
    e.preventDefault();
    if (!newCampaign.name) return showToast('Campaign name is required.', 'error');
    if (newCampaign.contacts.length === 0) return showToast('Please load at least 1 contact.', 'error');

    try {
      await axios.post(`${API_BASE}/api/campaigns`, newCampaign);
      showToast('Campaign successfully prepared!', 'success');
      setIsCreatingCampaign(false);
      // Reset form
      setNewCampaign({
        name: '',
        description: '',
        messageTemplate: 'Hi {{name}}, this is {{businessName}}. We are confirming appointments for {{campaignName}}. Reply with:\n1. Book appointment\n2. Reschedule\n3. Not interested\n4. Talk to human',
        cooldownMin: 5,
        cooldownMax: 15,
        dailyLimit: 200,
        useTemplate: false,
        templateName: '',
        templateLanguage: 'en',
        presetReplies: [
          { label: '1', value: 'Book appointment', action: 'Book appointment' },
          { label: '2', value: 'Reschedule', action: 'Mark reschedule needed' },
          { label: '3', value: 'Not interested', action: 'Mark not interested' },
          { label: '4', value: 'Talk to human', action: 'Mark talk to human' }
        ],
        appointmentSlots: [],
        contacts: []
      });
      loadCampaigns();
    } catch (err) {
      showToast('Failed to create campaign.', 'error');
    }
  };

  // Delete Campaign
  const handleDeleteCampaign = async (id) => {
    if (!confirm('Are you sure you want to delete this campaign?')) return;
    try {
      await axios.delete(`${API_BASE}/api/campaigns/${id}`);
      showToast('Campaign deleted.');
      selectCampaign(null);
      loadCampaigns();
    } catch (e) {
      showToast('Failed to delete campaign.', 'error');
    }
  };

  // Manual WhatsApp Web Prefilled Dispatch Flow
  const handleOpenWhatsAppManual = async (contact) => {
    // Resolve templates
    const resolvedText = (campaignDetails?.messageTemplate || 'Hi {{name}}')
      .replace(/{{name}}/g, contact.name || '')
      .replace(/{{phone}}/g, contact.phone || '')
      .replace(/{{businessName}}/g, settings.businessName || 'Our Business')
      .replace(/{{campaignName}}/g, campaignDetails?.name || '');

    // Web url link
    let phoneNum = contact.phone.replace(/\D/g, '');
    if (phoneNum.length === 10) {
      phoneNum = '91' + phoneNum;
    }
    const waUrl = `https://web.whatsapp.com/send?phone=${phoneNum}&text=${encodeURIComponent(resolvedText)}`;
    
    // Open in new window/tab
    window.open(waUrl, '_blank');

    // Notify backend to log dispatch status
    try {
      await axios.post(`${API_BASE}/api/contacts/${contact.id}/manual-sent`);
      showToast('Manual outreach link opened & logged.', 'success');
      loadAllData();
      if (selectedCampaignId) {
        loadCampaignDetails(selectedCampaignId);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Add Contact Manually to Active Campaign
  const handleAddManualContact = async (e) => {
    e.preventDefault();
    if (!manualContact.phone) return showToast('Phone number is required.', 'error');

    try {
      await axios.post(`${API_BASE}/api/campaigns/${campaignDetails.id}/contacts`, manualContact);
      showToast('Contact added successfully.', 'success');
      setIsAddingContact(false);
      setManualContact({ name: '', phone: '', notes: '', optIn: true });
      loadCampaignDetails(campaignDetails.id);
    } catch (err) {
      showToast('Failed to add contact.', 'error');
    }
  };

  // Delete Contact
  const handleDeleteContact = async (id) => {
    if (!confirm('Remove this contact?')) return;
    try {
      await axios.delete(`${API_BASE}/api/contacts/${id}`);
      showToast('Contact deleted.');
      if (selectedCampaignId) loadCampaignDetails(selectedCampaignId);
      loadCampaigns();
    } catch (e) {
      showToast('Failed to delete.', 'error');
    }
  };

  // Toggle Opt-In status
  const handleToggleOptIn = async (contact) => {
    try {
      await axios.put(`${API_BASE}/api/contacts/${contact.id}`, { optIn: !contact.optIn });
      showToast(`Contact opt-in set to ${!contact.optIn ? 'Active' : 'Stopped'}.`);
      if (selectedCampaignId) loadCampaignDetails(selectedCampaignId);
      loadCampaigns();
    } catch (e) {
      showToast('Failed to toggle opt-in.', 'error');
    }
  };

  // Record manual replies
  const openRecordReplyModal = (contact) => {
    setRecordingContact(contact);
    setSelectedReplyVal('');
    setRecordNotes(contact.notes || '');
    setBookingSlotId('');
  };

  const handleRecordManualReplySubmit = async (e) => {
    e.preventDefault();
    if (!selectedReplyVal) return showToast('Please select reply option.', 'error');

    try {
      // Find what action maps to this selected reply
      const matched = campaignDetails?.presetReplies?.find(r => r.value === selectedReplyVal);
      let callStatus = 'pending';
      let appointmentSlotId = null;

      if (matched) {
        if (matched.action === 'Book appointment') {
          if (!bookingSlotId) return showToast('Please select an appointment slot.', 'error');
          callStatus = 'pending_confirmation';
          appointmentSlotId = parseInt(bookingSlotId, 10);
        } else if (matched.action === 'Mark not interested') {
          callStatus = 'not_interested';
        } else if (matched.action === 'Mark reschedule needed') {
          callStatus = 'reschedule_needed';
        } else if (matched.action === 'Mark talk to human' || matched.action === 'Mark follow-up needed') {
          callStatus = 'pending';
        }
      }

      await axios.put(`${API_BASE}/api/contacts/${recordingContact.id}`, {
        messageStatus: 'replied',
        selectedReply: selectedReplyVal,
        notes: recordNotes,
        callStatus,
        appointmentSlotId
      });

      // Save log manually
      await axios.get(`${API_BASE}/api/contacts/${recordingContact.id}/logs`); // dummy trigger

      showToast('Customer reply manually recorded.', 'success');
      setRecordingContact(null);
      loadAllData();
      if (selectedCampaignId) loadCampaignDetails(selectedCampaignId);
    } catch (err) {
      showToast('Error recording reply.', 'error');
    }
  };

  // Record Phone Call results
  const openCallConfirmationDrawer = (contact) => {
    setCallingContact(contact);
    setCallStatusResult(contact.callStatus === 'confirmed' ? 'confirmed' : 'confirmed');
    setCallNotes(contact.callNotes || '');
  };

  const handleRecordCallSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/api/contacts/${callingContact.id}/call`, {
        status: callStatusResult,
        notes: callNotes
      });
      showToast('Call confirmation logged successfully.', 'success');
      setCallingContact(null);
      loadAllData();
      if (selectedCampaignId) loadCampaignDetails(selectedCampaignId);
    } catch (err) {
      showToast('Failed to log call details.', 'error');
    }
  };

  // Manage Bookings
  const handleUpdateBookingStatus = async (id, status) => {
    try {
      await axios.put(`${API_BASE}/api/bookings/${id}`, { bookingStatus: status });
      showToast(`Booking marked as ${status}.`);
      loadBookings();
      loadCampaigns();
    } catch (e) {
      showToast('Failed to update booking status.', 'error');
    }
  };

  const handleCancelBooking = async (id) => {
    if (!confirm('Are you sure you want to cancel this booking slot?')) return;
    try {
      await axios.delete(`${API_BASE}/api/bookings/${id}`);
      showToast('Booking cancelled.');
      loadBookings();
      loadCampaigns();
      if (selectedCampaignId) loadCampaignDetails(selectedCampaignId);
    } catch (e) {
      showToast('Failed to cancel booking.', 'error');
    }
  };

  // Save Settings
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/api/settings`, settingsForm);
      showToast('Global settings saved successfully.');
      loadSettings();
    } catch (e) {
      showToast('Failed to save settings.', 'error');
    }
  };

  // Blocklist
  const handleAddBlocklist = async (e) => {
    e.preventDefault();
    if (!blockPhone) return;
    try {
      await axios.post(`${API_BASE}/api/blocklist`, { phone: blockPhone, reason: blockReason });
      showToast('Contact number added to Blocklist.', 'success');
      setBlockPhone('');
      setBlockReason('');
      loadBlocklist();
    } catch (e) {
      showToast('Failed to block number.', 'error');
    }
  };

  const handleRemoveBlocklist = async (id) => {
    try {
      await axios.delete(`${API_BASE}/api/blocklist/${id}`);
      showToast('Number removed from blocklist.');
      loadBlocklist();
    } catch (e) {
      showToast('Failed to remove number.', 'error');
    }
  };

  // Campaign background queue controls
  const handleStartQueue = async (id) => {
    try {
      await axios.post(`${API_BASE}/api/campaigns/${id}/start`);
      showToast('API Campaign Queue process started.', 'success');
      loadCampaignDetails(id);
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to start queue.', 'error');
    }
  };

  const handlePauseQueue = async (id) => {
    try {
      await axios.post(`${API_BASE}/api/campaigns/${id}/pause`);
      showToast('Queue paused.');
      loadCampaignDetails(id);
    } catch (e) {
      showToast('Failed to pause queue.', 'error');
    }
  };

  const handleStopQueue = async (id) => {
    try {
      await axios.post(`${API_BASE}/api/campaigns/${id}/stop`);
      showToast('Queue stopped.');
      loadCampaignDetails(id);
    } catch (e) {
      showToast('Failed to stop queue.', 'error');
    }
  };

  // Copy phone helper
  const [copiedNum, setCopiedNum] = useState(null);
  const copyPhone = (num) => {
    navigator.clipboard.writeText(num);
    setCopiedNum(num);
    setTimeout(() => setCopiedNum(null), 1500);
  };

  // Dynamic cost estimates
  const getCampaignCost = (sentCount) => {
    const rate = parseFloat(settings.messageCostRate || '0.01');
    return (sentCount * rate).toFixed(2);
  };

  // Filters for Dashboard Tab
  const getFilteredContacts = () => {
    return contactsList.filter(c => {
      const matchCamp = dashFilterCampaign === 'all' || String(c.campaignId) === dashFilterCampaign;
      const matchReply = dashFilterReply === 'all' || c.selectedReply === dashFilterReply;
      const matchStatus = dashFilterStatus === 'all' || 
                          (dashFilterStatus === 'replied' && c.messageStatus === 'replied') ||
                          (dashFilterStatus === 'sent' && c.messageStatus === 'sent') ||
                          (dashFilterStatus === 'pending' && c.messageStatus === 'pending') ||
                          (dashFilterStatus === 'failed' && c.messageStatus === 'failed') ||
                          (dashFilterStatus === c.callStatus);
      return matchCamp && matchReply && matchStatus;
    });
  };

  const recentReplies = contactsList.filter(c => c.messageStatus === 'replied');
  const pendingConfirmationCalls = contactsList.filter(c => c.callStatus === 'pending_confirmation');
  const confirmedAppointments = bookingsList.filter(b => b.bookingStatus === 'Confirmed');

  return (
    <div className="min-h-screen bg-darkBg text-gray-200 font-sans flex">
      
      {/* Toast Alert */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-2xl border text-sm font-semibold transition-all duration-300 transform translate-y-0 ${
          toast.type === 'success' ? 'bg-[#064e3b] text-emerald-300 border-[#047857]' : 
          toast.type === 'warning' ? 'bg-[#78350f] text-amber-300 border-[#b45309]' : 
          'bg-[#7f1d1d] text-rose-300 border-[#b91c1c]'
        }`}>
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
          {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400" />}
          {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400" />}
          <span>{toast.text}</span>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="w-64 bg-darkCard border-r border-darkBorder flex flex-col justify-between shrink-0">
        <div>
          {/* Sidebar Brand header */}
          <div className="p-6 border-b border-darkBorder">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-primary-500 flex items-center justify-center text-darkBg font-black text-lg shadow-md shadow-primary-500/20">
                WA
              </div>
              <div>
                <h1 className="font-extrabold text-sm text-white leading-none">Outreach Assistant</h1>
                <p className="text-[10px] text-gray-500 font-medium mt-1">Campaign & Bookings CRM</p>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1.5">
            <button
              onClick={() => { setActiveTab('dashboard'); selectCampaign(null); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'dashboard' ? 'bg-primary-500 text-darkBg shadow-md shadow-primary-500/10' : 'text-gray-400 hover:text-white hover:bg-darkBg/50'
              }`}
            >
              <BarChart2 className="w-4 h-4" />
              <span>Dashboard Overview</span>
            </button>

            <button
              onClick={() => { setActiveTab('campaigns'); selectCampaign(null); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'campaigns' ? 'bg-primary-500 text-darkBg shadow-md shadow-primary-500/10' : 'text-gray-400 hover:text-white hover:bg-darkBg/50'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Campaign Management</span>
            </button>

            <button
              onClick={() => { setActiveTab('contacts'); selectCampaign(null); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'contacts' ? 'bg-primary-500 text-darkBg shadow-md shadow-primary-500/10' : 'text-gray-400 hover:text-white hover:bg-darkBg/50'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Opted-in Outreach List</span>
            </button>

            <button
              onClick={() => { setActiveTab('bookings'); selectCampaign(null); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'bookings' ? 'bg-primary-500 text-darkBg shadow-md shadow-primary-500/10' : 'text-gray-400 hover:text-white hover:bg-darkBg/50'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>Appointments & Call logs</span>
            </button>

            <button
              onClick={() => { setActiveTab('settings'); selectCampaign(null); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'settings' ? 'bg-primary-500 text-darkBg shadow-md shadow-primary-500/10' : 'text-gray-400 hover:text-white hover:bg-darkBg/50'
              }`}
            >
              <SettingsIcon className="w-4 h-4" />
              <span>System Settings</span>
            </button>
          </nav>
        </div>

        {/* Sidebar Footer details */}
        <div className="p-4 border-t border-darkBorder bg-darkBg/20">
          <div className="flex items-center justify-between text-[10px] text-gray-500 font-semibold mb-2">
            <span>MODE:</span>
            <span className={`px-2 py-0.5 rounded font-bold ${
              settings.sendingMode === 'API' ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-900/30' : 'bg-amber-950/60 text-amber-400 border border-amber-900/30'
            }`}>{settings.sendingMode} Mode</span>
          </div>
          <div className="text-[9px] text-gray-600 font-medium leading-relaxed">
            {settings.sendingMode === 'API' ? 'Active Meta Webhook receiver listens on /api/whatsapp/webhook' : 'Open WhatsApp manual dispatch links for campaigns'}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-grow flex flex-col min-w-0">
        
        {/* Top Header bar */}
        <header className="h-16 bg-darkCard border-b border-darkBorder px-8 flex items-center justify-between sticky top-0 z-20 shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="font-extrabold text-sm text-white uppercase tracking-wider">
              {activeTab === 'dashboard' && 'CRM Dashboard Dashboard'}
              {activeTab === 'campaigns' && 'Outreach Campaigns Builder'}
              {activeTab === 'contacts' && 'Consent outreach list'}
              {activeTab === 'bookings' && 'Confirmed Appointments'}
              {activeTab === 'settings' && 'System Config Settings'}
            </h2>
            {settings.sendingMode === 'API' && (
              <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-900/30 px-2 py-0.5 rounded-full font-bold">WhatsApp Cloud API Live</span>
            )}
            {settings.sendingMode === 'Manual' && (
              <span className="text-[10px] bg-amber-950 text-amber-400 border border-amber-900/30 px-2 py-0.5 rounded-full font-bold">Manual Link Fallback Mode</span>
            )}
          </div>

          <div className="flex items-center gap-6">
            {/* Quick overview of limits */}
            <div className="text-xs font-semibold flex items-center gap-2">
              <span className="text-gray-500">Business:</span>
              <span className="text-gray-300 font-bold">{settings.businessName}</span>
            </div>
            {settings.sendingMode === 'API' && (
              <div className="text-xs font-semibold flex items-center gap-2 bg-darkBg/60 border border-darkBorder px-3 py-1.5 rounded-lg">
                <span className="text-gray-500">API Queue:</span>
                <span className="text-primary-400 font-bold">{settings.dailySentCount || 0} / {settings.dailyLimit || 200}</span>
              </div>
            )}
          </div>
        </header>

        {/* Content Body scrollable */}
        <div className="flex-grow overflow-y-auto p-8 max-w-7xl w-full mx-auto space-y-8">

          {/* WARNING Disclaimer bar */}
          <div className="bg-amber-950/20 border border-amber-900/30 p-4 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <h4 className="font-extrabold text-amber-400 mb-1 uppercase tracking-wider">Aarian Outreach Policy Compliance</h4>
              <p className="text-gray-400 leading-relaxed">
                {settings.disclaimerText || 'Make sure contacts have opted in to receive campaigns. Never spam. User keywords like STOP will blacklist numbers automatically.'}
              </p>
            </div>
          </div>

          {/* ================= TAB 1: DASHBOARD ================= */}
          {activeTab === 'dashboard' && (
            <div className="space-y-8">
              {/* Quick statistics layout */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                
                <div className="bg-darkCard border border-darkBorder p-5 rounded-2xl flex flex-col justify-between shadow-xl">
                  <div className="flex justify-between items-center text-gray-500 mb-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider">Outreach Campaigns</span>
                    <Layers className="w-4 h-4 text-primary-400" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white">{campaignsList.length}</h3>
                    <span className="text-[9px] text-gray-600 font-medium">Configured in database</span>
                  </div>
                </div>

                <div className="bg-darkCard border border-darkBorder p-5 rounded-2xl flex flex-col justify-between shadow-xl">
                  <div className="flex justify-between items-center text-gray-500 mb-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider">Opted-in Contacts</span>
                    <Users className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white">{contactsList.length}</h3>
                    <span className="text-[9px] text-gray-600 font-medium">Checked for consent</span>
                  </div>
                </div>

                <div className="bg-darkCard border border-darkBorder p-5 rounded-2xl flex flex-col justify-between shadow-xl">
                  <div className="flex justify-between items-center text-gray-500 mb-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider">Customer Replies</span>
                    <MessageSquare className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white">{recentReplies.length}</h3>
                    <span className="text-[9px] text-gray-600 font-medium">Parsed from webhook/manual</span>
                  </div>
                </div>

                <div className="bg-darkCard border border-darkBorder p-5 rounded-2xl flex flex-col justify-between shadow-xl">
                  <div className="flex justify-between items-center text-gray-500 mb-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider">Bookings & Confirmations</span>
                    <Calendar className="w-4 h-4 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white">{bookingsList.length}</h3>
                    <span className="text-[9px] text-gray-600 font-medium">{confirmedAppointments.length} confirmed bookings</span>
                  </div>
                </div>

              </div>

              {/* CRM TABLES ROW */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                
                {/* Dashboard column 1: Recent replies */}
                <div className="xl:col-span-2 bg-darkCard border border-darkBorder rounded-2xl p-6 shadow-xl space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-primary-400" />
                      Recent Customer Replies ({recentReplies.length})
                    </h3>
                  </div>

                  <div className="border border-darkBorder rounded-xl overflow-hidden overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-darkBg border-b border-darkBorder text-gray-500 font-bold text-[10px] uppercase">
                          <th className="px-4 py-3">Customer</th>
                          <th className="px-4 py-3">Phone</th>
                          <th className="px-4 py-3">Campaign</th>
                          <th className="px-4 py-3">Reply Value</th>
                          <th className="px-4 py-3">Call Status</th>
                          <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-darkBorder">
                        {recentReplies.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-6 text-center text-gray-600 font-semibold">No recent customer replies found.</td>
                          </tr>
                        ) : (
                          recentReplies.slice(0, 5).map(c => (
                            <tr key={c.id} className="hover:bg-darkBg/30">
                              <td className="px-4 py-3 font-semibold text-white">{c.name || 'Anonymous'}</td>
                              <td className="px-4 py-3 font-mono text-gray-400">{c.phone}</td>
                              <td className="px-4 py-3 text-gray-400 truncate max-w-[120px]">{c.campaignName}</td>
                              <td className="px-4 py-3">
                                <span className="bg-[#0b1329] text-blue-300 border border-blue-900/35 px-2 py-0.5 rounded font-medium text-[10px]">
                                  {c.selectedReply || 'Replied Text'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                                  c.callStatus === 'confirmed' ? 'bg-emerald-950 text-emerald-400' :
                                  c.callStatus === 'pending_confirmation' ? 'bg-amber-950 text-amber-400' :
                                  c.callStatus === 'reschedule_needed' ? 'bg-indigo-950 text-indigo-400' :
                                  c.callStatus === 'not_interested' ? 'bg-rose-950 text-rose-400' :
                                  'bg-zinc-800 text-zinc-400'
                                }`}>{c.callStatus}</span>
                              </td>
                              <td className="px-4 py-3 text-right space-x-1.5">
                                <button 
                                  onClick={() => openRecordReplyModal(c)}
                                  className="px-2 py-1 bg-darkBg hover:bg-darkBg/60 text-primary-400 border border-darkBorder rounded text-[10px] font-bold"
                                >
                                  Update Flow
                                </button>
                                <button
                                  onClick={() => openCallConfirmationDrawer(c)}
                                  className="px-2 py-1 bg-primary-600 hover:bg-primary-500 text-darkBg rounded text-[10px] font-black"
                                >
                                  Log Call
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Dashboard column 2: Calls list */}
                <div className="bg-darkCard border border-darkBorder rounded-2xl p-6 shadow-xl space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                    <PhoneCall className="w-4 h-4 text-amber-400" />
                    Pending Confirmation Calls ({pendingConfirmationCalls.length})
                  </h3>

                  <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                    {pendingConfirmationCalls.length === 0 ? (
                      <div className="text-center py-8 text-gray-600 text-xs font-medium border border-dashed border-darkBorder rounded-xl">
                        No pending confirmation calls.
                      </div>
                    ) : (
                      pendingConfirmationCalls.map(c => (
                        <div key={c.id} className="p-3 bg-darkBg/30 border border-darkBorder rounded-xl flex items-center justify-between">
                          <div>
                            <h4 className="text-xs font-bold text-white">{c.name || 'No Name'}</h4>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] font-mono text-gray-500">{c.phone}</span>
                              {copiedNum === c.phone ? (
                                <span className="text-[9px] text-emerald-400 font-bold">Copied</span>
                              ) : (
                                <button onClick={() => copyPhone(c.phone)} className="text-[9px] text-primary-400 hover:underline">Copy</button>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex gap-1">
                            <a 
                              href={`tel:${c.phone}`}
                              className="p-1.5 bg-emerald-950 text-emerald-400 hover:bg-emerald-900 border border-emerald-900/35 rounded-lg"
                              title="Call Customer"
                            >
                              <Phone className="w-4 h-4" />
                            </a>
                            <button
                              onClick={() => openCallConfirmationDrawer(c)}
                              className="px-2 py-1 bg-primary-600 hover:bg-primary-500 text-darkBg font-black text-[10px] rounded-lg"
                            >
                              Log Call
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>

              {/* Tabular Lists with dynamic filters */}
              <div className="bg-darkCard border border-darkBorder rounded-2xl p-6 shadow-xl space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-darkBorder pb-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                    Comprehensive CRM Filter Directory
                  </h3>
                  
                  {/* Filters selector row */}
                  <div className="flex flex-wrap gap-2 text-xs">
                    <div>
                      <select 
                        value={dashFilterCampaign}
                        onChange={(e) => setDashFilterCampaign(e.target.value)}
                        className="bg-darkBg border border-darkBorder focus:border-primary-500 text-gray-300 rounded-lg px-2.5 py-1.5 outline-none font-bold"
                      >
                        <option value="all">All Campaigns</option>
                        {campaignsList.map(camp => (
                          <option key={camp.id} value={camp.id}>{camp.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <select
                        value={dashFilterStatus}
                        onChange={(e) => setDashFilterStatus(e.target.value)}
                        className="bg-darkBg border border-darkBorder focus:border-primary-500 text-gray-300 rounded-lg px-2.5 py-1.5 outline-none font-bold"
                      >
                        <option value="all">All Statuses</option>
                        <option value="pending">Outreach: Pending</option>
                        <option value="sent">Outreach: Sent</option>
                        <option value="replied">Outreach: Replied</option>
                        <option value="pending_confirmation">Call: Pending Confirmation</option>
                        <option value="confirmed">Call: Confirmed</option>
                        <option value="reschedule_needed">Call: Reschedule Needed</option>
                        <option value="not_interested">Call: Not Interested</option>
                        <option value="cancelled">Call: Cancelled</option>
                        <option value="no_answer">Call: No Answer</option>
                        <option value="opted_out">Opted Out (STOP)</option>
                      </select>
                    </div>

                    <div>
                      <select
                        value={dashFilterReply}
                        onChange={(e) => setDashFilterReply(e.target.value)}
                        className="bg-darkBg border border-darkBorder focus:border-primary-500 text-gray-300 rounded-lg px-2.5 py-1.5 outline-none font-bold"
                      >
                        <option value="all">All Preset Replies</option>
                        <option value="Book appointment">Book appointment</option>
                        <option value="Reschedule">Reschedule</option>
                        <option value="Not interested">Not interested</option>
                        <option value="Talk to human">Talk to human</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="border border-darkBorder rounded-xl overflow-hidden overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-darkBg border-b border-darkBorder text-gray-500 font-bold text-[10px] uppercase">
                        <th className="px-4 py-3">Customer Name</th>
                        <th className="px-4 py-3">Phone</th>
                        <th className="px-4 py-3">Campaign</th>
                        <th className="px-4 py-3">Outreach Status</th>
                        <th className="px-4 py-3">Reply Match</th>
                        <th className="px-4 py-3">Call Confirmation</th>
                        <th className="px-4 py-3">Notes</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-darkBorder">
                      {getFilteredContacts().length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-8 text-center text-gray-600 font-semibold">No contacts match the selected filters.</td>
                        </tr>
                      ) : (
                        getFilteredContacts().map(c => (
                          <tr key={c.id} className="hover:bg-darkBg/30">
                            <td className="px-4 py-3 font-semibold text-white">{c.name || 'Anonymous'}</td>
                            <td className="px-4 py-3 font-mono text-gray-400">{c.phone}</td>
                            <td className="px-4 py-3 text-gray-400 font-medium">{c.campaignName}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                                c.messageStatus === 'sent' ? 'bg-[#022c22] text-emerald-400 border border-emerald-950' :
                                c.messageStatus === 'replied' ? 'bg-[#1e3a8a] text-blue-300 border border-blue-950' :
                                c.messageStatus === 'failed' ? 'bg-[#450a0a] text-rose-400 border border-rose-950' :
                                'bg-zinc-800 text-zinc-400'
                              }`}>{c.messageStatus}</span>
                            </td>
                            <td className="px-4 py-3">
                              {c.selectedReply ? (
                                <span className="bg-[#0b1329] text-blue-300 px-2 py-0.5 border border-blue-950 rounded text-[10px]">
                                  {c.selectedReply}
                                </span>
                              ) : '-'}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                                c.callStatus === 'confirmed' ? 'bg-emerald-950 text-emerald-400' :
                                c.callStatus === 'pending_confirmation' ? 'bg-amber-950 text-amber-400' :
                                c.callStatus === 'reschedule_needed' ? 'bg-indigo-950 text-indigo-400' :
                                c.callStatus === 'not_interested' ? 'bg-rose-950 text-rose-400' :
                                c.callStatus === 'opted_out' ? 'bg-red-950 text-red-400' :
                                'bg-zinc-800 text-zinc-400'
                              }`}>{c.callStatus}</span>
                            </td>
                            <td className="px-4 py-3 text-gray-400 max-w-[150px] truncate" title={c.notes}>{c.notes || '-'}</td>
                            <td className="px-4 py-3 text-right space-x-1">
                              {settings.sendingMode === 'Manual' && c.messageStatus === 'pending' && (
                                <button
                                  onClick={() => handleOpenWhatsAppManual(c)}
                                  className="px-2 py-1 bg-primary-600 hover:bg-primary-500 text-darkBg font-black text-[10px] rounded-lg"
                                >
                                  Open in WhatsApp
                                </button>
                              )}
                              <button 
                                onClick={() => openRecordReplyModal(c)}
                                className="px-2 py-1 bg-darkBg hover:bg-darkBg/60 text-primary-400 border border-darkBorder rounded text-[10px] font-bold"
                              >
                                Record Reply
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

          {/* ================= TAB 2: CAMPAIGNS ================= */}
          {activeTab === 'campaigns' && !selectedCampaignId && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Campaign Directories</h3>
                <button
                  onClick={() => setIsCreatingCampaign(true)}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-darkBg text-xs font-extrabold rounded-xl flex items-center gap-1.5 transition-all shadow-md shadow-primary-500/10"
                >
                  <Plus className="w-4 h-4" /> Create Outreach Campaign
                </button>
              </div>

              {/* Active list grid */}
              {campaignsList.length === 0 ? (
                <div className="bg-darkCard border border-darkBorder rounded-2xl p-12 text-center shadow-xl space-y-3">
                  <Layers className="w-12 h-12 text-gray-600 mx-auto" />
                  <h4 className="text-sm font-bold text-white">No campaigns created yet</h4>
                  <p className="text-xs text-gray-500 max-w-sm mx-auto">Create a campaign, define preset answers and appointment capacity, and upload contact lists to begin outreach.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {campaignsList.map(camp => {
                    const sent = camp.contacts?.filter(c => c.messageStatus === 'sent' || c.messageStatus === 'replied').length || 0;
                    const total = camp.contacts?.length || 0;
                    const replies = camp.contacts?.filter(c => c.messageStatus === 'replied').length || 0;
                    const bookings = camp.contacts?.filter(c => c.appointmentSlotId).length || 0;

                    return (
                      <div 
                        key={camp.id}
                        className="bg-darkCard border border-darkBorder hover:border-primary-500/30 rounded-2xl p-6 flex flex-col justify-between shadow-xl transition-all hover:translate-y-[-2px]"
                      >
                        <div className="space-y-4">
                          <div className="flex justify-between items-start gap-2">
                            <h4 className="font-extrabold text-sm text-white truncate">{camp.name}</h4>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                              camp.status === 'completed' ? 'bg-emerald-950 text-emerald-400' :
                              camp.status === 'active' ? 'bg-amber-950 text-amber-400 animate-pulse' :
                              camp.status === 'paused' ? 'bg-slate-800 text-slate-400' :
                              'bg-zinc-900 text-zinc-400'
                            }`}>{camp.status}</span>
                          </div>

                          <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{camp.description || 'No description provided.'}</p>

                          <div className="grid grid-cols-3 gap-2 bg-darkBg/40 border border-darkBorder/60 p-3 rounded-xl text-center text-[10px] font-bold">
                            <div>
                              <span className="block text-white text-xs font-black">{total}</span>
                              <span className="text-gray-500 uppercase tracking-wider text-[8px]">Contacts</span>
                            </div>
                            <div>
                              <span className="block text-emerald-400 text-xs font-black">{replies}</span>
                              <span className="text-gray-500 uppercase tracking-wider text-[8px]">Replies</span>
                            </div>
                            <div>
                              <span className="block text-primary-400 text-xs font-black">{bookings}</span>
                              <span className="text-gray-500 uppercase tracking-wider text-[8px]">Booked</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-2 mt-6 border-t border-darkBorder/60 pt-4">
                          <button
                            onClick={() => selectCampaign(camp.id)}
                            className="flex-grow py-2 bg-darkBg hover:bg-darkBg/60 text-primary-400 border border-darkBorder rounded-xl text-xs font-bold transition-all"
                          >
                            Open Campaign CRM
                          </button>
                          <button
                            onClick={() => handleDeleteCampaign(camp.id)}
                            className="p-2 bg-rose-950/20 hover:bg-rose-950/40 text-rose-400 border border-rose-900/20 rounded-xl transition-all"
                            title="Delete Campaign"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Create Campaign Inline Sub-view */}
          {activeTab === 'campaigns' && isCreatingCampaign && (
            <div className="bg-darkCard border border-darkBorder rounded-2xl p-8 shadow-2xl max-w-4xl mx-auto space-y-8 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary-500 to-emerald-500" />
              
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-extrabold text-sm uppercase tracking-wider text-white">Create WhatsApp Campaign & Assistant</h3>
                  <p className="text-[10px] text-gray-500 font-medium mt-1">Initialize outreach messages, preset user answers, and booking slots.</p>
                </div>
                <button 
                  onClick={() => setIsCreatingCampaign(false)}
                  className="p-1.5 hover:bg-darkBg rounded-lg text-gray-500 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateCampaign} className="space-y-6">
                
                {/* 1. Name & template */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Campaign Name</label>
                      <input 
                        type="text" 
                        placeholder="e.g. June Dentist Cleanings Outreach"
                        value={newCampaign.name}
                        onChange={(e) => setNewCampaign(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-600 outline-none font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Description</label>
                      <textarea 
                        placeholder="Internal campaign objective details..."
                        value={newCampaign.description}
                        onChange={(e) => setNewCampaign(prev => ({ ...prev, description: e.target.value }))}
                        rows={3}
                        className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl p-3 text-xs text-white placeholder-gray-600 outline-none resize-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider">Outreach Message template</label>
                        <div className="flex gap-1">
                          {['{{name}}', '{{businessName}}', '{{campaignName}}', '{{date}}', '{{time}}'].map(tag => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => setNewCampaign(prev => ({ ...prev, messageTemplate: prev.messageTemplate + ' ' + tag }))}
                              className="text-[9px] font-mono bg-darkBg hover:bg-darkBg/60 text-primary-400 px-1.5 py-0.5 rounded border border-darkBorder"
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      </div>
                      <textarea 
                        value={newCampaign.messageTemplate}
                        onChange={(e) => setNewCampaign(prev => ({ ...prev, messageTemplate: e.target.value }))}
                        rows={6}
                        className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl p-4 text-xs text-white outline-none resize-none leading-relaxed font-semibold"
                      />
                    </div>
                  </div>
                </div>

                {/* API Template Config */}
                <div className="border border-darkBorder p-5 rounded-2xl bg-darkBg/20 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">Meta Approved Template (API Mode only)</h4>
                      <p className="text-[10px] text-gray-500 font-medium">Toggle this if you have an approved WhatsApp template with matching variables in Meta Developers console.</p>
                    </div>
                    <input 
                      type="checkbox"
                      checked={newCampaign.useTemplate}
                      onChange={(e) => setNewCampaign(prev => ({ ...prev, useTemplate: e.target.checked }))}
                      className="w-4 h-4 accent-primary-500"
                    />
                  </div>

                  {newCampaign.useTemplate && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Meta Template Name</label>
                        <input 
                          type="text" 
                          placeholder="e.g. appointment_confirmation_v1"
                          value={newCampaign.templateName}
                          onChange={(e) => setNewCampaign(prev => ({ ...prev, templateName: e.target.value }))}
                          className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2 text-xs text-white placeholder-gray-600 outline-none font-semibold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Language Code</label>
                        <input 
                          type="text" 
                          placeholder="e.g. en (defaults to English)"
                          value={newCampaign.templateLanguage}
                          onChange={(e) => setNewCampaign(prev => ({ ...prev, templateLanguage: e.target.value }))}
                          className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2 text-xs text-white placeholder-gray-600 outline-none font-semibold"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Preset Answers builder & Slots builder */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-darkBorder/60 pt-6">
                  
                  {/* Preset replies */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Configure Preset Answers</h4>
                    <p className="text-[10px] text-gray-500 font-medium">Map expected user response codes (e.g. 1, 2) to CRM statuses.</p>
                    
                    <div className="space-y-2">
                      {newCampaign.presetReplies.map((r, i) => (
                        <div key={i} className="flex justify-between items-center p-2 bg-darkBg border border-darkBorder rounded-xl text-xs font-bold">
                          <span>{r.label} &rarr; {r.value} <span className="text-gray-500 text-[10px]">({r.action})</span></span>
                          <button type="button" onClick={() => removePresetReplyForm(i)} className="text-rose-400 hover:text-rose-300">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-1.5">
                      <input 
                        type="text" 
                        placeholder="Keyword/No (e.g. 1)" 
                        value={newReply.label} 
                        onChange={(e) => setNewReply(prev => ({ ...prev, label: e.target.value }))}
                        className="bg-darkBg border border-darkBorder focus:border-primary-500 text-white text-xs font-bold px-2 py-1.5 rounded-lg outline-none w-28"
                      />
                      <input 
                        type="text" 
                        placeholder="Reply Selected Label" 
                        value={newReply.value} 
                        onChange={(e) => setNewReply(prev => ({ ...prev, value: e.target.value }))}
                        className="bg-darkBg border border-darkBorder focus:border-primary-500 text-white text-xs font-bold px-2 py-1.5 rounded-lg outline-none flex-grow"
                      />
                      <select 
                        value={newReply.action}
                        onChange={(e) => setNewReply(prev => ({ ...prev, action: e.target.value }))}
                        className="bg-darkBg border border-darkBorder focus:border-primary-500 text-white text-xs font-bold px-2 py-1.5 rounded-lg outline-none w-36"
                      >
                        <option value="Book appointment">Book appointment</option>
                        <option value="Mark reschedule needed">Mark reschedule</option>
                        <option value="Mark not interested">Not interested</option>
                        <option value="Mark talk to human">Talk to human</option>
                        <option value="Mark follow-up needed">Follow-up needed</option>
                      </select>
                      <button 
                        type="button" 
                        onClick={addPresetReplyForm}
                        className="px-3 py-1.5 bg-primary-600 hover:bg-primary-500 text-darkBg font-black text-xs rounded-lg"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Appointment Slots */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Configure Appointment Slots</h4>
                    <p className="text-[10px] text-gray-500 font-medium">Define capacity slots for this campaign. Stops bookings if full.</p>

                    <div className="space-y-2 max-h-32 overflow-y-auto">
                      {newCampaign.appointmentSlots.map((s, i) => (
                        <div key={i} className="flex justify-between items-center p-2 bg-darkBg border border-darkBorder rounded-xl text-xs font-bold">
                          <span>{s.date} @ {s.time} <span className="text-primary-400">({s.maxBookings} max)</span></span>
                          <button type="button" onClick={() => removeSlotForm(i)} className="text-rose-400 hover:text-rose-300">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-1.5">
                      <input 
                        type="date" 
                        value={newSlot.date} 
                        onChange={(e) => setNewSlot(prev => ({ ...prev, date: e.target.value }))}
                        className="bg-darkBg border border-darkBorder focus:border-primary-500 text-white text-xs font-bold px-2 py-1.5 rounded-lg outline-none flex-grow"
                      />
                      <input 
                        type="time" 
                        value={newSlot.time} 
                        onChange={(e) => setNewSlot(prev => ({ ...prev, time: e.target.value }))}
                        className="bg-darkBg border border-darkBorder focus:border-primary-500 text-white text-xs font-bold px-2 py-1.5 rounded-lg outline-none w-24"
                      />
                      <input 
                        type="number" 
                        placeholder="Max bookings" 
                        value={newSlot.maxBookings} 
                        onChange={(e) => setNewSlot(prev => ({ ...prev, maxBookings: parseInt(e.target.value, 10) }))}
                        className="bg-darkBg border border-darkBorder focus:border-primary-500 text-white text-xs font-bold px-2 py-1.5 rounded-lg outline-none w-24"
                      />
                      <button 
                        type="button" 
                        onClick={addSlotForm}
                        className="px-3 py-1.5 bg-primary-600 hover:bg-primary-500 text-darkBg font-black text-xs rounded-lg"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                </div>

                {/* Contacts Import Stepper */}
                <div className="border-t border-darkBorder/60 pt-6 space-y-4">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Load Campaign Contacts List</h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Upload Excel / CSV list</label>
                      <div className="border-2 border-dashed border-darkBorder hover:border-primary-500/30 rounded-2xl p-6 text-center cursor-pointer relative bg-darkBg/10">
                        <Upload className="w-8 h-8 text-gray-500 mx-auto mb-2" />
                        <span className="text-xs font-bold text-gray-300">Click to Select CSV File</span>
                        <p className="text-[10px] text-gray-600 mt-1">Required columns: name, phone, notes</p>
                        <input 
                          type="file" 
                          ref={fileInputRef}
                          onChange={handleCSVUpload}
                          accept=".csv,.xlsx,.xls"
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Copy-Paste manual list (One per line)</label>
                      <textarea 
                        placeholder="phone,name,notes&#10;e.g. 919876543210,Aary,Confirming tooth extraction"
                        value={manualContactInput}
                        onChange={(e) => setManualContactInput(e.target.value)}
                        rows={3}
                        className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl p-3 text-xs text-white placeholder-gray-600 outline-none resize-none font-semibold"
                      />
                      <button 
                        type="button" 
                        onClick={parseManualContactsInput}
                        className="w-full mt-2 py-1.5 bg-darkBg border border-darkBorder hover:border-primary-500 text-primary-400 rounded-xl text-xs font-bold transition-all"
                      >
                        Parse Text Numbers
                      </button>
                    </div>
                  </div>

                  {newCampaign.contacts.length > 0 && (
                    <div className="border border-darkBorder rounded-xl bg-darkBg/30 p-4 max-h-48 overflow-y-auto">
                      <div className="flex justify-between items-center text-[10px] text-gray-500 font-bold mb-3 border-b border-darkBorder pb-2">
                        <span>LOADED RECEIVERS ({newCampaign.contacts.length})</span>
                        <button type="button" onClick={() => setNewCampaign(p => ({ ...p, contacts: [] }))} className="text-rose-400 hover:underline">Clear List</button>
                      </div>
                      <div className="space-y-1 text-xs">
                        {newCampaign.contacts.map((c, idx) => (
                          <div key={idx} className="flex justify-between text-gray-400 font-semibold">
                            <span>{c.name || 'No Name'} ({c.phone})</span>
                            <span className="text-gray-600 truncate max-w-[200px]">{c.notes}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Pre flight validation checklist */}
                <div className="border-t border-darkBorder/60 pt-6 flex justify-between items-center gap-4">
                  <div className="text-xs font-semibold text-gray-500">
                    Contacts loaded: <span className="text-white font-extrabold">{newCampaign.contacts.length}</span> | Slots: <span className="text-white font-extrabold">{newCampaign.appointmentSlots.length}</span>
                  </div>

                  <button
                    type="submit"
                    className="px-6 py-3 bg-primary-600 hover:bg-primary-500 text-darkBg text-xs font-extrabold rounded-xl transition-all shadow-lg shadow-primary-500/15"
                  >
                    Save & Initialize Campaign
                  </button>
                </div>

              </form>
            </div>
          )}

          {/* Campaign Details dashboard view */}
          {activeTab === 'campaigns' && selectedCampaignId && campaignDetails && (
            <div className="space-y-8">
              
              {/* Back navigation & settings controls */}
              <div className="flex justify-between items-center flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => selectCampaign(null)}
                    className="px-3 py-1.5 bg-darkCard hover:bg-darkCard/60 border border-darkBorder text-primary-400 rounded-xl text-xs font-bold transition-all"
                  >
                    &larr; Back to Directory
                  </button>
                  <span className="text-gray-600 font-bold">/</span>
                  <span className="text-xs text-white font-extrabold">{campaignDetails.name}</span>
                </div>

                {settings.sendingMode === 'API' && (
                  <div className="flex gap-2">
                    {campaignDetails.status !== 'active' && (
                      <button 
                        onClick={() => handleStartQueue(campaignDetails.id)}
                        className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-darkBg text-xs font-black rounded-xl flex items-center gap-1.5 shadow-md shadow-primary-500/10"
                      >
                        <Play className="w-3.5 h-3.5 fill-darkBg" /> Start API Queue
                      </button>
                    )}
                    {campaignDetails.status === 'active' && (
                      <button 
                        onClick={() => handlePauseQueue(campaignDetails.id)}
                        className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-darkBg text-xs font-black rounded-xl flex items-center gap-1.5"
                      >
                        <Pause className="w-3.5 h-3.5 fill-darkBg" /> Pause Queue
                      </button>
                    )}
                    {campaignDetails.status === 'active' && (
                      <button 
                        onClick={() => handleStopQueue(campaignDetails.id)}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-black rounded-xl flex items-center gap-1.5"
                      >
                        <Square className="w-3.5 h-3.5 fill-white" /> Stop Queue
                      </button>
                    )}
                  </div>
                )}
                
                <div className="flex gap-2 text-xs">
                  <a 
                    href={`${API_BASE}/api/reports/campaign/${campaignDetails.id}/contacts`}
                    className="px-3 py-1.5 bg-darkCard border border-darkBorder hover:border-emerald-600 text-emerald-400 rounded-xl font-bold flex items-center gap-1 transition-all"
                  >
                    <Download className="w-4 h-4" /> Export Contacts CSV
                  </a>
                </div>
              </div>

              {/* Stats overview cards */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-6">
                
                <div className="bg-darkCard border border-darkBorder p-4 rounded-xl">
                  <span className="block text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Queue Status</span>
                  <span className={`text-xs font-black uppercase ${
                    campaignDetails.status === 'active' ? 'text-amber-400 animate-pulse' :
                    campaignDetails.status === 'completed' ? 'text-emerald-400' : 'text-gray-400'
                  }`}>{campaignDetails.status}</span>
                </div>

                <div className="bg-darkCard border border-darkBorder p-4 rounded-xl">
                  <span className="block text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Total Recipients</span>
                  <span className="text-sm font-black text-white">{campaignDetails.contacts?.length || 0}</span>
                </div>

                <div className="bg-darkCard border border-darkBorder p-4 rounded-xl">
                  <span className="block text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Outreach Dispatched</span>
                  <span className="text-sm font-black text-white">
                    {campaignDetails.contacts?.filter(c => c.messageStatus === 'sent' || c.messageStatus === 'replied').length || 0}
                  </span>
                </div>

                <div className="bg-darkCard border border-darkBorder p-4 rounded-xl">
                  <span className="block text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Total Replies</span>
                  <span className="text-sm font-black text-blue-400">
                    {campaignDetails.contacts?.filter(c => c.messageStatus === 'replied').length || 0}
                  </span>
                </div>

                <div className="bg-darkCard border border-darkBorder p-4 rounded-xl">
                  <span className="block text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Estimated Cost</span>
                  <span className="text-sm font-black text-emerald-400">
                    ${getCampaignCost(campaignDetails.contacts?.filter(c => c.messageStatus === 'sent' || c.messageStatus === 'replied').length || 0)}
                  </span>
                </div>

              </div>

              {/* Message template preview */}
              <div className="bg-darkCard border border-darkBorder rounded-2xl p-6 shadow-xl space-y-4">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Outreach Message Draft Preview</h4>
                <pre className="bg-darkBg border border-darkBorder rounded-xl p-4 text-xs font-semibold text-gray-300 leading-relaxed whitespace-pre-wrap">
                  {campaignDetails.messageTemplate}
                </pre>
              </div>

              {/* Campaign specific contacts, slots, replies lists */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* 1. Contacts List with CRUD inside campaign */}
                <div className="lg:col-span-2 bg-darkCard border border-darkBorder rounded-2xl p-6 shadow-xl space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Campaign Outreach Recipients</h4>
                    <button
                      onClick={() => setIsAddingContact(true)}
                      className="px-2.5 py-1 bg-primary-600 hover:bg-primary-500 text-darkBg font-black text-[10px] rounded-lg"
                    >
                      + Add Manually
                    </button>
                  </div>

                  {isAddingContact && (
                    <form onSubmit={handleAddManualContact} className="p-4 bg-darkBg border border-darkBorder rounded-xl grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                      <div>
                        <label className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider mb-1">Full Name</label>
                        <input 
                          type="text" 
                          placeholder="John Doe" 
                          value={manualContact.name} 
                          onChange={(e) => setManualContact(prev => ({ ...prev, name: e.target.value }))}
                          className="w-full bg-darkCard border border-darkBorder focus:border-primary-500 text-white px-2 py-1 rounded text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider mb-1">Phone Number (with Country Code)</label>
                        <input 
                          type="text" 
                          placeholder="e.g. 919876543210" 
                          value={manualContact.phone} 
                          onChange={(e) => setManualContact(prev => ({ ...prev, phone: e.target.value }))}
                          className="w-full bg-darkCard border border-darkBorder focus:border-primary-500 text-white px-2 py-1 rounded text-xs font-mono"
                        />
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-grow">
                          <label className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider mb-1">Notes</label>
                          <input 
                            type="text" 
                            placeholder="Reason/Detail" 
                            value={manualContact.notes} 
                            onChange={(e) => setManualContact(prev => ({ ...prev, notes: e.target.value }))}
                            className="w-full bg-darkCard border border-darkBorder focus:border-primary-500 text-white px-2 py-1 rounded text-xs"
                          />
                        </div>
                        <button type="submit" className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold">Add</button>
                      </div>
                    </form>
                  )}

                  <div className="border border-darkBorder rounded-xl overflow-hidden overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-darkBg border-b border-darkBorder text-gray-500 font-bold text-[10px] uppercase">
                          <th className="px-4 py-3">Customer</th>
                          <th className="px-4 py-3">Phone</th>
                          <th className="px-4 py-3">Message status</th>
                          <th className="px-4 py-3">Reply Value</th>
                          <th className="px-4 py-3 text-right">Outreach Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-darkBorder">
                        {(!campaignDetails.contacts || campaignDetails.contacts.length === 0) ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center text-gray-600 font-semibold">No contacts registered for this campaign.</td>
                          </tr>
                        ) : (
                          campaignDetails.contacts.map(c => (
                            <tr key={c.id} className="hover:bg-darkBg/30">
                              <td className="px-4 py-3">
                                <div className="font-semibold text-white">{c.name || 'No Name'}</div>
                                <div className="text-[10px] text-gray-500 truncate max-w-[150px]" title={c.notes}>{c.notes || '-'}</div>
                              </td>
                              <td className="px-4 py-3 font-mono text-gray-400">
                                <div className="flex items-center gap-1.5">
                                  <span>{c.phone}</span>
                                  <button onClick={() => copyPhone(c.phone)} className="text-[9px] text-primary-400">
                                    {copiedNum === c.phone ? 'Copied' : 'Copy'}
                                  </button>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                                  c.messageStatus === 'sent' ? 'bg-[#022c22] text-emerald-400' :
                                  c.messageStatus === 'replied' ? 'bg-[#1e3a8a] text-blue-300' :
                                  c.messageStatus === 'failed' ? 'bg-[#450a0a] text-rose-400' :
                                  'bg-zinc-800 text-zinc-400'
                                }`}>{c.messageStatus}</span>
                              </td>
                              <td className="px-4 py-3 text-gray-300">
                                {c.selectedReply ? (
                                  <span className="bg-[#0b1329] text-blue-300 px-2 py-0.5 border border-blue-950 rounded text-[10px] font-bold">
                                    {c.selectedReply}
                                  </span>
                                ) : '-'}
                              </td>
                              <td className="px-4 py-3 text-right space-x-1">
                                {settings.sendingMode === 'Manual' && c.messageStatus === 'pending' && (
                                  <button
                                    onClick={() => handleOpenWhatsAppManual(c)}
                                    className="px-2 py-1 bg-primary-600 hover:bg-primary-500 text-darkBg font-black text-[10px] rounded-lg"
                                  >
                                    Open in WA
                                  </button>
                                )}
                                <button 
                                  onClick={() => openRecordReplyModal(c)}
                                  className="px-2 py-1 bg-darkBg hover:bg-darkBg/60 text-primary-400 border border-darkBorder rounded text-[10px] font-bold"
                                >
                                  Record Reply
                                </button>
                                <button
                                  onClick={() => handleDeleteContact(c.id)}
                                  className="p-1 bg-rose-950/20 hover:bg-rose-950/40 text-rose-400 rounded-lg"
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

                {/* 2. Campaign details side columns */}
                <div className="space-y-6">
                  
                  {/* Slots info */}
                  <div className="bg-darkCard border border-darkBorder rounded-2xl p-6 shadow-xl space-y-4">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Available Capacity Slots</h4>
                    <div className="space-y-2">
                      {(!campaignDetails.appointmentSlots || campaignDetails.appointmentSlots.length === 0) ? (
                        <div className="text-center py-6 text-gray-600 text-xs font-medium border border-dashed border-darkBorder rounded-xl">
                          No slots defined.
                        </div>
                      ) : (
                        campaignDetails.appointmentSlots.map(s => {
                          const percent = Math.min(100, Math.round((s.currentBookings / s.maxBookings) * 100));
                          return (
                            <div key={s.id} className="p-3 bg-darkBg/30 border border-darkBorder rounded-xl space-y-2">
                              <div className="flex justify-between items-center text-xs font-bold text-white">
                                <span>{s.date} @ {s.time}</span>
                                <span className={percent >= 100 ? 'text-rose-400' : 'text-primary-400'}>
                                  {s.currentBookings} / {s.maxBookings} Slots
                                </span>
                              </div>
                              <div className="w-full h-1.5 bg-darkBg rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full transition-all ${
                                    percent >= 100 ? 'bg-rose-500' : 'bg-primary-500'
                                  }`} 
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Preset replies info */}
                  <div className="bg-darkCard border border-darkBorder rounded-2xl p-6 shadow-xl space-y-4">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Configured Preset Actions</h4>
                    <div className="space-y-2">
                      {(!campaignDetails.presetReplies || campaignDetails.presetReplies.length === 0) ? (
                        <div className="text-center py-6 text-gray-600 text-xs font-medium border border-dashed border-darkBorder rounded-xl">
                          No preset replies found.
                        </div>
                      ) : (
                        campaignDetails.presetReplies.map(pr => (
                          <div key={pr.id} className="p-2.5 bg-darkBg/30 border border-darkBorder rounded-xl flex justify-between items-center text-xs">
                            <span className="font-bold text-white">{pr.label} &rarr; {pr.value}</span>
                            <span className="text-[10px] text-primary-400 font-semibold bg-primary-950/40 border border-primary-900/30 px-2 py-0.5 rounded">
                              {pr.action}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                </div>

              </div>

            </div>
          )}

          {/* ================= TAB 3: CONTACTS DIRECTORY ================= */}
          {activeTab === 'contacts' && (
            <div className="space-y-6">
              
              <div className="flex justify-between items-center flex-wrap gap-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Opted-in Outreach List Directory</h3>
                  <p className="text-[10px] text-gray-500 font-medium mt-1">A consolidated list of all contacts imported across active campaigns.</p>
                </div>

                <div className="flex gap-2">
                  <a 
                    href={`${API_BASE}/api/reports/contacts`}
                    className="px-4 py-2 bg-darkCard border border-darkBorder hover:border-emerald-600 text-emerald-400 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all"
                  >
                    <Download className="w-4 h-4" /> Export All Contacts CSV
                  </a>
                </div>
              </div>

              {/* Contacts table view */}
              <div className="bg-darkCard border border-darkBorder rounded-2xl p-6 shadow-xl space-y-6">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 font-semibold">Consolidated Directory ({contactsList.length} Contacts)</span>
                </div>

                <div className="border border-darkBorder rounded-xl overflow-hidden overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-darkBg border-b border-darkBorder text-gray-500 font-bold text-[10px] uppercase">
                        <th className="px-4 py-3">Contact</th>
                        <th className="px-4 py-3">Phone</th>
                        <th className="px-4 py-3">Campaign</th>
                        <th className="px-4 py-3">Outreach Status</th>
                        <th className="px-4 py-3">Opt-in Consent</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-darkBorder">
                      {contactsList.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-gray-600 font-semibold">No contacts registered in CRM database.</td>
                        </tr>
                      ) : (
                        contactsList.map(c => (
                          <tr key={c.id} className="hover:bg-darkBg/30">
                            <td className="px-4 py-3">
                              <div className="font-semibold text-white">{c.name || 'Anonymous'}</div>
                              <div className="text-[10px] text-gray-500 max-w-[200px] truncate" title={c.notes}>{c.notes || '-'}</div>
                            </td>
                            <td className="px-4 py-3 font-mono text-gray-400">{c.phone}</td>
                            <td className="px-4 py-3 text-gray-400">{c.campaignName}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                                c.messageStatus === 'sent' ? 'bg-[#022c22] text-emerald-400' :
                                c.messageStatus === 'replied' ? 'bg-[#1e3a8a] text-blue-300' :
                                c.messageStatus === 'failed' ? 'bg-[#450a0a] text-rose-400' :
                                'bg-zinc-800 text-zinc-400'
                              }`}>{c.messageStatus}</span>
                            </td>
                            <td className="px-4 py-3">
                              <button 
                                onClick={() => handleToggleOptIn(c)}
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  c.optIn ? 'bg-emerald-950 text-emerald-400 border border-emerald-900/30' : 'bg-rose-950 text-rose-400 border border-rose-900/30'
                                }`}
                              >
                                {c.optIn ? 'Opted In' : 'Opted Out'}
                              </button>
                            </td>
                            <td className="px-4 py-3 text-right space-x-1.5">
                              {settings.sendingMode === 'Manual' && c.messageStatus === 'pending' && (
                                <button
                                  onClick={() => handleOpenWhatsAppManual(c)}
                                  className="px-2 py-1 bg-primary-600 hover:bg-primary-500 text-darkBg font-black text-[10px] rounded-lg"
                                >
                                  Open WhatsApp
                                </button>
                              )}
                              <button 
                                onClick={() => openRecordReplyModal(c)}
                                className="px-2 py-1 bg-darkBg hover:bg-darkBg/60 text-primary-400 border border-darkBorder rounded text-[10px] font-bold"
                              >
                                Record Reply
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

          {/* ================= TAB 4: BOOKINGS ================= */}
          {activeTab === 'bookings' && (
            <div className="space-y-6">
              
              <div className="flex justify-between items-center flex-wrap gap-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Appointments Booking & Confirmations Log</h3>
                  <p className="text-[10px] text-gray-500 font-medium mt-1">Confirmed booking logs with manual telephone verification actions.</p>
                </div>

                <div className="flex gap-2">
                  <a 
                    href={`${API_BASE}/api/reports/bookings`}
                    className="px-4 py-2 bg-darkCard border border-darkBorder hover:border-emerald-600 text-emerald-400 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all"
                  >
                    <Download className="w-4 h-4" /> Export Bookings CSV
                  </a>
                  <a 
                    href={`${API_BASE}/api/reports/calls`}
                    className="px-4 py-2 bg-darkCard border border-darkBorder hover:border-emerald-600 text-emerald-400 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all"
                  >
                    <Download className="w-4 h-4" /> Export Confirmation Call CSV
                  </a>
                </div>
              </div>

              {/* Bookings table */}
              <div className="bg-darkCard border border-darkBorder rounded-2xl p-6 shadow-xl space-y-6">
                <div className="border border-darkBorder rounded-xl overflow-hidden overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-darkBg border-b border-darkBorder text-gray-500 font-bold text-[10px] uppercase">
                        <th className="px-4 py-3">Customer</th>
                        <th className="px-4 py-3">Phone</th>
                        <th className="px-4 py-3">Campaign</th>
                        <th className="px-4 py-3">Appointment date/time</th>
                        <th className="px-4 py-3">Booking Status</th>
                        <th className="px-4 py-3">Notes</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-darkBorder">
                      {bookingsList.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-gray-600 font-semibold">No bookings recorded yet.</td>
                        </tr>
                      ) : (
                        bookingsList.map(b => (
                          <tr key={b.id} className="hover:bg-darkBg/30">
                            <td className="px-4 py-3 font-semibold text-white">{b.Contact?.name || 'Anonymous'}</td>
                            <td className="px-4 py-3 font-mono text-gray-400">
                              <div className="flex items-center gap-1.5">
                                <span>{b.Contact?.phone}</span>
                                <button onClick={() => copyPhone(b.Contact?.phone)} className="text-[9px] text-primary-400">
                                  {copiedNum === b.Contact?.phone ? 'Copied' : 'Copy'}
                                </button>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-gray-400 font-medium">{b.Campaign?.name}</td>
                            <td className="px-4 py-3 text-white font-semibold">
                              {b.AppointmentSlot ? `${b.AppointmentSlot.date} @ ${b.AppointmentSlot.time}` : 'Not scheduled'}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                                b.bookingStatus === 'Confirmed' ? 'bg-emerald-950 text-emerald-400 border border-emerald-900/35' :
                                b.bookingStatus === 'Pending Confirmation' ? 'bg-amber-950 text-amber-400 border border-amber-900/35' :
                                b.bookingStatus === 'Reschedule Needed' ? 'bg-indigo-950 text-indigo-400 border border-indigo-900/35' :
                                b.bookingStatus === 'Cancelled' ? 'bg-rose-950 text-rose-400 border border-rose-900/35' :
                                'bg-zinc-800 text-zinc-400'
                              }`}>{b.bookingStatus}</span>
                            </td>
                            <td className="px-4 py-3 text-gray-400 max-w-[150px] truncate">{b.notes || '-'}</td>
                            <td className="px-4 py-3 text-right space-x-1">
                              <a 
                                href={`tel:${b.Contact?.phone}`}
                                className="px-2 py-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-400 border border-emerald-900/35 rounded text-[10px] font-black inline-flex items-center gap-1"
                              >
                                <Phone className="w-3 h-3" /> Call
                              </a>
                              <button
                                onClick={() => openCallConfirmationDrawer(b.Contact)}
                                className="px-2 py-1 bg-primary-600 hover:bg-primary-500 text-darkBg rounded text-[10px] font-black"
                              >
                                Log Call
                              </button>
                              <button
                                onClick={() => handleCancelBooking(b.id)}
                                className="p-1 bg-rose-950/20 hover:bg-rose-950/40 text-rose-400 rounded-lg"
                                title="Cancel Appointment Slot"
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

          {/* ================= TAB 5: SYSTEM SETTINGS ================= */}
          {activeTab === 'settings' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* Blocklist inputs */}
              <div className="bg-darkCard border border-darkBorder rounded-2xl p-6 shadow-xl h-fit space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Opted-Out Blocklist</h3>
                <p className="text-[10px] text-gray-500 font-medium">Add numbers to completely exclude them from all campaigns and automations.</p>

                <form onSubmit={handleAddBlocklist} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Phone Number</label>
                    <input 
                      type="text" 
                      placeholder="e.g. 919876543210"
                      value={blockPhone}
                      onChange={(e) => setBlockPhone(e.target.value)}
                      className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2 text-xs text-white placeholder-gray-600 outline-none font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Reason</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Requested STOP keyword"
                      value={blockReason}
                      onChange={(e) => setBlockReason(e.target.value)}
                      className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2 text-xs text-white placeholder-gray-600 outline-none font-semibold"
                    />
                  </div>
                  <button 
                    type="submit" 
                    className="w-full py-2 bg-primary-600 hover:bg-primary-500 text-darkBg text-xs font-black rounded-xl transition-all"
                  >
                    Add to blocklist
                  </button>
                </form>

                {/* Exclude list Database table */}
                <div className="border border-darkBorder rounded-xl max-h-48 overflow-y-auto divide-y divide-darkBorder pt-2">
                  {blocklist.length === 0 ? (
                    <div className="p-4 text-center text-gray-600 text-xs font-medium">Blocklist is empty.</div>
                  ) : (
                    blocklist.map(b => (
                      <div key={b.id} className="p-3 text-xs flex justify-between items-center">
                        <div>
                          <div className="font-mono font-bold text-white">{b.phone}</div>
                          <div className="text-[10px] text-gray-500">{b.reason || 'Unspecified'}</div>
                        </div>
                        <button onClick={() => handleRemoveBlocklist(b.id)} className="text-rose-400 hover:underline">Unblock</button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Main settings form */}
              <div className="lg:col-span-2 bg-darkCard border border-darkBorder rounded-2xl p-8 shadow-xl space-y-6 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1 bg-primary-500" />
                
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 border-b border-darkBorder pb-3">Global Outreach Configurations</h3>
                
                <form onSubmit={handleSaveSettings} className="space-y-6 text-xs">
                  
                  {/* Mode Toggler */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-darkBg/30 border border-darkBorder p-5 rounded-2xl">
                    <div>
                      <h4 className="font-bold text-white uppercase tracking-wider text-xs">Communication Mode</h4>
                      <p className="text-[10px] text-gray-500 font-medium mt-1">Manual link generation or automatic Meta Cloud API dispatching.</p>
                    </div>
                    <div>
                      <select
                        value={settingsForm.sendingMode || 'Manual'}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, sendingMode: e.target.value }))}
                        className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 text-white rounded-xl px-4 py-2.5 outline-none font-bold"
                      >
                        <option value="Manual">Manual Mode (WhatsApp Web Links)</option>
                        <option value="API">WhatsApp Business Cloud API Mode</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Business Profile Display Name</label>
                      <input 
                        type="text" 
                        value={settingsForm.businessName || ''}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, businessName: e.target.value }))}
                        className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2.5 text-white outline-none font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Daily Threshold Message Warning Limit</label>
                      <input 
                        type="number" 
                        value={settingsForm.dailyLimit || '200'}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, dailyLimit: e.target.value }))}
                        className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2.5 text-white outline-none font-mono"
                      />
                    </div>
                  </div>

                  {settingsForm.sendingMode === 'API' && (
                    <div className="border border-darkBorder p-5 rounded-2xl bg-darkBg/20 space-y-4">
                      <h4 className="font-bold text-white uppercase tracking-wider">Meta Business Cloud API Gateway Credentials</h4>
                      
                      <div className="space-y-4">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Meta Access Token (Permanent / Temporary)</label>
                          <input 
                            type="password" 
                            value={settingsForm.whatsappAccessToken || ''}
                            onChange={(e) => setSettingsForm(prev => ({ ...prev, whatsappAccessToken: e.target.value }))}
                            className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2 text-white outline-none font-mono"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">WhatsApp Phone Number ID</label>
                            <input 
                              type="text" 
                              value={settingsForm.whatsappPhoneNumberId || ''}
                              onChange={(e) => setSettingsForm(prev => ({ ...prev, whatsappPhoneNumberId: e.target.value }))}
                              className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2 text-white outline-none font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">WhatsApp Business Account ID</label>
                            <input 
                              type="text" 
                              value={settingsForm.whatsappBusinessAccountId || ''}
                              onChange={(e) => setSettingsForm(prev => ({ ...prev, whatsappBusinessAccountId: e.target.value }))}
                              className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2 text-white outline-none font-mono"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-darkBorder pt-4">
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Webhook URL (For Meta developers portal)</label>
                            <div className="bg-darkBg border border-darkBorder rounded-xl px-3 py-2 text-gray-500 font-mono text-[10px] flex justify-between items-center select-all">
                              <span>{window.location.origin}/api/whatsapp/webhook</span>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Webhook Verify Token</label>
                            <input 
                              type="text" 
                              value={settingsForm.whatsappVerifyToken || ''}
                              onChange={(e) => setSettingsForm(prev => ({ ...prev, whatsappVerifyToken: e.target.value }))}
                              className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2 text-white outline-none font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Outreach Policy Consent Disclaimer text</label>
                      <input 
                        type="text" 
                        value={settingsForm.disclaimerText || ''}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, disclaimerText: e.target.value }))}
                        className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2.5 text-white outline-none font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Opt-out Keyword (Triggers blacklist)</label>
                      <input 
                        type="text" 
                        value={settingsForm.optOutKeyword || ''}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, optOutKeyword: e.target.value }))}
                        className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2.5 text-white outline-none font-bold text-center uppercase"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Meta Charge per Outreach Cost ($)</label>
                      <input 
                        type="text" 
                        value={settingsForm.messageCostRate || '0.01'}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, messageCostRate: e.target.value }))}
                        className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 rounded-xl px-4 py-2.5 text-white outline-none font-mono"
                      />
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    className="w-full py-3 bg-primary-600 hover:bg-primary-500 text-darkBg text-xs font-extrabold rounded-xl transition-all shadow-md shadow-primary-500/10"
                  >
                    Save configuration Settings
                  </button>

                </form>
              </div>

            </div>
          )}

        </div>
      </main>

      {/* MODAL 1: Record manual replies */}
      {recordingContact && (
        <div className="fixed inset-0 bg-black/75 z-40 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-darkCard border border-darkBorder rounded-2xl w-full max-w-md p-6 shadow-2xl relative space-y-4">
            <button onClick={() => setRecordingContact(null)} className="absolute top-4 right-4 p-1 hover:bg-darkBg rounded text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
            <div>
              <h3 className="font-extrabold text-sm uppercase tracking-wider text-white">Record Customer Reply manually</h3>
              <p className="text-[10px] text-gray-500 mt-1">Recording customer response for {recordingContact.name || recordingContact.phone}.</p>
            </div>

            <form onSubmit={handleRecordManualReplySubmit} className="space-y-4 text-xs font-semibold">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Select Answer Received</label>
                <select
                  value={selectedReplyVal}
                  onChange={(e) => setSelectedReplyVal(e.target.value)}
                  className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 text-white rounded-xl px-3 py-2 outline-none"
                >
                  <option value="">-- Choose matching answer option --</option>
                  {campaignDetails?.presetReplies?.map(pr => (
                    <option key={pr.id} value={pr.value}>{pr.label} - {pr.value} ({pr.action})</option>
                  ))}
                  <option value="Other / Freeform">Custom Reply / Other</option>
                </select>
              </div>

              {campaignDetails?.presetReplies?.find(r => r.value === selectedReplyVal)?.action === 'Book appointment' && (
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Select Capacity Slot</label>
                  <select
                    value={bookingSlotId}
                    onChange={(e) => setBookingSlotId(e.target.value)}
                    className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 text-white rounded-xl px-3 py-2 outline-none"
                  >
                    <option value="">-- Choose slot --</option>
                    {campaignDetails?.appointmentSlots?.map(slot => (
                      <option 
                        key={slot.id} 
                        value={slot.id}
                        disabled={slot.currentBookings >= slot.maxBookings}
                      >
                        {slot.date} @ {slot.time} ({slot.maxBookings - slot.currentBookings} left)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Conversation Notes</label>
                <textarea 
                  value={recordNotes}
                  onChange={(e) => setRecordNotes(e.target.value)}
                  rows={3}
                  placeholder="Record customer constraints, follow-up times..."
                  className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 text-white rounded-xl p-3 outline-none resize-none"
                />
              </div>

              <button 
                type="submit" 
                className="w-full py-2.5 bg-primary-600 hover:bg-primary-500 text-darkBg font-black text-xs rounded-xl"
              >
                Log Response Status
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Record phone calls results */}
      {callingContact && (
        <div className="fixed inset-0 bg-black/75 z-40 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-darkCard border border-darkBorder rounded-2xl w-full max-w-md p-6 shadow-2xl relative space-y-4">
            <button onClick={() => setCallingContact(null)} className="absolute top-4 right-4 p-1 hover:bg-darkBg rounded text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
            <div>
              <h3 className="font-extrabold text-sm uppercase tracking-wider text-white">Log Telephone Call Result</h3>
              <p className="text-[10px] text-gray-500 mt-1">Logging call result verification details for {callingContact.name || callingContact.phone}.</p>
            </div>

            <div className="bg-darkBg/60 border border-darkBorder p-3 rounded-xl flex items-center justify-between text-xs">
              <div>
                <div className="text-gray-500">Phone Number:</div>
                <div className="font-mono text-white font-bold">{callingContact.phone}</div>
              </div>
              <a 
                href={`tel:${callingContact.phone}`} 
                className="px-3 py-1.5 bg-emerald-950 text-emerald-400 hover:bg-emerald-900 border border-emerald-900/35 rounded-lg flex items-center gap-1 font-bold text-xs"
              >
                <Phone className="w-3.5 h-3.5" /> Call Dialer
              </a>
            </div>

            <form onSubmit={handleRecordCallSubmit} className="space-y-4 text-xs font-semibold">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Call verification Result</label>
                <select
                  value={callStatusResult}
                  onChange={(e) => setCallStatusResult(e.target.value)}
                  className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 text-white rounded-xl px-3 py-2 outline-none"
                >
                  <option value="confirmed">Confirmed</option>
                  <option value="reschedule_needed">Reschedule Needed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="no_answer">No Answer / Voicemail</option>
                  <option value="not_interested">Not Interested</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Call details & notes</label>
                <textarea 
                  value={callNotes}
                  onChange={(e) => setCallNotes(e.target.value)}
                  rows={3}
                  placeholder="e.g. Spoke to wife, she confirmed appointment slot."
                  className="w-full bg-darkBg border border-darkBorder focus:border-primary-500 text-white rounded-xl p-3 outline-none resize-none"
                />
              </div>

              <button 
                type="submit" 
                className="w-full py-2.5 bg-primary-600 hover:bg-primary-500 text-darkBg font-black text-xs rounded-xl"
              >
                Save Call Log
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
