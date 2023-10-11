const { spawn } = require('child_process');
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 7100 });
const port = 7000;


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
                ws.send(JSON.stringify({ output: 'Code compiled successfuly \n', error: '' }));

                const runProcess = spawn('./my_program', { shell: true });

                runProcess.stdout.on('data', (data) => {
                    ws.send(JSON.stringify({ output: data.toString() }));
                });

                runProcess.stderr.on('data', (data) => {
                    ws.send(JSON.stringify({ error: data.toString() }));
                });

                ws.on('message', (message) => {
                    console.log(`Received: ${message}`);
                    let jsonData = JSON.parse(message);
                    if (jsonData.input) {
                        runProcess.stdin.write(jsonData.input);
                        runProcess.stdin.end();
                    }
                });

                runProcess.on('close', (code) => {
                    ws.send(JSON.stringify({ closed: true, output: `C++ Program Exited with Code ${code}` }));
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
