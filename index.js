const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');

class DualRequestInstaller {
  constructor() {
    this.pcIp = '192.168.100.248';
    this.ps4Ip = '192.168.100.12';
    this.callbackPort = 9022;
    this.npxPort = 8081;
    this.callbackSocket = null;
    this.callbackConnected = false;
    this.pkgSize = 0;
    this.pkgName = '';
  }

  async install(pkgName) {
    console.log('🎮 DUAL REQUEST INSTALLER');
    console.log('='.repeat(50));

    this.pkgName = pkgName;

    // Construct the URL dynamically based on the filename
    const pkgUrl = `http://${this.pcIp}:${this.npxPort}/${encodeURIComponent(pkgName)}`;
    console.log(`Using package URL: ${pkgUrl}`);

    // Verify file size
    try {
      this.pkgSize = await this.getFileSize(pkgUrl);
      console.log(`✅ Found package: ${pkgName}`);
      console.log(`💾 Size: ${this.pkgSize} bytes (${(this.pkgSize / (1024 * 1024)).toFixed(2)} MB)`);
    } catch (e) {
      console.log(`❌ Cannot access npx server: ${e.message}`);
      return;
    }

    // Start callback server
    console.log(`📡 Starting callback server on port ${this.callbackPort}...`);
    this.startCallbackServer();

    // Patch payload
    const payload = this.patchPayload();
    if (!payload) return;

    // Send payload to PS4
    const success = await this.sendPayload(payload);
    if (!success) return;

    // Wait for PS4 connection
    console.log('⏳ Waiting for PS4 to connect back...');
    const connected = await this.waitForCallback(30);
    if (!connected) {
      console.log('❌ PS4 did not connect back in time');
      return;
    }

    // Send metadata
    this.sendMetadata();

    // Stream file from npx server to PS4
    await this.streamFileFromNpx(pkgUrl);

    console.log('✅ Installation completed!');
  }

  getFileSize(url) {
    return new Promise((resolve, reject) => {
      const req = http.request(url, { method: 'HEAD' }, (res) => {
        const size = parseInt(res.headers['content-length'] || '0', 10);
        if (size > 0) resolve(size);
        else reject(new Error('File size is 0 or unknown'));
      });
      req.on('error', reject);
      req.end();
    });
  }

  startCallbackServer() {
    const server = net.createServer((socket) => {
      this.callbackSocket = socket;
      this.callbackConnected = true;
      console.log(`✅ PS4 connected from ${socket.remoteAddress}`);
    });

    server.on('error', (err) => {
      console.log(`❌ Callback server error: ${err.message}`);
    });

    server.listen(this.callbackPort, () => {
      console.log(`Listening on port ${this.callbackPort}`);
    });
  }

