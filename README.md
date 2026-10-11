# EmailConfig: self-hosted cold outreach

A single-user app that emails each lead **once ever**, slowly and automatically, from your Hostinger mailbox. Each message is personalised by an AI from facts the app checks on the lead's real homepage. When the app is unsure about anything, it does not send.

- **Web UI**: Next.js 15, run with pm2 behind nginx on your own server
- **Worker**: a second pm2 process. Every minute it syncs the inbox (every 10 minutes), prepares AI drafts and sends at most one mail.
- **Database**: Firestore (free Spark plan), in the Firebase project's existing database. Every outreach collection is prefixed `outreach_`, so it never mixes with the website's own collections, and the website's default-deny rule keeps it server-only.
- **Mail**: Nodemailer (SMTP) and imapflow (IMAP) against Hostinger

## Once-ever rule (how it is enforced)

1. **Firestore `outreach_contacted` ledger.** Every address the app has ever tried to email is written here, together with its business in `outreach_contactedBiz`. Nothing in the app deletes from these collections.
2. **Import.** Every row is checked against the ledger, existing leads and the suppression list. Matches are skipped with a visible reason. Leads are stored with the email as the document id, using create-only writes, so one address can exist only once, ever.
3. **Send.** One Firestore transaction re-reads the ledger and the suppression list and claims the address *before* the SMTP call. If the address or its business is already in the ledger, the mail is blocked and the lead is marked `already_contacted`.
4. **Unclear results.** A mail is retried (at most 2 times, on later days) only when the server certainly refused it: the login check failed before any data was sent, or the server answered with an explicit 4xx code. A timeout, dropped connection or crash during the transaction makes the lead `check_manual`, and it is never resent automatically.
5. **Ledger page.** You can add addresses you emailed yourself, or import every recipient from the mailbox's Sent folder.

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

In `.env` on the server set `COOKIE_SECURE="true"`.

nginx site (`/etc/nginx/sites-available/<domain>`), then `certbot --nginx -d <domain>`:

```nginx
server {
    listen 80;
    server_name email.brightonsolution.com;
    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:3417;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```

The `Host`, `X-Real-IP` and `X-Forwarded-Proto` headers are required: the app uses them for login redirects and for the login rate limit.

Update later:

```bash
cd ~/email.brightonsolution.com && git pull && npm ci && npm run build && pm2 restart outreach-web outreach-worker
```

Run the worker in one place only. A Firestore lock and the ledger prevent double sends even if two run, but one is cleaner.

## Local development

1. In the Firebase console, go to Project settings → Service accounts → Generate new private key. Save the file as `service-account.json` in the project root (it is gitignored).
2. Copy `.env.example` to `.env` and fill it in.
3. Run:

```bash
npm run dev                # http://localhost:3001
npm run worker             # only if the server worker is not running
```

Checks (no email is sent):

```bash
npm run test:ledger            # once-ever rule and SMTP outcome rules, in throw-away test collections
npm run test:ledger indexes    # read-only: every indexed query the app uses
```

Firestore indexes live in `firestore.indexes.json`. Deploy them with `npm run deploy:indexes` (indexes only; this never touches the website's security rules). If the website repo ever deploys indexes with `--force`, the `outreach_*` indexes are deleted and sending stops with errors (it does not send wrongly); re-run the command to restore them.

## First-time checklist

1. **Settings**: fill in your test address, alert address, sender profile, postal address and offer notes. Click **Send test mail to me** and **Check DNS**.
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

Firestore keeps the data. For an extra copy, use the CSV export on the Contacts page.
