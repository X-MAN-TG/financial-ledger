# 💠 Financial Ledger

### Your private daily trading ledger fast, offline-first, and built like a real financial product.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/<your-username>/financial-ledger)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-daily--ledger.workers.dev-00c896?style=for-the-badge&logo=cloudflare&logoColor=white)](https://daily-ledger.100coldice.workers.dev)
[![Built with React](https://img.shields.io/badge/React-18-149eca?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1%20%2B%20R2-f38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Offline First](https://img.shields.io/badge/Offline-First-6c5ce7?style=flat-square&logo=pwa&logoColor=white)](#-offline-first-architecture)
[![License](https://img.shields.io/badge/License-Private-lightgrey?style=flat-square)](#-license)

**[🔴 Live Demo →](https://daily-ledger.100coldice.workers.dev)**

</div>

---

## ✨ What is this?

**Financial Ledger** is a private, mobile-first financial transaction ledger a modern
"daily databook" for anyone who manually tracks daily currency-exchange or trading
activity and wants something dramatically better than a spreadsheet, without the
overhead of full accounting software.

Every day gets its own ledger. Every user's data is completely isolated. Every
transaction autosaves instantly online or offline and syncs safely the moment
connectivity returns. It's designed to feel like a native financial app, not a website.

> Built for **speed, reliability, and trust** first visual polish second.
> Data integrity always wins over everything else.

---

## 🖼️ Preview

| Dashboard | Daily Ledger | Analytics |
|:---:|:---:|:---:|
| *your home screen* | *the beating heart of the app* | *premium fintech-grade insights* |

*(Add your own screenshots here — drop them in `/docs/screenshots` and update the paths.)*

---

## 🚀 Live Demo

**Try it now → [daily-ledger.100coldice.workers.dev](https://daily-ledger.100coldice.workers.dev)**

---

## 🧠 Core Features

### 📒 The Daily Ledger
- One dedicated ledger per calendar date open any day, past or present
- Fast row-based entry: add/delete rows, Tab/Enter keyboard flow, auto-focus
- Tracks Customer, INR, INR Received, USDT, Final RUB, Extras, Order Done, and Notes
- A live, always-visible totals bar that recalculates instantly on every edit
- Mark any day as **Day Off** reopen it anytime without losing data

### 🔌 Offline-First, Always
- Every entry is saved locally first the app works fully with no internet
- Automatic, idempotent background sync the moment you're back online
- Survives closed tabs, browser restarts, and iOS Safari "swipe away"
- Zero duplicate transactions, zero lost edits guaranteed by design

### 📊 Real Analytics, Not Decoration
- Today / 7 Days / 30 Days / Monthly / All-Time breakdowns
- Transaction volume trends, extras trends, completion rates
- Most active days, top customers, currency movement all computed server-side

### 👥 Customers & Timeline
- A lightweight customer directory with per-customer transaction history
- A searchable, filterable timeline of your entire trading history, grouped by date

### 🔐 Private by Design
- Strict per-user data isolation, enforced at the server not just the UI
- Two distinct roles: **Owner** (administration) and **User** (personal ledger)
- Every meaningful action is audit-logged

### 💾 Backup You Can Trust
- Export your full ledger as PDF, CSV, or JSON generated entirely in your browser
- Automated Cloudflare R2 backups + D1 Time Travel as a safety net
- The app never claims a backup succeeded unless it actually did

### 🎨 A Theme for Every Mood
- Light, Dark, and a true **OLED Black** theme
- Four additional premium color themes (navy, indigo, emerald, slate)
- Every theme is mature, professional, and easy on the eyes

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React · TypeScript · Vite · Tailwind CSS · shadcn/ui · Lucide Icons |
| **Motion & Charts** | Motion (animations) · Recharts (analytics) |
| **State & Forms** | TanStack Query · TanStack Table · React Hook Form · Zod |
| **Offline Storage** | Dexie (IndexedDB) · Service Worker · vite-plugin-pwa |
| **Backend** | Cloudflare Workers (TypeScript) |
| **Database** | Cloudflare D1 (SQLite at the edge) |
| **Backups** | Cloudflare R2 + D1 Time Travel |
| **Hosting** | Cloudflare's global edge network |

---

## 🗺️ Architecture at a Glance

```
Browser (React PWA)
   │
   │  writes instantly to IndexedDB (Dexie)
   ▼
Local-first UI  ──sync when online──►  Cloudflare Worker (API)
                                             │
                                             ▼
                                       Cloudflare D1 (source of truth)
                                             │
                                             ▼
                                  Cloudflare R2 (automated backups)
```

One repository. One deployable Worker. No separate backend server, no database
exposed to the browser — every request is authenticated, authorized, and validated
at the edge.

---

## ⚡ Quick Start

### Prerequisites
- Node.js 18+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)

### Local Development

```bash
# 1. Clone the repo
git clone https://github.com/<your-username>/financial-ledger.git
cd financial-ledger

# 2. Install dependencies
npm install

# 3. Create your local D1 database
wrangler d1 create financial-ledger-db

# 4. Copy the example config and fill in your own values
cp wrangler.toml.example wrangler.toml
cp .dev.vars.example .dev.vars

# 5. Run database migrations
wrangler d1 migrations apply financial-ledger-db --local

# 6. Start the dev server
npm run dev
```

The app will be running locally with hot reload on both the frontend and the Worker.

---

## ☁️ One-Click Deploy to Cloudflare

Click the button below to deploy your own private instance directly to Cloudflare:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/<your-username>/financial-ledger)

After deploying, don't forget to:
1. Create and bind your **D1 database** and **R2 bucket**
2. Set your secrets: `wrangler secret put SESSION_SIGNING_KEY`, `OWNER_BOOTSTRAP_SECRET`, etc.
3. Run your migrations against the production database
4. Log in once as Owner to complete setup

Full details in [`/docs/deployment.md`](./docs/deployment.md).

---

## 🔒 Security & Privacy

- Passwords are hashed with salted PBKDF2 never stored in plain text
- Sessions are server-revocable, HttpOnly, and never exposed to client-side scripts
- Every API request re-validates ownership one user can never see another's data
- No secrets are ever committed to this repository (see `.gitignore` and `*.example` files)

---

## 📌 Project Status

This project is under active development. See the pinned roadmap/issues for what's
next. Data integrity, security, and offline reliability are always prioritized ahead
of new features or visual changes.

---

## 🤝 Contributing

Contributions, improvements, bug fixes, and ideas are welcome. If you'd like to contribute, please open an issue or submit a pull request.

---

## 📄 License

This project is open source and distributed under the terms of the license included in this repository.

You are free to use, study, modify, and redistribute the project in accordance with the applicable license terms. Please review the `LICENSE` file for the complete permissions, conditions, and limitations.

---

<div align="center">

**Financial Ledger** built for people who take their numbers seriously.

<br>

Created & maintained by **𝗔𝘆𝘂𝘀𝗵 𝗞**

</div>
