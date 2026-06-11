import {
  findAllRecipes,
  findRecipeById,
  findRecipeByDeviceId,
  upsertRecipe,
} from "../repositories/recipe.repository.js";
import { startModbusWorkers } from "../jobs/modbus/modbus.service.js";

export function getAllRecipes() {
  return findAllRecipes();
}

export function getRecipe(id) {
  const recipe = findRecipeById(id);
  if (!recipe) {
    throw new Error("Recipe not found");
  }
  return recipe;
}

export function getRecipeByDeviceId(deviceId) {
  if (!deviceId) {
    throw new Error("deviceId is required");
  }
  return findRecipeByDeviceId(deviceId) ?? null;
}

export async function saveRecipe(record) {
  const saved = upsertRecipe(record);
  try {
    await startModbusWorkers();
  } catch (err) {
    console.error(
      "Failed to restart modbus workers:",
      err && err.message ? err.message : err,
    );
  }
  return saved;
}
