import {
    findAllConfigs,
    findConfigById,
    upsertConfig,
    deleteConfig
} from "../repositorys/config.repository.js";

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

export function saveConfig(key, value) {
    return upsertConfig(key, value);
}

export function removeConfig(key) {
    return deleteConfig(key);
}