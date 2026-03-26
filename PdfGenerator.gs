// ============================================================
// PdfGenerator.gs — Build HTML quotation + convert to PDF
// ============================================================

// ── Fetch logo as base64 data URI (cached 6 h) ──────────────
function getLogoBase64() {
  const logoId = getProp('LOGO_FILE_ID');
  if (!logoId) return '';

  const cache = CacheService.getScriptCache();
  const cached = cache.get('logoDataUri');
  if (cached) return cached;

  try {
    const blob = DriveApp.getFileById(logoId).getBlob();
    const bytes = blob.getBytes();
    const b64 = Utilities.base64Encode(bytes);
    const mimeType = blob.getContentType() || 'image/png';
    const dataUri = 'data:' + mimeType + ';base64,' + b64;
    cache.put('logoDataUri', dataUri, 21600);
    return dataUri;
  } catch (e) {
    Logger.log('Logo fetch failed: ' + e.message);
    return '';
  }
}

// ── Build full HTML string for quotation ────────────────────
function buildHtmlQuotation(payload, loc, logoDataUri) {
  // Group items by category
  const grouped = {};
  const categoryOrder = [];
  payload.items.forEach(function(item) {
    const cat = item.category || 'General';
    if (!grouped[cat]) {
      grouped[cat] = [];
      categoryOrder.push(cat);
    }
    grouped[cat].push(item);
  });

  // Build item rows HTML
  let itemRowsHtml = '';
  let itemCounter = 1;
  categoryOrder.forEach(function(cat) {
    itemRowsHtml += `
      <tr class="cat-header">
        <td colspan="4"><strong>${escHtml(cat)}</strong></td>
      </tr>`;
    grouped[cat].forEach(function(item) {
      const descLines = escHtml(item.description).replace(/\n/g, '<br>');
      const unitPrice = formatMyr(item.unitPrice);
      const lineTotal = formatMyr(item.lineTotal);

      // Build sub-components list if present
      let subHtml = '';
      if (item.subRows && item.subRows.length > 0) {
        subHtml = '<div style="margin-top:4px; color:#555; font-size:8.5pt; line-height:1.5;">';
        item.subRows.forEach(function(sub) {
          subHtml += escHtml(sub.description) + '<br>';
        });
        subHtml += '</div>';
      }

      // Only show price columns if unit price > 0
      const priceHtml = item.unitPrice > 0
        ? `<td class="center">${item.qty}</td><td class="right">${unitPrice}</td><td class="right">${lineTotal}</td>`
        : `<td class="center">${item.qty}</td><td class="right">—</td><td class="right">—</td>`;

      itemRowsHtml += `
      <tr class="item-row">
        <td>${itemCounter}. <strong>${descLines}</strong>${subHtml}</td>
        ${priceHtml}
      </tr>`;
      itemCounter++;
    });
  });

  // Parse location address block
  // Expected multi-line: Name\nCompany\nStreet\nCity\nEmail
  const addrLines = loc.fullAddress.split('\n').map(function(l) { return escHtml(l.trim()); });
  const locationName    = addrLines[0] || '';
  const locationCompany = addrLines[1] || '';
  const locationAddr    = addrLines.slice(2).join('<br>');

  const totalFormatted = formatMyr(payload.quotedPrice);

  // Customer address multi-line
  const custAddrHtml = escHtml(payload.customerAddress || '').replace(/\n/g, '<br>');

  const template = HtmlService.createTemplateFromFile('quotation-template');
  template.logoDataUri     = logoDataUri;
  template.locationName    = locationName;
  template.locationCompany = locationCompany;
  template.locationAddr    = locationAddr;
  template.locationEmail   = escHtml(loc.email || '');
  template.accountNo       = escHtml(loc.accountNo || '512222641522');
  template.quoteDate       = escHtml(payload.quoteDate || '');
  template.customerName    = escHtml(payload.customerName || '');
  template.customerAddr    = custAddrHtml;
  template.quoteNumber     = escHtml(payload.quoteNumber || '');
  template.itemRowsHtml    = itemRowsHtml;
  template.totalFormatted  = totalFormatted;

  return template.evaluate().getContent();
}

// ── Convert HTML string → PDF blob ──────────────────────────
function convertHtmlToPdf(htmlString, quoteNumber) {
  const blob = Utilities.newBlob(htmlString, 'text/html', 'temp-quote.html');
  const tempFile = DriveApp.createFile(blob);
  try {
    const pdfBlob = tempFile.getAs('application/pdf');
    pdfBlob.setName(quoteNumber.replace(/\//g, '-') + '.pdf');
    return pdfBlob;
  } finally {
    tempFile.setTrashed(true);
  }
}

// ── Helpers ──────────────────────────────────────────────────
function escHtml(str) {
  return (str || '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMyr(value) {
  const num = parseFloat(value) || 0;
  return num.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
