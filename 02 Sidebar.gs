// ============================================================
// Sidebar.gs — Server-side functions called from sidebar UI
// ============================================================

// ── Initial data bundle for sidebar on open ─────────────────
function getInitialData() {
  const rowData = getSelectedRowData();
  const locations = getLocations();

  // Default location: first in list (or ITG if found)
  let defaultLocation = locations.length > 0 ? locations[0].code : 'ITG';
  const itg = locations.find(function(l) { return l.code === 'ITG'; });
  if (itg) defaultLocation = 'ITG';

  const quoteNumber = getNextQuoteNumber(defaultLocation);
  const today = Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'dd-MMM-yyyy');

  return {
    locations: locations,
    defaultLocation: defaultLocation,
    quoteNumber: quoteNumber,
    today: today,
    selectedRow: rowData
  };
}

// ── Catalogue items (parsed + cached 10 min) ────────────────
function getCatalogueItems() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('catalogue');
  if (cached) return JSON.parse(cached);

  const sheetId = getProp('CATALOGUE_SHEET_ID');
  const tabName = getProp('CATALOGUE_TAB_NAME') || 'Hardware & Services';

  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getSheetByName(tabName);
  const rows = sheet.getDataRange().getValues();

  function computeCatalogueSellPrice(cost) {
    if (!cost) return 0;
    return Math.ceil((cost / 0.7) / 10) * 10;
  }

  // Rows 0-2 are notes/header — start at index 3
  const items = [];
  let current = null;

  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    const category   = r[0] ? r[0].toString().trim() : '';
    const brand      = r[1] ? r[1].toString().trim() : '';
    const desc       = r[2] ? r[2].toString().trim() : '';
    const costUnit   = r[3] ? parseFloat(r[3]) || 0 : 0;
    const costPrice  = r[4] ? parseFloat(r[4]) || 0 : 0;
    const price      = r[5] ? parseFloat(r[5]) || 0 : 0;
    const chargeType = r[6] ? r[6].toString().trim() : '';
    const remark     = r[7] ? r[7].toString().trim() : '';

    if (category) {
      // New parent item — push previous
      if (current) items.push(current);
      // Some items have no description on the category row (desc is in sub-rows)
      // Use brand as fallback label if desc is blank; sub-rows will fill in detail
      current = {
        category: category,
        brand: brand,
        description: desc,  // may be blank — will be filled from first sub-row if needed
        costPrice: costPrice,
        price: price,
        chargeType: chargeType,
        remark: remark,
        subRows: []
      };
    } else if (current) {
      if (brand) {
        // Sub-row with brand + price and no category = secondary billing component of parent
        // Detected when: parent has a chargeType already and this row adds a different chargeType with its own price
        if ((costPrice > 0 || price > 0) && chargeType && chargeType !== current.chargeType && current.chargeType) {
          const epPrice = price > 0 ? price : computeCatalogueSellPrice(costPrice);
          current.extraPriceRows = current.extraPriceRows || [];
          current.extraPriceRows.push({ description: brand, costPrice: costPrice, price: epPrice, chargeType: chargeType });
        } else {
          // Distinct sibling item
          items.push(current);
          current = {
            category: current.category,
            brand: brand,
            description: desc,
            costPrice: costPrice,
            price: price,
            chargeType: chargeType,
            remark: remark,
            subRows: []
          };
        }
      } else if (costPrice > 0 || price > 0) {
        // Sub-row with its own price — store for display but do NOT accumulate into parent
        // (parent's catalogue price already reflects the full package price)
        if (!current.description && desc) current.description = desc;
        current.subRows.push({ description: desc, costUnit: costUnit, costPrice: costPrice, price: price, chargeType: chargeType });
      } else if (costUnit > 0 && chargeType && chargeType !== current.chargeType) {
        // Sub-row with only a costUnit and a different chargeType — treat costUnit as its individual sell price
        // Do NOT accumulate into parent price (parent catalogue price already covers the full package)
        const subSellPrice = computeCatalogueSellPrice(costUnit);
        current.subRows.push({ description: desc, costUnit: costUnit, costPrice: costUnit, price: subSellPrice, chargeType: chargeType });
      } else if (desc) {
        // Regular sub-component row (no price)
        current.subRows.push({ description: desc, costUnit: costUnit, chargeType: chargeType });
      }
    }
  }
  if (current) items.push(current);

  // Remove items with no description and no price (blank spacer rows)
  const filtered = items.filter(function(item) {
    return item.description || item.subRows.length > 0;
  });

  cache.put('catalogue', JSON.stringify(filtered), 600);
  return filtered;
}

