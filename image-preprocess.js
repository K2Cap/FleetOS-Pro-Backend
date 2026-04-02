const sharp = require('sharp');

async function preprocessForOcr(base64Image, mimeType = 'image/jpeg') {
  const normalizedMime = String(mimeType || '').toLowerCase();
  if (normalizedMime.includes('pdf')) {
    return { base64: base64Image, mimeType };
  }

  const input = Buffer.from(base64Image, 'base64');
  const output = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({
      width: 2200,
      height: 2200,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .normalize()
    .sharpen()
    .jpeg({
      quality: 92,
      mozjpeg: true,
    })
    .toBuffer();

  return {
    base64: output.toString('base64'),
    mimeType: 'image/jpeg',
  };
}

module.exports = {
  preprocessForOcr,
};
