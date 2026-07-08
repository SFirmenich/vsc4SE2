const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');

const root = path.resolve(__dirname, '..');
const localSource = path.join(root, 'examples', 'poo-basico-01');
const fallbackSource = path.resolve(root, '..', 'docs', 'examples', 'learning-activity', 'poo-basico-01');
const source = fs.existsSync(localSource) ? localSource : fallbackSource;
const destination = path.join(root, 'examples', 'poo-basico-01.zip');
const zip = new AdmZip();

fs.mkdirSync(path.dirname(destination), { recursive: true });
zip.addLocalFolder(source);
zip.writeZip(destination);
console.log(`Created ${destination}`);
