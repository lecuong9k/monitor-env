import ModbusRTU from "modbus-serial";
import { checkPhysicalPorts } from "../serialPort.js";
import db from "../../database/sqlite.js";

const workers = new Map();
const TIMEOUT = 3000;
let CONFIG_WATCHER = null;
export async function startModbusWorkers(devices = []) {
    initConfig();
    // for (const device of devices) {
    //     await startDeviceWorker(device);
    // }
}

async function initConfig() {
    const devicesInOS = await checkPhysicalPorts();
    if (devicesInOS.length == 0) {
        console.log("No physical devices found.");
        return;
    }
    const hardwarePorts = devicesInOS.map(d => d.path);
    console.log(hardwarePorts);
    CONFIG_WATCHER = await db.prepare(`
        SELECT  mbrt.id as modbus_rtu_id, mbrt.hardware_port, c.* 
        FROM modbus_rtu mbrt JOIN configs c
        ON mbrt.config_id = c.id
        WHERE mbrt.hardware_port IN (${hardwarePorts.map(() => '?').join(',')})
        `).all(hardwarePorts);
    const existingPorts = CONFIG_WATCHER.map(c => c.hardware_port);
    const missingPorts = hardwarePorts.filter(p => !existingPorts.includes(p));
    console.log('Existing ports in configs:', existingPorts);
    console.log('Missing ports in configs:', missingPorts);
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
        worker.client.close();
    } catch (err) { }
    workers.delete(workerKey);
    console.log(`Worker stopped ${workerKey}`);
}

async function connectClient(worker) {
    const {
        client,
        device
    } = worker;

    const cfg = parseConfig(device.config);
    console.log(
        `Connecting device ${device.data_name}`
    );

    // RTU
    if (cfg.hardware_port) {
        await client.connectRTUBuffered(
            cfg.hardware_port,
            {
                baudRate: cfg.baud_rate || 9600,
                dataBits: cfg.data_bits || 8,
                parity: normalizeParity(cfg.parity_bits),
                stopBits: cfg.stop_bits || 1
            }
        );
        console.log(
            `RTU connected ${cfg.hardware_port}`
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
    const cfg = parseConfig(device.config);
    const unitId =
        Number(device.device_id) || 1;
    const register =
        Number(device.register_address) || 0;
    const quantity =
        Number(cfg.quantity) || 1;
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

    // TODO:
    // save database
    // mqtt publish
    // websocket emit
}

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
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
startModbusWorkers([
    {
        id: 1,
        device_id: 1,
        function_code: 3,
        register_address: 0,
        data_name: "Test Device",
        config: {
            quantity: 3,
            type: "rtu",
            hardware_port: "COM5",
            baud_rate: 9600,
            data_bits: 8,
            parity_bits: "none",
            stop_bits: 1
        }
    }
])