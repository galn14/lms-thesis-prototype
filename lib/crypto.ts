import CryptoJS from 'crypto-js';

function getSecret(): string {
  const secret = process.env.CREDENTIAL_ENCRYPTION_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('Missing CREDENTIAL_ENCRYPTION_SECRET (or NEXTAUTH_SECRET) environment variable');
  }
  return secret;
}

export function encryptSecret(plaintext: string): string {
  return CryptoJS.AES.encrypt(plaintext, getSecret()).toString();
}

export function decryptSecret(ciphertext: string): string {
  const secret = getSecret();
  let plaintext = '';
  try {
    // A wrong key yields random bytes, which crypto-js reports either as an
    // empty string or by throwing "Malformed UTF-8 data".
    plaintext = CryptoJS.AES.decrypt(ciphertext, secret).toString(CryptoJS.enc.Utf8);
  } catch {
    plaintext = '';
  }
  if (!plaintext) {
    throw new Error('Failed to decrypt secret — encryption key may have changed');
  }
  return plaintext;
}

/** Last 4 visible characters, rest masked — safe to display in the UI. */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) {
    return '••••';
  }
  return `••••••••${plaintext.slice(-4)}`;
}
