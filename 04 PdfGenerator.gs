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

  // Compute charge-type totals (One-Off vs Monthly)
  const chargeGroups = {};
  payload.items.forEach(function(item) {
    const ct = item.chargeType || 'Other';
    chargeGroups[ct] = (chargeGroups[ct] || 0) + (item.lineTotal || 0);
    (item.subRows || []).filter(function(s) { return s.price > 0; }).forEach(function(sub) {
      const sct = sub.chargeType || 'Other';
      chargeGroups[sct] = (chargeGroups[sct] || 0) + (sub.price * (item.qty || 1));
    });
    (item.extraPriceRows || []).forEach(function(ep) {
      const ect = ep.chargeType || 'Other';
      chargeGroups[ect] = (chargeGroups[ect] || 0) + (ep.price * (item.qty || 1));
    });
  });
  const chargeGroupKeys = Object.keys(chargeGroups);

  // Build item rows HTML
  let itemRowsHtml = '';
  let itemCounter = 1;
  const lastCat = categoryOrder[categoryOrder.length - 1];
  categoryOrder.forEach(function(cat) {
    itemRowsHtml += `
      <tr class="cat-header">
        <td colspan="4"><strong>${escHtml(cat)}</strong></td>
      </tr>`;
    const catItems = grouped[cat];
    catItems.forEach(function(item, idx) {
      const descLines = escHtml(item.description).replace(/\n/g, '<br>');
      const unitPrice = formatMyr(item.unitPrice);
      const lineTotal = formatMyr(item.lineTotal);

      // Split sub-rows: components (no price) stay in desc cell; priced rows get own table row
      const componentSubs = (item.subRows || []).filter(function(s) { return !(s.price > 0); });
      const pricedSubs    = (item.subRows || []).filter(function(s) { return s.price > 0; });

      let subHtml = '';
      if (componentSubs.length > 0) {
        subHtml = '<table style="width:100%; border-collapse:collapse; margin-top:4px; color:#222; font-size:8.5pt;">';
        componentSubs.forEach(function(sub) {
          subHtml += '<tr>'
                   + '<td style="padding:1px 0; border:none;">' + escHtml(sub.description) + '</td>'
                   + '<td style="padding:1px 0; border:none; text-align:right; white-space:nowrap; width:1%; padding-left:8px;">' + chargeTag(sub.chargeType || '') + '</td>'
                   + '</tr>';
        });
        subHtml += '</table>';
      }

      // Main description line: tag floated right before sub-rows
      const mainDescHtml = item.chargeType
        ? '<table style="width:100%; border-collapse:collapse;"><tr>'
          + '<td style="border:none;"><strong>' + itemCounter + '. ' + descLines + '</strong></td>'
          + '<td style="border:none; text-align:right; white-space:nowrap; width:1%; padding-left:8px;">' + chargeTag(item.chargeType) + '</td>'
          + '</tr></table>'
        : itemCounter + '. <strong>' + descLines + '</strong>';

      // Last item in a non-final category: suppress bottom border to avoid double line with next cat-header
      const isLastInCat = idx === catItems.length - 1;
      const isFinalCat  = cat === lastCat;
      const noBorder    = (isLastInCat && !isFinalCat) ? ' style="border-bottom:none;"' : '';

      const extraRows = item.extraPriceRows || [];
      const hasTrailing = pricedSubs.length > 0 || extraRows.length > 0;
      const mainNoBorder = hasTrailing ? ' style="border-bottom:none;"' : noBorder;

      itemRowsHtml += `
      <tr class="item-row">
        <td${mainNoBorder}>${mainDescHtml}${subHtml}</td>
        <td class="center"${mainNoBorder}>${item.qty}</td>
        <td class="right"${mainNoBorder}>${item.unitPrice > 0 ? unitPrice : '—'}</td>
        <td class="right"${mainNoBorder}>${item.unitPrice > 0 ? lineTotal : '—'}</td>
      </tr>`;

      // Priced sub-rows (e.g. Monthly service fee bundled with a One-Off setup)
      pricedSubs.forEach(function(sub, subIdx) {
        const isLast     = subIdx === pricedSubs.length - 1 && extraRows.length === 0;
        const subNoBorder = isLast ? noBorder : '';
        const subPrice   = formatMyr(sub.price);
        const subTotal   = formatMyr(sub.price * item.qty);
        const subDescHtml = sub.chargeType
          ? '<table style="width:100%; border-collapse:collapse;"><tr>'
            + '<td style="border:none; color:#222; font-size:8.5pt;">' + escHtml(sub.description) + '</td>'
            + '<td style="border:none; text-align:right; white-space:nowrap; width:1%; padding-left:8px;">' + chargeTag(sub.chargeType) + '</td>'
            + '</tr></table>'
          : '<span style="color:#222; font-size:8.5pt;">' + escHtml(sub.description) + '</span>';
        itemRowsHtml += `
      <tr class="item-row">
        <td${subNoBorder}>${subDescHtml}</td>
        <td class="center"${subNoBorder}>${item.qty}</td>
        <td class="right"${subNoBorder}>${sub.price > 0 ? subPrice : '—'}</td>
        <td class="right"${subNoBorder}>${sub.price > 0 ? subTotal : '—'}</td>
      </tr>`;
      });

      // Extra price rows (secondary billing component with different charge type)
      extraRows.forEach(function(ep, epIdx) {
        const isLastEp   = epIdx === extraRows.length - 1;
        const epNoBorder = isLastEp ? noBorder : '';
        const epPrice    = formatMyr(ep.price);
        const epTotal    = formatMyr(ep.price * item.qty);
        const epDescHtml = ep.chargeType
          ? '<table style="width:100%; border-collapse:collapse;"><tr>'
            + '<td style="border:none; color:#222; font-size:8.5pt;">' + escHtml(ep.description) + '</td>'
            + '<td style="border:none; text-align:right; white-space:nowrap; width:1%; padding-left:8px;">' + chargeTag(ep.chargeType) + '</td>'
            + '</tr></table>'
          : '<span style="color:#222; font-size:8.5pt;">' + escHtml(ep.description) + '</span>';
        itemRowsHtml += `
      <tr class="item-row">
        <td${epNoBorder}>${epDescHtml}</td>
        <td class="center"${epNoBorder}>${item.qty}</td>
        <td class="right"${epNoBorder}>${ep.price > 0 ? epPrice : '—'}</td>
        <td class="right"${epNoBorder}>${ep.price > 0 ? epTotal : '—'}</td>
      </tr>`;
      });

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

  // Build charge-group subtotal rows HTML (only when >1 group)
  let chargeGroupHtml = '';
  if (chargeGroupKeys.length > 1) {
    chargeGroupKeys.forEach(function(ct) {
      chargeGroupHtml += `
      <tr class="charge-group-row">
        <td colspan="3" class="right" style="font-size:8pt; color:#222; padding: 3px 6px;">${escHtml(ct)}</td>
        <td class="right" style="font-size:8pt; color:#222; padding: 3px 6px;">MYR ${formatMyr(chargeGroups[ct])}</td>
      </tr>`;
    });
  }

  // Customer address multi-line
  const custAddrHtml = escHtml(payload.customerAddress || '').replace(/\n/g, '<br>');

  const template = HtmlService.createTemplateFromFile('07 quotation_template');
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
  template.chargeGroupHtml = chargeGroupHtml;
  template.totalFormatted  = totalFormatted;

  return template.evaluate().getContent();
}

// ── Convert HTML string → PDF blob ──────────────────────────
function convertHtmlToPdf(htmlString, quoteNumber, customerName) {
  const blob = Utilities.newBlob(htmlString, 'text/html', 'temp-quote.html');
  const tempFile = DriveApp.createFile(blob);
  try {
    const pdfBlob = tempFile.getAs('application/pdf');
    pdfBlob.setName(buildPdfFileName(quoteNumber, customerName));
    return pdfBlob;
  } finally {
    tempFile.setTrashed(true);
  }
}

// ── Build PDF filename: "WORQ-STO-2026-15 (Customer Name).pdf" ──
function buildPdfFileName(quoteNumber, customerName) {
  const safeQuote = (quoteNumber || '').replace(/\//g, '-');
  const safeCust  = (customerName || '').replace(/[\\/:*?"<>|]/g, '').trim();
  return safeCust ? safeQuote + ' (' + safeCust + ').pdf' : safeQuote + '.pdf';
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

function chargeTag(ct) {
  if (!ct) return '';
  const isMonthly = ct === 'Monthly';
  const bg    = isMonthly ? '#ddeeff' : '#eeeeee';
  const color = isMonthly ? '#0055aa' : '#444444';
  return '<span style="background:' + bg + '; color:' + color + '; font-size:7pt; '
       + 'font-weight:normal; border-radius:3px; padding:1px 5px; '
       + 'margin-left:6px; white-space:nowrap;">' + escHtml(ct) + '</span>';
}
