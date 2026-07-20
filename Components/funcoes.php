<?php
/**
 * DKSOFT Chatbot - Funções de Criptografia & Chaves
 * Componente em PHP
 * Pasta: Components/funcoes.php
 */

define('CHATBOT_ENCRYPTION_KEY', 'dK$oft_S3cr3tKey_F0r_Encrypt10n!');

if (!function_exists('encrypt_chatbot')) {
    function encrypt_chatbot($text, $key = CHATBOT_ENCRYPTION_KEY) {
        if (!$text) return '';
        $iv = random_bytes(16);
        $encrypted = openssl_encrypt($text, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv);
        return bin2hex($iv) . ':' . bin2hex($encrypted);
    }
}

if (!function_exists('decrypt_chatbot')) {
    function decrypt_chatbot($text, $key = CHATBOT_ENCRYPTION_KEY) {
        if (!$text) return '';
        $parts = explode(':', $text);
        if (count($parts) < 2) return $text;
        $iv = hex2bin($parts[0]);
        $encrypted = hex2bin($parts[1]);
        return openssl_decrypt($encrypted, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv);
    }
}

if (!function_exists('encryptId_portal_aluno')) {
    function encryptId_portal_aluno($id, $key = 'dksof') {
        $iv = random_bytes(openssl_cipher_iv_length('aes-256-cbc'));
        $ciphertext = openssl_encrypt($id, 'aes-256-cbc', $key, 0, $iv);
        return base64url_encode($iv . $ciphertext);
    }
}

if (!function_exists('base64url_encode')) {
    function base64url_encode($data) {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}

if (!function_exists('base64url_decode')) {
    function base64url_decode($data) {
        return base64_decode(strtr($data, '-_', '+/') . str_repeat('=', (4 - strlen($data) % 4) % 4));
    }
}

if (!function_exists('decryptId_portal_aluno')) {
    function decryptId_portal_aluno($encryptedId, $key = 'dksof') {
        $decoded = base64url_decode($encryptedId);
        if (strlen($decoded) <= 16) return null;
        $iv = substr($decoded, 0, 16);
        $ciphertext = substr($decoded, 16);
        return openssl_decrypt($ciphertext, 'aes-256-cbc', $key, 0, $iv);
    }
}

if (!function_exists('encryptId')) {
    function encryptId($id, $key = 'dksof') {
        $iv = openssl_random_pseudo_bytes(openssl_cipher_iv_length('aes-256-cbc'));
        $encrypted = openssl_encrypt($id, 'aes-256-cbc', $key, 0, $iv);
        $base64 = base64_encode($iv . $encrypted);
        
        $base64url = strtr($base64, '+/', '-_');
        $base64url = rtrim($base64url, '=');
        
        return $base64url;
    }
}
?>
