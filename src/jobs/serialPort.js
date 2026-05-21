import { SerialPort } from 'serialport';
export async function checkPhysicalPorts() {
    try {
        const ports = await SerialPort.list();

        console.log(`============= CỔNG PHẦN CỨNG (${ports.length}) =============`);
        if (ports.length === 0) {
            console.log("❌ Không phát hiện thiết bị nào cắm vào cổng USB/Serial.");
            return [];
        }

        ports.forEach((port, index) => {
            console.log(`${index + 1}. Cổng kết nối: ${port.path}`);
            if (port.manufacturer) console.log(`   Nhà sản xuất: ${port.manufacturer}`);
            if (port.pnpId) console.log(`   PnP ID      : ${port.pnpId}`);
            console.log('------------------------------------------');
        });

        return ports;
    } catch (error) {
        console.error("Lỗi khi quét cổng phần cứng:", error);
    }
}
// Chạy thử hàm
checkPhysicalPorts();