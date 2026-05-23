# 🚀 WhatsApp Web Campaign & API Gateway

<p align="center">
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel" />
  <img src="https://img.shields.io/badge/Render-46E3B7?style=for-the-badge&logo=render&logoColor=white" alt="Render" />
</p>

A premium, highly secure, and fully self-contained WhatsApp Web-based campaign sender and **direct HTTP API Gateway**. Crafted with safety-first controls (such as dynamic jitter cooldowns, unsubscribe database, daily limits, and auto-halt triggers) and process-level crash guards to ensure stable programmatic API delivery.

---

## ✨ Key Features

* 🔌 **Direct REST API Gateway**: Exposes a clean HTTP endpoint (`POST /api/messages/send`) to send WhatsApp messages from any curl request, script, or external system.
* 📱 **WhatsApp Web Linker**: Real-time QR-code linking using dynamic generation directly in the dashboard UI.
* 💾 **Session Caching**: Saves authentication state locally so you don't have to scan the QR code on every launch.
* 🏷️ **Dynamic Tag Templating**: Custom tags `{name}`, `{phone}`, `{custom1}`, `{custom2}` dynamically compile for each recipient.
* ⏱️ **Safety Jitter Controls**: Configurable fixed minimum + randomized extra delay ranges.
* 🚨 **Auto-Halt Trigger**: Automatically pauses campaign queues if continuous failures exceeding 20% occur.
* 📂 **Universal Contact Upload**: Support for XLSX, CSV, manual copy-paste parsing, and Google Sheets link extraction.
* 📊 **Exportable Reports**: Generate detailed CSV logs showing successful dispatches, failures, and errors.
* 🚫 **Unsubscribe Database**: Built-in blocklist panel ensuring unsubscribed/blocked clients never receive campaigns.

---

## 🌐 HTTP REST API Gateway Guide

Once your WhatsApp device is connected via the dashboard QR code, you can use the backend directly as a private API gateway. 

### 1. Check Connection Status
* **Endpoint**: `GET /api/whatsapp/status`
* **Response**:
  ```json
  {
    "status": "Connected",
    "qrCode": "",
    "senderNumber": "919082209489"
  }
  ```

### 2. Send Message via API
* **Endpoint**: `POST /api/messages/send`
* **Headers**: `Content-Type: application/json`
* **Payload**:
  ```json
  {
    "phone": "9987020199",
    "message": "Hello! This is sent directly via the WhatsApp REST API Gateway."
  }
  ```
* **cURL Example**:
  ```bash
  curl -X POST http://localhost:5001/api/messages/send \
    -H "Content-Type: application/json" \
    -d '{"phone": "9987020199", "message": "Hello from API!"}'
  ```
* **Response (Success)**:
  ```json
  {
    "success": true,
    "message": "Message sent successfully",
    "messageId": "3EB0D4BB802425"
  }
  ```

---

## 🛠️ Architecture & Directories

The project is split into two modules:
* **`/backend`**: Express Node.js application managing SQLite/Sequelize database, Puppeteer-headless WhatsApp automation client, and socket streams.
* **`/frontend`**: React + Vite single-page application crafted with minimalist Tailwind CSS panels.

```text
├── README.md
├── backend/
│   ├── .env
│   ├── database.js          # SQLite / Sequelize models
│   ├── whatsapp.js          # WhatsApp Web Client & local session caches
│   ├── queue.js             # Intelligent transmission queue manager
│   ├── server.js            # Express routes and socket hubs
│   ├── render-build.sh      # Render custom build script for Chromium
│   └── package.json
└── frontend/
    ├── src/
    │   ├── App.jsx          # Custom React panel UI console
    │   ├── index.css        # Tailwind style definitions & typography
    │   └── main.jsx
    ├── tailwind.config.js
    ├── postcss.config.js
    └── package.json
```

---

## ⚙️ Quick Start (Local Setup)

