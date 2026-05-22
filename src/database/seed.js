/**
 * Nạp bản ghi mẫu (configs, data_logging, modbus_rtu).
 * Quan hệ: 1 modbus_rtu → 1 config, nhiều data_logging.
 * Chạy: npm run seed
 * Ghi đè: npm run seed -- --force
 */
import db from "./sqlite.js";
import { insertConfig } from "../repositories/config.repository.js";
import { insertDataLogging } from "../repositories/data-logging.repository.js";
import { insertModbusRtu } from "../repositories/modbus-rtu.repository.js";

const FORCE = process.argv.includes("--force");

function tableCount(table) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return row.n;
}

function clearTables() {
  db.exec("DELETE FROM modbus_rtu");
  db.exec("DELETE FROM data_logging");
  db.exec("DELETE FROM configs");
  console.log("Đã xóa dữ liệu cũ (modbus_rtu, data_logging, configs).");
}

const SAMPLE_DEVICES = [
  {
    device_id: "DEV-PM25-01",
    hardware_port: "/dev/ttyUSB0",
    data_name: "PM2.5",
    data_type: "float",
    function_code: "3",
    register_address: 0,
    data_format: 1,
    byte_order: 0,
    unit: "µg/m³",
    status: 1,
    config: {
      hardware_port: "/dev/ttyUSB0",
      communication_type: 0,
      ip: null,
      port: null,
      baud_rate: 9600,
      data_bits: 8,
      parity_bits: 0,
      stop_bits: 1,
    },
    loggings: [
      {
        data_name: "PM2.5",
        raw_data: "12.4",
        recipe: "x * 1.0",
        convert_data: "12.4",
      },
      {
        data_name: "Nhiệt độ",
        raw_data: "26.8",
        recipe: "x * 0.1",
        convert_data: "2.68",
      },
    ],
  },
  {
    device_id: "DEV-PM10-01",
    hardware_port: "/dev/ttyUSB1",
    data_name: "PM10",
    data_type: "float",
    function_code: "3",
    register_address: 2,
    data_format: 1,
    byte_order: 0,
    unit: "µg/m³",
    status: 1,
    config: {
      hardware_port: "/dev/ttyUSB1",
      communication_type: 0,
      ip: null,
      port: null,
      baud_rate: 9600,
      data_bits: 8,
      parity_bits: 0,
      stop_bits: 1,
    },
    loggings: [
      {
        data_name: "PM10",
        raw_data: "28.1",
        recipe: "x * 1.0",
        convert_data: "28.1",
      },
      {
        data_name: "Độ ẩm",
        raw_data: "65",
        recipe: "x",
        convert_data: "65",
      },
    ],
  },
  {
    device_id: "DEV-SO2-01",
    hardware_port: "/dev/ttyUSB2",
    data_name: "SO2",
    data_type: "float",
    function_code: "3",
    register_address: 4,
    data_format: 1,
    byte_order: 1,
    unit: "ppb",
    status: 1,
    config: {
      hardware_port: "/dev/ttyUSB2",
      communication_type: 0,
      ip: null,
      port: null,
      baud_rate: 19200,
      data_bits: 8,
      parity_bits: 0,
      stop_bits: 1,
    },
    loggings: [
      {
        data_name: "SO2",
        raw_data: "5.2",
        recipe: "x * 0.1",
        convert_data: "0.52",
      },
    ],
  },
];

function seed() {
  const existing = tableCount("modbus_rtu");

  if (existing > 0 && !FORCE) {
    console.log(
      `DB đã có ${existing} thiết bị modbus_rtu — bỏ qua seed. Dùng: npm run seed -- --force`,
    );
    return;
  }

  if (existing > 0 && FORCE) {
    clearTables();
  }

  const insertAll = db.transaction(() => {
    for (const sample of SAMPLE_DEVICES) {
      const config = insertConfig(sample.config);
      const modbus = insertModbusRtu({
        device_id: sample.device_id,
        hardware_port: sample.hardware_port,
        data_name: sample.data_name,
        data_type: sample.data_type,
        function_code: sample.function_code,
        register_address: sample.register_address,
        data_format: sample.data_format,
        byte_order: sample.byte_order,
        unit: sample.unit,
        status: sample.status,
        config_id: config.id,
      });

      for (const logging of sample.loggings) {
        insertDataLogging({
          modbus_rtu_id: modbus.id,
          device_id: sample.device_id,
          ...logging,
        });
      }
    }
  });

  insertAll();

  console.log(`Đã thêm ${SAMPLE_DEVICES.length} thiết bị mẫu:`);
  for (const s of SAMPLE_DEVICES) {
    console.log(
      `  - ${s.device_id}: 1 config, ${s.loggings.length} kênh log`,
    );
  }
}

seed();
