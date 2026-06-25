const path = require('path');
const AdmZip = require('adm-zip');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'examples', 'poo-basico-01');
const destination = path.join(root, 'examples', 'poo-basico-01.zip');
const zip = new AdmZip();

zip.addLocalFolder(source);
zip.writeZip(destination);
console.log(`Created ${destination}`);
