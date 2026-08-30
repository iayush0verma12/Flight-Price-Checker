# Flight Price Checker — Origin → Destination

Automated dashboard that checks Bangalore (BLR) → Patna (PAT) flight fares for
**2 Nov 2026 – 7 Nov 2026**, once per day (or on-demand), remembers the first
price it saw for each date as the "baseline", flags any day whose price later
drops below that baseline, and can email a price report / drop alert to a
list of recipients you manage from the dashboard.

## Quick start

```bash
npm install
npx playwright install chromium
npm start
```

Open **http://localhost:3000** in your browser. That's the whole app —
one Node process serving the API and the dashboard. `playwright install
chromium` is a one-time ~300MB browser download needed for live scraping.

The app fetches **real, live prices by default** — no signup or API key
required — by scraping Google Flights with a headless browser (Playwright).
This is what powers the price shown, the **Stops** column (non-stop vs
N-stop layover with connecting airport), the airline name, and the
**"Book →" link** (opens that exact Google Flights search).

## Provider order (automatic fallback chain)

1. **Google Flights scrape** (default, always on, no config) — real prices,
   stops, airline, matches what you'd see browsing google.com/travel/flights
   yourself.
2. **Kiwi.com Tequila API** (optional) — only used if a Google Flights
   scrape fails for a date. Gives a real one-click booking checkout link
   instead of a search-results link, if you have a key. Sign-up now
   requires going through Kiwi's partner/affiliate application (no longer
   instant self-serve) — see partners.kiwi.com.
3. **Amadeus for Developers** (optional) — last real-data fallback. Note:
   Amadeus decommissioned its old instant self-service portal; free-tier
   access now goes through their Enterprise API Portal's request/consultant
   flow rather than an instant signup.
4. **Demo mode** (simulated prices) — only reached if all of the above fail,
   so the dashboard never shows nothing.

Every price is tagged with which source produced it (`google-flights`,
`kiwi`, `amadeus`, or `demo`) — visible via the History view on each date.

## ⚠️ Notes on the Google Flights scraper

- It's a real browser automation, not an official API — Google could change
  their page layout at some point, which would need a small selector fix in
  [src/googleFlights.js](src/googleFlights.js) (the result cards are
  currently matched via `li.pIav2d`).
- Keep the check frequency reasonable (the default daily cron is fine) —
  this is built for personal, low-volume price tracking, not high-frequency
  polling.
- Kiwi and Amadeus are both optional now — only fill them in if you
  specifically want Kiwi's real booking checkout link, or already have
  Amadeus access.

## Sending emails — SMTP

Fill in Settings → "SMTP" with any SMTP provider's details, e.g. Gmail:

- Host: `smtp.gmail.com`, Port: `587`, TLS: off (StartTLS is automatic)
- Username: your Gmail address
- Password: a Gmail **App Password** (not your normal password — required
  if 2FA is on: https://myaccount.google.com/apppasswords)

## What the dashboard lets you do

- **Week Overview** — table of all dates in range with latest price, stop
  count (non-stop / N-stop layover + airline codes when available),
  baseline (first price ever observed for that date), % change, a
  "PRICE DROP" badge when the latest price is below baseline, and a
  **Book →** link that jumps straight to booking. Click "View" on any row
  for its full price history + a small trend chart.
- **Check Prices Now** — trigger an immediate check of all dates instead of
  waiting for the schedule.
- **Recipients** — add/remove people who should receive report/alert emails.
- **Send Report** — pick a date range (defaults to the full week) and email
  the current observed prices for those dates to selected recipients (or
  everyone if none are checked).
- **Settings** — route (origin/destination/date range), schedule (cron
  expression, default `0 8 * * *` = daily at 08:00 server time), toggle the
  scheduler on/off, toggle **auto-email on price drop**, and the two
  integrations above.
- **Activity Log** — recent checks, emails sent, and errors.

## How "price drop" detection works

The first price ever recorded for a given date becomes its **baseline**.
Every later check compares the newest price against that baseline. If it's
lower, the date is flagged as a drop in the dashboard, and — if "auto-email
on price drop" is enabled and you have recipients — an alert email is sent
automatically listing the dropped date(s) alongside the full week for
context.

## Data storage

Everything (settings, recipients, price history, baselines, logs) lives in
`data/store.json`, a plain JSON file created automatically on first run — no
database server required. Back it up if you want to preserve history.

## Project structure

```text
server.js              Express app entrypoint
src/store.js           JSON-file data store (settings, history, recipients, logs)
src/googleFlights.js   Playwright scraper — primary live price source (default, no key)
src/kiwi.js            Kiwi Tequila API client — optional fallback
src/amadeus.js         Amadeus flight-price client — optional fallback (+ demo-mode)
src/mailer.js          Nodemailer wrapper + HTML email templates
src/priceCheck.js      Core "check all dates" logic, provider order, baseline/drop detection
src/scheduler.js       node-cron daily job
src/routes.js          REST API (/api/...)
public/                Dashboard UI (vanilla HTML/CSS/JS, no build step)
data/store.json        Auto-created local data file
```

## Running as a long-lived service

For "keep checking prices" to actually happen unattended, `npm start` needs
to keep running (e.g. in a background terminal, `pm2`, Windows Task
Scheduler running `node server.js` at logon, or deployed to a small VPS).
The in-app scheduler only fires while the process is alive.
