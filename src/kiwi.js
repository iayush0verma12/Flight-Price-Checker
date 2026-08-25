const axios = require("axios");

const BASE_URL = "https://api.tequila.kiwi.com";

const isConfigured = (kiwiSettings) => !!(kiwiSettings && kiwiSettings.apiKey);

function toKiwiDate(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function summarizeItinerary(item) {
  // Kiwi returns a flat "route" array; for a one-way search every segment has return === 0.
  const segments = (item.route || []).filter((r) => r.return === 0);
  const stops = Math.max(0, segments.length - 1);
  return {
    price: Math.round(item.price),
    stops,
    airlines: item.airlines || [...new Set(segments.map((s) => s.airline))],
    segments: segments.map((s) => ({
      airline: s.airline,
      flightNo: `${s.airline}${s.flight_no}`,
      from: s.flyFrom,
      to: s.flyTo,
      departure: s.local_departure,
      arrival: s.local_arrival,
    })),
    deepLink: item.deep_link,
  };
}

/**
 * Searches Kiwi Tequila for the cheapest one-way itinerary on a given date.
 * Returns null if not configured or the call fails, so the caller can fall
 * back to another provider.
 */
async function getCheapestPrice(kiwiSettings, origin, destination, date, currency) {
  if (!isConfigured(kiwiSettings)) return null;

  try {
    const kiwiDate = toKiwiDate(date);
    const res = await axios.get(`${BASE_URL}/v2/search`, {
      headers: { apikey: kiwiSettings.apiKey },
      params: {
        fly_from: origin,
        fly_to: destination,
        date_from: kiwiDate,
        date_to: kiwiDate,
        curr: currency || "INR",
        adults: 1,
        sort: "price",
        asc: 1,
        limit: 15,
        one_for_city: 0,
        partner_market: "in",
      },
      timeout: 20000,
    });

    const offers = (res.data && res.data.data) || [];
    if (!offers.length) {
      return { price: null, currency: currency || "INR", source: "kiwi", note: "no offers found" };
    }
    const cheapest = offers.reduce((min, o) => (o.price < min.price ? o : min), offers[0]);
    const summary = summarizeItinerary(cheapest);

    return {
      price: summary.price,
      currency: currency || "INR",
      source: "kiwi",
      stops: summary.stops,
      airlines: summary.airlines,
      segments: summary.segments,
      bookingLink: summary.deepLink,
    };
  } catch (err) {
    const msg = err.response ? JSON.stringify(err.response.data) : err.message;
    return { price: null, currency: currency || "INR", source: "kiwi", error: msg };
  }
}

module.exports = { getCheapestPrice, isConfigured };
