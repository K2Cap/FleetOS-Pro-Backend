const fs = require('fs');
const files = fs.readdirSync('.').filter(f => f.endsWith('.html'));
files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  let changed = false;
  
  if(content.includes('width:390px')) {
    content = content.replace(/width:390px;/g, 'width:100%;max-width:450px;');
    content = content.replace(/width:390px/g, 'width:100%;max-width:450px');
    content = content.replace(/height:820px;/g, 'height:100vh;');
    content = content.replace(/height:820px/g, 'height:100vh');
    content = content.replace(/border-radius:44px;/g, '');
    content = content.replace(/box-shadow:0 32px 80px rgba\(26,24,20,\.35\),0 0 0 9px #181510;/g, '');
    content = content.replace(/border:5px solid #232018;/g, '');
    changed = true;
  }
  
  if(content.includes('transform:translate3d(0,0,0);')) {
    content = content.replace(/transform:translate3d\(0,0,0\);/g, '');
    changed = true;
  }
  
  if (changed) {
    fs.writeFileSync(f, content);
    console.log('Fixed:', f);
  }
});
