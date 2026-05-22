import {
    findAllDataLogging,
    findDataLoggingById,
    upsertDataLogging,
    deleteDataLogging
} from "../repositories/data-logging.repository.js";

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
    return upsertDataLogging(record);
}

export function removeDataLogging(id) {
    return deleteDataLogging(id);
}
