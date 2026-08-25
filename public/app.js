const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function api(path, opts) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

function fmtMoney(price, currency) {
  if (price === null || price === undefined) return "—";
  return `${currency || "INR"} ${Number(price).toLocaleString("en-IN")}`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

let recipientsCache = [];

async function refreshStatus() {
  const status = await api("/status");
  $("#routeSub").textContent = `${status.settings.origin} → ${status.settings.destination} | ${status.settings.startDate} to ${status.settings.endDate}`;
  $("#lastCheck").textContent = status.lastCheck ? `Last checked: ${fmtDate(status.lastCheck)}` : "Never checked";

  $("#kiwiStatus").textContent = status.kiwiConfigured ? "active" : "not configured (optional)";
  $("#kiwiStatus").className = "pill " + (status.kiwiConfigured ? "ok" : "");
  $("#amadeusStatus").textContent = status.amadeusConfigured ? "configured" : "not configured (optional)";
  $("#amadeusStatus").className = "pill " + (status.amadeusConfigured ? "ok" : "");
  $("#smtpStatus").textContent = status.smtpConfigured ? "configured" : "not configured";
  $("#smtpStatus").className = "pill " + (status.smtpConfigured ? "ok" : "warn");

  const badges = $("#badges");
  badges.innerHTML = "";
  badges.innerHTML += `<span class="pill ok">Live prices via Google Flights</span>`;
  if (!status.smtpConfigured) {
    badges.innerHTML += `<span class="pill warn">Email not configured</span>`;
  }

  fillSettingsForm(status.settings);
}

function fillSettingsForm(s) {
  $("#setOrigin").value = s.origin;
  $("#setDestination").value = s.destination;
  $("#setStartDate").value = s.startDate;
  $("#setEndDate").value = s.endDate;
  $("#setCurrency").value = s.currency;
  $("#setCron").value = s.scheduleCron;
  $("#setSchedulerEnabled").checked = s.schedulerEnabled;
  $("#setAutoEmail").checked = s.autoEmailOnDrop;
  $("#setKiwiKey").value = s.kiwi.apiKey || "";
  $("#setAmKey").value = s.amadeus.apiKey || "";
  $("#setAmSecret").value = s.amadeus.apiSecret || "";
  $("#setAmEnv").value = s.amadeus.env || "test";
  $("#setSmtpHost").value = s.smtp.host || "";
  $("#setSmtpPort").value = s.smtp.port || 587;
  $("#setSmtpSecure").checked = !!s.smtp.secure;
  $("#setSmtpUser").value = s.smtp.user || "";
  $("#setSmtpPass").value = s.smtp.pass || "";
  $("#setSmtpFrom").value = s.smtp.from || "";

  if (!$("#reportStart").value) $("#reportStart").value = s.startDate;
  if (!$("#reportEnd").value) $("#reportEnd").value = s.endDate;
}

async function refreshDates() {
  const dates = await api("/dates");
  const body = $("#datesBody");
  body.innerHTML = "";
  for (const d of dates) {
    const tr = document.createElement("tr");
    const changeText =
      d.baseline && d.latestPrice
        ? `${d.latestPrice - d.baseline >= 0 ? "+" : ""}${(d.latestPrice - d.baseline).toLocaleString("en-IN")} (${(
            ((d.latestPrice - d.baseline) / d.baseline) *
            100
          ).toFixed(1)}%)`
        : "—";
    const stopsLabel =
      d.stops === null || d.stops === undefined ? "—" : d.stops === 0 ? "Non-stop" : `${d.stops} stop${d.stops > 1 ? "s" : ""}`;
    const airlinesLabel = d.airlines && d.airlines.length ? ` <span class="muted small">(${d.airlines.join(", ")})</span>` : "";
    tr.innerHTML = `
      <td>${d.date}</td>
      <td>${d.weekday}</td>
      <td>${fmtMoney(d.latestPrice, d.currency)}</td>
      <td>${stopsLabel}${airlinesLabel}</td>
      <td>${fmtMoney(d.baseline, d.currency)}</td>
      <td class="${d.isDrop ? "price-drop" : "price-up"}">${changeText}</td>
      <td>${d.isDrop ? '<span class="pill drop">PRICE DROP</span>' : d.latestPrice ? '<span class="pill">stable</span>' : '<span class="pill warn">no data</span>'}</td>
      <td><button class="btn small" data-date="${d.date}">View (${d.historyCount})</button></td>
      <td>${d.bookingLink ? `<a class="btn small primary" href="${d.bookingLink}" target="_blank" rel="noopener">Book &rarr;</a>` : "—"}</td>
    `;
    body.appendChild(tr);
  }
  $$("#datesBody button[data-date]").forEach((btn) => {
    btn.addEventListener("click", () => openHistory(btn.dataset.date));
  });
}

async function openHistory(date) {
  const history = await api(`/history?date=${encodeURIComponent(date)}`);
  $("#historyTitle").textContent = `History for ${date}`;
  const tbody = $("#historyTable tbody");
  tbody.innerHTML = history
    .map((h) => {
      const stopsLabel = h.stops === null || h.stops === undefined ? "—" : h.stops === 0 ? "Non-stop" : `${h.stops} stop${h.stops > 1 ? "s" : ""}`;
      const bookCell = h.bookingLink ? `<a href="${h.bookingLink}" target="_blank" rel="noopener">Book &rarr;</a>` : "—";
      return `<tr><td>${fmtDate(h.checkedAt)}</td><td>${fmtMoney(h.price, h.currency)}</td><td>${stopsLabel}</td><td>${h.source}</td><td>${bookCell}</td></tr>`;
    })
    .join("");
  drawChart(history);
  $("#historyModal").classList.remove("hidden");
}

function drawChart(history) {
  const canvas = $("#historyChart");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (history.length < 2) {
    ctx.fillStyle = "#8b93a7";
    ctx.font = "13px sans-serif";
    ctx.fillText("Not enough data points yet for a chart.", 10, 30);
    return;
  }
  const prices = history.map((h) => h.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = 30;
  const w = canvas.width - pad * 2;
  const h = canvas.height - pad * 2;

  ctx.strokeStyle = "#2a3142";
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, canvas.height - pad);
  ctx.lineTo(canvas.width - pad, canvas.height - pad);
  ctx.stroke();

  ctx.strokeStyle = "#4f8cff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((point, i) => {
    const x = pad + (i / (history.length - 1)) * w;
    const y = pad + h - ((point.price - min) / (max - min || 1)) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = "#8b93a7";
  ctx.font = "11px sans-serif";
  ctx.fillText(`min ${min}`, pad, canvas.height - 8);
  ctx.fillText(`max ${max}`, canvas.width - pad - 60, 20);
}

async function refreshRecipients() {
  recipientsCache = await api("/recipients");
  const list = $("#recipientList");
  list.innerHTML = "";
  for (const r of recipientsCache) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${r.name ? r.name + " — " : ""}${r.email}</span><button class="btn small danger" data-id="${r.id}">Remove</button>`;
    list.appendChild(li);
  }
  $$("#recipientList button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/recipients/${btn.dataset.id}`, { method: "DELETE" });
      await refreshRecipients();
    });
  });

  const reportRecipients = $("#reportRecipients");
  reportRecipients.innerHTML = recipientsCache
    .map(
      (r) => `<label><input type="checkbox" value="${r.id}" /> ${r.name ? r.name + " — " : ""}${r.email}</label>`
    )
    .join("") || '<p class="muted small">No recipients yet — add one on the left.</p>';
}

