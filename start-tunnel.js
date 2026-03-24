const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Port we are using
const PORT = 3001;

console.log('--- GLOBAL TUNNEL INITIALIZER ---');
console.log('1. Starting Tunnel (Free Service: localtunnel)...');

// Start the tunnel via npx
const tunnelProc = exec(`npx localtunnel --port ${PORT}`);

tunnelProc.stdout.on('data', (data) => {
    const output = data.toString();
    if (output.includes('your url is:')) {
        const url = output.split('your url is:')[1].trim();
        console.log(`\n🚀 SUCCESS: Your Global Access URL is: ${url}`);
        console.log(`\n2. Updating config.js with the new URL...`);

        // Update config.js
        const configPath = path.resolve(__dirname, '..', 'APP', 'config.js');
        const configContent = `window.FLEETOS_API_BASE = "${url}";\n`;
        fs.writeFileSync(configPath, configContent);
        
        console.log(`✅ config.js updated to use the global tunnel.`);
        console.log(`\n3. You now need to REBUILD the APK for it to work outside your Wi-Fi.`);
        console.log(`(Type 'rebuild' in the chat and I will handle it!)`);
    }
});

tunnelProc.stderr.on('data', (data) => {
    console.error(`Tunnel Error: ${data.toString()}`);
});

process.on('SIGINT', () => {
    tunnelProc.kill();
    process.exit();
});
