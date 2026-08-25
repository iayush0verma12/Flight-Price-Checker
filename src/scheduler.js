const cron = require("node-cron");
const store = require("./store");
const { checkAllPrices } = require("./priceCheck");

let task = null;

function stop() {
  if (task) {
    task.stop();
    task = null;
  }
}

function start() {
  stop();
  const { scheduleCron, schedulerEnabled } = store.get().settings;
  if (!schedulerEnabled) {
    store.addLog("info", "Scheduler is disabled.");
    return;
  }
  if (!cron.validate(scheduleCron)) {
    store.addLog("error", `Invalid cron expression "${scheduleCron}", scheduler not started.`);
    return;
  }
  task = cron.schedule(scheduleCron, async () => {
    store.addLog("info", "Scheduled price check starting...");
    try {
      await checkAllPrices();
    } catch (err) {
      store.addLog("error", `Scheduled check failed: ${err.message}`);
    }
  });
  store.addLog("info", `Scheduler started with cron "${scheduleCron}".`);
}

function restart() {
  start();
}

module.exports = { start, stop, restart };
