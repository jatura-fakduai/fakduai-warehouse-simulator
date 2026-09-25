/**
 * Fakduai Lab — Central Google Sheets adapter
 * Deploy this script once from the Master Sheet.
 * It can read/write the Master and copies owned by the same Google account.
 */
const CONFIG = Object.freeze({
  API_KEY: "693d5190eac0e1e3e18cb2ec7e88b36047ae",
  INVENTORY_SHEET: "Inventory",
  TRANSACTIONS_SHEET: "Transactions",
  TRANSACTION_HEADERS: [
    "Operation ID", "Timestamp", "Type", "Location", "SKU", "Quantity",
    "Balance", "Status", "Started At", "Completed At", "Message", "Source", "Worker"
  ]
});

function doGet(e) {
  try {
    authorize_(e.parameter.key);
    const action = e.parameter.action || "read";
    if (action === "read") return output_(readInventory_(e.parameter.sheetId), e.parameter.callback);
    if (action === "jobs") return output_(readJobs_(e.parameter.sheetId), e.parameter.callback);
    if (action === "claim") return output_(claimNextJob_(e.parameter), e.parameter.callback);
    if (action === "complete") return output_(completeJob_(e.parameter), e.parameter.callback);
    if (action === "fail") return output_(failJob_(e.parameter), e.parameter.callback);
    throw new Error("GET action ไม่ถูกต้อง");
  } catch (error) {
    return output_({ ok: false, error: error.message }, e && e.parameter && e.parameter.callback);
  }
}

function doPost(e) {
  try {
    authorize_(e.parameter.key);
    if (e.parameter.action === "update") return output_(updateStock_(e.parameter));
    if (e.parameter.action === "color") return output_(updateColor_(e.parameter));
    if (e.parameter.action === "enqueue") return output_(enqueueJob_(e.parameter));
    if (e.parameter.action === "complete") return output_(completeJob_(e.parameter));
    if (e.parameter.action === "fail") return output_(failJob_(e.parameter));
    throw new Error("action ไม่ถูกต้อง");
  } catch (error) {
    return output_({ ok: false, error: error.message });
  }
}

function testMasterSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("กรุณารันฟังก์ชันนี้จาก Master Google Sheet");
  ensureStructure_(spreadsheet);
  return `พร้อมใช้งาน: ${spreadsheet.getName()}`;
}

function readInventory_(sheetId) {
  const spreadsheet = openAuthorizedSpreadsheet_(sheetId);
  ensureStructure_(spreadsheet);
  const sheet = spreadsheet.getSheetByName(CONFIG.INVENTORY_SHEET);
  const values = sheet.getDataRange().getDisplayValues();
  const indexes = headerIndexes_(values[0]);
  const items = values.slice(1).filter(row => row[indexes.code] || row[indexes.sku]).map(row => ({
    code: row[indexes.code],
    sku: row[indexes.sku],
    name: row[indexes.name],
    category: row[indexes.category],
    stock: Number(row[indexes.stock]),
    capacity: Number(row[indexes.capacity]),
    color: row[indexes.color]
  }));
  return { ok: true, spreadsheetId: spreadsheet.getId(), sheetName: sheet.getName(), items: items };
}

function readJobs_(sheetId) {
  const spreadsheet = openAuthorizedSpreadsheet_(sheetId);
  ensureStructure_(spreadsheet);
  const sheet = spreadsheet.getSheetByName(CONFIG.TRANSACTIONS_SHEET);
  const values = sheet.getDataRange().getValues();
  const indexes = transactionIndexes_(values[0]);
  const jobs = values.slice(1)
    .filter(row => row[indexes.operationId])
    .map(row => transactionFromRow_(row, indexes))
    .filter(job => job.status === "PENDING" || job.status === "RUNNING");
  return { ok: true, spreadsheetId: spreadsheet.getId(), jobs: jobs };
}

