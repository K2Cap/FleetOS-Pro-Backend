const fs = require('fs');
const files = fs.readdirSync('.').filter(f => f.endsWith('.html') || f.endsWith('.jsx'));
files.forEach(f => {
    let content = fs.readFileSync(f, 'utf8');
    let changed = false;
    if (content.includes('max-width: 450px')) {
        content = content.replace(/max-width:\s*450px;?/g, 'width: 100%;');
        changed = true;
    }
    if (content.includes('max-width: 450')) {
        content = content.replace(/max-width:\s*450;?/g, 'width: 100%;');
        changed = true;
    }
    if (content.includes('maxWidth: 450')) {
        content = content.replace(/maxWidth:\s*450/g, 'width: "100%"');
        changed = true;
    }
    // Also remove the body centering
    if (content.includes('justify-content:center')) {
        content = content.replace(/justify-content:\s*center;?/g, '');
        changed = true;
    }
    if (content.includes('justify-content: center')) {
        content = content.replace(/justify-content:\s*center;?/g, '');
        changed = true;
    }
    if (changed) {
        fs.writeFileSync(f, content);
        console.log('Fluidized:', f);
    }
});
