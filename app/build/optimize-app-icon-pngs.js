const fs = require('fs');
const path = require('path');
const { PNG } = require(path.join(__dirname, '..', 'node_modules', 'pngjs'));

for (const filePath of process.argv.slice(2)) {
  const decoded = PNG.sync.read(fs.readFileSync(filePath));
  const encoded = PNG.sync.write(decoded, {
    colorType: 6,
    inputColorType: 6,
    inputHasAlpha: true,
    filterType: -1,
    deflateLevel: 9,
    deflateStrategy: 3,
  });
  fs.writeFileSync(filePath, encoded);
}