function enqueueJob_(params) {
  const type = normalizeJobType_(params.type);
  const quantity = Math.floor(Number(params.quantity || params.qty));
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity ต้องมากกว่า 0");

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const spreadsheet = openAuthorizedSpreadsheet_(params.sheetId);
    ensureStructure_(spreadsheet);
    const inventory = spreadsheet.getSheetByName(CONFIG.INVENTORY_SHEET);
    const transactions = spreadsheet.getSheetByName(CONFIG.TRANSACTIONS_SHEET);
    const inventoryValues = inventory.getDataRange().getValues();
    const inventoryIndexes = headerIndexes_(inventoryValues[0]);
    const code = String(params.code || params.location || "").trim();
    const sku = String(params.sku || "").trim();
    const inventoryRowIndex = findInventoryRow_(inventoryValues, inventoryIndexes, code, sku);
    const item = inventoryValues[inventoryRowIndex];
    const resolvedCode = String(item[inventoryIndexes.code]).trim();
    const resolvedSku = String(item[inventoryIndexes.sku]).trim();
    const current = Number(item[inventoryIndexes.stock]) || 0;
    const capacity = Number(item[inventoryIndexes.capacity]) || Number.MAX_SAFE_INTEGER;
    const operationId = String(params.operationId || Utilities.getUuid()).trim();

    const transactionValues = transactions.getDataRange().getValues();
    const transactionIndexes = transactionIndexes_(transactionValues[0]);
    const existingRow = transactionValues.find((row, index) => index > 0 && String(row[transactionIndexes.operationId]).trim() === operationId);
    if (existingRow) return { ok: true, duplicate: true, job: transactionFromRow_(existingRow, transactionIndexes) };

    let reservedIn = 0;
    let reservedOut = 0;
    transactionValues.slice(1).forEach(row => {
      const job = transactionFromRow_(row, transactionIndexes);
      if ((job.status !== "PENDING" && job.status !== "RUNNING") || job.sku !== resolvedSku) return;
      if (job.type === "IN") reservedIn += job.quantity;
      if (job.type === "OUT") reservedOut += job.quantity;
    });
    if (type === "OUT" && quantity > current - reservedOut) throw new Error(`Stock ${resolvedSku} ไม่พอสำหรับงานนี้`);
    if (type === "IN" && current + reservedIn + quantity > capacity) throw new Error(`Capacity ${resolvedSku} ไม่พอสำหรับงานนี้`);

    const job = {
      operationId: operationId,
      createdAt: new Date(),
      type: type,
      location: resolvedCode,
      sku: resolvedSku,
      quantity: quantity,
      balance: "",
      status: "PENDING",
      startedAt: "",
      completedAt: "",
      message: "Waiting for AGV",
      source: String(params.source || "N8N_CHAT").trim(),
      worker: ""
    };
    appendTransaction_(transactions, job);
    SpreadsheetApp.flush();
    return { ok: true, job: serializableJob_(job) };
  } finally {
    lock.releaseLock();
  }
}

