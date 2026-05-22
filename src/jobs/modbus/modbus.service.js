import ModbusRTU from "modbus-serial";
import { checkPhysicalPorts } from "../serialPort.js";
import db from "../../database/sqlite.js";
import { saveDataLogging } from "../../services/data-logging.service.js";

const workers = new Map();
const TIMEOUT = 3000;
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function startModbusWorkers(devices = []) {
    await stopAllModbusWorkers();
    const DEVICES = await initConfig();
    for (const device of DEVICES) {
        await startDeviceWorker(device);
    }
}

export async function stopAllModbusWorkers() {
    const keys = [...workers.keys()];
    console.log("Stopping all modbus workers...", keys);
    for (const key of keys) {
        const deviceId = key.replace(/^device-/, "");
        await stopDeviceWorker(deviceId);
    }
}

async function initConfig() {
    const devicesInOS = await checkPhysicalPorts();
    if (devicesInOS.length == 0) {
        console.log("No physical devices found.");
        return [];
    }
    const hardwarePorts = devicesInOS.map(d => d.path);
    console.log(hardwarePorts);
    const DEVICES = await db.prepare(`
        SELECT  mbrt.id as id,
            mbrt.device_id,
            mbrt.function_code,
            mbrt.register_address,
            mbrt.hardware_port,
            mbrt.data_name,
            c.* 
        FROM modbus_rtu mbrt JOIN configs c
        ON mbrt.config_id = c.id
        WHERE mbrt.hardware_port IN (${hardwarePorts.map(() => '?').join(',')})
        `).all(hardwarePorts);
    const existingPorts = DEVICES.map(d => d.hardware_port);
    const missingPorts = hardwarePorts.filter(p => !existingPorts.includes(p));
    // console.log('Existing ports in configs:', existingPorts, DEVICES);
    // console.log('Missing ports in configs:', missingPorts);
    return DEVICES;
}

export async function startDeviceWorker(device) {
    console.log(`Starting worker for device ${device}...`);
    const workerKey = `device-${device.id}`;
    // tránh duplicate
    if (workers.has(workerKey)) {
        await stopDeviceWorker(device.id);
    }
    const worker = {
        running: true,
        device,
        client: new ModbusRTU()
    };
    workers.set(workerKey, worker);
    try {
        await connectClient(worker);
        pollingLoop(worker);
        console.log(`Worker started ${workerKey}`);
    } catch (err) {
        console.error(
            `Worker start failed ${workerKey}:`,
            err.message
        );
        await stopDeviceWorker(device.id);
    }
}

export async function stopDeviceWorker(deviceId) {
    const workerKey = `device-${deviceId}`;
    const worker = workers.get(workerKey);
    if (!worker) {
        return;
    }

    worker.running = false;
    try {
        await worker.client.close().catch(() => { });
    } catch (err) {
        // ignore close failures when port is already closed
    }
    workers.delete(workerKey);
    console.log(`Worker stopped ${workerKey}`);
}

async function connectClient(worker) {
    const {
        client,
        device
    } = worker;

    console.log(
        `Connecting device ${device.data_name}`
    );

    // RTU
    if (device.hardware_port) {
        await client.connectRTUBuffered(
            device.hardware_port,
            {
                baudRate: device.baud_rate || 9600,
                dataBits: device.data_bits || 8,
                parity: normalizeParity(device.parity_bits),
                stopBits: device.stop_bits || 1
            }
        );
        console.log(
            `RTU connected ${device.hardware_port}`
        );
    } else {
        // TCP
        await client.connectTCP(
            cfg.ip,
            {
                port: cfg.port || 502
            }
        );
        console.log(
            `TCP connected ${cfg.ip}:${cfg.port || 502}`
        );
    }
    client.setTimeout(TIMEOUT);
}

async function pollingLoop(worker) {
    const {
        client,
        device
    } = worker;
    while (worker.running) {
        try {
            await pollDevice(client, device);
        } catch (err) {
            console.error(
                `Poll error ${device.data_name}:`,
                err.message
            );
            // reconnect nếu mất kết nối
            try {
                client.close();
            } catch (e) { }
            await sleep(3000);
            try {
                await connectClient(worker);
            } catch (reconnectErr) {
                console.error(
                    `Reconnect failed ${device.data_name}:`,
                    reconnectErr.message
                );
            }
        }
        // polling interval
        await sleep(device.interval || 3000);
    }
}

async function pollDevice(client, device) {
    const unitId =
        Number(device.device_id) || 1;
    const register =
        Number(device.register_address) || 0;
    const quantity =
        Number(device.quantity) || 1;
    const func =
        Number(device.function_code) || 3;
    client.setID(unitId);
    let response;
    switch (func) {
        case 3:
            response =
                await client.readHoldingRegisters(
                    register,
                    quantity
                );
            break;
        case 4:
            response =
                await client.readInputRegisters(
                    register,
                    quantity
                );
            break;
        default:
            console.log(
                `Unsupported function code ${func}`
            );
            return;
    }
    console.log({
        device: device.data_name,
        data: response.data
    });

    try {
        await saveDataLogging({
            device_id: device.device_id,
            data_name: device.data_name,
            raw_data: JSON.stringify(response.data),
            recipe: device.recipe ? JSON.stringify(device.recipe) : null,
            convert_data: JSON.stringify({
                temperature: response.data[0],
                humidity: response.data[1],
                version: response.data[2]
            })
        });
    } catch (err) {
        console.error("Failed to save data log:", err && err.message ? err.message : err);
    }
}

function normalizeParity(parity) {
    switch (parity) {
        case 0:
        case "none":
            return "none";
        case 1:
        case "even":
            return "even";
        case 2:
        case "odd":
            return "odd";
        default:
            return "none";
    }
}

function parseConfig(config) {
    if (!config) {
        return {};
    }
    if (typeof config === "object") {
        return config;
    }
    try {
        return JSON.parse(config);
    } catch (err) {
        console.error(
            "Invalid config JSON:",
            config
        );
        return {};
    }
}
// startModbusWorkers()