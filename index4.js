const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');

class DualRequestInstaller {
    constructor() {
        this.pcIp = "192.168.100.248";
        this.ps4Ip = "192.168.100.12";
        this.callbackPort = 9022;
        this.npxPort = 8080;
        this.callbackConnected = false;
        this.callbackSocket = null;
        this.pkgSize = 0;
        this.pkgName = "";
        this.callbackServer = null;
    }

    async install(pkgName) {
        console.log("🎮 DUAL REQUEST INSTALLER");
        console.log("==================================================");

        this.pkgName = pkgName;
        const pkgUrl = `http://${this.pcIp}:${this.npxPort}/${pkgName}`;

        // Check file size from NPX server
        console.log(`📡 Checking file on npx server: ${pkgUrl}`);
        try {
            this.pkgSize = await this.getFileSize(pkgUrl);
            console.log(`✅ Found package: ${pkgName}`);
            console.log(`💾 Size: ${this.pkgSize} bytes (${(this.pkgSize / (1024 * 1024)).toFixed(2)} MB)`);
        } catch (e) {
            console.error(`❌ Cannot access npx server: ${e.message}`);
            console.error(`   Make sure npx http-server is running on port ${this.npxPort}`);
            return;
        }

        // Start callback server
        console.log(`📡 Starting callback server on port ${this.callbackPort}...`);
        this.startCallbackServer();

        // Patch payload
        const payload = await this.patchPayload();
        if (!payload) return;

        // Send payload to PS4
        console.log("📤 Sending payload to PS4...");
        const sent = await this.sendPayload(payload);
        if (!sent) return;

        // Wait for PS4 to connect back
        console.log("⏳ Waiting for PS4 to connect back...");
        const connected = await this.waitForCallback(30);
        if (!connected) {
            console.log("❌ PS4 did not connect back in time");
            return;
        }

        // Send metadata
        this.sendMetadata();

        // Stream file from NPX to PS4
        await this.streamFileFromNpx(pkgUrl);
        console.log("✅ Installation completed!");
    }

    getFileSize(url) {
        return new Promise((resolve, reject) => {
            const options = {
                method: 'HEAD'
            };
            const req = http.request(url, options, (res) => {
                const length = res.headers['content-length'];
                if (length) {
                    resolve(parseInt(length));
                } else {
                    reject(new Error('Content-Length header not found'));
                }
            });
            req.on('error', reject);
            req.end();
        });
    }

    startCallbackServer() {
        this.callbackServer = net.createServer((socket) => {
            this.callbackConnected = true;
            this.callbackSocket = socket;
            console.log(`✅ PS4 connected from ${socket.remoteAddress}`);
        });
        this.callbackServer.listen(this.callbackPort, () => {
            console.log(`Callback server listening on port ${this.callbackPort}`);
        });
        this.callbackServer.on('error', (err) => {
            console.error(`❌ Callback server error: ${err.message}`);
        });
    }

    waitForCallback(timeoutSeconds) {
        return new Promise((resolve) => {
            let elapsed = 0;
            const interval = setInterval(() => {
                if (this.callbackConnected) {
                    clearInterval(interval);
                    resolve(true);
                } else {
                    elapsed++;
                    if (elapsed >= timeoutSeconds) {
                        clearInterval(interval);
                        resolve(false);
                    }
                }
            }, 1000);
        });
    }

    sendMetadata() {
        if (!this.callbackSocket) {
            console.error("❌ No callback socket");
            return;
        }
        try {
            const contentId = "ED1633-PKGI13337_00-0000000000000000";
            const bgftType = "gd";
            const pkgUrl = `http://${this.pcIp}:${this.npxPort}/${this.pkgName}`;

            const urlData = Buffer.from(pkgUrl, 'utf-8');
            const nameData = Buffer.from(this.pkgName, 'utf-8');
            const idData = Buffer.from(contentId, 'utf-8');
            const typeData = Buffer.from(bgftType, 'utf-8');

            const packet = Buffer.alloc(4 + 4 + urlData.length + 4 + nameData.length + 4 + idData.length + 4 + typeData.length + 8 + 4);
            let offset = 0;

            packet.writeUInt32LE(1, offset); offset += 4;
            packet.writeUInt32LE(urlData.length, offset); offset += 4;
            urlData.copy(packet, offset); offset += urlData.length;
            packet.writeUInt32LE(nameData.length, offset); offset += 4;
            nameData.copy(packet, offset); offset += nameData.length;
            packet.writeUInt32LE(idData.length, offset); offset += 4;
            idData.copy(packet, offset); offset += idData.length;
            packet.writeUInt32LE(typeData.length, offset); offset += 4;
            typeData.copy(packet, offset); offset += typeData.length;
            // 8 bytes for pkgSize
            packet.writeBigUInt64LE(BigInt(this.pkgSize), offset); offset += 8;
            // 4 bytes zero
            packet.writeUInt32LE(0, offset);

            this.callbackSocket.write(packet);
            console.log("✅ Metadata sent");
        } catch (err) {
            console.error(`❌ Metadata error: ${err.message}`);
        }
    }

