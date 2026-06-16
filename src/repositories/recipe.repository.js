import db from "../database/sqlite.js";

const COLUMNS = ["name", "formula", "float", "device_id"];

export function findAllRecipes() {
  return db
    .prepare(
      `
        SELECT *
        FROM recipe
        ORDER BY id DESC
    `,
    )
    .all();
}

export function findRecipeById(id) {
  return db
    .prepare(
      `
        SELECT *
        FROM recipe
        WHERE id = ?
    `,
    )
    .get(id);
}

export function findRecipeByDeviceId(deviceId) {
  return db
    .prepare(
      `
        SELECT *
        FROM recipe
        WHERE device_id = ?
        ORDER BY id DESC
        LIMIT 1
    `,
    )
    .get(deviceId);
}

export function insertRecipe(record) {
  const placeholders = COLUMNS.map(() => "?").join(", ");
  const values = COLUMNS.map((col) => record[col] ?? null);

  const result = db
    .prepare(
      `
        INSERT INTO recipe (${COLUMNS.join(", ")}, updated_at)
        VALUES (${placeholders}, CURRENT_TIMESTAMP)
    `,
    )
    .run(...values);

  return findRecipeById(result.lastInsertRowid);
}

export function updateRecipe(id, record) {
  const assignments = COLUMNS.map((col) => `${col} = ?`).join(", ");
  const values = [...COLUMNS.map((col) => record[col] ?? null), id];

  db.prepare(
    `
        UPDATE recipe
        SET ${assignments},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
  ).run(...values);

  return findRecipeById(id);
}

export function upsertRecipe(data) {
  const { id, ...payload } = data;
  if (id) {
    return updateRecipe(id, payload);
  }
  return insertRecipe(payload);
}
