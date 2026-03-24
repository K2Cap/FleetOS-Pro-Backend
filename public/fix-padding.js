const fs = require('fs');
const files = fs.readdirSync('.').filter(f => f.endsWith('.html'));

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  let changed = false;

  // Fix body padding and height to 100% to fill simulator exactly
  if (content.match(/padding:\s*20px\s*0;/)) {
    content = content.replace(/padding:\s*20px\s*0;/g, 'padding: 0;');
    changed = true;
  }
  if (content.match(/min-height:\s*100vh;/)) {
    content = content.replace(/min-height:\s*100vh;/g, 'height: 100%;');
    changed = true;
  }
  if (content.match(/height:\s*100vh;/)) {
    content = content.replace(/height:\s*100vh;/g, 'height: 100%;');
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(f, content);
    console.log('Fixed body padding/height:', f);
  }
});
