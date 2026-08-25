const axios = require("axios");

let tokenCache = { token: null, expiresAt: 0, env: null };

function baseUrl(env) {
  return env === "production" ? "https://api.amadeus.com" : "https://test.api.amadeus.com";
}

async function getToken(amadeusSettings) {
  const { apiKey, apiSecret, env } = amadeusSettings;
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 5000 && tokenCache.env === env) {
    return tokenCache.token;
  }
  const url = `${baseUrl(env)}/v1/security/oauth2/token`;
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", apiKey);
  params.append("client_secret", apiSecret);

  const res = await axios.post(url, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000,
  });

  tokenCache = {
    token: res.data.access_token,
    expiresAt: now + res.data.expires_in * 1000,
    env,
  };
  return tokenCache.token;
}

function googleFlightsLink(origin, destination, date) {
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(
    `Flights from ${origin} to ${destination} on ${date}`
  )}`;
}

// Deterministic pseudo-random demo price generator so the dashboard is usable
// out of the box before real API keys are configured.
function demoPrice(origin, destination, date) {
  let seed = 0;
  const str = `${origin}${destination}${date}`;
  for (let i = 0; i < str.length; i++) seed = (seed * 31 + str.charCodeAt(i)) >>> 0;
  const dayOfMonth = new Date(date).getUTCDate();
  const wobble = (Math.sin(seed + Date.now() / (1000 * 60 * 60 * 6)) + 1) / 2; // slow drift every ~6h
  const base = 3800 + (dayOfMonth % 5) * 250;
  const price = Math.round(base + wobble * 1800);
  const stops = seed % 3 === 0 ? 1 : 0;
  return { price, stops };
}

const isConfigured = (amadeusSettings) =>
  !!(amadeusSettings && amadeusSettings.apiKey && amadeusSettings.apiSecret);

/**
 * Returns the cheapest offer price for a given origin/destination/date.
 * Falls back to a labeled demo price if no API credentials are configured,
 * or if the live call fails, so the dashboard keeps working.
 */
async function getCheapestPrice(amadeusSettings, origin, destination, date, currency) {
  if (!isConfigured(amadeusSettings)) {
    const demo = demoPrice(origin, destination, date);
    return {
      price: demo.price,
      currency: currency || "INR",
      source: "demo",
      stops: demo.stops,
      airlines: [],
      segments: [],
      bookingLink: googleFlightsLink(origin, destination, date),
    };
  }

  try {
    const token = await getToken(amadeusSettings);
    const url = `${baseUrl(amadeusSettings.env)}/v2/shopping/flight-offers`;
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        originLocationCode: origin,
        destinationLocationCode: destination,
        departureDate: date,
        adults: 1,
        currencyCode: currency || "INR",
        max: 10,
        nonStop: false,
      },
      timeout: 20000,
    });

    const offers = res.data && res.data.data ? res.data.data : [];
    if (!offers.length) {
      return {
        price: null,
        currency: currency || "INR",
        source: "amadeus",
        note: "no offers found",
        bookingLink: googleFlightsLink(origin, destination, date),
      };
    }
    const cheapest = offers.reduce((min, o) => (parseFloat(o.price.total) < parseFloat(min.price.total) ? o : min), offers[0]);
    const itinerary = cheapest.itineraries && cheapest.itineraries[0];
    const segs = (itinerary && itinerary.segments) || [];

    return {
      price: Math.round(parseFloat(cheapest.price.total)),
      currency: currency || "INR",
      source: "amadeus",
      stops: Math.max(0, segs.length - 1),
      airlines: [...new Set(segs.map((s) => s.carrierCode))],
      segments: segs.map((s) => ({
        airline: s.carrierCode,
        flightNo: `${s.carrierCode}${s.number}`,
        from: s.departure.iataCode,
        to: s.arrival.iataCode,
        departure: s.departure.at,
        arrival: s.arrival.at,
      })),
      // Amadeus self-service does not provide a public booking deep link;
      // Google Flights search prefilled for this route/date is the closest
      // one-click fallback.
      bookingLink: googleFlightsLink(origin, destination, date),
    };
  } catch (err) {
    const msg = err.response ? JSON.stringify(err.response.data) : err.message;
    const demo = demoPrice(origin, destination, date);
    return {
      price: demo.price,
      currency: currency || "INR",
      source: "demo-fallback",
      stops: demo.stops,
      airlines: [],
      segments: [],
      bookingLink: googleFlightsLink(origin, destination, date),
      error: msg,
    };
  }
}

module.exports = { getCheapestPrice, isConfigured };
