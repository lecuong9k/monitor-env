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
    const grouped = groupDevicesByEndpoint(DEVICES);
    console.log("Starting modbus workers for endpoints:", Array.from(grouped.keys()));

    for (const [endpoint, devices] of grouped.entries()) {
        await startEndpointWorker(endpoint, devices);
    }
}

export async function stopAllModbusWorkers() {
    const keys = [...workers.keys()];
    console.log("Stopping all modbus workers...", keys);
    for (const key of keys) {
        await stopWorker(key);
    }
}

function groupDevicesByEndpoint(devices) {
    return devices.reduce((map, device) => {
        const endpoint = getWorkerKey(device);
        if (!endpoint) {
            return map;
        }
        if (!map.has(endpoint)) {
            map.set(endpoint, []);
        }
        map.get(endpoint).push(device);
        return map;
    }, new Map());
}

function getWorkerKey(device) {
    if (device.hardware_port) {
        return `rtu-${device.hardware_port}`;
    }
    if (device.ip) {
        return `tcp-${device.ip}:${device.port || 502}`;
    }
    return null;
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
            FROM modbus_rtu mbrt LEFT JOIN configs c
            ON mbrt.config_id = c.id
            WHERE mbrt.hardware_port IN (${hardwarePorts.map(() => '?').join(',')})
            `).all(hardwarePorts);
    const existingPorts = DEVICES.map(d => d.hardware_port);
    const missingPorts = hardwarePorts.filter(p => !existingPorts.includes(p));
    return DEVICES;
}

async function startEndpointWorker(endpoint, devices) {
    console.log(`Starting worker for endpoint ${endpoint} with ${devices.length} device(s)`);
    if (workers.has(endpoint)) {
        await stopWorker(endpoint);
    }

    const worker = {
        running: true,
        devices,
        client: new ModbusRTU(),
        endpoint
    };
    workers.set(endpoint, worker);

    try {
        await connectClient(worker);
        pollingLoop(worker);
        console.log(`Worker started ${endpoint}`);
    } catch (err) {
        console.error(`Worker start failed ${endpoint}:`, err.message);
        await stopWorker(endpoint);
    }
}

async function stopWorker(workerKey) {
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
        devices
    } = worker;
    const device = devices[0];

    console.log(`Connecting endpoint ${worker.endpoint} for device ${device.data_name}`);

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
        console.log(`RTU connected ${device.hardware_port}`);
    } else {
        await client.connectTCP(
            device.ip,
            {
                port: device.port || 502
            }
        );
        console.log(`TCP connected ${device.ip}:${device.port || 502}`);
    }
    client.setTimeout(TIMEOUT);
}

async function pollingLoop(worker) {
    const {
        client,
        devices
    } = worker;

    while (worker.running) {
        for (const device of devices) {
            if (!worker.running) {
                break;
            }
            try {
                await pollDevice(client, device);
            } catch (err) {
                console.error(`Poll error ${device.data_name}:`, err.message);
                await saveErrorLog(device, err);
                try {
                    await client.close().catch(() => { });
                } catch (e) {
                    // ignore close failures
                }
                if (!worker.running) {
                    break;
                }

                await sleep(500);
                try {
                    await connectClient(worker);
                } catch (reconnectErr) {
                    console.error(`Reconnect failed ${device.data_name}:`, reconnectErr.message);
                    break;
                }
            }
            await sleep(device.interval || 500);
        }
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
        const convertedData = buildConvertData(device.data_name, response.data);
        const dataLog = {
            device_id: device.device_id,
            data_name: device.data_name,
            raw_data: JSON.stringify(response.data),
            recipe: device.recipe ? JSON.stringify(device.recipe) : null,
            convert_data: JSON.stringify(convertedData)
        }
        await sendToServer(response.data);
        await saveDataLogging(dataLog);
    } catch (err) {
        console.error("Failed to save data log:", err && err.message ? err.message : err);
    }
}

async function saveErrorLog(device, err) {
    try {
        const convertedData = buildErrorConvertData(device.data_name, err);
        await saveDataLogging({
            device_id: device.device_id,
            data_name: device.data_name,
            raw_data: `0`,
            recipe: device.recipe ? JSON.stringify(device.recipe) : null,
            convert_data: JSON.stringify(convertedData)
        });
    } catch (saveErr) {
        console.error(`Failed to save error log for ${device.data_name}:`, saveErr && saveErr.message ? saveErr.message : saveErr);
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

function buildConvertData(dataName, dataArray) {
    if (!dataName || !dataArray) {
        return {};
    }
    const names = dataName.split(',').map(name => name.trim()).filter(name => name);
    const result = {};
    for (let i = 0; i < names.length && i < dataArray.length; i++) {
        result[names[i]] = dataArray[i];
    }
    return result;
}

function buildErrorConvertData(dataName, err) {
    const result = {};
    const names = String(dataName || "").split(',').map(name => name.trim()).filter(name => name);
    for (const name of names) {
        result[name] = "";
    }
    result.message = err.message || String(err);
    return result;
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
async function sendToServer(data) {
    try {
        const formData = {
            device_id: "MINI PC",
            machineCode: "Sensor-mini-pc",
            temperature: data[0],
            humidity: data[1],
            version: data[2],
            timestamp: new Date().toISOString()
        }
        const response = await fetch('http://123.25.30.4:20003', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
    } catch (err) {
        console.error('Error sending data to server:', err);
    }
}
