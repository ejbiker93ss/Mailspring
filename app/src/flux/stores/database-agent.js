const Sqlite3 = require('better-sqlite3');
const dbs = {};

const deathDelay = 5000;
let deathTimer = setTimeout(() => process.exit(0), deathDelay);

function getDatabase(dbpath) {
  if (dbs[dbpath]) {
    return Promise.resolve(dbs[dbpath]);
  }

  try {
    dbs[dbpath] = new Sqlite3(dbpath, { readonly: true, timeout: 10000 });
  } catch (err) {
    return Promise.reject(err);
  }

  return Promise.resolve(dbs[dbpath]);
}

process.on('message', async (m) => {
  clearTimeout(deathTimer);
  const { query, values, id, dbpath } = m;
  const start = Date.now();

  try {
    const db = await getDatabase(dbpath);
    clearTimeout(deathTimer);
    const fn = query.startsWith('SELECT') ? 'all' : 'run';
    const stmt = db.prepare(query);
    const results = stmt[fn](values);
    process.send({ type: 'results', results, id, agentTime: Date.now() - start });
  } catch (err) {
    process.send({
      type: 'error',
      error: err && err.stack ? err.stack : String(err),
      id,
      agentTime: Date.now() - start,
    });
  } finally {
    clearTimeout(deathTimer);
    deathTimer = setTimeout(() => process.exit(0), deathDelay);
  }
});
