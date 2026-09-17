import { openDB } from "idb";
import api, { errText } from "./api";
import { genUUID, deviceId } from "./utils";

const DB_NAME = "jawad_offline";
const DB_VERSION = 1;

let dbp = null;
const getDB = () => {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("queue")) {
          const s = db.createObjectStore("queue", { keyPath: "local_id" });
          s.createIndex("status", "sync_status");
        }
      },
    });
  }
  return dbp;
};

export const queueOperation = async (op) => {
  const db = await getDB();
  const doc = {
    local_id: genUUID(),
    idempotency_key: genUUID(),
    device_id: deviceId(),
    sync_status: "pending",
    created_at: new Date().toISOString(),
    ...op,
  };
  await db.add("queue", doc);
  return doc;
};

export const getPending = async () => {
  const db = await getDB();
  const all = await db.getAll("queue");
  return all.filter((x) => x.sync_status !== "synced");
};

export const syncNow = async () => {
  const db = await getDB();
  const pending = await getPending();
  let ok = 0, failed = 0;
  for (const op of pending) {
    try {
      const payload = { ...op.payload, idempotency_key: op.idempotency_key, local_id: op.local_id, device_id: op.device_id };
      await api.post(op.endpoint, payload);
      op.sync_status = "synced";
      op.synced_at = new Date().toISOString();
      await db.put("queue", op);
      ok++;
    } catch (e) {
      op.sync_status = "failed";
      op.last_error = errText(e);
      await db.put("queue", op);
      failed++;
    }
  }
  return { ok, failed };
};

export const isOnline = () => navigator.onLine;
