# EmailConfig: self-hosted cold outreach

A single-user app that emails each lead **once**, slowly and automatically, from your Hostinger mailbox. Each message is personalised by an AI from facts the app checks on the lead's real homepage. When the app is unsure about anything, it does not send.

Stack: Next.js 15 (App Router) + TypeScript + Tailwind, SQLite + Prisma, Nodemailer, imapflow. A separate worker process handles sending and inbox sync, run under pm2.

## Setup

```bash
git clone https://github.com/Kishan3864/EmailConfig.git
cd EmailConfig
npm install
cp .env.example .env        # then edit .env (see below)
npx prisma db push          # creates data/app.db
npm run build
```

`.env` (secrets live only here and are never committed):

| Key | What |
|---|---|
| `DATABASE_URL` | `file:../data/app.db` |
| `APP_PASSWORD` | your login password |
| `SESSION_SECRET` | random string, 32+ chars (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `SMTP_PASSWORD` | Hostinger mailbox password |
| `IMAP_PASSWORD` | optional, defaults to `SMTP_PASSWORD` |
| `AI_API_KEY` | key for any OpenAI-compatible endpoint |
| `COOKIE_SECURE` | `true` when served over HTTPS |

## Run

Development:

```bash
npm run dev          # web UI on http://localhost:3000
npm run worker       # sender + inbox sync (second terminal)
```

Production with pm2:

```bash
npm i -g pm2
npm run build
pm2 start ecosystem.config.js     # starts outreach-web and outreach-worker
pm2 save && pm2 startup           # restart on reboot
pm2 logs outreach-worker          # watch sending
pm2 restart all                   # after git pull + npm run build
```

Put the web app behind a reverse proxy with HTTPS (nginx or Caddy) if it is reachable from the internet.

## First-time checklist

1. **Settings**: fill in your mailbox, sender profile, offer notes, test address, alert address, AI base URL and model, and domain plus DKIM selector. Click **Test SMTP**, **Test IMAP**, **Send test mail to me**, **Test AI** and **Check DNS**.
2. Leave **Dry-run** on for the first campaign. Mails then go only to your test address.
3. **Import**: upload a CSV, XLSX, PDF or TXT file, or paste text. Map the columns, say where you found the addresses, review the preview, then confirm.
4. **Contacts → needs_review**: approve or reject addresses that look like a private person's.
5. **Campaigns**: create a campaign. Generate the 5 sample drafts, read them, then click **Approve samples & start**. A campaign is blocked if SPF or DKIM is missing.
6. When you are happy with the results, turn off dry-run in Settings.

## Safety rules built in

- Each email address is unique in the DB, ever, and so is each business key (website domain, or the email domain when it is not a free-mail provider). Each lead has exactly one message.
- Before the SMTP call, the message is marked `sending` inside a transaction. If the worker crashes, or the server's answer is unclear, the message becomes `check_manual` and is never resent.
- A message is retried (at most 2 times, on later days) only when the server clearly refused it. There are no follow-ups.
- All sending pauses automatically, with a red alert and an email to you, on:
  - any SMTP auth, policy or rate-limit error
  - 2 hard bounces in one day
  - a bounce rate above 5% over the last 50 sends
- Sending happens only on Mon–Fri, 09:30–17:30 in the campaign's timezone, with a random 5–15 minute gap. Warm-up starts at 10 per day and adds 5 each sending day, up to 30, and never exceeds 40% of your mailbox plan limit. All of these are editable.
- Mails are plain text only: no tracking, no links in the AI-written body, a List-Unsubscribe mailto header, and a footer in the recipient's language ("where I found you", "reply STOP").
- The suppression list is permanent. Bounces and opt-outs are added automatically, and nothing is ever removed from it.

## DB backup

SQLite is a single file at `data/app.db`.

```bash
mkdir -p backups
sqlite3 data/app.db ".backup 'backups/app-$(date +%F).db'"     # safe while running
# or, with the apps stopped:
pm2 stop all && cp data/app.db backups/app-$(date +%F).db && pm2 start all
```

Daily cron (Linux):

```
0 2 * * * cd /path/to/EmailConfig && sqlite3 data/app.db ".backup 'backups/app-$(date +\%F).db'" && find backups -mtime +30 -delete
```

To restore: `pm2 stop all`, copy the backup over `data/app.db`, then `pm2 start all`.

## Firebase note

The app needs a process that is always running (the pm2 worker) and a local SQLite file. Firebase Hosting and Cloud Functions provide neither, so run it on a small VPS (for example a Hostinger VPS) or your own PC. Firebase could replace the database later (Firestore instead of SQLite/Prisma), but the worker still needs a server.
