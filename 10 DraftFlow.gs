// ============================================================
// DraftFlow.gs — Save-as-draft, approval, rejection
// ============================================================
// Drafts live in the same tracker tab as final quotes (column K = "Draft").
// Their payload + drafter identity is persisted so an approver can review,
// edit, approve-and-send (atomic), or reject with a note.

const DRAFT_PDF_PREFIX = '[DRAFT] ';

// ── Save the current pending payload as a Draft (no email) ───
// Returns { success, draftRow, pdfUrl } on success.
function saveDraftFromPending() {
  try {
    const cache = CacheService.getScriptCache();
    const raw = cache.get('pendingPayload');
    if (!raw) throw new Error('Preview expired. Please generate the preview again.');

    const payload = JSON.parse(raw);
    const drafter = Session.getActiveUser().getEmail();

    // Server-side enforcement: a non-approver cannot send ≥RM 10K, but they
    // CAN always save a draft. (The frontend just hides Send Now in that case.)
    cache.remove('pendingPayload');

    const locations = getLocations();
    const loc = locations.find(function(l) { return l.code === payload.locationCode; });
    if (!loc) throw new Error('Location not found: ' + payload.locationCode);

    const logoDataUri = getLogoBase64();
    const htmlString = buildHtmlQuotation(payload, loc, logoDataUri);
    const pdfBlob = convertHtmlToPdf(htmlString, payload.quoteNumber, payload.customerName, DRAFT_PDF_PREFIX);
    const saved = savePdf(pdfBlob, payload.quoteNumber, payload.customerName, DRAFT_PDF_PREFIX);

    const draftRow = appendTrackerRow(
      payload.quoteNumber, saved.url,
      payload.quotedPrice, payload.costPrice,
      payload.quoteDate, payload.customerName, payload.work,
      'Draft', drafter
    );

    // Stash payload + draft PDF id (for later cleanup at approval time)
    payload._draftPdfId = saved.id;
    upsertPayload(payload.quoteNumber, payload.parentQuoteNumber || '', payload);

    notifyApproversOfDraft(payload, drafter, draftRow);

    return { success: true, draftRow: draftRow, pdfUrl: saved.url };

  } catch (e) {
    console.error('saveDraftFromPending error:', e.message, e.stack);
    return { success: false, error: e.message };
  }
}

