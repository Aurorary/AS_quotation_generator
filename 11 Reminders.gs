// ============================================================
// Reminders.gs — Daily follow-up digest for stale quotes
// ============================================================
// Scheduled by an installable time-driven trigger on
// `dailyFollowUpReminder` (run setupDailyReminder once to install).

const REMINDER_HOUR = 9;                           // 9am
const REMINDER_TIMEZONE = 'Asia/Kuala_Lumpur';
const REMINDER_AGE_DAYS = 7;
// Each raiser receives a digest of THEIR stale quotes; afdhal is CC'd on
// every digest for visibility. Quotes with a missing raiser fall back to
// REMINDER_FALLBACK only (afdhal handles them directly).
const REMINDER_CC = 'afdhal@worq.space';
const REMINDER_FALLBACK = 'afdhal@worq.space';

// ── Install the daily trigger (run once) ─────────────────────
function setupDailyReminder() {
  // Remove any existing triggers for this function so we don't double up
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'dailyFollowUpReminder') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('dailyFollowUpReminder')
    .timeBased()
    .atHour(REMINDER_HOUR)
    .inTimezone(REMINDER_TIMEZONE)
    .everyDays(1)
    .create();
  Logger.log('Daily reminder trigger installed for ' + REMINDER_HOUR + ':00 ' + REMINDER_TIMEZONE);
}

// ── Trigger entry point ──────────────────────────────────────
function dailyFollowUpReminder() {
  try {
    const stale = findStalePendingCustomerQuotes(REMINDER_AGE_DAYS);
    if (stale.length === 0) return;

    // Group by raiser. Quotes missing a raiser go to the fallback bucket
    // so they don't slip through the cracks while we backfill column N.
    const buckets = {};
    stale.forEach(function(q) {
      const key = q.raisedBy || REMINDER_FALLBACK;
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(q);
    });

    Object.keys(buckets).forEach(function(raiser) {
      const quotes = buckets[raiser];
      const subject = '[WORQ Quotations] ' + quotes.length +
                      ' quote' + (quotes.length === 1 ? '' : 's') +
                      ' pending follow-up >' + REMINDER_AGE_DAYS + ' days';

      let body = quotes.length + ' quotation' + (quotes.length === 1 ? ' has' : 's have') +
                 ' been sitting at "Pending Customer" for more than ' + REMINDER_AGE_DAYS +
                 ' days. Please follow up with the customer or update the status:\n\n';

      quotes.forEach(function(q) {
        body += '• ' + q.quoteNumber + '  —  ' + q.customer +
                '  —  ' + q.daysAgo + ' day' + (q.daysAgo === 1 ? '' : 's') + ' ago' +
                '  —  RM ' + q.quotedPrice.toFixed(2) + '\n';
        if (q.driveUrl) body += '   ' + q.driveUrl + '\n';
      });

      body += '\nOpen the dashboard to follow up, mark Pending Bill, or cancel.';

      const opts = { name: 'WORQ Quotation Generator' };
      // Don't CC if the raiser IS afdhal (avoid duplicate copy in the same inbox)
      if (REMINDER_CC && REMINDER_CC !== raiser) opts.cc = REMINDER_CC;

      try { GmailApp.sendEmail(raiser, subject, body, opts); }
      catch (e) { Logger.log('Failed to send reminder to ' + raiser + ': ' + e.message); }
    });

  } catch (e) {
    console.error('dailyFollowUpReminder error:', e.message, e.stack);
  }
}

function findStalePendingCustomerQuotes(thresholdDays) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = getProp('TRACKER_SHEET_TAB') || 'NEW COMBINED';
  const sheet = ss.getSheetByName(tabName);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  // Read through column N (Raised by) so we can group the digest per raiser
  const values = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  const now = new Date();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    const dateVal = r[0];
    if (!(dateVal instanceof Date)) continue;
    const status = r[10] ? r[10].toString().trim() : '';
    if (status !== 'Pending Customer') continue;
    const daysAgo = Math.floor((now - dateVal) / (1000 * 60 * 60 * 24));
    if (daysAgo <= thresholdDays) continue;
    out.push({
      rowIndex: i + 2,
      quoteNumber: r[1] ? r[1].toString().trim() : '',
      customer: r[2] ? r[2].toString().trim() : '',
      driveUrl: r[5] ? r[5].toString().trim() : '',
      quotedPrice: parseFloat(r[6]) || 0,
      daysAgo: daysAgo,
      raisedBy: r[13] ? r[13].toString().trim() : ''  // N = index 13
    });
  }
  // Oldest first — most pressing at the top of the digest
  out.sort(function(a, b) { return b.daysAgo - a.daysAgo; });
  return out;
}

// ── Manual test: run this to send today's digest immediately ──
function testDailyReminderNow() {
  dailyFollowUpReminder();
}