### Prerequisites
* [Node.js](https://nodejs.org/) (v18 or higher recommended)
* A mobile device with WhatsApp installed.

### Step 1: Install Dependencies
Open your terminal and install packages for both components:

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### Step 2: Configure Environment Variables
Verify or edit configuration variables inside `backend/.env`:
```env
PORT=5001
CORS_ORIGIN=http://localhost:5173
DATABASE_URL=sqlite://database.sqlite
SESSION_PATH=./whatsapp-session
UPLOAD_PATH=./uploads

# Safety Defaults
MIN_COOLDOWN_SECONDS=5
DEFAULT_DAILY_LIMIT=200
```

### Step 3: Run Both Services
You can run both servers concurrently. Open two terminal split instances:

**Terminal 1 (Backend)**:
```bash
cd backend
npm run dev
```

**Terminal 2 (Frontend)**:
```bash
cd frontend
npm run dev
```

---

## ☁️ Deployment Guide

Follow these steps to deploy the application on **Render** (Backend) and **Vercel** (Frontend).

### 1. Backend Deployment (Render)

Deploy the Express Node.js server as a **Web Service** on Render:

1. Log in to [Render](https://render.com) and click **New** > **Web Service**.
2. Connect your GitHub repository.
3. In the creation wizard, configure:
   * **Name**: `whatsapp-blast-backend`
   * **Root Directory**: `backend`
   * **Runtime**: `Node`
   * **Build Command**: `./render-build.sh`
   * **Start Command**: `node server.js`
4. Click **Advanced** and add the following **Environment Variables**:
   * `PUPPETEER_CACHE_DIR` = `/opt/render/.cache/puppeteer`
   * `PORT` = `5001`
   * `CORS_ORIGIN` = `https://your-vercel-domain.vercel.app` (Your frontend Vercel URL)
5. Under the **Disk** section (if using a paid instance), you can mount a persistent disk to `/opt/render/project/src/whatsapp-session` to keep SQLite database and WhatsApp session logs permanent. (Without a disk, the sqlite database and QR logins will reset every 24 hours).

---

### 2. Frontend Deployment (Vercel)

Deploy the React Vite frontend on Vercel:

1. Log in to [Vercel](https://vercel.com) and click **Add New** > **Project**.
2. Select your GitHub repository.
3. Configure the following project options:
   * **Framework Preset**: `Vite`
   * **Root Directory**: `frontend`
   * **Build Command**: `npm run build`
   * **Output Directory**: `dist`
4. Expand **Environment Variables** and add:
   * `VITE_API_BASE` = `https://whatsapp-blast-backend.onrender.com` (Your backend Render service URL)
5. Click **Deploy**.

---

## 🛡️ Best Practices for Keeping WhatsApp Safe

WhatsApp active checks monitor mass automated scripts. To ensure absolute compliance and prevent account bans:
1. **Always use Opt-In contacts**: Only message users who have explicitly requested updates.
2. **Set generous cooldowns**: Avoid rapid blasts. We enforce a minimum 5-second delay, but recommend using **15–60 seconds** cooldown ranges.
3. **Configure random delays**: The random delay slider introduces variations mimicking natural typing.
4. **Utilize dynamic placeholders**: Make messages distinct by embedding custom recipient variables (`{name}`, `{custom1}`, etc.) to avoid sending exact repetitive messages.
5. **Manage blocklists**: Instantly log opt-out/unsubscribe requests in the "Unsubscribe List" panel.

---

## 🛠️ Troubleshooting

If you experience issues such as the **QR code appearing and disappearing within a few seconds** or failing to persist:

1. **Clear Existing Sessions**: Delete the `backend/whatsapp-session` cache folder to clear any corrupt local authentication files, or click the **"Clear Session"** button directly inside the app's dashboard.
2. **Restart the Server**: Stop the backend process (`Ctrl + C`) and run `npm run dev` again to boot a clean browser instance.
3. **Web Version Cache**: We have automatically configured a stable, remote `webVersionCache` to bypass WhatsApp Web's browser support checks. If WhatsApp updates again, check the latest active version files in the [wppconnect-team/wa-version](https://github.com/wppconnect-team/wa-version) repository and update `webVersionCache.remotePath` in `backend/whatsapp.js` accordingly.