// ── Step 1: Preview — build HTML only, cache payload ────────
function previewQuotation(payload) {
  try {
    const locations = getLocations();
    const loc = locations.find(function(l) { return l.code === payload.locationCode; });
    if (!loc) throw new Error('Location not found: ' + payload.locationCode);

    const logoDataUri = getLogoBase64();
    const htmlString = buildHtmlQuotation(payload, loc, logoDataUri);

    // Cache payload for confirm step (10 min)
    const cache = CacheService.getScriptCache();
    cache.put('pendingPayload', JSON.stringify(payload), 600);

    return { success: true, html: htmlString };

  } catch (e) {
    console.error('previewQuotation error:', e.message, e.stack);
    return { success: false, error: e.message };
  }
}

// ── Step 2: Confirm — save PDF, send email, update tracker ───
function confirmQuotation() {
  try {
    const cache = CacheService.getScriptCache();
    const raw = cache.get('pendingPayload');
    if (!raw) throw new Error('Preview expired. Please generate the preview again.');

    const payload = JSON.parse(raw);

    // Server-side enforcement: non-approvers can't send ≥ RM 10K directly.
    // (Frontend hides Send Now in this case, but enforce here too.)
    const me = Session.getActiveUser().getEmail();
    const gross = parseFloat(payload.quotedPrice) || 0;
    if (!isApprover(me) && gross >= APPROVAL_THRESHOLD_MYR) {
      return {
        success: false,
        error: 'Quotes ≥ RM ' + APPROVAL_THRESHOLD_MYR.toLocaleString() + ' require approval. Save as draft instead.'
      };
    }

    // Fail fast on bad email — no point rendering PDFs we can't deliver
    if (!isValidEmail(payload.customerEmail)) {
      return { success: false, error: 'Customer email is invalid: "' + (payload.customerEmail || '') + '"' };
    }
    if (!isValidCcList(payload.ccEmail)) {
      return { success: false, error: 'CC email is invalid: "' + (payload.ccEmail || '') + '"' };
    }

    cache.remove('pendingPayload');

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
    // Disabled during testing — re-enable to copy the WORQ location's email
    // if (loc.email && loc.email !== payload.customerEmail) {
    //   sendQuotationEmail(loc.email, payload.customerName, payload.quoteNumber, pdfBlob, driveUrl, true, '');
    // }

    updateTrackerRow(payload.rowIndex, payload.quoteNumber, driveUrl, payload.quotedPrice, payload.costPrice, payload.quoteDate, payload.customerName, payload.work);

    // Persist payload for future revisions
    savePayload(payload.quoteNumber, payload.parentQuoteNumber || '', payload);
    logCustomItems(payload, 'Pending Customer');

    return { success: true, pdfUrl: driveUrl };

  } catch (e) {
    console.error('confirmQuotation error:', e.message, e.stack);
    return { success: false, error: e.message };
  }
}

// ── Send email with PDF attachment ──────────────────────────
function sendQuotationEmail(email, customerName, quoteNumber, pdfBlob, driveUrl, isCc, ccEmail) {
  const subject = 'Quotation ' + quoteNumber + ' — WORQ';
  const body = isCc
    ? 'Please find attached the quotation ' + quoteNumber + ' for ' + customerName + '.\n\nDrive link: ' + driveUrl
    : 'Dear ' + customerName + ',\n\nPlease find attached your quotation ' + quoteNumber + '.\n\nShould you have any questions, feel free to reach out.\n\nBest regards,\nWORQ Team';

  const opts = {
    attachments: [pdfBlob.setName(buildPdfFileName(quoteNumber, customerName))],
    name: 'WORQ Quotation'
  };
  if (ccEmail) opts.cc = ccEmail;

  GmailApp.sendEmail(email, subject, body, opts);
}

// ── Email format guard ────────────────────────────────────────
// Lightweight RFC-5321-ish check — catches the common mistakes (missing @,
// stray spaces, "test" with no domain). Real validation is GmailApp's job;
// this just fails fast before we render PDFs and write tracker rows.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(s) {
  return EMAIL_PATTERN.test((s || '').toString().trim());
}

