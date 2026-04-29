// ============================================================
// Reminders.gs — Daily follow-up digest for stale quotes
// ============================================================
// Scheduled by an installable time-driven trigger on
// `dailyFollowUpReminder` (run setupDailyReminder once to install).

const REMINDER_HOUR = 9;                           // 9am
const REMINDER_TIMEZONE = 'Asia/Kuala_Lumpur';
const REMINDER_AGE_DAYS = 7;
const REMINDER_RECIPIENT = 'afdhal@worq.space';

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

    const subject = '[WORQ Quotations] ' + stale.length +
                    ' quote' + (stale.length === 1 ? '' : 's') +
                    ' pending follow-up >' + REMINDER_AGE_DAYS + ' days';

    let body = stale.length + ' quotation' + (stale.length === 1 ? ' has' : 's have') +
               ' been sitting at "Pending Customer" for more than ' + REMINDER_AGE_DAYS +
               ' days:\n\n';

    stale.forEach(function(q) {
      body += '• ' + q.quoteNumber + '  —  ' + q.customer +
              '  —  ' + q.daysAgo + ' day' + (q.daysAgo === 1 ? '' : 's') + ' ago' +
              '  —  RM ' + q.quotedPrice.toFixed(2) + '\n';
      if (q.driveUrl) body += '   ' + q.driveUrl + '\n';
    });

    body += '\nOpen the dashboard to follow up, mark Pending Bill, or cancel.';

    GmailApp.sendEmail(REMINDER_RECIPIENT, subject, body, { name: 'WORQ Quotation Generator' });

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

  const values = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
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
      daysAgo: daysAgo
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
