const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { generateKeyPairSync } = require('crypto');

const root = path.resolve(__dirname, '..');
const localSource = path.join(root, 'examples', 'poo-basico-01');
const fallbackSource = path.resolve(root, '..', 'docs', 'examples', 'learning-activity', 'poo-basico-01');
const source = fs.existsSync(localSource) ? localSource : fallbackSource;
const destination = path.join(root, 'examples', 'poo-basico-01.zip');
const zip = new AdmZip();

fs.mkdirSync(path.dirname(destination), { recursive: true });
zip.addLocalFolder(source);
if (!zip.getEntry('signatures/evidence-public-key.jwk')) {
	const { publicKey } = generateKeyPairSync('rsa', {
		modulusLength: 3072,
		publicKeyEncoding: { format: 'jwk' },
		privateKeyEncoding: { format: 'jwk' }
	});
	zip.addFile(
		'signatures/evidence-public-key.jwk',
		Buffer.from(JSON.stringify({
			...publicKey,
			kid: 'example-key',
			use: 'enc',
			alg: 'RSA-OAEP-256'
		}, null, 2), 'utf8')
	);
}
zip.writeZip(destination);
console.log(`Created ${destination}`);
