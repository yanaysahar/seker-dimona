/**
 * סקר דימונה — קליטת נקודות סקר לגיליון Google Sheets
 *
 * האפליקציה שולחת לכאן כל נקודה. סוקר יכול לעדכן או למחוק נקודה ששלח רק
 * במשך שעתיים מרגע שהיא התקבלה בגיליון (לפי השעון של הגיליון). אחרי זה
 * השורה נעולה לאפליקציה — עריכה ומחיקה רק בגיליון, על ידי בעל הגיליון.
 *
 * התקנה: Extensions → Apps Script, להדביק את הקובץ הזה, לשמור,
 * ואז Deploy → New deployment → Web app
 *   Execute as: Me
 *   Who has access: Anyone
 */

const SHEET_NAME = 'נקודות';
const PHOTO_FOLDER = 'סקר דימונה - תמונות';
const EDIT_WINDOW_HOURS = 2;
const SCRIPT_VERSION = 4; // shown when the web-app link is opened in a browser

const HEADERS = [
  'מזהה ייחודי', 'מספר נקודה', 'סוג ממצא', 'תקופה', 'מצב השתמרות (1-5)', 'מפנה',
  'צפיפות ממצא', 'גודל אתר (מ״ר)', 'תיאור נוף', 'הערות',
  'X (רשת ישראל החדשה)', 'Y (רשת ישראל החדשה)', 'גובה (מ׳)', 'דיוק GPS (מ׳)',
  'סוקר/ת', 'זמן דגימה', 'התקבל בגיליון', 'תמונה', 'מפה', 'עודכן מהאפליקציה', 'שרטוט מבנה (WKT, רשת ישראל)'
];
const COL_RECEIVED = 17, COL_PHOTO = 18;

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const p = JSON.parse(e.postData.contents);
    if (!p || !p.uid || !p.name) return json_({ ok: false, error: 'missing fields' });

    const sheet = getSheet_();
    const found = sheet.getLastRow() > 1
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(String(p.uid)).matchEntireCell(true).findNext()
      : null;

    if (!found) {
      if (p.delete) return json_({ ok: true, deleted: true }); // not in the sheet (already removed)
      sheet.appendRow(rowValues_(p, savePhoto_(p), new Date(), ''));
      return json_({ ok: true });
    }

    // Point already in the sheet
    if (!p.update && !p.delete) return json_({ ok: true, duplicate: true });
    const rowNum = found.getRow();
    const received = sheet.getRange(rowNum, COL_RECEIVED).getValue();
    const age = received instanceof Date ? Date.now() - received.getTime() : Infinity;
    if (age > EDIT_WINDOW_HOURS * 3600 * 1000) {
      return json_({ ok: false, locked: true, error: 'עברו ' + EDIT_WINDOW_HOURS + ' שעות מהשליחה — הנקודה נעולה' });
    }
    if (p.delete) {
      trashPhoto_(sheet.getRange(rowNum, COL_PHOTO).getValue());
      sheet.deleteRow(rowNum);
      return json_({ ok: true, deleted: true });
    }
    let photo = sheet.getRange(rowNum, COL_PHOTO).getValue();
    if (p.removeImage || p.image) { trashPhoto_(photo); photo = ''; }
    if (p.image) photo = savePhoto_(p);
    sheet.getRange(rowNum, 1, 1, HEADERS.length).setValues([rowValues_(p, photo, received, new Date())]);
    return json_({ ok: true, updated: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function rowValues_(p, photo, received, updated) {
  const lat = Number(p.lat), lng = Number(p.lng);
  // Older app versions sent only lat/lng; their X/Y cells stay empty
  return [
    text_(p.uid), text_(p.name), text_(p.findType), text_(p.period),
    num_(p.preservation), text_(p.aspect), text_(p.density), num_(p.siteSize),
    text_(p.landscape), text_(p.notes),
    num_(p.x), num_(p.y), num_(p.alt), num_(p.acc),
    text_(p.surveyor), p.createdAt ? new Date(p.createdAt) : text_(p.timeText),
    received, photo,
    isFinite(lat) && isFinite(lng) ? 'https://www.google.com/maps?q=' + lat.toFixed(6) + ',' + lng.toFixed(6) : '',
    updated, text_(p.structure)
  ];
}

function savePhoto_(p) {
  if (typeof p.image !== 'string' || p.image.indexOf('data:image/jpeg;base64,') !== 0) return '';
  const bytes = Utilities.base64Decode(p.image.split(',')[1]);
  const blob = Utilities.newBlob(bytes, 'image/jpeg', safeName_(p.name) + '_' + String(p.uid).slice(0, 8) + '.jpg');
  return getFolder_().createFile(blob).getUrl();
}

function trashPhoto_(url) {
  const m = String(url || '').match(/[-\w]{25,}/);
  if (!m) return;
  try { DriveApp.getFileById(m[0]).setTrashed(true); } catch (e) {}
}

// Opening the web-app link in a browser checks that it works, shows which
// version is running, and brings the sheet's header row up to date.
function doGet() {
  getSheet_();
  return json_({ ok: true, app: 'seker-dimona', version: SCRIPT_VERSION });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.setRightToLeft(true);
  }
  // keep the header row up to date when the script is updated
  const head = sheet.getRange(1, 1, 1, HEADERS.length);
  if (head.getValues()[0].join('|') !== HEADERS.join('|')) head.setValues([HEADERS]);
  head.setFontWeight('bold');
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
