'use strict';

const express = require('express');
const cors = require('cors');
const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');
const { spawn, execSync } = require('child_process');
const WebSocketServer = require('ws').Server;
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

////////////////////////////////////////////////////////////////////////////////
// Configuration & Setup
////////////////////////////////////////////////////////////////////////////////

const PORT = process.env.PORT || 7000;
const WSS_PORT = 7100;
const LOGS_DIR = path.join(__dirname, 'logs');
const OUTPUTS_DIR = path.join(__dirname, 'outputs');

// Ensure logs and outputs directories exist
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

if (!fs.existsSync(OUTPUTS_DIR)) {
  fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
}

// Create a write stream for access logs (in append mode)
const accessLogStream = fs.createWriteStream(
  path.join(LOGS_DIR, 'access.log'),
  { flags: 'a' }
);

// Define a custom token for real IP address in Morgan
morgan.token('real-ip', (req) => {
  return (
    req.headers['x-forwarded-for'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    (req.connection.socket ? req.connection.socket.remoteAddress : null)
  );
});

////////////////////////////////////////////////////////////////////////////////
// WebSocket Server Setup
////////////////////////////////////////////////////////////////////////////////

const wss = new WebSocketServer({ port: WSS_PORT });
console.log(`WebSocket server is running on port ${WSS_PORT}`);

/**
 * Returns an ISO-like date-time string (e.g., "2023-09-21_12:34:56")
 */
function getCurrentDateTime() {
  return new Date().toJSON().slice(0, 19).replace('T', '_');
}

/**
 * Logs an event to websocket-events.log
 */
function logWebSocketEvent(event, req) {
  const clientIp =
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    (req.connection.socket ? req.connection.socket.remoteAddress : null);

  const log = `${new Date().toISOString()} - ${clientIp} - WebSocket ${event}\n`;
  fs.appendFile(path.join(LOGS_DIR, 'websocket-events.log'), log, (err) => {
    if (err) {
      console.error('Error writing to WebSocket log:', err);
    }
  });
}

// Handle new WebSocket connections
wss.on('connection', (ws, req) => {
  ws.id = `${getCurrentDateTime()}_${uuidv4().substr(0, 8)}`;
  console.log(`WebSocket connected: ${ws.id}`);

  logWebSocketEvent('connected', req);

  ws.on('message', (message) => {
    logWebSocketEvent(`received message: ${message}`, req);

    try {
      const jsonData = JSON.parse(message);
      let { code, lang, input } = jsonData;

      if (input) {
        return;
      } else if (!lang) {
        lang = 'c';
      }
      else if (!code) {
        ws.send(JSON.stringify({ error: 'Missing code or input field' }));
        return;
      }

      switch (lang.toLowerCase()) {
        case 'c++':
          console.log(`[${ws.id}] Compiling and running C++ code.`);
          compileAndRunCPP(code, ws);
          break;

        case 'c':
          console.log(`[${ws.id}] Compiling and running C code.`);
          compileAndRunC(code, ws);
          break;

        case 'python':
          console.log(`[${ws.id}] Running Python code.`);
          runPython(code, ws);
          break;

        case 'java':
          console.log(`[${ws.id}] Compiling and running Java code.`);
          compileAndRunJava(code, ws);
          break;

        default:
          ws.send(
            JSON.stringify({ error: `Unsupported language: ${lang}` })
          );
      }
    } catch (error) {
      console.error('Error parsing message:', error);
      ws.send(JSON.stringify({ error: 'Invalid JSON format' }));
    }
  });

  ws.on('close', () => {
    logWebSocketEvent('disconnected', req);
    console.log(`WebSocket disconnected: ${ws.id}`);
  });
});

////////////////////////////////////////////////////////////////////////////////
// Compilation & Execution: C++
////////////////////////////////////////////////////////////////////////////////

/**
 * Compiles and runs the provided C++ code.
 * @param {string} cppCode - The C++ code to compile and run.
 * @param {WebSocket} ws - The client's WebSocket connection.
 */
function compileAndRunCPP(cppCode, ws) {
  const outputExecutable = path.join(OUTPUTS_DIR, ws.id);

  // Spawn a process to compile the code
  const compileProcess = spawn('g++', ['-o', outputExecutable, '-x', 'c++', '-'], {
    shell: true,
  });

  compileProcess.stdin.write(cppCode);
  compileProcess.stdin.end();

  let compilationError = '';

  compileProcess.stderr.on('data', (data) => {
    compilationError += data.toString();
  });

  compileProcess.on('close', (code) => {
    if (code === 0) {
      // Compilation succeeded; now run the compiled binary
      const runProcess = spawn(outputExecutable, { shell: true });

      runProcess.stdout.on('data', (data) => {
        ws.send(JSON.stringify({ output: data.toString() }));
      });

      runProcess.stderr.on('data', (data) => {
        ws.send(JSON.stringify({ error: data.toString() }));
      });

      // Forward any "input" from the WebSocket to the running process
      ws.on('message', (message) => {
        try {
          const jsonData = JSON.parse(message);
          if (jsonData.input) {
            runProcess.stdin.write(jsonData.input + '\n');
          }
        } catch (error) {
          console.error(`[${ws.id}] Error parsing input message:`, error);
        }
      });

      runProcess.on('close', (exitCode) => {
        ws.send(
          JSON.stringify({
            closed: true,
            output: `\nProcess completed with exit code: ${exitCode}`,
          })
        );
      });
    } else {
      // Compilation failed
      ws.send(JSON.stringify({ output: '', error: compilationError }));
      console.error(`[${ws.id}] Compilation failed.`);
    }
  });
}

////////////////////////////////////////////////////////////////////////////////
// Compilation & Execution: C
////////////////////////////////////////////////////////////////////////////////

/**
 * Compiles and runs the provided C code.
 * @param {string} cCode - The C code to compile and run.
 * @param {WebSocket} ws - The client's WebSocket connection.
 */
function compileCCode(cCode, outputExecutable, callback) {
  const compileProcess = spawn('gcc', ['-o', outputExecutable, '-x', 'c', '-'], {
    shell: true,
  });

  compileProcess.stdin.write(cCode);
  compileProcess.stdin.end();

  let compilationError = '';

  compileProcess.stderr.on('data', (data) => {
    compilationError += data.toString();
  });

  compileProcess.on('close', (code) => {
    if (code === 0) {
      callback(null);
    } else {
      callback(compilationError);
    }
  });
}

function compileAndRunC(cCode, ws) {
  const outputExecutable = path.join(OUTPUTS_DIR, ws.id);

  // First compile the C code
  compileCCode(cCode, outputExecutable, (err) => {
    if (err) {
      ws.send(JSON.stringify({ output: '', error: err }));
      console.error(`[${ws.id}] Compilation failed.`);
      return;
    }

    console.log("Compilation success: ", ws.id);

    // Use node-pty to spawn the compiled binary inside a pseudo terminal
    const ptyProcess = pty.spawn(outputExecutable, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: process.env,
    });

    ptyProcess.on('data', (data) => {
      ws.send(JSON.stringify({ output: data }));
    });

    // Forward any "input" from the WebSocket to the running process
    ws.on('message', (message) => {
      try {
        const jsonData = JSON.parse(message);
        if (jsonData.input) {
          ptyProcess.write(jsonData.input + '\n');
        }
      } catch (error) {
        console.error(`[${ws.id}] Error parsing input message:`, error);
      }
    });

    ptyProcess.on('exit', (exitCode) => {
      ws.send(JSON.stringify({
        closed: true,
        output: `\nProcess completed with exit code: ${exitCode}`
      }));
    });
  });
}

