// Offline checks of the client code in the benchmark package (benchmark-workspace/, the MbMigrationBench Classic
// app a migration run is measured on). The package only means something if its Classic behaviour is right, and
// the stand click-through is manual, so the order of the Post button is pinned here against stubbed Classic APIs:
// the page's pending edits are saved first, and the flag, the History line and the contract amount follow only
// after that save and the flag write succeed. Zero dependencies (node built-ins). Exits 1 on any failed check.
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIXIN = path.join(HERE, "benchmark-workspace", "packages", "MbMigrationBench", "Schemas",
  "MbDocumentTotalsMixin", "MbDocumentTotalsMixin.js");

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
  }
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

// A one-row store for the document table and the Classic query classes the mixin creates.
function loadMixin(db) {
  let proto;
  const updateQuery = (cfg) => {
    const query = { filters: [], params: {} };
    query.filters.add = (key, filter) => query.filters.push(filter);
    query.setParameterValue = (column, value) => { query.params[column] = value; };
    query.execute = (callback, scope) => {
      const row = db[cfg.rootSchemaName];
      const match = query.filters.every((f) => row[f.column] === f.value);
      if (match) {
        Object.assign(row, query.params);
      }
      callback.call(scope, { success: true, rowsAffected: match ? 1 : 0 });
    };
    return query;
  };
  const sandbox = {
    Ext: {
      define: (name, cfg) => { proto = cfg; },
      create: (className, cfg) => (className === "Terrasoft.UpdateQuery" ? updateQuery(cfg) : {})
    },
    Terrasoft: {
      ComparisonType: { EQUAL: 3 },
      AggregationType: { SUM: 1 },
      DataValueType: { MONEY: 6, BOOLEAN: 12 },
      createColumnFilterWithParameter: (type, column, value) => ({ column, value })
    },
    define: (name, deps, factory) => factory()
  };
  vm.runInNewContext(readFileSync(MIXIN, "utf8"), sandbox, { filename: MIXIN });
  return proto;
}

// A delivery note page whose user changed the amount from 100 (stored) to 300 (on screen) and clicks Post.
// A rejected save (validation, rights, server) never calls back in Classic, which is what `saveSucceeds` models.
function post(saveSucceeds) {
  const db = { MbDeliveryNote: { Id: "d1", MbIsPosted: false, MbAmount: 100 } };
  const mixin = loadMixin(db);
  const page = Object.assign(Object.create(mixin), {
    entitySchemaName: "MbDeliveryNote",
    values: { Id: "d1", MbIsPosted: false, MbAmount: 300, MbNumber: "D-0002", MbContract: { value: "c1" } },
    history: [],
    amounts: [],
    get(key) { return this.values[key]; },
    set(key, value) { this.values[key] = value; },
    dialogs: [],
    showInformationDialog(message) { this.dialogs.push(message); },
    mbWriteLog(message) { this.history.push(message); },
    save(config) {
      if (saveSucceeds) {
        db.MbDeliveryNote.MbAmount = this.values.MbAmount;
        config.callback.call(config.scope, { success: true }, config);
      }
    },
    // The recalculation reads what is stored, as the real ESQ aggregation does.
    mbRecalculateContractAmount() {
      const note = db.MbDeliveryNote;
      this.amounts.push(note.MbIsPosted ? note.MbAmount : 0);
    }
  });
  page.mbPostDocument();
  return { db, page };
}

const edited = post(true);
check("edited amount then Post: the record is posted", edited.db.MbDeliveryNote.MbIsPosted, true);
check("edited amount then Post: the page shows posted", edited.page.values.MbIsPosted, true);
check("edited amount then Post: one History line", edited.page.history, ["Posted document D-0002"]);
check("edited amount then Post: the contract amount uses the edited 300", edited.page.amounts, [300]);

const rejected = post(false);
check("rejected save: the record stays unposted", rejected.db.MbDeliveryNote.MbIsPosted, false);
check("rejected save: the page stays unposted", rejected.page.values.MbIsPosted, false);
check("rejected save: no History line", rejected.page.history, []);
check("rejected save: the contract amount is not recalculated", rejected.page.amounts, []);

console.log(failed ? `${failed} check(s) failed` : "all benchmark package checks passed");
process.exit(failed ? 1 : 0);
