const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const WebSocketServer = require('ws').Server;
var wss = new WebSocketServer({ port: 7100 });

const port = process.env.PORT || 7000;

// Create a write stream (in append mode)
const accessLogStream = fs.createWriteStream(path.join(__dirname, 'logs/access.log'), { flags: 'a' });

// Define a custom token for real IP address
morgan.token('real-ip', function (req) {
    return req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        (req.connection.socket ? req.connection.socket.remoteAddress : null);
});

// Event handler for when a client connects
wss.on('connection', (ws, req) => {
    ws.id = getCurrentDateTime()+'_'+uuidv4().substr(0, 8);
    console.log(ws.id);
    logWebSocketEvent('connected', req);

    ws.on('message', (message) => {
        logWebSocketEvent(`received message: ${message}`, req);
        try {
            let jsonData = JSON.parse(message);
            if (jsonData.code) {
                console.log(`Received: ${jsonData.code}`);
                compileAndRun(jsonData.code);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
            ws.send(JSON.stringify({ error: 'Invalid JSON' }));
        }

    });

    // Compile and run the C++ program
    const compileAndRun = (cppCode) => {
        const compileProcess = spawn('g++', ['-o', 'outputs/' + ws.id, '-x', 'c++', '-'], { shell: true });

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

                const runProcess = spawn('outputs/' + ws.id, { shell: true });

                runProcess.stdout.on('data', (data) => {
                    ws.send(JSON.stringify({ output: data.toString() }));
                });

                runProcess.stderr.on('data', (data) => {
                    ws.send(JSON.stringify({ error: data.toString() }));
                });

                ws.on('message', (message) => {
                    console.log(`Input Received: ${message}`);
                    try {
                        let jsonData = JSON.parse(message);
                        if (jsonData.input) {
                            runProcess.stdin.write(jsonData.input + '\n');
                        }
                    } catch (error) {
                        console.error('Error parsing input:', error);
                        wss.send
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

//Format code with post data 
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
    fs.appendFile(path.join(__dirname, 'logs/websocket-events.log'), log, (err) => {
        if (err) console.error('Error writing to WebSocket log:', err);
    });
}

function getCurrentDateTime(){
    return new Date().toJSON().slice(0, 19).replace('T', '_');
}