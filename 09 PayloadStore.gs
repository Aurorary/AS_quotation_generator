// ============================================================
// PayloadStore.gs — Persist full quote payloads for revisions
// ============================================================
// Stores each sent quote's full JSON payload in a hidden tab so
// future revisions can pre-fill items, sub-rows, and pricing.
//
// Schema: A=quoteNumber  B=parentQuoteNumber  C=timestamp  D=payloadJson

const PAYLOADS_TAB_NAME = '_payloads';

function getPayloadsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PAYLOADS_TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PAYLOADS_TAB_NAME);
    sheet.getRange(1, 1, 1, 4).setValues([['quoteNumber', 'parentQuoteNumber', 'timestamp', 'payloadJson']]);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

function savePayload(quoteNumber, parentQuoteNumber, payload) {
  const sheet = getPayloadsSheet_();
  sheet.appendRow([
    quoteNumber,
    parentQuoteNumber || '',
    new Date(),
    JSON.stringify(payload)
  ]);
}

function loadPayload(quoteNumber) {
  const sheet = getPayloadsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if ((values[i][0] || '').toString().trim() === quoteNumber) {
      try {
        return JSON.parse(values[i][3]);
      } catch (e) {
        Logger.log('Failed to parse payload for ' + quoteNumber + ': ' + e.message);
        return null;
      }
    }
  }
  return null;
}

// ── Returns recent quotes that have stored payloads (revisable) ──
function getQuoteHistory(limit) {
  const max = limit || 100;
  const sheet = getPayloadsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const tracker = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(getProp('TRACKER_SHEET_TAB') || 'NEW COMBINED');
  const trackerLast = tracker.getLastRow();
  const trackerByQuote = {};
  if (trackerLast > 1) {
    const trackerVals = tracker.getRange(2, 1, trackerLast - 1, 11).getValues();
    trackerVals.forEach(function(r) {
      const qn = r[1] ? r[1].toString().trim() : '';
      if (!qn) return;
      trackerByQuote[qn] = {
        date: r[0] instanceof Date
          ? Utilities.formatDate(r[0], 'Asia/Kuala_Lumpur', 'dd-MMM-yyyy')
          : '',
        customer: r[2] ? r[2].toString().trim() : '',
        work: r[3] ? r[3].toString().trim() : '',
        quotedPrice: parseFloat(r[6]) || 0,
        status: r[10] ? r[10].toString().trim() : ''
      };
    });
  }

  const start = Math.max(2, lastRow - max + 1);
  const values = sheet.getRange(start, 1, lastRow - start + 1, 3).getValues();
  const out = [];
  for (let i = values.length - 1; i >= 0; i--) {
    const qn = (values[i][0] || '').toString().trim();
    if (!qn) continue;
    const t = trackerByQuote[qn] || {};
    out.push({
      quoteNumber: qn,
      parentQuoteNumber: (values[i][1] || '').toString().trim(),
      savedAt: values[i][2] instanceof Date
        ? Utilities.formatDate(values[i][2], 'Asia/Kuala_Lumpur', 'dd-MMM-yyyy')
        : '',
      customer: t.customer || '',
      work: t.work || '',
      quotedPrice: t.quotedPrice || 0,
      status: t.status || '',
      date: t.date || ''
    });
  }
  return out;
}

// ── Revision number builder (matches sidebar's lowercase rev1/rev2) ──
function buildRevisionNumber(existing) {
  const trimmed = (existing || '').trim();
  const match = trimmed.match(/^(.*)\s+rev(\d+)$/i);
  if (match) {
    return match[1] + ' rev' + (parseInt(match[2], 10) + 1);
  }
  return trimmed + ' rev1';
}

// ── Backend entry: load payload + bump quote number for Revise ──
function getRevisionData(quoteNumber) {
  const payload = loadPayload(quoteNumber);
  if (!payload) {
    return { success: false, error: 'No saved payload found for ' + quoteNumber };
  }
  return {
    success: true,
    parentQuoteNumber: quoteNumber,
    newQuoteNumber: buildRevisionNumber(quoteNumber),
    payload: payload
  };
}
