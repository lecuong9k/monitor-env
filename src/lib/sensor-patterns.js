/** Pattern tìm kiếm (lowercase) trong data_name / convert_data theo sensor FE. */
export const SENSOR_FIELD_PATTERNS = {
  pm1: ["pm1.0", "pm1"],
  pm25: ["pm2.5", "pm25"],
  pm10: ["pm10"],
  no: ["no"],
  no2: ["no2"],
  so2: ["so2"],
  nox: ["nox"],
  windSpeed: ["tocdogio", "windspeed"],
  windDirection: ["huonggio", "winddirection"],
  temperature: ["temperature", "nhietdo"],
  humidity: ["humidity", "doam"],
};

export const SENSOR_IDS = Object.keys(SENSOR_FIELD_PATTERNS);

export function isValidSensorId(sensor) {
  return typeof sensor === "string" && sensor in SENSOR_FIELD_PATTERNS;
}

/** Điều kiện SQL: row có khả năng chứa giá trị của sensor. */
export function buildSensorMatchSql(sensorId) {
  const patterns = SENSOR_FIELD_PATTERNS[sensorId];
  if (!patterns?.length) {
    return { clause: "1 = 0", params: [] };
  }

  const parts = [];
  const params = [];
  for (const pattern of patterns) {
    const like = `%${pattern}%`;
    parts.push(
      "lower(COALESCE(data_name, '')) LIKE ?",
      "lower(COALESCE(convert_data, '')) LIKE ?",
    );
    params.push(like, like);
  }

  return {
    clause: `(${parts.join(" OR ")})`,
    params,
  };
}