////////////////////////////////////////////////////////////////////////////////
// Execution: Python
////////////////////////////////////////////////////////////////////////////////

/**
 * Runs the provided Python code by saving to a temporary file and executing it.
 * @param {string} pyCode - The Python code to run.
 * @param {WebSocket} ws - The client's WebSocket connection.
 */
function runPython(pyCode, ws) {
  const pyFilePath = path.join(OUTPUTS_DIR, `${ws.id}.py`);

  // Write Python code to a file
  fs.writeFile(pyFilePath, pyCode, (err) => {
    if (err) {
      console.error(`[${ws.id}] Error writing Python file:`, err);
      ws.send(JSON.stringify({ error: 'Failed to write Python file.' }));
      return;
    }

    // Spawn a process to run the Python file
    const runProcess = spawn('python3', [pyFilePath], { shell: true });

    runProcess.stdout.on('data', (data) => {
      ws.send(JSON.stringify({ output: data.toString() }));
    });

    runProcess.stderr.on('data', (data) => {
      ws.send(JSON.stringify({ error: data.toString() }));
    });

    // Forward any "input" from the WebSocket to the running process
    ws.on('message', (message) => {
      try {
        const jsonData = JSON.parse(message);
        if (jsonData.input) {
          runProcess.stdin.write(jsonData.input + '\n');
        }
      } catch (error) {
        console.error(`[${ws.id}] Error parsing input message:`, error);
      }
    });

    runProcess.on('close', (exitCode) => {
      ws.send(
        JSON.stringify({
          closed: true,
          output: `\nProcess completed with exit code: ${exitCode}`,
        })
      );

      // Optionally remove the .py file after execution to keep outputs directory clean
      // fs.unlink(pyFilePath, (unlinkErr) => {
      //   if (unlinkErr) {
      //     console.error(`[${ws.id}] Error removing Python file:`, unlinkErr);
      //   }
      // });
    });
  });
}

////////////////////////////////////////////////////////////////////////////////
// Compilation & Execution: Java
////////////////////////////////////////////////////////////////////////////////

/**
 * Compiles and runs the provided Java code.
 * @param {string} javaCode - The Java code to compile and run.
 * @param {WebSocket} ws - The client's WebSocket connection.
 */
