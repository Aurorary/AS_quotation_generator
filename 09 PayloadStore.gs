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
  // Invalidate customer-history cache so a newly-quoted customer shows up
  // in autocomplete immediately instead of after the 5-min TTL.
  CacheService.getScriptCache().remove('customerHistory');
}

// Upsert: replace the existing row for this quote number, or append if absent.
// Used by saveDraft + draft-edit to keep one row per quote-in-progress.
function upsertPayload(quoteNumber, parentQuoteNumber, payload) {
  const sheet = getPayloadsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = keys.length - 1; i >= 0; i--) {
      if ((keys[i][0] || '').toString().trim() === quoteNumber) {
        const row = i + 2;
        sheet.getRange(row, 2).setValue(parentQuoteNumber || '');
        sheet.getRange(row, 3).setValue(new Date());
        sheet.getRange(row, 4).setValue(JSON.stringify(payload));
        CacheService.getScriptCache().remove('customerHistory');
        return;
      }
    }
  }
  // No existing row — append
  savePayload(quoteNumber, parentQuoteNumber, payload);
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
  // Backfill any missing customer-detail fields from older quotes to the same
  // customer — but only when exactly one historical value is known. Multiple
  // distinct values (e.g. several addresses) are surfaced as hints in the UI.
  const profile = getCustomerProfile(payload.customerName);
  if (profile) {
    if (!payload.customerEmail   && profile.customerEmail.length   === 1) payload.customerEmail   = profile.customerEmail[0];
    if (!payload.ccEmail         && profile.ccEmail.length         === 1) payload.ccEmail         = profile.ccEmail[0];
    if (!payload.customerAddress && profile.customerAddress.length === 1) payload.customerAddress = profile.customerAddress[0];
  }
  return {
    success: true,
    parentQuoteNumber: quoteNumber,
    newQuoteNumber: buildRevisionNumber(quoteNumber),
    payload: payload
  };
}

// ── Customer history (distinct names, for datalist) ──────────
function getCustomerHistory() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('customerHistory');
  if (cached) return JSON.parse(cached);

  const sheet = getPayloadsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const seen = {};
  // Walk newest first so the first encounter of each name wins for "lastSeen"
  for (let i = values.length - 1; i >= 0; i--) {
    let payload;
    try { payload = JSON.parse(values[i][3] || '{}'); } catch (e) { continue; }
    const name = (payload.customerName || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen[key]) {
      seen[key] = { name: name };
    }
  }
  const out = Object.keys(seen).map(function(k) { return seen[k]; });
  out.sort(function(a, b) { return a.name.localeCompare(b.name); });
  cache.put('customerHistory', JSON.stringify(out), 300);
  return out;
}

// ── Customer profile (distinct values per field, newest first) ──
// Walks _payloads newest-to-oldest for the given customer name (case-insensitive)
// and returns ALL distinct non-empty values seen for each field, in
// most-recent-first order. The frontend decides whether to autofill (when
// exactly one value is known) or show clickable hints (when 2+ exist).
function getCustomerProfile(customerName) {
  const target = (customerName || '').trim().toLowerCase();
  if (!target) return null;

  const sheet = getPayloadsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const fields = ['customerEmail', 'ccEmail', 'customerAddress'];
  const seen = { customerEmail: {}, ccEmail: {}, customerAddress: {} };
  const out  = { customerEmail: [], ccEmail: [], customerAddress: [] };
  let found = false;

  for (let i = values.length - 1; i >= 0; i--) {
    let payload;
    try { payload = JSON.parse(values[i][3] || '{}'); } catch (e) { continue; }
    if ((payload.customerName || '').trim().toLowerCase() !== target) continue;
    found = true;
    fields.forEach(function(f) {
      const v = (payload[f] || '').toString().trim();
      if (!v) return;
      const key = v.toLowerCase();
      if (seen[f][key]) return;
      seen[f][key] = true;
      out[f].push(v);
    });
  }
  return found ? out : null;
}
