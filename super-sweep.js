const fs = require('fs');
const files = fs.readdirSync('.').filter(f => f.endsWith('.html') || f.endsWith('.jsx'));

files.forEach(f => {
    let content = fs.readFileSync(f, 'utf8');
    let changed = false;

    // 1. Force Root height/width
    if (content.includes('</style>')) {
        const rootStyle = '\n html, body { height: 100% !important; width: 100% !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: #f5f2ec !important; }\n';
        if (!content.includes('html, body { height: 100% !important;')) {
            content = content.replace('</style>', rootStyle + '</style>');
            changed = true;
        }
    }

    // 2. Clear any fixed phone shells or centered flex bodies
    if (content.includes('display:flex;justify-content:center;')) {
        content = content.replace(/display:\s*flex;justify-content:\s*center;/g, '');
        changed = true;
    }
    if (content.includes('display: flex; justify-content: center;')) {
        content = content.replace(/display:\s*flex; justify-content:\s*center;/g, '');
        changed = true;
    }

    // 3. Remove hardcoded phone dimensions & framing
    const dimensionRegex = /(width|height):\s*([0-9]{3})(px)?/gi;
    content = content.replace(dimensionRegex, (match, prop, val) => {
        if (['390','393','360','412','844','820','852','915'].includes(val)) {
            return prop + ': 100%';
        }
        return match;
    });

    // 4. Force JSX outer container to be flush
    if (f.endsWith('.jsx')) {
        content = content.replace(/justifyContent:\s*"center"/g, 'justifyContent: "flex-start"');
        content = content.replace(/width:\s*390/g, 'width: "100%"');
        content = content.replace(/maxWidth:\s*450/g, 'maxWidth: "100%"');
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(f, content);
        console.log('Deep-swept edges in:', f);
    }
});
