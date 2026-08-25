require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const routes = require("./src/routes");
const scheduler = require("./src/scheduler");
const store = require("./src/store");
const googleFlights = require("./src/googleFlights");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", routes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  store.addLog("info", `Server started on port ${PORT}.`);
  console.log(`Flight Price Checker dashboard running at http://localhost:${PORT}`);
  scheduler.start();
});

async function shutdown() {
  await googleFlights.closeBrowser();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
