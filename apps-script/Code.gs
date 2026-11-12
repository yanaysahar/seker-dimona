/**
 * סקר דימונה — קליטת נקודות סקר לגיליון Google Sheets
 *
 * האפליקציה שולחת כל נקודה לכאן פעם אחת. הסקריפט רק מוסיף שורות חדשות
 * ואף פעם לא משנה או מוחק שורה קיימת — עריכה ומחיקה נעשות רק בגיליון,
 * על ידי בעל הגיליון.
 *
 * התקנה: Extensions → Apps Script, להדביק את הקובץ הזה, לשמור,
 * ואז Deploy → New deployment → Web app
 *   Execute as: Me
 *   Who has access: Anyone
 */

const SHEET_NAME = 'נקודות';
const PHOTO_FOLDER = 'סקר דימונה - תמונות';

const HEADERS = [
  'מזהה ייחודי', 'מספר נקודה', 'סוג ממצא', 'תקופה', 'מצב השתמרות (1-5)', 'מפנה',
  'צפיפות ממצא', 'גודל אתר (מ״ר)', 'תיאור נוף', 'הערות',
  'קו רוחב', 'קו אורך', 'גובה (מ׳)', 'דיוק GPS (מ׳)',
  'סוקר/ת', 'זמן דגימה', 'התקבל בגיליון', 'תמונה', 'מפה'
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const p = JSON.parse(e.postData.contents);
    if (!p || !p.uid || !p.name) return json_({ ok: false, error: 'missing fields' });

    const sheet = getSheet_();

    // Already received? Never overwrite — only the sheet owner edits.
    if (sheet.getLastRow() > 1) {
      const found = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
        .createTextFinder(String(p.uid)).matchEntireCell(true).findNext();
      if (found) return json_({ ok: true, duplicate: true });
    }

    let photo = '';
    if (typeof p.image === 'string' && p.image.indexOf('data:image/jpeg;base64,') === 0) {
      const bytes = Utilities.base64Decode(p.image.split(',')[1]);
      const blob = Utilities.newBlob(bytes, 'image/jpeg', safeName_(p.name) + '_' + String(p.uid).slice(0, 8) + '.jpg');
      photo = getFolder_().createFile(blob).getUrl();
    }

    const lat = Number(p.lat), lng = Number(p.lng);
    sheet.appendRow([
      text_(p.uid), text_(p.name), text_(p.findType), text_(p.period),
      num_(p.preservation), text_(p.aspect), text_(p.density), num_(p.siteSize),
      text_(p.landscape), text_(p.notes),
      isFinite(lat) ? lat : '', isFinite(lng) ? lng : '', num_(p.alt), num_(p.acc),
      text_(p.surveyor), p.createdAt ? new Date(p.createdAt) : text_(p.timeText),
      new Date(), photo,
      isFinite(lat) && isFinite(lng) ? 'https://www.google.com/maps?q=' + lat + ',' + lng : ''
    ]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Lets the app (or you, in a browser) check that the link works.
function doGet() {
  return json_({ ok: true, app: 'seker-dimona' });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setRightToLeft(true);
  }
  return sheet;
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(PHOTO_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER);
}

// Text that starts with = + - @ would be read by Sheets as a formula.
function text_(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function num_(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return isFinite(n) ? n : '';
}

function safeName_(s) {
  return String(s || 'point').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
