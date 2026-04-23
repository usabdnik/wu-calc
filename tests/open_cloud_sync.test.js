const test = require("node:test");
const assert = require("node:assert/strict");

let cloudSync;
try {
  cloudSync = require("../open_cloud_sync.js");
} catch {
  cloudSync = {};
}

test("buildFreestyleSyncRecords sends only freestyle records and trims oversized logs", () => {
  assert.equal(typeof cloudSync.buildFreestyleSyncRecords, "function");

  const records = cloudSync.buildFreestyleSyncRecords({
    open_athletes: [{ id: "ath-1", name: "Ignored Athlete" }],
    open_freestyle_results: [
      {
        id: "fs-1",
        name: "Freestyle Athlete",
        total: 42,
        log: { text: "x".repeat(12000) },
      },
    ],
    open_base_results: [{ id: "base-1", name: "Ignored Base", total: 12 }],
  }, "2026-04-23T09:00:00.000Z");

  assert.equal(records.length, 1);
  assert.equal(records[0].record_type, "freestyle_results");
  assert.equal(records[0].record_key, "fs-1");
  assert.equal(records[0].updated_at, "2026-04-23T09:00:00.000Z");
  assert.equal(records[0].data.id, "fs-1");
  assert.equal(records[0].data.log, undefined);
  assert.equal(records[0].data.log_trimmed, true);
});

test("cloudSourceFromPullRecords decodes only freestyle results into a Source snapshot", () => {
  assert.equal(typeof cloudSync.cloudSourceFromPullRecords, "function");

  const snapshot = cloudSync.cloudSourceFromPullRecords(
    [
      { record_type: "athletes", data: { id: "ath-1", name: "Should stay out" }, deleted: false },
      { record_type: "freestyle_results", data: { id: "fs-1", name: "Freestyle Athlete", total: 41 }, deleted: false },
      { record_type: "base_results", data: { id: "base-1", name: "Should stay out too" }, deleted: false },
      { record_type: "freestyle_results", data: { id: "fs-2", name: "Deleted Freestyle", total: 0 }, deleted: true },
    ],
    "wu-open-transfer-20260423",
  );

  assert.equal(snapshot.source, "cloud:wu-open-transfer-20260423");
  assert.deepEqual(snapshot.open_athletes, []);
  assert.deepEqual(snapshot.open_base_results, []);
  assert.deepEqual(snapshot.open_freestyle_results, [
    { id: "fs-1", name: "Freestyle Athlete", total: 41 },
  ]);
});

test("defaultCloudEventId is stable for a given date", () => {
  assert.equal(typeof cloudSync.defaultCloudEventId, "function");
  assert.equal(
    cloudSync.defaultCloudEventId(new Date("2026-04-23T12:00:00.000Z")),
    "wu-open-transfer-20260423",
  );
});