// Validates a comma- or semicolon-separated CC field; empty string is OK.
function isValidCcList(s) {
  const trimmed = (s || '').toString().trim();
  if (!trimmed) return true;
  const parts = trimmed.split(/[,;]/).map(function(p) { return p.trim(); }).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    if (!EMAIL_PATTERN.test(parts[i])) return false;
  }
  return true;
}

// ── Allowed status values (column K dropdown) ────────────────
const QUOTE_STATUSES = ['Draft', 'Pending Customer', 'Pending Bill', 'Billed', 'Cancelled'];

// ── Update a quote's status in column K ──────────────────────
// Open to anyone in the domain — flipping status is low-stakes operational
// work. Approval-gated actions (sending drafts ≥RM 10K) live elsewhere.
// Note: status "Billed" must go through markBilled() instead, which also
// writes the invoice number to column O atomically.
function setQuoteStatus(rowIndex, newStatus) {
  if (QUOTE_STATUSES.indexOf(newStatus) === -1) {
    return { success: false, error: 'Invalid status: ' + newStatus };
  }
  if (newStatus === 'Billed') {
    return { success: false, error: 'Use markBilled to set Billed status (requires invoice number)' };
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = getProp('TRACKER_SHEET_TAB') || 'NEW COMBINED';
  const sheet = ss.getSheetByName(tabName);
  const lastRow = sheet.getLastRow();
  if (rowIndex < 2 || rowIndex > lastRow) {
    return { success: false, error: 'Row ' + rowIndex + ' is out of range' };
  }
  sheet.getRange(rowIndex, 11).setValue(newStatus);

  // Snapshot custom-item prices on meaningful transitions
  if (newStatus === 'Pending Bill') {
    const quoteNumber = sheet.getRange(rowIndex, 2).getValue();
    if (quoteNumber) {
      const payload = loadPayload(quoteNumber.toString().trim());
      if (payload) logCustomItems(payload, 'Pending Bill');
    }
  }
  return { success: true };
}

// ── Mark a quote Billed: writes invoice number (col O) + status (col K) ──
const INVOICE_NUMBER_PATTERN = /^C-\d+-\d+$/;

function markBilled(rowIndex, invoiceNumber) {
  const inv = (invoiceNumber || '').trim();
  if (!inv) {
    return { success: false, error: 'Invoice number is required to mark Billed.' };
  }
  if (!INVOICE_NUMBER_PATTERN.test(inv)) {
    return { success: false, error: 'Invoice number must match C-{digits}-{digits} (e.g. C-108-0045871).' };
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = getProp('TRACKER_SHEET_TAB') || 'NEW COMBINED';
  const sheet = ss.getSheetByName(tabName);
  const lastRow = sheet.getLastRow();
  if (rowIndex < 2 || rowIndex > lastRow) {
    return { success: false, error: 'Row ' + rowIndex + ' is out of range' };
  }
  // Write both cells; column M=Invoice number, N=Drafted by, O=Rejection note
  sheet.getRange(rowIndex, 13).setValue(inv);    // M = 13
  sheet.getRange(rowIndex, 11).setValue('Billed'); // K = 11

  // Snapshot custom-item prices at billing
  const quoteNumber = sheet.getRange(rowIndex, 2).getValue();
  if (quoteNumber) {
    const payload = loadPayload(quoteNumber.toString().trim());
    if (payload) logCustomItems(payload, 'Billed');
  }
  return { success: true };
}

// ── Landing page data: open quotes (action-needed worklist) ──
// No date cutoff — a 4-month-old Pending Bill still needs billing.
// Filter out done/dead statuses (Billed, Cancelled). Sort oldest first
// within unbilled so the most-stale floats to the top.
function getRecentQuotes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = getProp('TRACKER_SHEET_TAB') || 'NEW COMBINED';
  const sheet = ss.getSheetByName(tabName);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
  const HIDDEN_STATUSES = { 'Billed': true, 'Cancelled': true };
  const now = new Date();

  const rows = [];
  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    const dateVal = r[0];
    if (!dateVal || !(dateVal instanceof Date)) continue;
    const quoteNumber = r[1] ? r[1].toString().trim() : '';
    if (!quoteNumber) continue;
    const status = r[10] ? r[10].toString().trim() : '';
    if (HIDDEN_STATUSES[status]) continue;
    const ageDays = Math.floor((now - dateVal) / (1000 * 60 * 60 * 24));
    rows.push({
      rowIndex: i + 2,
      date: Utilities.formatDate(dateVal, 'Asia/Kuala_Lumpur', 'dd-MMM-yyyy'),
      ageDays: ageDays,
      quoteNumber: quoteNumber,
      customer: r[2] ? r[2].toString().trim() : '',
      work: r[3] ? r[3].toString().trim() : '',
      driveUrl: r[5] ? r[5].toString().trim() : '',
      quotedPrice: parseFloat(r[6]) || 0,
      status: status,
      invoiceNumber: r[12] ? r[12].toString().trim() : ''
    });
  }
  // Oldest first — most overdue at the top
  rows.sort(function(a, b) { return b.ageDays - a.ageDays; });
  return rows;
}

