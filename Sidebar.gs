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

  // Rows 0-2 are notes/header — start at index 3
  const items = [];
  let current = null;

  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    const category = r[0] ? r[0].toString().trim() : '';
    const brand    = r[1] ? r[1].toString().trim() : '';
    const desc     = r[2] ? r[2].toString().trim() : '';
    const costUnit = r[3] ? parseFloat(r[3]) || 0 : 0;
    const costPrice= r[4] ? parseFloat(r[4]) || 0 : 0;
    const price    = r[5] ? parseFloat(r[5]) || 0 : 0;
    const chargeType = r[6] ? r[6].toString().trim() : '';
    const remark   = r[7] ? r[7].toString().trim() : '';

    if (category) {
      // New parent item
      if (current) items.push(current);
      current = {
        category: category,
        brand: brand,
        description: desc,
        costPrice: costPrice,
        price: price,
        chargeType: chargeType,
        remark: remark,
        subRows: []
      };
    } else if (desc && current) {
      // Sub-component row
      current.subRows.push({ description: desc, costUnit: costUnit });
    }
  }
  if (current) items.push(current);

  cache.put('catalogue', JSON.stringify(items), 600);
  return items;
}

// ── Master generate function ─────────────────────────────────
function generateQuotation(payload) {
  try {
    // 1. Get location details
    const locations = getLocations();
    const loc = locations.find(function(l) { return l.code === payload.locationCode; });
    if (!loc) throw new Error('Location not found: ' + payload.locationCode);

    // 2. Build PDF HTML
    const logoDataUri = getLogoBase64();
    const htmlString = buildHtmlQuotation(payload, loc, logoDataUri);

    // 3. Convert to PDF
    const pdfBlob = convertHtmlToPdf(htmlString, payload.quoteNumber);

    // 4. Save to Drive
    const driveUrl = savePdf(pdfBlob, payload.quoteNumber);

    // 5. Send email to customer
    if (payload.customerEmail) {
      sendQuotationEmail(payload.customerEmail, payload.customerName, payload.quoteNumber, pdfBlob, driveUrl);
    }

    // Also CC the location outlet email if available
    if (loc.email && loc.email !== payload.customerEmail) {
      sendQuotationEmail(loc.email, payload.customerName, payload.quoteNumber, pdfBlob, driveUrl, true);
    }

    // 6. Update tracker row
    updateTrackerRow(payload.rowIndex, payload.quoteNumber, driveUrl, payload.quotedPrice, payload.costPrice, payload.quoteDate, payload.customerName, payload.work);

    return { success: true, pdfUrl: driveUrl };

  } catch (e) {
    console.error('generateQuotation error:', e.message, e.stack);
    return { success: false, error: e.message };
  }
}

// ── Send email with PDF attachment ──────────────────────────
function sendQuotationEmail(email, customerName, quoteNumber, pdfBlob, driveUrl, isCc) {
  const subject = 'Quotation ' + quoteNumber + ' — WORQ';
  const body = isCc
    ? 'Please find attached the quotation ' + quoteNumber + ' for ' + customerName + '.\n\nDrive link: ' + driveUrl
    : 'Dear ' + customerName + ',\n\nPlease find attached your quotation ' + quoteNumber + '.\n\nShould you have any questions, feel free to reach out.\n\nBest regards,\nWORQ Team\n\nDrive link: ' + driveUrl;

  GmailApp.sendEmail(email, subject, body, {
    attachments: [pdfBlob.setName(quoteNumber.replace(/\//g, '-') + '.pdf')],
    name: 'WORQ Quotation'
  });
}

// ── Update tracker row columns ───────────────────────────────
function updateTrackerRow(rowIndex, quoteNumber, driveUrl, quotedPrice, costPrice, quoteDate, customerName, work) {
  if (!rowIndex || rowIndex <= 1) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = getProp('TRACKER_SHEET_TAB') || 'NEW COMBINED';
  const sheet = ss.getSheetByName(tabName);

  // Col A = Date, B = Quote#, C = Customer, D = Work, F = Drive link, G = Quoted, H = Cost
  if (quoteDate) sheet.getRange(rowIndex, 1).setValue(quoteDate);
  sheet.getRange(rowIndex, 2).setValue(quoteNumber);
  if (customerName) sheet.getRange(rowIndex, 3).setValue(customerName);
  if (work) sheet.getRange(rowIndex, 4).setValue(work);
  sheet.getRange(rowIndex, 6).setValue(driveUrl);
  sheet.getRange(rowIndex, 7).setValue(quotedPrice);
  sheet.getRange(rowIndex, 8).setValue(costPrice);
}