function claimNextJob_(params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const spreadsheet = openAuthorizedSpreadsheet_(params.sheetId);
    ensureStructure_(spreadsheet);
    const sheet = spreadsheet.getSheetByName(CONFIG.TRANSACTIONS_SHEET);
    const values = sheet.getDataRange().getValues();
    const indexes = transactionIndexes_(values[0]);
    const requestedOperationId = String(params.operationId || "").trim();
    const worker = String(params.worker || "WAREHOUSE_SIMULATOR").trim();

    // A claim may reach Sheets even if the JSONP response is lost. Resume the
    // same worker's RUNNING job before claiming another row so jobs stay serial.
    if (!requestedOperationId) {
      const runningRowIndex = values.findIndex((row, index) => index > 0
        && String(row[indexes.status]).trim().toUpperCase() === "RUNNING"
        && String(row[indexes.worker] || "").trim() === worker);
      if (runningRowIndex > 0) {
        return { ok: true, resumed: true, job: transactionFromRow_(values[runningRowIndex], indexes) };
      }
    }

    let rowIndex = values.findIndex((row, index) => index > 0
      && String(row[indexes.status]).trim().toUpperCase() === "PENDING"
      && (!requestedOperationId || String(row[indexes.operationId]).trim() === requestedOperationId));
    if (rowIndex < 1 && !requestedOperationId) {
      const staleBefore = Date.now() - (2 * 60 * 1000);
      rowIndex = values.findIndex((row, index) => index > 0
        && String(row[indexes.status]).trim().toUpperCase() === "RUNNING"
        && row[indexes.startedAt] instanceof Date
        && row[indexes.startedAt].getTime() < staleBefore);
    }
    if (rowIndex < 1) return { ok: true, job: null };

    const startedAt = new Date();
    sheet.getRange(rowIndex + 1, indexes.status + 1).setValue("RUNNING");
    sheet.getRange(rowIndex + 1, indexes.startedAt + 1).setValue(startedAt);
    sheet.getRange(rowIndex + 1, indexes.worker + 1).setValue(worker);
    sheet.getRange(rowIndex + 1, indexes.message + 1).setValue("AGV is running");
    SpreadsheetApp.flush();
    values[rowIndex][indexes.status] = "RUNNING";
    values[rowIndex][indexes.startedAt] = startedAt;
    values[rowIndex][indexes.worker] = worker;
    values[rowIndex][indexes.message] = "AGV is running";
    return { ok: true, job: transactionFromRow_(values[rowIndex], indexes) };
  } finally {
    lock.releaseLock();
  }
}

function completeJob_(params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const spreadsheet = openAuthorizedSpreadsheet_(params.sheetId);
    ensureStructure_(spreadsheet);
    const inventory = spreadsheet.getSheetByName(CONFIG.INVENTORY_SHEET);
    const transactions = spreadsheet.getSheetByName(CONFIG.TRANSACTIONS_SHEET);
    const transactionValues = transactions.getDataRange().getValues();
    const transactionIndexes = transactionIndexes_(transactionValues[0]);
    const operationId = String(params.operationId || "").trim();
    const transactionRowIndex = transactionValues.findIndex((row, index) => index > 0 && String(row[transactionIndexes.operationId]).trim() === operationId);
    if (transactionRowIndex < 1) throw new Error("ไม่พบ Operation ID");
    const job = transactionFromRow_(transactionValues[transactionRowIndex], transactionIndexes);
    if (job.status === "COMPLETED") return { ok: true, duplicate: true, job: job };
    if (job.status !== "RUNNING" && job.status !== "PENDING") throw new Error(`งานอยู่ในสถานะ ${job.status}`);

    const inventoryValues = inventory.getDataRange().getValues();
    const inventoryIndexes = headerIndexes_(inventoryValues[0]);
    const inventoryRowIndex = findInventoryRow_(inventoryValues, inventoryIndexes, job.location, job.sku);
    const current = Number(inventoryValues[inventoryRowIndex][inventoryIndexes.stock]) || 0;
    const capacity = Number(inventoryValues[inventoryRowIndex][inventoryIndexes.capacity]) || Number.MAX_SAFE_INTEGER;
    const delta = job.type === "IN" ? job.quantity : -job.quantity;
    const balance = current + delta;
    if (balance < 0 || balance > capacity) {
      setTransactionFields_(transactions, transactionRowIndex + 1, transactionIndexes, {
        status: "FAILED", completedAt: new Date(), message: balance < 0 ? "Insufficient stock" : "Insufficient capacity"
      });
      SpreadsheetApp.flush();
      throw new Error(balance < 0 ? "Stock ไม่พอ" : "Capacity ไม่พอ");
    }

    inventory.getRange(inventoryRowIndex + 1, inventoryIndexes.stock + 1).setValue(balance);
    const completedAt = new Date();
    setTransactionFields_(transactions, transactionRowIndex + 1, transactionIndexes, {
      status: "COMPLETED", completedAt: completedAt, balance: balance, message: "AGV completed"
    });
    SpreadsheetApp.flush();
    job.status = "COMPLETED";
    job.completedAt = completedAt;
    job.balance = balance;
    job.message = "AGV completed";
    return { ok: true, balance: balance, job: serializableJob_(job) };
  } finally {
    lock.releaseLock();
  }
}

