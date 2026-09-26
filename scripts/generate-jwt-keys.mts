// Gera o par de chaves RSA que assina os tokens de acesso (JWT RS256, spec §11.2)
// e acrescenta ao .env. Não sobrescreve chaves existentes.
import { generateKeyPairSync } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';

const ENV_PATH = '.env';

if (/^JWT_PRIVATE_KEY=/m.test(readFileSync(ENV_PATH, 'utf8'))) {
  console.log('O .env já tem chaves JWT; nada foi alterado.');
  console.log('Trocar as chaves invalida todas as sessões. Se for isso mesmo, apague as linhas JWT_* e rode de novo.');
  process.exit(0);
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

// PEM tem várias linhas; em base64 cabe numa linha só do .env
const toBase64 = (pem: string) => Buffer.from(pem).toString('base64');

appendFileSync(
  ENV_PATH,
  `\n# Chaves do JWT (geradas por "pnpm keys:generate"; nunca commitar)\n` +
    `JWT_PRIVATE_KEY=${toBase64(privateKey)}\n` +
    `JWT_PUBLIC_KEY=${toBase64(publicKey)}\n`,
);
console.log('Chaves JWT adicionadas ao .env.');