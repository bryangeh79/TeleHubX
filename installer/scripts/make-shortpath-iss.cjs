// Generate a short-path variant of telehubx.iss that points at C:\T (junction)
// instead of "dist\". Used as a workaround for ISCC + deep .pnpm path lengths.
const fs = require('node:fs');
const path = require('node:path');
const src = path.resolve(__dirname, '..', 'telehubx.iss');
const dst = path.resolve(__dirname, '..', 'telehubx-shortpath.iss');
let s = fs.readFileSync(src, 'utf8');
s = s.split('"dist\\app\\*"').join('"C:\\T\\app\\*"');
s = s.split('"dist\\tools\\*"').join('"C:\\T\\tools\\*"');
s = s.split('"dist\\runtime\\*"').join('"C:\\T\\runtime\\*"');
s = s.split('"dist\\.env"').join('"C:\\T\\.env"');
fs.writeFileSync(dst, s);
console.log('wrote', dst);