function failJob_(params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const spreadsheet = openAuthorizedSpreadsheet_(params.sheetId);
    ensureStructure_(spreadsheet);
    const sheet = spreadsheet.getSheetByName(CONFIG.TRANSACTIONS_SHEET);
    const values = sheet.getDataRange().getValues();
    const indexes = transactionIndexes_(values[0]);
    const operationId = String(params.operationId || "").trim();
    const rowIndex = values.findIndex((row, index) => index > 0 && String(row[indexes.operationId]).trim() === operationId);
    if (rowIndex < 1) throw new Error("ไม่พบ Operation ID");
    setTransactionFields_(sheet, rowIndex + 1, indexes, {
      status: "FAILED", completedAt: new Date(), message: String(params.message || "Simulator cannot process this job")
    });
    SpreadsheetApp.flush();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function updateStock_(params) {
  const delta = Number(params.delta);
  if (!Number.isFinite(delta) || delta === 0) throw new Error("จำนวนรับเข้า/จ่ายออกไม่ถูกต้อง");
  const operationId = String(params.operationId || "").trim();
  if (!operationId) throw new Error("ไม่พบ Operation ID");

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const spreadsheet = openAuthorizedSpreadsheet_(params.sheetId);
    ensureStructure_(spreadsheet);
    const inventory = spreadsheet.getSheetByName(CONFIG.INVENTORY_SHEET);
    const transactions = spreadsheet.getSheetByName(CONFIG.TRANSACTIONS_SHEET);
    const existing = transactions.getRange(1, 1, Math.max(1, transactions.getLastRow()), 1).createTextFinder(operationId).matchEntireCell(true).findNext();
    if (existing) return { ok: true, duplicate: true };

    const values = inventory.getDataRange().getValues();
    const indexes = headerIndexes_(values[0]);
    const code = String(params.code || "").trim();
    const sku = String(params.sku || "").trim();
    const rowIndex = findInventoryRow_(values, indexes, code, sku);
    const current = Number(values[rowIndex][indexes.stock]) || 0;
    const capacity = Number(values[rowIndex][indexes.capacity]) || Number.MAX_SAFE_INTEGER;
    const balance = Math.max(0, Math.min(capacity, current + delta));
    const actual = balance - current;
    inventory.getRange(rowIndex + 1, indexes.stock + 1).setValue(balance);
    appendTransaction_(transactions, {
      operationId: operationId,
      createdAt: new Date(),
      type: actual > 0 ? "IN" : "OUT",
      location: String(values[rowIndex][indexes.code]).trim(),
      sku: String(values[rowIndex][indexes.sku]).trim(),
      quantity: Math.abs(actual),
      balance: balance,
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
      message: "Manual simulator operation",
      source: "SIMULATOR_MANUAL",
      worker: "WAREHOUSE_SIMULATOR"
    });
    SpreadsheetApp.flush();
    return { ok: true, balance: balance, actual: actual };
  } finally {
    lock.releaseLock();
  }
}

function updateColor_(params) {
  const color = String(params.color || "").trim();
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("รหัสสีไม่ถูกต้อง");
  const spreadsheet = openAuthorizedSpreadsheet_(params.sheetId);
  ensureStructure_(spreadsheet);
  const inventory = spreadsheet.getSheetByName(CONFIG.INVENTORY_SHEET);
  const values = inventory.getDataRange().getValues();
  const indexes = headerIndexes_(values[0]);
  const rowIndex = findInventoryRow_(values, indexes, String(params.code || "").trim(), String(params.sku || "").trim());
  inventory.getRange(rowIndex + 1, indexes.color + 1).setValue(color);
  SpreadsheetApp.flush();
  return { ok: true, color: color };
}

