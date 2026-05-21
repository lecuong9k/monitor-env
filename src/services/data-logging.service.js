import {
    findAllDataLogging,
    findDataLoggingById,
    upsertDataLogging,
    deleteDataLogging
} from "../repositorys/data-logging.repository.js";

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

export function saveDataLogging(id, value) {
    return upsertDataLogging(id, value);
}

export function removeDataLogging(id) {
    return deleteDataLogging(id);
}