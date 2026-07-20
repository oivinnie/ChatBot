/**
 * DKSOFT Chatbot - Módulo de Criptografia & Chaves
 * Componente em Node.js
 * Pasta: Components/crypto.js
 */

const crypto = require('crypto');

// Chave e IV para criptografia AES-256-CBC do chatbot (chave de 32 bytes)
const ENCRYPTION_KEY = Buffer.from('dK$oft_S3cr3tKey_F0r_Encrypt10n!', 'utf-8');
const IV_LENGTH = 16;

/**
 * Criptografa textos e credenciais sensíveis (caminhos de banco, senhas, etc.)
 * @param {string} text 
 * @returns {string} iv:ciphertext em hex
 */
function encrypt(text) {
    if (!text) return '';
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(text, 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (err) {
        console.error('Erro ao criptografar:', err);
        return text;
    }
}

/**
 * Descriptografa textos e credenciais sensíveis do chatbot
 * @param {string} text 
 * @returns {string} texto original em utf8
 */
function decrypt(text) {
    if (!text) return '';
    try {
        const textParts = text.split(':');
        if (textParts.length < 2) return text;
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString('utf8');
    } catch (err) {
        console.error('Erro ao descriptografar:', err);
        return text;
    }
}

/**
 * Criptografa o ID de atendimento para uso nos links do Portal do Aluno / CRM
 * @param {string|number} id 
 * @param {string} key 
 * @returns {string} base64url
 */
function encryptId_portal_aluno(id, key = 'dksof') {
    if (!id && id !== 0) return '';
    const iv = crypto.randomBytes(16);
    const keyBuf = Buffer.alloc(32, 0);
    keyBuf.write(key, 'utf8');
    
    const cipher = crypto.createCipheriv('aes-256-cbc', keyBuf, iv);
    let ciphertextBase64 = Buffer.concat([cipher.update(String(id), 'utf8'), cipher.final()]).toString('base64');
    
    const combined = Buffer.concat([iv, Buffer.from(ciphertextBase64, 'ascii')]);
    let base64url = combined.toString('base64');
    return base64url.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Descriptografa o parâmetro ?i= para obter o ID de atendimento original
 * @param {string} encryptedId 
 * @param {string} key 
 * @returns {string|null} id_atendimento ou null
 */
function decryptId_portal_aluno(encryptedId, key = 'dksof') {
    if (!encryptedId || typeof encryptedId !== 'string') return null;
    try {
        let base64 = encryptedId.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4 !== 0) {
            base64 += '=';
        }
        const buf = Buffer.from(base64, 'base64');
        if (buf.length <= 16) return null;
        
        const iv = buf.subarray(0, 16);
        const ciphertextBase64 = buf.subarray(16).toString('ascii');
        
        const keyBuf = Buffer.alloc(32, 0);
        keyBuf.write(key, 'utf8');
        
        const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuf, iv);
        const decrypted = Buffer.concat([decipher.update(Buffer.from(ciphertextBase64, 'base64')), decipher.final()]).toString('utf8');
        return decrypted && /^\d+$/.test(decrypted) ? decrypted : null;
    } catch (err) {
        return null;
    }
}

module.exports = {
    encrypt,
    decrypt,
    encryptId_portal_aluno,
    decryptId_portal_aluno
};