   async streamFileFromNpx(pkgUrl) {
    if (!this.callbackSocket) {
        console.error("❌ No callback socket for streaming");
        return;
    }
    console.log(`📥 Downloading from: ${pkgUrl}`);
    return new Promise((resolve, reject) => {
        http.get(pkgUrl, (res) => {
            const chunkSize = 256 * 1024; // 256KB
            let sentBytes = 0;
            let lastReport = 0;
            let socketAlive = true;

            // Handle socket close/error events
            this.callbackSocket.on('close', () => {
                console.log('❌ Callback socket closed');
                socketAlive = false;
            });
            this.callbackSocket.on('error', (err) => {
                console.error(`❌ Callback socket error: ${err.message}`);
                socketAlive = false;
            });

            res.on('data', (chunk) => {
                if (!socketAlive) {
                    console.log('🛑 Socket is closed, stopping stream.');
                    res.destroy();
                    resolve();
                    return;
                }
                try {
                    this.callbackSocket.write(chunk);
                    sentBytes += chunk.length;
                    if (sentBytes - lastReport >= 5 * 1024 * 1024) {
                        const progress = (sentBytes / this.pkgSize) * 100;
                        console.log(`📊 ${progress.toFixed(1)}% (${sentBytes}/${this.pkgSize} bytes)`);
                        lastReport = sentBytes;
                    }
                } catch (err) {
                    console.error(`📭 Error during write: ${err.message}`);
                    res.destroy();
                    try { this.callbackSocket.destroy(); } catch(e) {}
                    resolve();
                }
            });

            res.on('end', () => {
                if (sentBytes === this.pkgSize) {
                    console.log(`✅ Transfer complete: ${sentBytes} bytes (100%)`);
                } else {
                    console.log(`⚠️ Transfer incomplete: ${sentBytes}/${this.pkgSize} bytes`);
                }
                if (this.callbackSocket) {
                    try { this.callbackSocket.end(); } catch(e) {}
                }
                resolve();
            });

            res.on('error', (err) => {
                console.error(`❌ Stream error: ${err.message}`);
                if (this.callbackSocket) {
                    try { this.callbackSocket.destroy(); } catch(e) {}
                }
                resolve();
            });
        }).on('error', (err) => {
            console.error(`❌ HTTP request error: ${err.message}`);
            if (this.callbackSocket) {
                try { this.callbackSocket.destroy(); } catch(e) {}
            }
            resolve();
        });
    });
}

    async patchPayload() {
        const payloadPath = path.resolve('/Users/rajabdev/Documents/Developments/testingYarab/payload.bin');
        if (!fs.existsSync(payloadPath)) {
            console.error(`❌ Payload not found: ${payloadPath}`);
            return null;
        }
        try {
            const payloadData = fs.readFileSync(payloadPath);
            const placeholder = Buffer.from([0xB4, 0xB4, 0xB4, 0xB4, 0xB4, 0xB4]);
            const offset = payloadData.indexOf(placeholder);
            if (offset === -1) {
                console.error("❌ Placeholder not found in payload");
                return null;
            }

            const ipBytes = Buffer.from(this.pcIp.split('.').map(Number));
            const portBytes = Buffer.alloc(2);
            portBytes.writeUInt16BE(this.callbackPort, 0);

            // Update payload
            ipBytes.copy(payloadData, offset);
            portBytes.copy(payloadData, offset + 4);

            console.log(`✅ Payload patched: ${this.pcIp}:${this.callbackPort}`);
            return payloadData;
        } catch (err) {
            console.error(`❌ Patch error: ${err.message}`);
            return null;
        }
    }

    sendPayload(payload) {
        return new Promise((resolve) => {
            const socket = net.createConnection({ host: this.ps4Ip, port: 9090 }, () => {
                socket.write(payload, () => {
                    socket.end();
                    console.log("✅ Payload sent");
                    resolve(true);
                });
            });
            socket.on('error', (err) => {
                console.error(`❌ Send error: ${err.message}`);
                resolve(false);
            });
        });
    }
}

// Usage example:
(async () => {
    const installer = new DualRequestInstaller();
    const pkgName = process.argv[2] || "FPKGi_v1.00.0-release.pkg";
    await installer.install(pkgName);
})();