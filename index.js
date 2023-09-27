const { spawn } = require('child_process');
const express = require('express');
const app = express();
const port = 3000;

app.use(express.json());

app.post('/', (req, res) => {
    console.log(req.body);
    const cppCode = req.body.code;
    console.log(cppCode);
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

    compileProcess.stderr.on('data', (data) => {
        console.error(`Compilation Error: ${data.toString()}`);
        res.json({ error: data.toString() });
    });

    compileProcess.on('close', (code) => {
        if (code === 0) {
            const runProcess = spawn('./my_program', { shell: true });

            // runProcess.stdin.write(inputData);
            // runProcess.stdin.end();

            let output = '';

            runProcess.stdout.on('data', (data) => {
                output += data.toString();
                console.log(output);
            });

            runProcess.stderr.on('data', (data) => {
                console.error(`Runtime Error: ${data.toString()}`);
                res.json({ error: data.toString(), output });
            });

            runProcess.on('close', (code) => {
                const outputMain =`C++ Program Exited with Code ${code}
                Program Output: 
                ${output}`;

                res.json({ output: outputMain });
            });
        } else {
            console.error('Compilation Failed');
        }
    });
};