// ── Initial bundle for web app landing page ─────────────────
function getWebAppData() {
  return {
    user: Session.getActiveUser().getEmail(),
    isApprover: isApprover(Session.getActiveUser().getEmail()),
    recentQuotes: getRecentQuotes(),
    today: Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'dd-MMM-yyyy')
  };
}

// ── Initial bundle for web app New Quote view ───────────────
function getNewQuoteData() {
  const locations = getLocations();
  let defaultLocation = locations.length > 0 ? locations[0].code : 'ITG';
  const itg = locations.find(function(l) { return l.code === 'ITG'; });
  if (itg) defaultLocation = 'ITG';

  return {
    user: Session.getActiveUser().getEmail(),
    isApprover: isApprover(Session.getActiveUser().getEmail()),
    locations: locations,
    defaultLocation: defaultLocation,
    quoteNumber: getNextQuoteNumber(defaultLocation),
    today: Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'dd-MMM-yyyy')
  };
}

// ── Append a new tracker row ─────────────────────────────────
// status defaults to 'Pending Customer' (the legacy send path).
// draftedBy populates column M when set (used by saveDraft).
function appendTrackerRow(quoteNumber, driveUrl, quotedPrice, costPrice, quoteDate, customerName, work, status, draftedBy) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = getProp('TRACKER_SHEET_TAB') || 'NEW COMBINED';
  const sheet = ss.getSheetByName(tabName);

  const profit = quotedPrice - costPrice;
  const margin = quotedPrice > 0 ? Math.round((profit / quotedPrice) * 100) + '%' : '0%';

  const lastRow = sheet.getLastRow();
  const newRow = lastRow + 1;

  // Copy format + validation from previous row (covers columns A:K so dropdown
  // validation transfers; M/N/O remain plain text columns and don't need it)
  sheet.getRange(lastRow, 1, 1, 11).copyTo(
    sheet.getRange(newRow, 1, 1, 11),
    SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false
  );
  sheet.getRange(lastRow, 11, 1, 1).copyTo(
    sheet.getRange(newRow, 11, 1, 1),
    SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false
  );

  // A=Date, B=Quote#, C=Customer, D=Work, F=Doc Link, G=Quoted, H=Cost, I=Profit, J=Margin, K=Status, N=Drafted by
  sheet.getRange(newRow, 1).setValue(quoteDate);
  sheet.getRange(newRow, 2).setValue(quoteNumber);
  sheet.getRange(newRow, 3).setValue(customerName);
  sheet.getRange(newRow, 4).setValue(work);
  sheet.getRange(newRow, 6).setValue(driveUrl);
  sheet.getRange(newRow, 7).setValue(quotedPrice);
  sheet.getRange(newRow, 8).setValue(costPrice);
  sheet.getRange(newRow, 9).setValue(profit);
  sheet.getRange(newRow, 10).setValue(margin);
  sheet.getRange(newRow, 11).setValue(status || 'Pending Customer');
  if (draftedBy) sheet.getRange(newRow, 14).setValue(draftedBy); // N = 14
  return newRow;
}

// Back-compat wrapper for existing callers (sidebar etc.)
function updateTrackerRow(rowIndex, quoteNumber, driveUrl, quotedPrice, costPrice, quoteDate, customerName, work) {
  return appendTrackerRow(quoteNumber, driveUrl, quotedPrice, costPrice, quoteDate, customerName, work, 'Pending Customer', '');
}