// ── Approve a draft: re-render PDF, send to customer, flip status ──
// Atomic from the user's perspective: clicking Approve & Send fires the
// real send flow against the saved payload snapshot.
function approveAndSend(draftRow) {
  try {
    const me = Session.getActiveUser().getEmail();
    if (!isApprover(me)) {
      return { success: false, error: 'Only approvers can send drafts.' };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tabName = getProp('TRACKER_SHEET_TAB') || 'NEW COMBINED';
    const sheet = ss.getSheetByName(tabName);
    const lastRow = sheet.getLastRow();
    if (draftRow < 2 || draftRow > lastRow) throw new Error('Draft row out of range');

    const rowVals = sheet.getRange(draftRow, 1, 1, 15).getValues()[0];
    const status = (rowVals[10] || '').toString().trim();
    if (status !== 'Draft') throw new Error('Row ' + draftRow + ' is not a Draft (status: ' + status + ')');
    const quoteNumber = (rowVals[1] || '').toString().trim();

    const payload = loadPayload(quoteNumber);
    if (!payload) throw new Error('No saved payload found for ' + quoteNumber);

    const locations = getLocations();
    const loc = locations.find(function(l) { return l.code === payload.locationCode; });
    if (!loc) throw new Error('Location not found: ' + payload.locationCode);

    const logoDataUri = getLogoBase64();
    const htmlString = buildHtmlQuotation(payload, loc, logoDataUri);
    const pdfBlob = convertHtmlToPdf(htmlString, payload.quoteNumber, payload.customerName);
    const saved = savePdf(pdfBlob, payload.quoteNumber, payload.customerName);
    const driveUrl = saved.url;

    if (payload.customerEmail) {
      const ccList = (payload.ccEmail || '').trim();
      sendQuotationEmail(payload.customerEmail, payload.customerName, payload.quoteNumber, pdfBlob, driveUrl, false, ccList);
    }

    // Update the draft row → flip status, replace doc link, leave M (drafter) intact
    sheet.getRange(draftRow, 6).setValue(driveUrl);
    sheet.getRange(draftRow, 11).setValue('Pending Customer');

    // Trash the draft PDF if we know its id
    if (payload._draftPdfId) {
      try { DriveApp.getFileById(payload._draftPdfId).setTrashed(true); }
      catch (e) { Logger.log('Failed to trash draft PDF: ' + e.message); }
      delete payload._draftPdfId;
    }

    // Update stored payload (drop the draft pdf id, keep the rest)
    upsertPayload(payload.quoteNumber, payload.parentQuoteNumber || '', payload);

    return { success: true, pdfUrl: driveUrl };

  } catch (e) {
    console.error('approveAndSend error:', e.message, e.stack);
    return { success: false, error: e.message };
  }
}

// ── Reject a draft with a note (writes Cancelled, emails drafter) ──
function rejectDraft(draftRow, note) {
  try {
    const me = Session.getActiveUser().getEmail();
    if (!isApprover(me)) {
      return { success: false, error: 'Only approvers can reject drafts.' };
    }
    const trimmed = (note || '').trim();
    if (!trimmed) return { success: false, error: 'A rejection note is required.' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tabName = getProp('TRACKER_SHEET_TAB') || 'NEW COMBINED';
    const sheet = ss.getSheetByName(tabName);
    const lastRow = sheet.getLastRow();
    if (draftRow < 2 || draftRow > lastRow) throw new Error('Draft row out of range');

    const rowVals = sheet.getRange(draftRow, 1, 1, 15).getValues()[0];
    const status = (rowVals[10] || '').toString().trim();
    if (status !== 'Draft') throw new Error('Row ' + draftRow + ' is not a Draft (status: ' + status + ')');

    const quoteNumber = (rowVals[1] || '').toString().trim();
    const customerName = (rowVals[2] || '').toString().trim();
    const drafter = (rowVals[13] || '').toString().trim(); // N = 14 → index 13

    sheet.getRange(draftRow, 11).setValue('Cancelled');
    sheet.getRange(draftRow, 15).setValue(trimmed); // O = 15

    if (drafter) {
      const subject = '[Draft rejected] ' + quoteNumber + ' — ' + customerName;
      const body = me + ' rejected your draft quotation ' + quoteNumber +
                   ' for ' + customerName + '.\n\nNote:\n' + trimmed +
                   '\n\nYou can revise the cancelled quote from the dashboard.';
      try { GmailApp.sendEmail(drafter, subject, body, { name: 'WORQ Quotation Generator' }); }
      catch (e) { Logger.log('Failed to email drafter: ' + e.message); }
    }

    return { success: true };

  } catch (e) {
    console.error('rejectDraft error:', e.message, e.stack);
    return { success: false, error: e.message };
  }
}

// ── Drafts the current viewer is meant to act on ─────────────
// Approvers see all drafts. Non-approvers see their own drafts (so they
// can edit / pull back before approval).
function getDraftsAwaitingApproval() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = getProp('TRACKER_SHEET_TAB') || 'NEW COMBINED';
  const sheet = ss.getSheetByName(tabName);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const me = Session.getActiveUser().getEmail();
  const isApp = isApprover(me);
  const values = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    const status = r[10] ? r[10].toString().trim() : '';
    if (status !== 'Draft') continue;
    const drafter = r[13] ? r[13].toString().trim() : '';
    if (!isApp && drafter !== me) continue;
    out.push({
      rowIndex: i + 2,
      date: r[0] instanceof Date
        ? Utilities.formatDate(r[0], 'Asia/Kuala_Lumpur', 'dd-MMM-yyyy')
        : '',
      quoteNumber: r[1] ? r[1].toString().trim() : '',
      customer: r[2] ? r[2].toString().trim() : '',
      work: r[3] ? r[3].toString().trim() : '',
      driveUrl: r[5] ? r[5].toString().trim() : '',
      quotedPrice: parseFloat(r[6]) || 0,
      drafter: drafter
    });
  }
  // Newest first
  out.sort(function(a, b) { return b.rowIndex - a.rowIndex; });
  return out;
}

