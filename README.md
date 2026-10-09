# EmailConfig: cold outreach on Firebase

A single-user app that emails each lead **once ever**, slowly and automatically, from your Hostinger mailbox. Each message is personalised by an AI from facts the app checks on the lead's real homepage. When the app is unsure about anything, it does not send.

- **Web UI**: Next.js 15 on Firebase App Hosting
- **Database**: Firestore (named database `outreach`, server-only access)
- **Worker**: a scheduled Cloud Function `outreachTick`, run every 2 minutes. It syncs the inbox, prepares AI drafts and sends at most one mail per run.
- **Mail**: Nodemailer (SMTP) and imapflow (IMAP) against Hostinger

## Once-ever rule (how it is enforced)

1. **Firestore `contacted` ledger.** Every address the app has ever tried to email is written here, together with its business in `contactedBiz`. Nothing in the app deletes from these collections.
2. **Import.** Every row is checked against the ledger, existing leads and the suppression list. Matches are skipped with a visible reason. Leads are stored with the email as the document id, using create-only writes, so one address can exist only once, ever.
3. **Send.** One Firestore transaction re-reads the ledger and the suppression list and claims the address *before* the SMTP call. If the address or its business is already in the ledger, the mail is blocked and the lead is marked `already_contacted`.
4. **Crashes.** If a run crashes, or the server's answer is unclear, the lead becomes `check_manual` and is never resent automatically.
5. **Ledger page.** You can add addresses you emailed yourself, or import every recipient from the mailbox's Sent folder.

## Firebase deployment (one time)

Requires the **Blaze** (pay-as-you-go) plan, which App Hosting and scheduled functions need. At this volume, usage stays inside the free tier.

```bash
npm install
npx firebase-tools login
npx firebase-tools use brighton-web-ea63c

# 1. Firestore database + rules + indexes (separate from the website's default database)
npx firebase-tools firestore:databases:create outreach --location=asia-south1
npx firebase-tools deploy --only firestore:outreach

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

Firestore keeps the data. For an extra copy: `gcloud firestore export gs://<bucket> --database=outreach`, or use the CSV export on the Contacts page.
