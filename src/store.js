const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "store.json");

const DEFAULTS = {
  settings: {
    origin: "BLR",
    destination: "PAT",
    startDate: "2026-11-02",
    endDate: "2026-11-07",
    currency: "INR",
    scheduleCron: "0 8 * * *", // every day at 08:00 server time
    schedulerEnabled: true,
    autoEmailOnDrop: false,
    kiwi: {
      apiKey: process.env.KIWI_API_KEY || "",
    },
    amadeus: {
      apiKey: process.env.AMADEUS_API_KEY || "",
      apiSecret: process.env.AMADEUS_API_SECRET || "",
      env: process.env.AMADEUS_ENV || "test",
    },
    smtp: {
      host: process.env.SMTP_HOST || "",
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
      from: process.env.SMTP_FROM || "Flight Price Checker <no-reply@example.com>",
    },
  },
  recipients: [],
  baselines: {}, // { "BLR-PAT-2026-11-02": price }
  history: [], // { id, origin, destination, date, checkedAt, price, currency, source }
  lastCheck: null,
  logs: [], // { id, ts, level, message }
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULTS, null, 2));
  }
}

function deepMerge(base, override) {
  if (typeof override !== "object" || override === null) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(base)) {
    if (
      typeof base[k] === "object" &&
      base[k] !== null &&
      !Array.isArray(base[k]) &&
      typeof override[k] === "object"
    ) {
      out[k] = deepMerge(base[k], override[k]);
    } else if (Object.prototype.hasOwnProperty.call(override, k)) {
      out[k] = override[k];
    }
  }
  return out;
}

function load() {
  ensureFile();
  const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  // merge with defaults so new fields introduced later don't crash old store files
  return deepMerge(DEFAULTS, raw);
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let cache = load();

function get() {
  return cache;
}

function persist() {
  save(cache);
}

function update(mutatorFn) {
  mutatorFn(cache);
  persist();
  return cache;
}

function addLog(level, message) {
  cache.logs.unshift({
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    ts: new Date().toISOString(),
    level,
    message,
  });
  cache.logs = cache.logs.slice(0, 200);
  persist();
}

module.exports = { get, update, persist, addLog };
