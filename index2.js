const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const PORT = 9898; // PS4 expects port 9898
const SERVER_IP = '192.168.100.248'; // Your server IP
const PACKAGE_PATH = '/Users/rajabdev/Documents/Developments/testingYarab/NBA.BOUNCE_CUSA50346_v1.00_[12.02]_OPOISSO893.pkg'; // Path to your package file

// Read the package file size
const packageStat = fs.statSync(PACKAGE_PATH);
const packageSize = packageStat.size;

// Function to compute SHA-256 hash of the package
function computeSHA256(filePath) {
  const hash = crypto.createHash('sha256');
  const fileBuffer = fs.readFileSync(filePath);
  hash.update(fileBuffer);
  return hash.digest('hex').toUpperCase();
}

// Calculate hash
const packageHash = computeSHA256(PACKAGE_PATH);

// Encode file path in Base64 for 'b64' parameter
const b64FilePath = Buffer.from(PACKAGE_PATH).toString('base64');

// Server implementation
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  if (pathname.startsWith('/json/')) {
    // Serve JSON metadata
    const taskIdMatch = pathname.match(/\/json\/(.*)\.json/);
    if (!taskIdMatch) {
      res.writeHead(404);
      res.end();
      return;
    }
    const taskId = taskIdMatch[1];

    const jsonResponse = {
      originalFileSize: packageSize,
      packageDigest: packageHash, // SHA-256 hash
      numberOfSplitFiles: 1,
      pieces: [{
        url: `http://${SERVER_IP}:${PORT}/file/?b64=${b64FilePath}`,
        fileOffset: 0,
        fileSize: packageSize,
        hashValue: '0'.repeat(40) // skip verification
      }]
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'OPTIONS, HEAD, GET, PUT, POST, DELETE',
      'Access-Control-Allow-Headers': '*'
    });
    res.end(JSON.stringify(jsonResponse));
  } else if (pathname.startsWith('/file/')) {
    // Handle range requests for file chunks
    const rangeHeader = req.headers['range'];
    if (!rangeHeader) {
      res.writeHead(416);
      res.end();
      return;
    }

    const matches = rangeHeader.match(/bytes=(\d+)-(\d+)/);
    if (!matches) {
      res.writeHead(416);
      res.end();
      return;
    }

    const start = parseInt(matches[1], 10);
    const end = parseInt(matches[2], 10);

    if (start >= packageSize || end >= packageSize || start > end) {
      res.writeHead(416);
      res.end();
      return;
    }

    const stream = fs.createReadStream(PACKAGE_PATH, { start, end });
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': chunkSize,
      'Content-Range': `bytes ${start}-${end}/${packageSize}`,
      'Content-Disposition': 'attachment; filename="app.pkg"',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'OPTIONS, HEAD, GET, PUT, POST, DELETE',
      'Access-Control-Allow-Headers': '*'
    });
    stream.pipe(res);
  } else {
    // Not found
    res.writeHead(404);
    res.end();
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`BGFT server listening on port ${PORT}`);
  console.log(`Serving package at: ${PACKAGE_PATH}`);
  console.log(`SHA-256: ${packageHash}`);
});