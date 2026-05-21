import {
    findAllConfigs,
    findConfigById,
    upsertConfig,
    deleteConfig
} from "../repositories/config.repository.js";

export function getAllConfigs() {
    return findAllConfigs();
}

export function getConfig(id) {
    const config = findConfigById(id);
    if (!config) {
        throw new Error("Config not found");
    }
    return config;
}

export function saveConfig(record) {
    return upsertConfig(record);
}

export function removeConfig(id) {
    return deleteConfig(id);
}
