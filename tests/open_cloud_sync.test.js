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

test("uploadFreestyleSnapshot creates today's cloud event before syncing", async () => {
  assert.equal(typeof cloudSync.uploadFreestyleSnapshot, "function");

  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (url.endsWith("/events")) {
      return {
        ok: true,
        json: async () => ({
          id: calls.at(-1).body.id,
          name: calls.at(-1).body.name,
          date: calls.at(-1).body.date,
          created_at: "2026-04-24T10:00:00+00:00",
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        pushed: { accepted: 1, rejected: 0, conflicts: [] },
        pulled: { records: [], count: 0 },
        server_time: "2026-04-24T10:00:01+00:00",
      }),
    };
  };

  const result = await cloudSync.uploadFreestyleSnapshot({
    data: { open_freestyle_results: [{ id: "fs-1", name: "Athlete", total: 42 }] },
    date: new Date("2026-04-24T12:00:00.000Z"),
    storage: new MapStorage(),
    fetchImpl,
    uuidFn: () => "device-1",
  });

  assert.equal(result.eventId, "wu-open-transfer-20260424");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, cloudSync.CLOUD_API_BASE + "/events");
  assert.equal(calls[0].body.id, "wu-open-transfer-20260424");
  assert.equal(calls[0].body.name, "WU Open Transfer 2026-04-24");
  assert.equal(calls[0].body.date, "2026-04-24");
  assert.equal(calls[1].url, cloudSync.CLOUD_API_BASE + "/sync");
  assert.equal(calls[1].body.event_id, "wu-open-transfer-20260424");
  assert.equal(result.response.pushed.accepted, 1);
});

class MapStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) || null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}
