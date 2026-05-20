import {
    findAllSettings,
    findSettingByKey,
    upsertSetting,
    deleteSetting
} from "../repositories/setting.repository.js";

export function getAllSettings() {
    return findAllSettings();
}

export function getSetting(key) {
    const setting = findSettingByKey(key);
    if (!setting) {
        throw new Error("Setting not found");
    }
    return setting;
}

export function saveSetting(key, value) {
    return upsertSetting(key, value);
}

export function removeSetting(key) {
    return deleteSetting(key);
}