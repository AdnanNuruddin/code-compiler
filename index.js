const { spawn } = require('child_process');
const express = require('express');
const WebSocket = require('ws');
const cors = require('cors'); // Import the cors package
const { escape } = require('querystring');
const app = express();
const wss = new WebSocket.Server({ port: 7100 });
const port = 7000;

app.use(cors());
app.use(express.json());

// Event handler for when a client connects
wss.on('connection', (ws) => {
    console.log('Client connected');

    app.post('/', (req, res) => {
        console.log(req.body);
        const cppCode = req.body.code;
        compileAndRun(cppCode, res);
    });

    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });

    // Compile and run the C++ program
    const compileAndRun = (cppCode, res) => {
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
                res.json({ output: 'Code compiled successfuly', error: '' });

                const runProcess = spawn('./my_program', { shell: true });

                runProcess.stdout.on('data', (data) => {
                    ws.send(JSON.stringify({ output: data.toString() }));
                });

                runProcess.stderr.on('data', (data) => {
                    ws.send(JSON.stringify({ error: data.toString() }));
                });

                ws.on('message', (message) => {
                    console.log(`Received: ${message}`);
                    runProcess.stdin.write(message);
                    runProcess.stdin.end();
                });

                runProcess.on('close', (code) => {
                    ws.send(JSON.stringify({ closed: true, output: `C++ Program Exited with Code ${code}` }));
                });

            } else {
                res.json({ output: '', error: compilationError });
                console.error('Compilation Failed');
            }
        });
    };

    // Event handler for messages received from clients
    ws.on('message', (message) => {
        console.log(`Received: ${message}`);

        // Send a response back to the client
        ws.send(`You said: ${message}`);
    });

    // Event handler for when a client disconnects
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

app.get('/', (req, res) => {
    res.json({ message: 'Code compiler running' });
});
