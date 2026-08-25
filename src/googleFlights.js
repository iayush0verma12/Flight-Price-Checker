const { chromium } = require("playwright");

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    browserPromise = null;
    await browser.close().catch(() => {});
  }
}

function buildSearchUrl(origin, destination, date) {
  const q = `Flights from ${origin} to ${destination} on ${date} one way`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&curr=INR&hl=en&gl=in`;
}

// Result cards render as <li class="pIav2d"> inside <ul role="list">. Google
// obfuscates most class names, but this one has been stable, and the card's
// plain innerText (not aria-label — these cards don't reliably expose one)
// contains everything we need in a consistent order.
const RESULT_CARD_SELECTOR = "li.pIav2d";

const KNOWN_AIRLINES = [
  "Air India Express",
  "Air India",
  "IndiGo",
  "SpiceJet",
  "Vistara",
  "Akasa Air",
  "AirAsia India",
  "Go First",
  "Alliance Air",
  "Star Air",
];

function parseCardText(text) {
  if (!text || /Price unavailable/i.test(text)) return null;

  const priceMatch = text.match(/₹\s?([\d,]{3,})/);
  if (!priceMatch) return null;
  const price = parseInt(priceMatch[1].replace(/,/g, ""), 10);
  if (!price || Number.isNaN(price)) return null;

  let stops = null;
  if (/\bNonstop\b/i.test(text)) stops = 0;
  else {
    const stopMatch = text.match(/(\d+)\s*stop/i);
    if (stopMatch) stops = parseInt(stopMatch[1], 10);
  }

  const airline = KNOWN_AIRLINES.find((name) => text.includes(name)) || null;

  return { price, stops, airline };
}

/**
 * Scrapes Google Flights for the cheapest one-way itinerary on a given date.
 * Returns null-price result (never throws) so callers can fall back to
 * another provider.
 */
async function getCheapestPrice(origin, destination, date) {
  const url = buildSearchUrl(origin, destination, date);
  let context;
  let page;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({ locale: "en-IN", timezoneId: "Asia/Kolkata" });
    page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector(RESULT_CARD_SELECTOR, { timeout: 20000 });
    // Let a few more result cards render in.
    await page.waitForTimeout(1500);

    const rawItems = await page.$$eval(RESULT_CARD_SELECTOR, (els) => els.map((el) => el.innerText).filter(Boolean));

    const parsed = rawItems.map(parseCardText).filter((r) => r && r.price);
    if (!parsed.length) {
      return { price: null, currency: "INR", source: "google-flights", note: "no parseable results", bookingLink: url };
    }

    const cheapest = parsed.reduce((min, r) => (r.price < min.price ? r : min), parsed[0]);

    return {
      price: cheapest.price,
      currency: "INR",
      source: "google-flights",
      stops: cheapest.stops,
      airlines: cheapest.airline ? [cheapest.airline] : [],
      segments: [],
      bookingLink: url,
    };
  } catch (err) {
    return { price: null, currency: "INR", source: "google-flights", error: err.message, bookingLink: url };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

module.exports = { getCheapestPrice, closeBrowser };
