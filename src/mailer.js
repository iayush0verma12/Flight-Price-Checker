const nodemailer = require("nodemailer");

function isSmtpConfigured(smtp) {
  return !!(smtp && smtp.host && smtp.user && smtp.pass);
}

function buildTransport(smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: !!smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  });
}

function fmtMoney(price, currency) {
  if (price === null || price === undefined) return "N/A";
  return `${currency || "INR"} ${Number(price).toLocaleString("en-IN")}`;
}

function rowsHtml(rows) {
  return rows
    .map((r) => {
      const dropBadge = r.isDrop
        ? `<span style="color:#0a7d3a;font-weight:600;">&#9660; DROP (was ${fmtMoney(
            r.baseline,
            r.currency
          )})</span>`
        : r.baseline
        ? `<span style="color:#666;">baseline ${fmtMoney(r.baseline, r.currency)}</span>`
        : "";
      const stopsLabel =
        r.stops === null || r.stops === undefined ? "—" : r.stops === 0 ? "Non-stop" : `${r.stops} stop${r.stops > 1 ? "s" : ""}`;
      const bookCell = r.bookingLink
        ? `<a href="${r.bookingLink}" style="color:#2f6fe0;text-decoration:none;font-weight:600;">Book &rarr;</a>`
        : "—";
      return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${r.date} (${r.weekday})</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">${fmtMoney(
          r.price,
          r.currency
        )}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${stopsLabel}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${dropBadge}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${bookCell}</td>
      </tr>`;
    })
    .join("");
}

function buildReportHtml({ origin, destination, rows, generatedAt, note }) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;">
    <h2 style="margin-bottom:4px;">Flight Price Report: ${origin} &rarr; ${destination}</h2>
    <p style="color:#555;margin-top:0;">Generated ${generatedAt}</p>
    ${note ? `<p style="color:#555;">${note}</p>` : ""}
    <table style="border-collapse:collapse;width:100%;">
      <thead>
        <tr style="background:#f5f5f5;text-align:left;">
          <th style="padding:8px 12px;">Date</th>
          <th style="padding:8px 12px;">Latest Price</th>
          <th style="padding:8px 12px;">Stops</th>
          <th style="padding:8px 12px;">Status</th>
          <th style="padding:8px 12px;">Book</th>
        </tr>
      </thead>
      <tbody>${rowsHtml(rows)}</tbody>
    </table>
    <p style="color:#999;font-size:12px;margin-top:16px;">Sent automatically by your Flight Price Checker dashboard.</p>
  </div>`;
}

async function sendMail(smtp, { to, subject, html }) {
  if (!isSmtpConfigured(smtp)) {
    throw new Error("SMTP is not configured. Fill in SMTP settings in the dashboard first.");
  }
  const transport = buildTransport(smtp);
  const info = await transport.sendMail({
    from: smtp.from || smtp.user,
    to: to.join(","),
    subject,
    html,
  });
  return info;
}

module.exports = { sendMail, buildReportHtml, isSmtpConfigured, fmtMoney };
