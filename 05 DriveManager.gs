// ============================================================
// DriveManager.gs — Save PDF to Google Drive folder
// ============================================================

function savePdf(pdfBlob, quoteNumber, customerName, prefix) {
  const folderId = getProp('QUOTATIONS_FOLDER_ID');
  const folder = DriveApp.getFolderById(folderId);

  pdfBlob.setName(buildPdfFileName(quoteNumber, customerName, prefix));

  const file = folder.createFile(pdfBlob);
  // Sharing is inherited from the parent folder — explicit setSharing fails
  // when the executing identity isn't the folder/file owner.

  return { url: file.getUrl(), id: file.getId() };
}

// ── Fetch a saved PDF as base64 + filename ────────────────────
// Lets the web app trigger a real browser download (drag-droppable into
// Gmail) instead of routing the user through Drive → download → attach.
// google.script.run return payloads are capped at ~50MB; quotations are
// well under that, so we don't paginate.
function getPdfBlobAsBase64(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    return {
      success: true,
      filename: file.getName(),
      mimeType: blob.getContentType() || 'application/pdf',
      base64: Utilities.base64Encode(blob.getBytes())
    };
  } catch (e) {
    console.error('getPdfBlobAsBase64 error:', e.message);
    return { success: false, error: e.message };
  }
}
