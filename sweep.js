const fs = require('fs');
const files = fs.readdirSync('.').filter(f => f.endsWith('.html') || f.endsWith('.jsx'));

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  let changed = false;

  // General responsive fix: width:390... -> width:100%
  if (content.match(/width:\s*390(px)?/i)) {
    content = content.replace(/width:\s*390(px)?/gi, 'width: 100%');
    changed = true;
  }
  // Remove hardcoded height limits
  if (content.match(/height:\s*(820|844)(px)?/i)) {
    content = content.replace(/height:\s*(820|844)(px)?/gi, 'height: 100%');
    changed = true;
  }
  // Clean up boundaries artifacts
  if (content.includes('border-radius: 44px')) {
    content = content.replace(/border-radius:\s*44px/g, '');
    changed = true;
  }
  if (content.includes('box-shadow: 0 32px 80px')) {
    content = content.replace(/box-shadow:\s*0 32px 80px[^;]*;/g, '');
    changed = true;
  }
  if (content.includes('border: 5px solid #232018')) {
    content = content.replace(/border: 5px solid #232018/g, '');
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(f, content);
    console.log('Swept boundaries from:', f);
  }
});
