import ModbusRTU from "modbus-serial";
import db from "../../database/sqlite.js";
import { checkPhysicalPorts } from "../serialPort.js";
// Job: watch config row and reinitialize Modbus client when config changes
const POLL_CONFIG_INTERVAL = 2000; // ms
const DEFAULT_POLLING_MS = 1000;
const TIMEOUT = 10 * 1000;
let CONFIG_WATCHER = null;

let client = null;
let readIntervals = [];
let currentConfigHash = null;
let currentConfigId = null;

async function startWithConfig(cfg) {

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

async function initConfig() {
    const devicesInOS = await checkPhysicalPorts();
    if (devicesInOS.length == 0) {
        console.log("No physical devices found.");
        return;
    }
    const hardwarePorts = devicesInOS.map(d => d.path);
    CONFIG_WATCHER = await db.prepare(`
        SELECT  mbrt.id as modbus_rtu_id, mbrt.hardware_port, c.* 
        FROM modbus_rtu mbrt JOIN configs c
        ON mbrt.config_id = c.id
        WHERE mbrt.hardware_port IN (${hardwarePorts.map(() => '?').join(',')})
        `).all();
    const existingPorts = CONFIG_WATCHER.map(c => c.hardware_port);
    const missingPorts = hardwarePorts.filter(p => !existingPorts.includes(p));
    console.log('Existing ports in configs:', existingPorts);
    console.log('Missing ports in configs:', missingPorts);
}

// Poll config for changes
async function watcher() {
    try {

    } catch (err) {
        console.error("Error while watching config:", err.message || err);
    }
}

// start initial watcher
(async () => {
    await initConfig();

    await watcher();
    setInterval(watcher, POLL_CONFIG_INTERVAL);
})();