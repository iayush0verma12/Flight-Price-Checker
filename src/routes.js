const express = require("express");
const store = require("./store");
const scheduler = require("./scheduler");
const mailer = require("./mailer");
const amadeus = require("./amadeus");
const kiwi = require("./kiwi");
const { checkAllPrices, getDatesSummary, getHistoryForDate, dateRange } = require("./priceCheck");

const router = express.Router();

// ---- Status / dashboard summary ----
router.get("/status", (req, res) => {
  const data = store.get();
  res.json({
    settings: redactSettings(data.settings),
    lastCheck: data.lastCheck,
    recipientCount: data.recipients.length,
    kiwiConfigured: kiwi.isConfigured(data.settings.kiwi),
    amadeusConfigured: amadeus.isConfigured(data.settings.amadeus),
    smtpConfigured: mailer.isSmtpConfigured(data.settings.smtp),
  });
});

router.get("/dates", (req, res) => {
  res.json(getDatesSummary());
});

router.get("/history", (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "date query param required" });
  res.json(getHistoryForDate(date));
});

router.get("/logs", (req, res) => {
  res.json(store.get().logs.slice(0, 50));
});

// ---- Settings ----
function redactSettings(settings) {
  const s = JSON.parse(JSON.stringify(settings));
  if (s.kiwi.apiKey) s.kiwi.apiKey = "********";
  if (s.amadeus.apiSecret) s.amadeus.apiSecret = "********";
  if (s.smtp.pass) s.smtp.pass = "********";
  return s;
}

router.get("/settings", (req, res) => {
  res.json(redactSettings(store.get().settings));
});

router.put("/settings", (req, res) => {
  const body = req.body || {};
  store.update((s) => {
    const merge = (target, src, skipMaskedKeys = []) => {
      for (const k of Object.keys(src || {})) {
        if (skipMaskedKeys.includes(k) && src[k] === "********") continue;
        if (typeof target[k] === "object" && target[k] !== null && !Array.isArray(target[k]) && typeof src[k] === "object") {
          merge(target[k], src[k], k === "amadeus" ? ["apiSecret"] : k === "smtp" ? ["pass"] : k === "kiwi" ? ["apiKey"] : []);
        } else {
          target[k] = src[k];
        }
      }
    };
    merge(s.settings, body, []);
  });
  scheduler.restart();
  store.addLog("info", "Settings updated.");
  res.json(redactSettings(store.get().settings));
});

// ---- Manual check ----
router.post("/check-now", async (req, res) => {
  try {
    const result = await checkAllPrices();
    res.json(result);
  } catch (err) {
    store.addLog("error", `Manual check failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ---- Recipients ----
router.get("/recipients", (req, res) => {
  res.json(store.get().recipients);
});

router.post("/recipients", (req, res) => {
  const { name, email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Valid email required" });
  }
  const recipient = { id: Date.now() + "-" + Math.random().toString(36).slice(2, 6), name: name || "", email };
  store.update((s) => s.recipients.push(recipient));
  store.addLog("info", `Recipient added: ${email}`);
  res.json(recipient);
});

router.delete("/recipients/:id", (req, res) => {
  const { id } = req.params;
  let removed = false;
  store.update((s) => {
    const before = s.recipients.length;
    s.recipients = s.recipients.filter((r) => r.id !== id);
    removed = s.recipients.length !== before;
  });
  if (!removed) return res.status(404).json({ error: "Not found" });
  store.addLog("info", `Recipient removed: ${id}`);
  res.json({ ok: true });
});

// ---- Send report email ----
router.post("/send-report", async (req, res) => {
  const data = store.get();
  const { origin, destination, startDate, endDate } = data.settings;
  const reqStart = (req.body && req.body.startDate) || startDate;
  const reqEnd = (req.body && req.body.endDate) || endDate;
  const recipientIds = req.body && req.body.recipientIds; // array of ids, or omitted = all

  let recipients = data.recipients;
  if (Array.isArray(recipientIds) && recipientIds.length) {
    recipients = data.recipients.filter((r) => recipientIds.includes(r.id));
  }
  if (!recipients.length) {
    return res.status(400).json({ error: "No recipients selected/available. Add recipients first." });
  }

  try {
    const dates = dateRange(reqStart, reqEnd);
    const summary = getDatesSummary().filter((d) => dates.includes(d.date));
    const rows = summary.map((d) => ({
      date: d.date,
      weekday: d.weekday,
      price: d.latestPrice,
      currency: d.currency,
      baseline: d.baseline,
      isDrop: d.isDrop,
      stops: d.stops,
      bookingLink: d.bookingLink,
    }));

    const html = mailer.buildReportHtml({
      origin,
      destination,
      rows,
      generatedAt: new Date().toLocaleString(),
      note: `Price report for ${reqStart} to ${reqEnd}.`,
    });

    const info = await mailer.sendMail(data.settings.smtp, {
      to: recipients.map((r) => r.email),
      subject: `Flight Price Report: ${origin} -> ${destination} (${reqStart} to ${reqEnd})`,
      html,
    });

    store.addLog("info", `Report emailed to ${recipients.length} recipient(s) for ${reqStart}..${reqEnd}.`);
    res.json({ ok: true, messageId: info.messageId, recipients: recipients.map((r) => r.email) });
  } catch (err) {
    store.addLog("error", `Send report failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
