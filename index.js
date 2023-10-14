const { spawn } = require('child_process');
const fs = require('fs');
const WebSocket = require('ws');
const https = require('https');
const port = 7000;

const server = https.createServer({
    key: fs.readFileSync('./key.pem'),
    cert: fs.readFileSync('./cert.pem'),
});
const wss = new WebSocket.Server({ server });

// Event handler for when a client connects
wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        let jsonData = JSON.parse(message);
        if (jsonData.code) {
            console.log(`Received: ${jsonData.code}`);
            compileAndRun(jsonData.code, ws);
        }
    });

    // Compile and run the C++ program
    const compileAndRun = (cppCode, ws) => {
        const compileProcess = spawn('g++', ['-o', 'my_program', '-x', 'c++', '-'], { shell: true });

        compileProcess.stdin.write(cppCode);
        compileProcess.stdin.end();

        let compilationError = '';
        compileProcess.stderr.on('data', (data) => {
            console.error(`Compilation Error: ${data.toString()}`);
            compilationError += data.toString() + '\n';
        });

        compileProcess.on('close', (code) => {
            if (code === 0) {
                ws.send(JSON.stringify({ output: 'Code compiled successfuly \n\n', error: '' }));

                const runProcess = spawn('./my_program', { shell: true });

                runProcess.stdout.on('data', (data) => {
                    ws.send(JSON.stringify({ output: data.toString() }));
                });

                runProcess.stderr.on('data', (data) => {
                    ws.send(JSON.stringify({ error: data.toString() }));
                });

                ws.on('message', (message) => {
                    console.log(`Input Received: ${message}`);
                    let jsonData = JSON.parse(message);
                    if (jsonData.input) {
                        runProcess.stdin.write(jsonData.input + '\n');
                    }
                });

                runProcess.on('close', (code) => {
                    ws.send(JSON.stringify({ closed: true, output: `\n\nC++ Program Exited with Code ${code}` }));
                });

            } else {
                ws.send(JSON.stringify({ output: '', error: compilationError }));
                console.error('Compilation Failed');
            }
        });
    };


    // Event handler for when a client disconnects
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

server.listen(7100, () => {
    console.log('WebSocket server is running on https://localhost:7100');
});