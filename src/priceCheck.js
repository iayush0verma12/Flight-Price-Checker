const store = require("./store");
const amadeus = require("./amadeus");
const kiwi = require("./kiwi");
const googleFlights = require("./googleFlights");
const mailer = require("./mailer");

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateRange(startDate, endDate) {
  const dates = [];
  let cur = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

function baselineKey(origin, destination, date) {
  return `${origin}-${destination}-${date}`;
}

// Provider order: Google Flights scraper first (free, no key, matches what
// consumer travel apps show), then Kiwi (real fares + booking deep link, if
// configured), then Amadeus (sandbox data unless production is granted, if
// configured), then a deterministic demo price as the last resort so the
// dashboard always has something to show.
async function fetchPrice(settings, origin, destination, date) {
  const { currency, kiwi: kiwiSettings, amadeus: amadeusSettings } = settings;

  const gfResult = await googleFlights.getCheapestPrice(origin, destination, date);
  if (gfResult && gfResult.price !== null && !gfResult.error) {
    return gfResult;
  }
  store.addLog(
    "error",
    `Google Flights scrape failed for ${date}, falling back: ${(gfResult && (gfResult.error || gfResult.note)) || "unknown error"}`
  );

  if (kiwi.isConfigured(kiwiSettings)) {
    const kiwiResult = await kiwi.getCheapestPrice(kiwiSettings, origin, destination, date, currency);
    if (kiwiResult && kiwiResult.price !== null && !kiwiResult.error) {
      return kiwiResult;
    }
    store.addLog("error", `Kiwi lookup failed for ${date}, falling back to Amadeus/demo: ${(kiwiResult && kiwiResult.error) || "no offers"}`);
  }

  return amadeus.getCheapestPrice(amadeusSettings, origin, destination, date, currency);
}

async function checkAllPrices() {
  const data = store.get();
  const { origin, destination, startDate, endDate } = data.settings;
  const dates = dateRange(startDate, endDate);
  const results = [];
  const drops = [];

  for (const date of dates) {
    const result = await fetchPrice(data.settings, origin, destination, date);
    const checkedAt = new Date().toISOString();
    const key = baselineKey(origin, destination, date);

    store.update((s) => {
      if (result.price !== null && result.price !== undefined) {
        s.history.push({
          id: Date.now() + "-" + Math.random().toString(36).slice(2, 6),
          origin,
          destination,
          date,
          checkedAt,
          price: result.price,
          currency: result.currency,
          source: result.source,
          stops: result.stops !== undefined ? result.stops : null,
          airlines: result.airlines || [],
          bookingLink: result.bookingLink || null,
        });
        if (!(key in s.baselines)) {
          s.baselines[key] = result.price;
        }
      }
    });

    const freshData = store.get();
    const baseline = freshData.baselines[key];
    const isDrop = result.price !== null && baseline !== undefined && result.price < baseline;

    const row = {
      date,
      weekday: WEEKDAYS[new Date(date + "T00:00:00Z").getUTCDay()],
      price: result.price,
      currency: result.currency,
      baseline,
      isDrop,
      source: result.source,
      stops: result.stops !== undefined ? result.stops : null,
      airlines: result.airlines || [],
      bookingLink: result.bookingLink || null,
    };
    results.push(row);
    if (isDrop) drops.push(row);
  }

  store.update((s) => {
    s.lastCheck = new Date().toISOString();
  });
  store.addLog(
    "info",
    `Checked ${dates.length} date(s) for ${origin}->${destination}. ${drops.length} price drop(s) found.`
  );

  if (drops.length && data.settings.autoEmailOnDrop) {
    const recipients = store.get().recipients.map((r) => r.email);
    if (recipients.length) {
      try {
        const html = mailer.buildReportHtml({
          origin,
          destination,
          rows: results,
          generatedAt: new Date().toLocaleString(),
          note: `${drops.length} date(s) dropped below their baseline price. Only flagged rows are marked DROP below; full week shown for context.`,
        });
        await mailer.sendMail(store.get().settings.smtp, {
          to: recipients,
          subject: `Price drop alert: ${origin} -> ${destination} (${drops.length} date${drops.length > 1 ? "s" : ""})`,
          html,
        });
        store.addLog("info", `Auto price-drop email sent to ${recipients.length} recipient(s).`);
      } catch (err) {
        store.addLog("error", `Auto-email failed: ${err.message}`);
      }
    }
  }

  return { results, drops, checkedAt: new Date().toISOString() };
}

function getDatesSummary() {
  const data = store.get();
  const { origin, destination, startDate, endDate } = data.settings;
  const dates = dateRange(startDate, endDate);

  return dates.map((date) => {
    const key = baselineKey(origin, destination, date);
    const history = data.history
      .filter((h) => h.origin === origin && h.destination === destination && h.date === date)
      .sort((a, b) => new Date(a.checkedAt) - new Date(b.checkedAt));
    const latest = history[history.length - 1];
    const baseline = data.baselines[key];
    const isDrop = latest && baseline !== undefined && latest.price < baseline;
    return {
      date,
      weekday: WEEKDAYS[new Date(date + "T00:00:00Z").getUTCDay()],
      latestPrice: latest ? latest.price : null,
      currency: latest ? latest.currency : data.settings.currency,
      baseline: baseline !== undefined ? baseline : null,
      isDrop: !!isDrop,
      lastCheckedAt: latest ? latest.checkedAt : null,
      historyCount: history.length,
      minPrice: history.length ? Math.min(...history.map((h) => h.price)) : null,
      maxPrice: history.length ? Math.max(...history.map((h) => h.price)) : null,
      stops: latest ? latest.stops : null,
      airlines: latest ? latest.airlines || [] : [],
      bookingLink: latest ? latest.bookingLink : null,
      source: latest ? latest.source : null,
    };
  });
}

function getHistoryForDate(date) {
  const data = store.get();
  const { origin, destination } = data.settings;
  return data.history
    .filter((h) => h.origin === origin && h.destination === destination && h.date === date)
    .sort((a, b) => new Date(a.checkedAt) - new Date(b.checkedAt));
}

module.exports = { checkAllPrices, getDatesSummary, getHistoryForDate, dateRange, baselineKey, WEEKDAYS };