// ── Email approvers when a teammate drafts something ─────────
function notifyApproversOfDraft(payload, drafter, draftRow) {
  try {
    const subject = '[Approval needed] ' + payload.quoteNumber + ' — ' +
                    payload.customerName + ' — RM ' +
                    (parseFloat(payload.quotedPrice) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 });
    const body = drafter + ' has drafted a quotation pending your review.\n\n' +
                 'Quote: ' + payload.quoteNumber + '\n' +
                 'Customer: ' + payload.customerName + '\n' +
                 'Work: ' + (payload.work || '—') + '\n' +
                 'Quoted: RM ' + (parseFloat(payload.quotedPrice) || 0).toFixed(2) + '\n\n' +
                 'Open the dashboard to review, edit, approve, or reject.';
    APPROVER_EMAILS.forEach(function(addr) {
      try { GmailApp.sendEmail(addr, subject, body, { name: 'WORQ Quotation Generator' }); }
      catch (e) { Logger.log('Failed to notify ' + addr + ': ' + e.message); }
    });
  } catch (e) {
    Logger.log('notifyApproversOfDraft outer error: ' + e.message);
  }
}

// ── Load a draft for editing (returns full payload + draftRow) ──
function getDraftForEdit(draftRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = getProp('TRACKER_SHEET_TAB') || 'NEW COMBINED';
  const sheet = ss.getSheetByName(tabName);
  const rowVals = sheet.getRange(draftRow, 1, 1, 15).getValues()[0];
  const status = (rowVals[10] || '').toString().trim();
  if (status !== 'Draft') return { success: false, error: 'Row is not a Draft' };
  const quoteNumber = (rowVals[1] || '').toString().trim();
  const payload = loadPayload(quoteNumber);
  if (!payload) return { success: false, error: 'No saved payload for ' + quoteNumber };
  return {
    success: true,
    draftRow: draftRow,
    quoteNumber: quoteNumber,
    drafter: rowVals[13] ? rowVals[13].toString().trim() : '',
    payload: payload
  };
}

// ── Update an existing draft in place (re-renders PDF, no email) ──
// Replaces the tracker row's doc link + financial cells, replaces the
// _payloads JSON. Trashes the old draft PDF.
function updateDraftFromPending(draftRow) {
  try {
    const me = Session.getActiveUser().getEmail();

    const cache = CacheService.getScriptCache();
    const raw = cache.get('pendingPayload');
    if (!raw) throw new Error('Preview expired. Please generate the preview again.');
    const payload = JSON.parse(raw);
    cache.remove('pendingPayload');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tabName = getProp('TRACKER_SHEET_TAB') || 'NEW COMBINED';
    const sheet = ss.getSheetByName(tabName);
    const rowVals = sheet.getRange(draftRow, 1, 1, 15).getValues()[0];
    const status = (rowVals[10] || '').toString().trim();
    if (status !== 'Draft') throw new Error('Row is not a Draft');

    const locations = getLocations();
    const loc = locations.find(function(l) { return l.code === payload.locationCode; });
    if (!loc) throw new Error('Location not found: ' + payload.locationCode);

    const logoDataUri = getLogoBase64();
    const htmlString = buildHtmlQuotation(payload, loc, logoDataUri);
    const pdfBlob = convertHtmlToPdf(htmlString, payload.quoteNumber, payload.customerName, DRAFT_PDF_PREFIX);
    const saved = savePdf(pdfBlob, payload.quoteNumber, payload.customerName, DRAFT_PDF_PREFIX);

    // Trash old draft PDF if we know its id
    const prior = loadPayload(payload.quoteNumber);
    if (prior && prior._draftPdfId) {
      try { DriveApp.getFileById(prior._draftPdfId).setTrashed(true); }
      catch (e) { Logger.log('Failed to trash old draft PDF: ' + e.message); }
    }

    // Update tracker row in place (keep drafter intact)
    const profit = (payload.quotedPrice || 0) - (payload.costPrice || 0);
    const margin = payload.quotedPrice > 0 ? Math.round((profit / payload.quotedPrice) * 100) + '%' : '0%';
    sheet.getRange(draftRow, 3).setValue(payload.customerName);
    sheet.getRange(draftRow, 4).setValue(payload.work || '');
    sheet.getRange(draftRow, 6).setValue(saved.url);
    sheet.getRange(draftRow, 7).setValue(payload.quotedPrice);
    sheet.getRange(draftRow, 8).setValue(payload.costPrice);
    sheet.getRange(draftRow, 9).setValue(profit);
    sheet.getRange(draftRow, 10).setValue(margin);

    payload._draftPdfId = saved.id;
    upsertPayload(payload.quoteNumber, payload.parentQuoteNumber || '', payload);

    return { success: true, draftRow: draftRow, pdfUrl: saved.url };

  } catch (e) {
    console.error('updateDraftFromPending error:', e.message, e.stack);
    return { success: false, error: e.message };
  }
}