function openAuthorizedSpreadsheet_(sheetId) {
  const id = String(sheetId || "").trim();
  if (!/^[a-zA-Z0-9-_]{20,}$/.test(id)) throw new Error("Google Sheet ID ไม่ถูกต้อง");
  const file = DriveApp.getFileById(id);
  const owner = file.getOwner();
  const effectiveUser = Session.getEffectiveUser().getEmail();
  if (owner && effectiveUser && owner.getEmail() !== effectiveUser) {
    throw new Error("Sheet นี้ไม่ได้เป็นของบัญชีที่ Deploy ระบบกลาง");
  }
  return SpreadsheetApp.openById(id);
}

function ensureStructure_(spreadsheet) {
  const inventory = spreadsheet.getSheetByName(CONFIG.INVENTORY_SHEET);
  if (!inventory || inventory.getLastRow() < 2) throw new Error("ไม่พบข้อมูลในชีต Inventory");
  if (!spreadsheet.getSheetByName(CONFIG.TRANSACTIONS_SHEET)) {
    const transactions = spreadsheet.insertSheet(CONFIG.TRANSACTIONS_SHEET);
    transactions.appendRow(CONFIG.TRANSACTION_HEADERS);
    transactions.setFrozenRows(1);
  }
  ensureTransactionsStructure_(spreadsheet.getSheetByName(CONFIG.TRANSACTIONS_SHEET));
}

function ensureTransactionsStructure_(sheet) {
  if (sheet.getLastRow() === 0) sheet.appendRow(CONFIG.TRANSACTION_HEADERS);
  let headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  const normalized = headers.map(normalizeHeader_);
  const createdAtIndex = normalized.indexOf("createdat");
  if (createdAtIndex >= 0 && normalized.indexOf("timestamp") < 0) {
    sheet.getRange(1, createdAtIndex + 1).setValue("Timestamp");
  }
  headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  const existing = headers.map(normalizeHeader_);
  CONFIG.TRANSACTION_HEADERS.forEach(header => {
    if (existing.indexOf(normalizeHeader_(header)) < 0) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      existing.push(normalizeHeader_(header));
    }
  });
  const finalHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const indexes = transactionIndexes_(finalHeaders);
  if (sheet.getLastRow() > 1) {
    const rowCount = sheet.getLastRow() - 1;
    const transactionValues = sheet.getRange(2, 1, rowCount, sheet.getLastColumn()).getValues();
    const statusRange = sheet.getRange(2, indexes.status + 1, rowCount, 1);
    const balanceRange = sheet.getRange(2, indexes.balance + 1, rowCount, 1);
    const statusValues = statusRange.getValues();
    const balanceValues = balanceRange.getValues();
    let statusChanged = false;
    let balanceChanged = false;
    transactionValues.forEach((row, rowIndex) => {
      const status = String(row[indexes.status] || "").trim().toUpperCase();
      const source = String(row[indexes.source] || "").trim().toUpperCase();
      const message = String(row[indexes.message] || "").trim().toLowerCase();
      const hasStarted = Boolean(row[indexes.startedAt]);
      const hasCompleted = Boolean(row[indexes.completedAt]);
      const waitingForAgv = source === "N8N_CHAT" && message === "waiting for agv" && !hasStarted && !hasCompleted;

      // Recover rows appended by n8n that were temporarily blank and migrated
      // to COMPLETED before the AGV had a chance to claim them.
      if (waitingForAgv && (status === "" || status === "COMPLETED")) {
        statusValues[rowIndex][0] = "PENDING";
        statusChanged = true;
        if (balanceValues[rowIndex][0] === 0) {
          balanceValues[rowIndex][0] = "";
          balanceChanged = true;
        }
      } else if (!status) {
        statusValues[rowIndex][0] = "COMPLETED";
        statusChanged = true;
      }
    });
    if (statusChanged) statusRange.setValues(statusValues);
    if (balanceChanged) balanceRange.setValues(balanceValues);
  }
  sheet.setFrozenRows(1);
}

