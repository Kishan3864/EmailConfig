# EmailConfig: cold outreach on Firebase

A single-user app that emails each lead **once ever**, slowly and automatically, from your Hostinger mailbox. Each message is personalised by an AI from facts the app checks on the lead's real homepage. When the app is unsure about anything, it does not send.

- **Web UI**: Next.js 15 on Firebase App Hosting
- **Database**: Firestore, in the project's existing database. Every outreach collection is prefixed `outreach_`, so it never mixes with the website's own collections, and the website's default-deny rule keeps it server-only. This works on the free Spark plan.
- **Worker**: a scheduled Cloud Function `outreachTick`, run every 2 minutes. It syncs the inbox, prepares AI drafts and sends at most one mail per run.
- **Mail**: Nodemailer (SMTP) and imapflow (IMAP) against Hostinger

## Once-ever rule (how it is enforced)

1. **Firestore `contacted` ledger.** Every address the app has ever tried to email is written here, together with its business in `contactedBiz`. Nothing in the app deletes from these collections.
2. **Import.** Every row is checked against the ledger, existing leads and the suppression list. Matches are skipped with a visible reason. Leads are stored with the email as the document id, using create-only writes, so one address can exist only once, ever.
3. **Send.** One Firestore transaction re-reads the ledger and the suppression list and claims the address *before* the SMTP call. If the address or its business is already in the ledger, the mail is blocked and the lead is marked `already_contacted`.
4. **Crashes.** If a run crashes, or the server's answer is unclear, the lead becomes `check_manual` and is never resent automatically.
5. **Ledger page.** You can add addresses you emailed yourself, or import every recipient from the mailbox's Sent folder.

## Two ways to run

| | Plan needed | Where the app runs |
|---|---|---|
| **On your PC** (see Local development) | Free Spark plan | `npm run dev` and `npm run worker` on your machine. Mail goes out only while the worker is running. |
| **Live on Firebase** (below) | Blaze (pay-as-you-go) | App Hosting for the web UI, a scheduled Cloud Function for the worker. |

| **On your own server** (below) | Free Spark plan | pm2 runs the web app and the worker on a VPS, behind nginx with HTTPS. Runs 24×7. |

All of them use the same Firestore data, so the contacted ledger is shared. Run the worker in one place only.

## Run on your own server (VPS)

Needs Node 20+, pm2 and nginx. The app only adds its own folder, two pm2 processes and one nginx site file.

```bash
git clone https://github.com/Kishan3864/EmailConfig.git ~/email.brightonsolution.com
cd ~/email.brightonsolution.com
# copy .env and service-account.json into this folder (they are not in git), then:
chmod 600 .env service-account.json
npm ci
npm run build
pm2 start ecosystem.config.js      # web on 127.0.0.1:3417, plus the worker
pm2 save
```

In `.env` on the server set `COOKIE_SECURE="true"`. Point an nginx server block for your domain at `http://127.0.0.1:3417`, then issue a certificate with `certbot --nginx -d <domain>`.

Update later: `git pull && npm ci && npm run build && pm2 restart outreach-web outreach-worker`.

## Firebase deployment (one time)

Requires the **Blaze** plan, which App Hosting and scheduled functions need. At this volume, usage should stay inside the free tier.

```bash
npm install
npx firebase-tools login
npx firebase-tools use brighton-web-ea63c

# 1. Firestore indexes (indexes only: this never touches the website's security rules)
npx firebase-tools deploy --only firestore:indexes

# 2. Secrets (same names are used by the web app and the worker)
npx firebase-tools functions:secrets:set SMTP_PASSWORD
npx firebase-tools functions:secrets:set AI_API_KEY
npx firebase-tools apphosting:secrets:set APP_PASSWORD
npx firebase-tools apphosting:secrets:set SESSION_SECRET

# 3. Worker (scheduled function)
cd functions && npm install && cd ..
npx firebase-tools deploy --only functions:outreach

# 4. Web UI
npx firebase-tools apphosting:backends:create --backend outreach --primary-region asia-south1
npx firebase-tools apphosting:secrets:grantaccess SMTP_PASSWORD,AI_API_KEY,APP_PASSWORD,SESSION_SECRET --backend outreach
npx firebase-tools deploy --only apphosting
```

Redeploy after changes: `npm run deploy:worker` and `npm run deploy:web`.

Note: if the website repo ever deploys Firestore indexes with `--force`, it would delete the `outreach_*` indexes. Sending then stops with errors (it does not send wrongly). Re-run `npm run deploy:indexes` to restore them.

## Local development

1. In the Firebase console, go to Project settings → Service accounts → Generate new private key. Save the file as `service-account.json` in the project root (it is gitignored).
2. Copy `.env.example` to `.env` and fill it in.
3. Run:

```bash
npm run migrate:settings   # one time: copies settings from the old local SQLite DB into Firestore
npm run dev                # http://localhost:3001
npm run worker             # local worker (do not run it while the Cloud Function is deployed; the Firestore lock prevents double sends anyway)
```

## First-time checklist

1. **Settings**: fill in your test address, alert address, sender profile and offer notes. Click **Send test mail to me** and **Check DNS**.
2. **Ledger → Import Sent folder recipients**, so that nobody you already emailed gets a cold mail.
3. Leave **Dry-run** on for the first campaign. Mails then go only to your test address.
4. **Import** a list, check the preview, then confirm. Approve any **needs_review** addresses under Contacts.
5. **Campaigns**: create a campaign, generate the 5 samples, read them, then approve and start.
6. When the dry-run mails look right, turn off dry-run.

## Mailbox protection (Hostinger)

- **Pace.** For a new domain, start slowly: 5/day on day one, then +3 per sending day, up to 25/day. Mails are sent one at a time with a random 8–20 minute gap, Mon–Fri, 09:30–17:30 in the recipient's timezone. A day never exceeds 40% of the mailbox plan limit.
- **Auto-pause.** Everything stops on any SMTP auth, policy or rate-limit error, on 2 hard bounces in a day, or on a bounce rate above 5%. You get a red alert and an email.
- **Address filtering.** Before import, the app checks MX records, removes role and chain addresses, and holds personal-looking addresses for your approval.
- **Message content.** Mails are plain text with no links in the body and no tracking. They carry a List-Unsubscribe header and a STOP footer. Opt-outs and bounces are suppressed permanently.

## Backup

Firestore keeps the data. For an extra copy, use the CSV export on the Contacts page, or `gcloud firestore export gs://<bucket> --collection-ids=outreach_contacted,outreach_leads,outreach_messages` (needs Blaze).