function compileAndRunJava(javaCode, ws) {
  // Extract class name from the Java code
  const classNameMatch = javaCode.match(/public\s+class\s+(\w+)/);
  const className = classNameMatch ? classNameMatch[1] : 'Main';
  
  const javaFilePath = path.join(OUTPUTS_DIR, `${className}.java`);
  const classOutputDir = OUTPUTS_DIR;

  // Write Java code to a file
  fs.writeFile(javaFilePath, javaCode, (err) => {
    if (err) {
      console.error(`[${ws.id}] Error writing Java file:`, err);
      ws.send(JSON.stringify({ error: 'Failed to write Java file.' }));
      return;
    }

    // Compile the Java file
    const compileProcess = spawn('javac', ['-d', classOutputDir, javaFilePath], { shell: true });

    let compilationError = '';

    compileProcess.stderr.on('data', (data) => {
      compilationError += data.toString();
    });

    compileProcess.on('close', (code) => {
      if (code === 0) {
        // Compilation succeeded; now run the compiled class
        const runProcess = spawn('java', ['-cp', classOutputDir, className], { shell: true });

        runProcess.stdout.on('data', (data) => {
          ws.send(JSON.stringify({ output: data.toString() }));
        });

        runProcess.stderr.on('data', (data) => {
          ws.send(JSON.stringify({ error: data.toString() }));
        });

        // Forward any "input" from the WebSocket to the running process
        ws.on('message', (message) => {
          try {
            const jsonData = JSON.parse(message);
            if (jsonData.input) {
              runProcess.stdin.write(jsonData.input + '\n');
            }
          } catch (error) {
            console.error(`[${ws.id}] Error parsing input message:`, error);
          }
        });

        runProcess.on('close', (exitCode) => {
          ws.send(
            JSON.stringify({
              closed: true,
              output: `\nProcess completed with exit code: ${exitCode}`,
            })
          );

          // Optionally remove the .java and .class files after execution
          // fs.unlink(javaFilePath, (unlinkErr) => {
          //   if (unlinkErr) {
          //     console.error(`[${ws.id}] Error removing Java file:`, unlinkErr);
          //   }
          // });
          // fs.unlink(path.join(classOutputDir, `${className}.class`), (unlinkErr) => {
          //   if (unlinkErr) {
          //     console.error(`[${ws.id}] Error removing class file:`, unlinkErr);
          //   }
          // });
        });
      } else {
        // Compilation failed
        ws.send(JSON.stringify({ output: '', error: compilationError }));
        console.error(`[${ws.id}] Java compilation failed.`);
      }
    });
  });
}

////////////////////////////////////////////////////////////////////////////////
// Express Server for Formatting
////////////////////////////////////////////////////////////////////////////////

const app = express();

// Morgan logging
app.use(
  morgan(
    ':real-ip - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"',
    { stream: accessLogStream }
  )
);

app.use(cors());
app.use(express.json());

// Endpoint to format code using clang-format
app.post('/', (req, res) => {
  try {
    const code = req.body.code || '';
    const language = req.body.lang || 'c++';
    const formattedCode = formatCode(code, language);
    res.json({ code: formattedCode });
  } catch (error) {
    console.error('Formatting error:', error);
    res.status(500).json({ error: 'Error formatting code' });
  }
});

// Simple status endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Code compiler running' });
});

app.post('/log-data-for-analytics', (req, res) => {
  console.log('log:', req.body);
  res.json({ message: 'Code compiler running' });
});

app.listen(PORT, () => {
  console.log(`HTTP server is running on port ${PORT}`);
});

////////////////////////////////////////////////////////////////////////////////
// Utilities
////////////////////////////////////////////////////////////////////////////////

/**
 * Formats code using appropriate formatters for different languages.
 * @param {string} code - The code to be formatted.
 * @param {string} language - The language of the code (c, c++, java).
 * @returns {string} - The formatted code.
 */
function formatCode(code, language) {
  try {
    switch (language.toLowerCase()) {
      case 'c':
      case 'c++':
        // clang-format works for both C and C++
        return execSync('clang-format -style=file', { input: code }).toString();
      
      case 'java':
        // Use Google Java Format for Java code
        // First, write the code to a temporary file
        const tempJavaFile = path.join(OUTPUTS_DIR, 'temp_format.java');
        fs.writeFileSync(tempJavaFile, code);
        
        try {
          // Try to use google-java-format if available
          const formatted = execSync(`google-java-format "${tempJavaFile}"`, { encoding: 'utf8' });
          fs.unlinkSync(tempJavaFile); // Clean up temp file
          console.log('Formatted Java code using Google Java Format');
          return formatted;
        } catch (gfmtError) {
          // Fallback: try using basic Java formatting with clang-format
          console.log('Google Java Format not available, trying clang-format for Java');
          fs.unlinkSync(tempJavaFile); // Clean up temp file
          return execSync('clang-format -style=Google -assume-filename=.java', { input: code }).toString();
        }
      
      default:
        console.log(`No formatter available for language: ${language}`);
        return code;
    }
  } catch (error) {
    // Log the error and return the original code if formatting fails
    console.error('Formatting error:', error);
    return code;
  }
}
