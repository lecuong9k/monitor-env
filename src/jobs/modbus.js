import ModbusRTU from "modbus-serial";
import db from "../database/sqlite.js";

// Job: watch config row and reinitialize Modbus client when config changes

const POLL_CONFIG_INTERVAL = 2000; // ms
const DEFAULT_POLLING_MS = 1000;
const TIMEOUT = 10 * 1000;

let client = null;
let readIntervals = [];
let currentConfigHash = null;
let currentConfigId = null;

function normalizeParity(p) {
    if (p === null || p === undefined) return "none";
    if (typeof p === "string") return p;
    // numeric mapping if integer stored
    switch (Number(p)) {
        case 1:
            return "even";
        case 2:
            return "odd";
        default:
            return "none";
    }
}

function clearReads() {
    readIntervals.forEach(i => clearInterval(i));
    readIntervals = [];
}

function closeClient() {
    return new Promise(resolve => {
        try {
            if (!client) return resolve();
            try {
                client.close(() => {
                    client = null;
                    resolve();
                });
            } catch (e) {
                // some versions may not support callback close
                try {
                    client.close();
                } catch (er) { }
                client = null;
                resolve();
            }
        } catch (err) {
            client = null;
            resolve();
        }
    });
}

function computeHash(cfg) {
    if (!cfg) return null;
    // consider relevant fields only
    const relevant = {
        id: cfg.id,
        hardware_port: cfg.hardware_port,
        baud_rate: cfg.baud_rate,
        data_bits: cfg.data_bits,
        parity_bits: cfg.parity_bits,
        stop_bits: cfg.stop_bits,
        communication_type: cfg.communication_type,
        ip: cfg.ip,
        port: cfg.port
    };
    return JSON.stringify(relevant);
}

async function loadLatestConfig() {
    return db.prepare(`SELECT * FROM configs ORDER BY id DESC LIMIT 1`).get();
}

async function loadDevices() {
    return db.prepare(`SELECT * FROM modbus_rtu WHERE status = 1`).all();
}

async function startWithConfig(cfg) {
    await closeClient();
    clearReads();

    if (!cfg) {
        console.warn("No config found — waiting for configuration to be added.");
        currentConfigHash = null;
        currentConfigId = null;
        return;
    }

    client = new ModbusRTU();

    const isSerial = !!cfg.hardware_port;
    try {
        if (isSerial) {
            const serialOptions = {
                baudRate: cfg.baud_rate || 9600,
                dataBits: cfg.data_bits || 8,
                parity: normalizeParity(cfg.parity_bits),
                stopBits: cfg.stop_bits || 1
            };
            await client.connectRTUBuffered(cfg.hardware_port, serialOptions);
            console.log(`Connected to serial port ${cfg.hardware_port}`);
        } else {
            // assume Modbus TCP
            await client.connectTCP(cfg.ip || "127.0.0.1", { port: cfg.port || 502 });
            console.log(`Connected to Modbus TCP ${cfg.ip}:${cfg.port}`);
        }

        client.setTimeout(TIMEOUT);

        const devices = await loadDevices();
        devices.forEach(device => {
            let cfgJson = {};
            try { cfgJson = JSON.parse(device.config || "{}"); } catch (e) { }

            const unitId = Number(device.device_id) || Number(cfgJson.device_id) || 1;
            const register = Number(device.register_address) || Number(cfgJson.register_address) || 0;
            const quantity = Number(cfgJson.quantity) || 1;
            const polling = Number(cfgJson.polling_ms) || DEFAULT_POLLING_MS;
            const func = Number(device.function_code) || Number(cfgJson.function_code) || 3; // default readHoldingRegisters

            const interval = setInterval(() => {
                if (!client) return;
                client.setID(unitId);
                if (func === 3) {
                    client.readHoldingRegisters(register, quantity)
                        .then(data => {
                            console.log(`Device ${unitId} registers @${register}:`, data.data || data);
                        })
                        .catch(err => {
                            console.error(`Read error device ${unitId}:`, err.message || err);
                        });
                } else if (func === 4) {
                    client.readInputRegisters(register, quantity)
                        .then(data => console.log(`Device ${unitId} input @${register}:`, data.data || data))
                        .catch(err => console.error(`Read error device ${unitId}:`, err.message || err));
                } else {
                    // other function codes can be added as needed
                }
            }, polling);

            readIntervals.push(interval);
        });

    } catch (err) {
        console.error("Failed to start Modbus client:", err.message || err);
        await closeClient();
        clearReads();
    }
}

// Poll config for changes
async function watcher() {
    try {
        const cfg = await loadLatestConfig();
        const hash = computeHash(cfg);
        if (hash !== currentConfigHash) {
            console.log("Config change detected — reinitializing Modbus client.");
            currentConfigHash = hash;
            currentConfigId = cfg ? cfg.id : null;
            await startWithConfig(cfg);
        }
    } catch (err) {
        console.error("Error while watching config:", err.message || err);
    }
}

// start initial watcher
(async () => {
    await watcher();
    setInterval(watcher, POLL_CONFIG_INTERVAL);
})();