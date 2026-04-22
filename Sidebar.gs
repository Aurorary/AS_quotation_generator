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
    cache.remove('pendingPayload');

    const locations = getLocations();
    const loc = locations.find(function(l) { return l.code === payload.locationCode; });
    if (!loc) throw new Error('Location not found: ' + payload.locationCode);

    const logoDataUri = getLogoBase64();
    const htmlString = buildHtmlQuotation(payload, loc, logoDataUri);
    const pdfBlob = convertHtmlToPdf(htmlString, payload.quoteNumber);
    const driveUrl = savePdf(pdfBlob, payload.quoteNumber);

    if (payload.customerEmail) {
      const userCc = (payload.ccEmail || '').trim();
      sendQuotationEmail(payload.customerEmail, payload.customerName, payload.quoteNumber, pdfBlob, driveUrl, false, userCc);
    }
    if (loc.email && loc.email !== payload.customerEmail) {
      sendQuotationEmail(loc.email, payload.customerName, payload.quoteNumber, pdfBlob, driveUrl, true, '');
    }

    updateTrackerRow(payload.rowIndex, payload.quoteNumber, driveUrl, payload.quotedPrice, payload.costPrice, payload.quoteDate, payload.customerName, payload.work);

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
    : 'Dear ' + customerName + ',\n\nPlease find attached your quotation ' + quoteNumber + '.\n\nShould you have any questions, feel free to reach out.\n\nBest regards,\nWORQ Team\n\nDrive link: ' + driveUrl;

  const opts = {
    attachments: [pdfBlob.setName(quoteNumber.replace(/\//g, '-') + '.pdf')],
    name: 'WORQ Quotation'
  };
  if (ccEmail) opts.cc = ccEmail;

  GmailApp.sendEmail(email, subject, body, opts);
}

// ── Update tracker row columns ───────────────────────────────
function updateTrackerRow(rowIndex, quoteNumber, driveUrl, quotedPrice, costPrice, quoteDate, customerName, work) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = getProp('TRACKER_SHEET_TAB') || 'NEW COMBINED';
  const sheet = ss.getSheetByName(tabName);

  const profit = quotedPrice - costPrice;
  const margin = quotedPrice > 0 ? Math.round((profit / quotedPrice) * 100) + '%' : '0%';

  // Always append a new row (revisions get their own row with Rev# in the quote number)
  const lastRow = sheet.getLastRow();
  const newRow = lastRow + 1;

  // Copy format + validation from previous row
  sheet.getRange(lastRow, 1, 1, 11).copyTo(
    sheet.getRange(newRow, 1, 1, 11),
    SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false
  );
  sheet.getRange(lastRow, 11, 1, 1).copyTo(
    sheet.getRange(newRow, 11, 1, 1),
    SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false
  );

  // A=Date, B=Quote#, C=Customer, D=Work, F=Doc Link, G=Quoted, H=Cost, I=Profit, J=Margin, K=Billed?
  sheet.getRange(newRow, 1).setValue(quoteDate);
  sheet.getRange(newRow, 2).setValue(quoteNumber);
  sheet.getRange(newRow, 3).setValue(customerName);
  sheet.getRange(newRow, 4).setValue(work);
  sheet.getRange(newRow, 6).setValue(driveUrl);
  sheet.getRange(newRow, 7).setValue(quotedPrice);
  sheet.getRange(newRow, 8).setValue(costPrice);
  sheet.getRange(newRow, 9).setValue(profit);
  sheet.getRange(newRow, 10).setValue(margin);
  sheet.getRange(newRow, 11).setValue('Pending Customer');
}
