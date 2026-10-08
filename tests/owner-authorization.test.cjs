const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../google-apps-script/Code.gs'), 'utf8');
const sheetId = 'workshop_sheet_1234567890';

function adapter(ownerEmail, effectiveEmail, options = {}) {
  const opened = [];
  const context = vm.createContext({
    DriveApp: { getFileById: () => {
      if (options.inaccessible) throw new Error('Drive access denied');
      return { getOwner: () => ownerEmail === null ? null : { getEmail: () => ownerEmail } };
    } },
    Session: { getEffectiveUser: () => ({ getEmail: () => effectiveEmail }) },
    SpreadsheetApp: { openById: id => { opened.push(id); return { id }; } }
  });
  vm.runInContext(source, context);
  return { open: id => context.openAuthorizedSpreadsheet_(id), opened };
}

test('deployer can still open their own Sheets', () => {
  const api = adapter('deployer@example.com', 'deployer@example.com');
  assert.equal(api.open(sheetId).id, sheetId);
});

test('additional owner is allowed with normalized email', () => {
  const api = adapter(' LOUISZZICO@gmail.com ', 'deployer@example.com');
  assert.equal(api.open(sheetId).id, sheetId);
});

test('unlisted owners and missing identities cannot open Sheets', () => {
  for (const [owner, deployer] of [
    ['other@example.com', 'deployer@example.com'],
    [null, 'deployer@example.com'],
    ['', 'deployer@example.com'],
    ['louiszzico@gmail.com', '']
  ]) {
    const api = adapter(owner, deployer);
    assert.throws(() => api.open(sheetId), /ไม่ได้รับอนุญาต|ตรวจสอบเจ้าของ/);
    assert.deepEqual(api.opened, []);
  }
});

test('allowing an owner does not bypass Google Drive access', () => {
  const api = adapter('louiszzico@gmail.com', 'deployer@example.com', { inaccessible: true });
  assert.throws(() => api.open(sheetId), /Drive access denied/);
  assert.deepEqual(api.opened, []);
});

test('invalid Sheet IDs are rejected', () => {
  const api = adapter('louiszzico@gmail.com', 'deployer@example.com');
  assert.throws(() => api.open('bad/id'), /Google Sheet ID/);
  assert.deepEqual(api.opened, []);
});
