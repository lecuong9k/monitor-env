import os from 'os'

export function checkNetworkConnection() {
    const interfaces = os.networkInterfaces();
    let connectionInfo = {
        type: 'Không có kết nối (No Connection)',
        interface: null,
        ip: '127.0.0.1'
    };

    // Danh sách các từ khóa của card mạng ảo cần bỏ qua
    const virtualKeywords = ['lo', 'docker', 'br-', 'veth', 'anycast'];

    for (const interfaceName in interfaces) {
        // Bỏ qua các card mạng ảo nội bộ
        const isVirtual = virtualKeywords.some(keyword => interfaceName.toLowerCase().includes(keyword));
        if (isVirtual) continue;

        const networkAddressList = interfaces[interfaceName];

        for (const network of networkAddressList) {
            // Chỉ lấy IPv4 nội bộ do Router cấp (bỏ qua IPv6 toàn cục và local)
            if (network.family === 'IPv4' && !network.internal) {

                // Thuật toán nhận diện thông minh dựa trên tên card mạng mới và cũ
                let currentType = 'Mạng dây (Ethernet)';

                // Nếu tên chứa chữ 'wl' hoặc 'wifi' -> Chắc chắn là Wi-Fi
                if (interfaceName.toLowerCase().includes('wl') || interfaceName.toLowerCase().includes('wifi')) {
                    currentType = 'Wi-Fi (Không dây)';
                }

                // Độ ưu tiên: Nếu phát hiện mạng dây (en/eth) thì ưu tiên trả về ngay
                if (interfaceName.toLowerCase().startsWith('et') || interfaceName.toLowerCase().startsWith('en')) {
                    return {
                        type: 'Mạng dây (Ethernet)',
                        interface: interfaceName,
                        ip: network.address
                    };
                }

                // Lưu tạm thông tin nếu là mạng khác (như Wi-Fi)
                connectionInfo = {
                    type: currentType,
                    interface: interfaceName,
                    ip: network.address
                };
            }
        }
    }

    return connectionInfo;
}

// ===== CHẠY THỬ HÀM =====
const currentNetwork = checkNetworkConnection();

console.log(`============= THÔNG TIN MẠNG =============`);
console.log(`Kiểu kết nối : ${currentNetwork.type}`);
if (currentNetwork.interface) {
    console.log(`Card mạng    : ${currentNetwork.interface}`);
}
console.log(`Địa chỉ IP   : ${currentNetwork.ip}`);
console.log(`==========================================`);
