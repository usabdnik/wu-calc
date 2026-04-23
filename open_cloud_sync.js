(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.WuOpenCloudSync = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CLOUD_API_BASE = "https://api.workoutudm.ru/api/competition";
  const CLOUD_API_KEY = "SggpROWNGUNVTdWFYXmNmBZGzyoJp91E-7c5bEz8zdE";
  const CLOUD_EVENT_ID_KEY = "open_cloud_event_id";
  const CLOUD_DEVICE_ID_KEY = "comp_device_id";
  const MAX_DATA_SIZE_BYTES = 9500;

  function arr(value) {
    return Array.isArray(value) ? value : [];
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function wrapData(data, source) {
    return {
      kind: "wu-open-data",
      version: 1,
      exportedAt: nowIso(),
      source,
      open_athletes: arr(data && data.open_athletes),
      open_freestyle_results: arr(data && data.open_freestyle_results),
      open_base_results: arr(data && data.open_base_results),
    };
  }

  function defaultCloudEventId(date) {
    const value = date instanceof Date ? date : new Date();
    return "wu-open-transfer-" + value.toISOString().slice(0, 10).replace(/-/g, "");
  }

  function normalizeCloudEventId(eventId) {
    const value = String(eventId || "").trim();
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(value)) {
      throw new Error("Код обмена: только латиница, цифры и дефис, до 64 символов");
    }
    return value;
  }

  function getSavedCloudEventId(storage) {
    if (!storage || typeof storage.getItem !== "function") return "";
    return storage.getItem(CLOUD_EVENT_ID_KEY) || "";
  }

  function saveCloudEventId(storage, eventId) {
    const value = normalizeCloudEventId(eventId);
    if (storage && typeof storage.setItem === "function") {
      storage.setItem(CLOUD_EVENT_ID_KEY, value);
    }
    return value;
  }

  function resolveCloudEventId(options) {
    const opts = options || {};
    const storage = opts.storage;
    let eventId = opts.eventId == null ? getSavedCloudEventId(storage) : String(opts.eventId || "").trim();
    if (!eventId && typeof opts.promptFn === "function") {
      const suggested = getSavedCloudEventId(storage) || defaultCloudEventId(opts.date);
      const response = opts.promptFn(
        "Введи код обмена с основного Mac. Этот код потом понадобится для загрузки фристайла на Mac.",
        suggested,
      );
      if (response == null) return null;
      eventId = response;
    }
    if (!eventId) {
      eventId = defaultCloudEventId(opts.date);
    }
    return saveCloudEventId(storage, eventId);
  }

  function fallbackUuid() {
    return "open-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  function getCloudDeviceId(storage, uuidFn) {
    if (storage && typeof storage.getItem === "function") {
      const existing = storage.getItem(CLOUD_DEVICE_ID_KEY);
      if (existing) return existing;
    }
    const makeUuid = uuidFn
      || (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? () => crypto.randomUUID() : fallbackUuid);
    const value = makeUuid();
    if (storage && typeof storage.setItem === "function") {
      storage.setItem(CLOUD_DEVICE_ID_KEY, value);
    }
    return value;
  }

  function jsonSize(obj) {
    return new TextEncoder().encode(JSON.stringify(obj)).length;
  }

  function hashKey(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function recordKey(item, recordType, index) {
    const raw = String((item && item.id) || (item && item.name) || (recordType + "-" + index));
    return raw.length <= 32 ? raw : raw.slice(0, 23) + "-" + hashKey(raw).slice(0, 8);
  }

  function compactFreestyleRecord(item) {
    if (jsonSize(item) <= MAX_DATA_SIZE_BYTES) return item;
    const copy = { ...item };
    delete copy.log;
    copy.log_trimmed = true;
    return copy;
  }

  function buildFreestyleSyncRecords(data, updatedAt) {
    const timestamp = updatedAt || nowIso();
    return arr(data && data.open_freestyle_results).map((item, index) => {
      const compact = compactFreestyleRecord(item || {});
      if (jsonSize(compact) > MAX_DATA_SIZE_BYTES) {
        throw new Error("Запись фристайла слишком большая для облака: " + recordKey(item, "freestyle_results", index));
      }
      return {
        record_type: "freestyle_results",
        record_key: recordKey(item, "freestyle_results", index),
        data: compact,
        updated_at: timestamp,
      };
    });
  }

  function cloudSourceFromPullRecords(records, eventId) {
    return wrapData({
      open_athletes: [],
      open_freestyle_results: arr(records)
        .filter((record) => !record.deleted && record.record_type === "freestyle_results")
        .map((record) => record.data),
      open_base_results: [],
    }, "cloud:" + normalizeCloudEventId(eventId));
  }

  function cloudHeaders() {
    return {
      "Content-Type": "application/json",
      "X-API-Key": CLOUD_API_KEY,
    };
  }

  async function uploadFreestyleSnapshot(options) {
    const opts = options || {};
    const fetchImpl = opts.fetchImpl || fetch;
    const eventId = resolveCloudEventId({
      storage: opts.storage,
      eventId: opts.eventId,
      promptFn: opts.promptFn,
      date: opts.date,
    });
    if (!eventId) {
      return { cancelled: true, eventId: null, records: [] };
    }
    const records = buildFreestyleSyncRecords(opts.data, opts.updatedAt);
    const response = await fetchImpl((opts.apiBase || CLOUD_API_BASE) + "/sync", {
      method: "POST",
      headers: cloudHeaders(),
      body: JSON.stringify({
        event_id: eventId,
        device_id: opts.deviceId || getCloudDeviceId(opts.storage, opts.uuidFn),
        since: null,
        records,
      }),
    });
    if (!response.ok) {
      throw new Error("Сервер ответил " + response.status + ": " + await response.text());
    }
    return {
      cancelled: false,
      eventId,
      records,
      response: await response.json(),
    };
  }

  async function loadCloudFreestyleSource(options) {
    const opts = options || {};
    const fetchImpl = opts.fetchImpl || fetch;
    const eventId = resolveCloudEventId({
      storage: opts.storage,
      eventId: opts.eventId,
      promptFn: opts.promptFn,
      date: opts.date,
    });
    if (!eventId) {
      return { cancelled: true, eventId: null, snapshot: null };
    }
    const response = await fetchImpl(
      (opts.apiBase || CLOUD_API_BASE)
        + "/sync?event_id="
        + encodeURIComponent(eventId)
        + "&since=1970-01-01T00:00:00Z",
      { headers: cloudHeaders() },
    );
    if (!response.ok) {
      throw new Error("Сервер ответил " + response.status + ": " + await response.text());
    }
    const data = await response.json();
    return {
      cancelled: false,
      eventId,
      response: data,
      snapshot: cloudSourceFromPullRecords(data.records, eventId),
    };
  }

  return {
    CLOUD_API_BASE,
    CLOUD_API_KEY,
    CLOUD_DEVICE_ID_KEY,
    CLOUD_EVENT_ID_KEY,
    arr,
    buildFreestyleSyncRecords,
    cloudHeaders,
    cloudSourceFromPullRecords,
    defaultCloudEventId,
    getCloudDeviceId,
    getSavedCloudEventId,
    loadCloudFreestyleSource,
    normalizeCloudEventId,
    recordKey,
    resolveCloudEventId,
    saveCloudEventId,
    uploadFreestyleSnapshot,
    wrapData,
  };
});
