const { spawn, execSync } = require('child_process');
var WebSocketServer = require('ws').Server;
const express = require('express');
const cors = require('cors');
const port = process.env.PORT || 7000;
var wss = new WebSocketServer({ port: 7100 });
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

// Create a write stream (in append mode)
const accessLogStream = fs.createWriteStream(path.join(__dirname, 'access.log'), { flags: 'a' });

// Define a custom token for real IP address
morgan.token('real-ip', function (req) {
    return req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        (req.connection.socket ? req.connection.socket.remoteAddress : null);
});

// Event handler for when a client connects
wss.on('connection', (ws, req) => {
    logWebSocketEvent('connected', req);

    ws.on('message', (message) => {
        logWebSocketEvent(`received message: ${message}`, req);
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
                // ws.send(JSON.stringify({ output: 'Code compiled successfuly \n\n', error: '' }));

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
                    ws.send(JSON.stringify({ closed: true, output: `\n\nProcess completed with Code ${code}` }));
                });

            } else {
                ws.send(JSON.stringify({ output: '', error: compilationError }));
                console.error('Compilation Failed');
            }
        });
    };


    // Event handler for when a client disconnects
    ws.on('close', () => {
        logWebSocketEvent('disconnected', req);
        console.log('Client disconnected');
    });
});

// For code formatting
const app = express();
app.use(morgan(':real-ip - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"', { stream: accessLogStream }));

app.use(cors());
app.use(express.json());


app.post('/', (req, res) => {
    console.log(req.body);
    const cppCode = req.body.code;
    res.json({ code: formatCode(cppCode) });
});

app.get('/', (req, res) => {
    res.json({ message: 'Code compiler running' });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

function formatCode(code) {
    try {
        const formattedCode = execSync('clang-format -style=file', { input: code }).toString();
        return formattedCode;
    } catch (error) {
        console.error("Formatting error:", error);
    }
}

// WebSocket logging function
function logWebSocketEvent(event, req) {
    const clientIp = req.headers['x-real-ip'] || 
                     req.headers['x-forwarded-for'] || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress ||
                     (req.connection.socket ? req.connection.socket.remoteAddress : null);
    const log = `${new Date().toISOString()} - ${clientIp} - WebSocket ${event}\n`;
    fs.appendFile(path.join(__dirname, 'websocket-events.log'), log, (err) => {
        if (err) console.error('Error writing to WebSocket log:', err);
    });
}