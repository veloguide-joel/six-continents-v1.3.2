# Six-continents-V1.3
Stability update: fixed logout issues, rebuilt password reset with modern UI, added global toast system, restored reliable DB solve logging, and introduced automatic local-to-cloud progress sync. App now loads cleaner, logs consistently, and maintains user progress across devices.
📦 Six Continents Challenge App

Modern browser-based puzzle game built around Joel & Jillian’s real Six Continents travel adventure. Players solve destination-based riddles across 15 stages for a chance to win major prizes.

This app uses a lightweight vanilla-JS front end with Supabase handling authentication, progress storage, and database-driven leaderboards.

🚀 Features
🔐 Modern Authentication

Email/password login

Secure password reset via Supabase

Fully redesigned 2025-style reset modal

Auto-login after reset

Smart “Welcome / Welcome back” toasts

🟦 Supabase Integration

Auth session management

RLS-protected stage logging

Progress syncing across devices

Leaderboard + stage winners table

🧩 Stage Progression System

15 riddle stages

Answer hashing with a server-side salt

Confetti triggers on stage solves

Real-time leaderboard updates

☁️ Local → Cloud Progress Sync (v1.3)

If local browser progress exceeds cloud progress:

Missing stages are auto-uploaded

Prevents lost solves

Ensures correct stage on every login

Fully cross-device safe

🎨 Updated UX (v1.3)

Global toast notification system

Styled password reset flow

Cleaner login/logout transitions

Modern modal components

Better state handling on refresh

🛠 Stability & Bug Fixes (v1.3)

DB solve logging restored

Logout rebuilt (no more ghost sessions)

Duplicate initialization removed

Auth listener cleaned up

Consistent session restore on reload

🏗️ Tech Stack

Vanilla JavaScript (no frameworks)

Supabase (Auth + Postgres DB)

HTML & CSS (simple static client)

Vercel (hosting + environment variables)

GitHub (source control)

⚙️ Local Setup
git clone <repo-url>
cd six-continents-challenge


You can run this app with any static server, e.g.:

VS Code

Use the Live Server extension and open index.html.

Node (optional)
npx serve .

Required Environment Variables

Create a .env or configure Vercel:

SUPABASE_URL=
SUPABASE_ANON_KEY=
ANSWER_SALT=

🚀 Deployment (Vercel)

Push to GitHub

Import the repo into Vercel

Add environment variables under Settings → Environment Variables

Deploy to production

Vercel handles static file hosting + edge caching automatically

🔒 Security Notes

All stage answers are hashed client-side using a secure salt

The plaintext answers never exist in the repo

Supabase RLS ensures users can only insert their own solve rows

Password reset flow uses Supabase’s secure recovery tokens

No sensitive keys are committed to source control

📁 Folder Structure
/
├── index.html
├── script.js
├── confetti-guard.js
├── styles.css (if present)
├── assets/
└── README.md

📝 Changelog
v1.3 – Stability & Modernization Release

Password Reset Overhaul

Replaced prompt() with a modal

Auto-login after reset

Toast notifications added

Logout Fixes

Rebuilt sign-out flow

Eliminated intermittent failure

No more ghost sessions on refresh

Progress System Upgrade

Automatic local-to-cloud progress sync

Prevents lost solves across devices

Recovers progress instantly on login

Database Logging Fix

Restored reliable solve inserts

Improved diagnostics

UI/UX Enhancements

Global toast system

Cleanup of double-init bugs

More consistent navigation flow

👤 Credits

Created by Joel (The Accidental Retiree)
Assisted with architecture, debugging, and modernization by ChatGPT
GitHub Copilot used for targeted code insertion during dev rebuild.

📜 License

MIT License
