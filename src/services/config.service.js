import {
    findAllConfigs,
    findConfigByKey,
    upsertConfig,
    deleteConfig
} from "../repositories/config.repository.js";

export function getAllConfigs() {
    return findAllConfigs();
}

export function getConfig(key) {
    const config = findConfigByKey(key);
    if (!config) {
        throw new Error("Config not found");
    }
    return config;
}

export function saveConfig(key, value) {
    return upsertConfig(key, value);
}

export function removeConfig(key) {
    return deleteConfig(key);
}