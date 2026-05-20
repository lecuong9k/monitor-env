import ModbusRTU from "modbus-serial"
const client = new ModbusRTU()


const serialConfig = {
    port: 'COM5',
    baudRate: 9600,   // 9600 Baud
    dataBits: 8,      // 8 Data bits
    parity: 'none',   // None Parity
    stopBits: 1,      // 1 Stop Bit,
};

const device = {
    id: 1,
    quantity: 3 // Số lượng
}
const TIMEOUT = 10 * 1000

client.connectRTUBuffered(serialConfig.port, serialConfig).then(() => {
    console.log(`Kết nối thành công cổng ${serialConfig.port}!`);

    client.setID(device.id);
    client.setTimeout(TIMEOUT);

    setInterval(() => {
        client.readHoldingRegisters(0, device.quantity)
            .then(data => {
                console.log("Giá trị nhận được:", data);
            })
            .catch(err => {
                console.error("Lỗi đọc dữ liệu:", err.message);
            });
    }, 1000);
})
    .catch(err => {
        console.error("Không thể mở cổng COM5:", err.message);
    });