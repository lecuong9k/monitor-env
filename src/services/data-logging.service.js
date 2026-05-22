import {
    findAllDataLogging,
    findDataLoggingById,
    upsertDataLogging,
    deleteDataLogging
} from "../repositories/data-logging.repository.js";
import { broadcastDataLoggingUpdate } from "../realtime/readings-hub.js";

export function getAllDataLogging() {
    return findAllDataLogging();
}

export function getDataLogging(id) {
    const dataLogging = findDataLoggingById(id);
    if (!dataLogging) {
        throw new Error("Data logging not found");
    }
    return dataLogging;
}

export function saveDataLogging(record) {
    const saved = upsertDataLogging(record);
    broadcastDataLoggingUpdate(saved);
    return saved;
}

export function removeDataLogging(id) {
    return deleteDataLogging(id);
}