async function refreshLogs() {
  const logs = await api("/logs");
  $("#logList").innerHTML = logs
    .map((l) => `<li class="lvl-${l.level}"><span>${new Date(l.ts).toLocaleTimeString()}</span><span>${l.message}</span></li>`)
    .join("");
}

async function refreshAll() {
  await Promise.all([refreshStatus(), refreshDates(), refreshRecipients(), refreshLogs()]);
}

// ---- Event wiring ----
$("#checkNowBtn").addEventListener("click", async () => {
  const btn = $("#checkNowBtn");
  btn.disabled = true;
  btn.textContent = "Checking...";
  try {
    await api("/check-now", { method: "POST" });
    await refreshAll();
  } catch (err) {
    alert("Check failed: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Check Prices Now";
  }
});

$("#toggleSettings").addEventListener("click", () => {
  $("#settingsForm").classList.toggle("hidden");
});

$("#recipientForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/recipients", {
      method: "POST",
      body: JSON.stringify({ name: $("#recName").value, email: $("#recEmail").value }),
    });
    $("#recName").value = "";
    $("#recEmail").value = "";
    await refreshRecipients();
  } catch (err) {
    alert(err.message);
  }
});

$("#reportForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = $("#reportStatus");
  statusEl.textContent = "Sending...";
  statusEl.className = "status";
  const checked = $$('#reportRecipients input[type="checkbox"]:checked').map((c) => c.value);
  try {
    const result = await api("/send-report", {
      method: "POST",
      body: JSON.stringify({
        startDate: $("#reportStart").value,
        endDate: $("#reportEnd").value,
        recipientIds: checked.length ? checked : undefined,
      }),
    });
    statusEl.textContent = `Sent to ${result.recipients.join(", ")}`;
    statusEl.className = "status ok";
    await refreshLogs();
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
    statusEl.className = "status error";
  }
});

$("#settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = $("#settingsStatus");
  statusEl.textContent = "Saving...";
  statusEl.className = "status";
  try {
    await api("/settings", {
      method: "PUT",
      body: JSON.stringify({
        origin: $("#setOrigin").value.toUpperCase(),
        destination: $("#setDestination").value.toUpperCase(),
        startDate: $("#setStartDate").value,
        endDate: $("#setEndDate").value,
        currency: $("#setCurrency").value.toUpperCase(),
        scheduleCron: $("#setCron").value,
        schedulerEnabled: $("#setSchedulerEnabled").checked,
        autoEmailOnDrop: $("#setAutoEmail").checked,
        kiwi: {
          apiKey: $("#setKiwiKey").value,
        },
        amadeus: {
          apiKey: $("#setAmKey").value,
          apiSecret: $("#setAmSecret").value,
          env: $("#setAmEnv").value,
        },
        smtp: {
          host: $("#setSmtpHost").value,
          port: Number($("#setSmtpPort").value),
          secure: $("#setSmtpSecure").checked,
          user: $("#setSmtpUser").value,
          pass: $("#setSmtpPass").value,
          from: $("#setSmtpFrom").value,
        },
      }),
    });
    statusEl.textContent = "Saved.";
    statusEl.className = "status ok";
    await refreshAll();
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
    statusEl.className = "status error";
  }
});

$("#closeModal").addEventListener("click", () => $("#historyModal").classList.add("hidden"));
$("#historyModal").addEventListener("click", (e) => {
  if (e.target.id === "historyModal") $("#historyModal").classList.add("hidden");
});

refreshAll();
setInterval(refreshAll, 60000);