function appendTransaction_(sheet, job) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const indexes = transactionIndexes_(headers);
  const row = new Array(headers.length).fill("");
  Object.keys(job).forEach(key => { if (indexes[key] !== undefined) row[indexes[key]] = job[key]; });
  sheet.appendRow(row);
}

function setTransactionFields_(sheet, rowNumber, indexes, fields) {
  Object.keys(fields).forEach(key => {
    if (indexes[key] !== undefined) sheet.getRange(rowNumber, indexes[key] + 1).setValue(fields[key]);
  });
}

function transactionIndexes_(headers) {
  const normalized = headers.map(normalizeHeader_);
  const required = {
    operationId: "operationid", createdAt: "timestamp", type: "type", location: "location",
    sku: "sku", quantity: "quantity", balance: "balance", status: "status",
    startedAt: "startedat", completedAt: "completedat", message: "message", source: "source", worker: "worker"
  };
  const indexes = {};
  Object.keys(required).forEach(key => {
    indexes[key] = normalized.indexOf(required[key]);
    if (indexes[key] < 0) throw new Error(`ไม่พบคอลัมน์ ${required[key]} ใน Transactions`);
  });
  return indexes;
}

function transactionFromRow_(row, indexes) {
  return serializableJob_({
    operationId: String(row[indexes.operationId] || "").trim(),
    createdAt: row[indexes.createdAt],
    type: normalizeJobType_(row[indexes.type]),
    location: String(row[indexes.location] || "").trim(),
    sku: String(row[indexes.sku] || "").trim(),
    quantity: Math.abs(Number(row[indexes.quantity]) || 0),
    balance: row[indexes.balance] === "" ? "" : Number(row[indexes.balance]),
    status: String(row[indexes.status] || "COMPLETED").trim().toUpperCase(),
    startedAt: row[indexes.startedAt],
    completedAt: row[indexes.completedAt],
    message: String(row[indexes.message] || ""),
    source: String(row[indexes.source] || ""),
    worker: String(row[indexes.worker] || "")
  });
}

function serializableJob_(job) {
  const copy = Object.assign({}, job);
  ["createdAt", "startedAt", "completedAt"].forEach(key => {
    if (copy[key] instanceof Date) copy[key] = copy[key].toISOString();
  });
  return copy;
}

function normalizeJobType_(value) {
  const type = String(value || "").trim().toUpperCase();
  if (type === "IN" || type === "RECEIVE" || type === "INBOUND") return "IN";
  if (type === "OUT" || type === "PICK" || type === "OUTBOUND") return "OUT";
  throw new Error("Type ต้องเป็น IN/RECEIVE หรือ OUT/PICK");
}

function normalizeHeader_(value) {
  return String(value || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function findInventoryRow_(values, indexes, code, sku) {
  const rowIndex = values.findIndex((row, index) => index > 0 && (
    String(row[indexes.code]).trim() === code || String(row[indexes.sku]).trim() === sku
  ));
  if (rowIndex < 1) throw new Error(`ไม่พบสินค้า ${sku || code}`);
  return rowIndex;
}

function headerIndexes_(headers) {
  const normalized = headers.map(normalizeHeader_);
  const required = { code: "location", sku: "sku", name: "name", category: "category", stock: "stock", capacity: "capacity", color: "color" };
  const indexes = {};
  Object.keys(required).forEach(key => {
    indexes[key] = normalized.indexOf(required[key]);
    if (indexes[key] < 0) throw new Error(`ไม่พบคอลัมน์ ${required[key]}`);
  });
  return indexes;
}

function authorize_(key) {
  if (String(key || "") !== CONFIG.API_KEY) throw new Error("Connection Key ไม่ถูกต้อง");
}

function output_(payload, callback) {
  const json = JSON.stringify(payload);
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback)) {
    return ContentService.createTextOutput(`${callback}(${json});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