  waitForCallback(timeoutSeconds) {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (this.callbackConnected) {
          clearInterval(interval);
          resolve(true);
        }
      }, 1000);
      setTimeout(() => {
        clearInterval(interval);
        resolve(false);
      }, timeoutSeconds * 1000);
    });
  }

  sendMetadata() {
    if (!this.callbackSocket) {
      console.log('❌ No callback socket');
      return;
    }
"CONTENT_ID"	"HP3768-CUSA50346_00-0000000000000000"

    const contentId = 'ED1633-PKGI13337_00-0000000000000000';
    const bgftType = 'AC';

    const pkgUrl = `http://${this.pcIp}:${this.npxPort}/${encodeURIComponent(this.pkgName)}`;

    const urlData = Buffer.from(pkgUrl, 'utf8');
    const nameData = Buffer.from(this.pkgName, 'utf8');
    const idData = Buffer.from(contentId, 'utf8');
    const typeData = Buffer.from(bgftType, 'utf8');

    const packet = Buffer.alloc(
      4 + 4 + urlData.length + 4 + nameData.length + 4 + idData.length + 4 + typeData.length + 8 + 4
    );
    let offset = 0;

    // Helper to write and advance offset
    function writeUInt32(val) {
      packet.writeUInt32LE(val, offset);
      offset += 4;
    }
    function writeUInt64(val) {
      const bigVal = BigInt(val);
      packet.writeUInt32LE(Number(bigVal & 0xFFFFFFFFn), offset);
      offset += 4;
      packet.writeUInt32LE(Number(bigVal >> 32n), offset);
      offset += 4;
    }

    writeUInt32(1); // type
    writeUInt32(urlData.length);
    urlData.copy(packet, offset);
    offset += urlData.length;

    writeUInt32(nameData.length);
    nameData.copy(packet, offset);
    offset += nameData.length;

    writeUInt32(idData.length);
    idData.copy(packet, offset);
    offset += idData.length;

    writeUInt32(typeData.length);
    typeData.copy(packet, offset);
    offset += typeData.length;

    // Write pkgSize as 64-bit little endian
    writeUInt64(this.pkgSize);

    // Final 0
    writeUInt32(0);

    // Send
    this.callbackSocket.write(packet);
    console.log('✅ Metadata sent');
  }

  streamFileFromNpx(pkgUrl) {
    return new Promise((resolve, reject) => {
      http.get(pkgUrl, (res) => {
        let sentBytes = 0;
        let lastReport = 0;

        res.on('data', (chunk) => {
          if (this.callbackSocket) {
            try {
              this.callbackSocket.write(chunk);
              sentBytes += chunk.length;

              if (sentBytes - lastReport >= 5 * 1024 * 1024) {
                const progress = (sentBytes / this.pkgSize) * 100;
                console.log(`📊 ${progress.toFixed(1)}% (${sentBytes}/${this.pkgSize} bytes)`);
                lastReport = sentBytes;
              }
            } catch (e) {
              console.log(`📭 PS4 disconnected at ${sentBytes}/${this.pkgSize} bytes`);
              res.destroy();
            }
          }
        });
        res.on('end', () => {
          if (sentBytes === this.pkgSize) {
            console.log(`✅ Transfer complete: ${sentBytes} bytes`);
          } else {
            console.log(`⚠️ Transfer incomplete: ${sentBytes}/${this.pkgSize} bytes`);
          }
          if (this.callbackSocket) {
            this.callbackSocket.end();
          }
          resolve();
        });
        res.on('error', (err) => {
          console.log(`❌ Stream error: ${err.message}`);
          if (this.callbackSocket) {
            this.callbackSocket.destroy();
          }
          resolve();
        });
      });
    });
  }

  patchPayload() {
    const payloadPath = path.join(__dirname, 'payload.bin');
    if (!fs.existsSync(payloadPath)) {
      console.log(`❌ Payload not found: ${payloadPath}`);
      return null;
    }

    try {
      const payloadData = fs.readFileSync(payloadPath);
      const placeholder = Buffer.from([0xB4, 0xB4, 0xB4, 0xB4, 0xB4, 0xB4]);
      const offset = payloadData.indexOf(placeholder);

      if (offset === -1) {
        console.log('❌ Placeholder not found in payload');
        return null;
      }

      const ipBytes = Buffer.from(this.pcIp.split('.').map(Number));
      const portBytes = Buffer.alloc(2);
      portBytes.writeUInt16BE(this.callbackPort, 0);

      // Patch IP
      ipBytes.copy(payloadData, offset);
      // Patch port
      portBytes.copy(payloadData, offset + 4);

      console.log(`✅ Payload patched: ${this.pcIp}:${this.callbackPort}`);
      return payloadData;
    } catch (e) {
      console.log(`❌ Patch error: ${e.message}`);
      return null;
    }
  }

  sendPayload(payload) {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: this.ps4Ip, port: 9090 }, () => {
        socket.write(payload, () => {
          socket.end();
          console.log('✅ Payload sent');
          resolve(true);
        });
      });
      socket.on('error', (err) => {
        console.log(`❌ Send error: ${err.message}`);
        resolve(false);
      });
    });
  }
}

// Usage
(async () => {
  const installer = new DualRequestInstaller();
  const pkgName = process.argv[2] || 'NBA.BOUNCE_CUSA50346_v1.00_[12.02]_OPOISSO893.pkg';
  await installer.install(pkgName);
})();