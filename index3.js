const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Configuration
const PC_IP = '192.168.100.248'; // Your server IP
const PS4_IP = '192.168.100.12'; // Your PS4 IP
const CALLBACK_PORT = 9022; // Port for callback server
const NPX_PORT = 8080; // Port where your package is hosted
const PKG_NAME = 'NBA.BOUNCE_CUSA50346_v1.00_[12.02]_OPOISSO893.pkg'; // Package filename
const PKG_URL = `http://${PC_IP}:${NPX_PORT}/${PKG_NAME}`; // URL to access the package
const PAYLOAD_PATH = '/Users/rajabdev/Documents/Developments/testingYarab/payload.bin'; // Path to your payload (not used in current script but included)

// Helper to get file size
function getFileSize(pkgUrl) {
    return new Promise((resolve, reject) => {
        const options = {
            method: 'HEAD',
            hostname: url.parse(pkgUrl).hostname,
            port: url.parse(pkgUrl).port,
            path: url.parse(pkgUrl).path,
        };
        const req = http.request(options, (res) => {
            if (res.headers['content-length']) {
                resolve(parseInt(res.headers['content-length'], 10));
            } else {
                reject('Content-Length header missing');
            }
        });
        req.on('error', reject);
        req.end();
    });
}

// Start callback server
function startCallbackServer() {
    return new Promise((resolve, reject) => {
        const server = net.createServer((socket) => {
            console.log('PS4 connected');
            resolve(socket);
        });
        server.listen(CALLBACK_PORT, '0.0.0.0', () => {
            console.log(`Callback server listening on port ${CALLBACK_PORT}`);
        });
        server.on('error', reject);
    });
}

// Send metadata
function sendMetadata(socket, pkgSize) {
    const contentId = 'HP3768-CUSA50346_00-0000000000000000';
    const bgftType = 'gd';
    const pkgUrl = `http://${PC_IP}:${NPX_PORT}/${PKG_NAME}`;

    const urlData = Buffer.from(pkgUrl, 'utf8');
    const nameData = Buffer.from(PKG_NAME, 'utf8');
    const idData = Buffer.from(contentId, 'utf8');
    const typeData = Buffer.from(bgftType, 'utf8');

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
    packet.writeBigUInt64LE(BigInt(pkgSize), offset); offset += 8;
    packet.writeUInt32LE(0, offset);

    socket.write(packet);
    console.log('Metadata sent');
}

// Stream file from npx server to PS4
function streamFile(socket, pkgUrl, pkgSize) {
    return new Promise((resolve, reject) => {
        http.get(pkgUrl, (res) => {
            res.on('data', (chunk) => {
                socket.write(chunk);
            });
            res.on('end', () => {
                console.log('Stream complete');
                resolve();
            });
        }).on('error', reject);
    });
}

// Main installation flow
async function install() {
    try {
        console.log('Checking file size...');
        const pkgSize = await getFileSize(PKG_URL);
        console.log(`Package size: ${pkgSize} bytes`);

        console.log('Starting callback server...');
        const socket = await startCallbackServer();

        console.log('Sending metadata...');
        sendMetadata(socket, pkgSize);

        console.log('Streaming package...');
        await streamFile(socket, PKG_URL, pkgSize);

        socket.end();
        console.log('Installation complete.');
    } catch (err) {
        console.error('Error:', err);
    }
}

install();