'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function ensure() {
  ensureDir();
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], sessions: [], partners: [], partnerProspects: [], partnerEvaluations: [], partnerPayments: [], partnerCodeCounters: {}, store: {}, errorLogs: [] }, null, 2));
  }
}

function read() {
  ensure();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  try {
    const data = JSON.parse(raw);
    if (!data.users) data.users = [];
    if (!data.sessions) data.sessions = [];
    if (!data.partners) data.partners = [];
    if (!data.partnerProspects) data.partnerProspects = [];
    if (!data.partnerEvaluations) data.partnerEvaluations = [];
    if (!data.partnerPayments) data.partnerPayments = [];
    if (!data.partnerCodeCounters) data.partnerCodeCounters = {};
    if (!data.store) data.store = {};
    if (!data.errorLogs) data.errorLogs = [];
    return data;
  } catch (e) {
    // corrupt file: back it up rather than silently destroying data
    fs.copyFileSync(DB_FILE, DB_FILE + '.corrupt.' + Date.now());
    const fresh = { users: [], sessions: [], partners: [], partnerProspects: [], partnerEvaluations: [], partnerPayments: [], partnerCodeCounters: {}, store: {}, errorLogs: [] };
    write(fresh);
    return fresh;
  }
}

// Atomic write: write to a temp file in the same directory, then rename over the target.
// Rename is atomic on POSIX filesystems, so a crash mid-write never leaves a truncated db.json.
function write(data) {
  ensureDir();
  const tmp = DB_FILE + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// Very small serialization guard: since Node is single-threaded and every write() call
// above is synchronous (readFileSync/writeFileSync/renameSync), concurrent requests in this
// process cannot interleave a read-modify-write, which is enough for this scale of usage.
let queue = Promise.resolve();
function transact(fn) {
  queue = queue.then(async () => {
    const data = read();
    const result = await fn(data);
    write(data);
    return result;
  });
  return queue;
}

module.exports = { read, write, transact };
