/**
 * DKSOFT Chatbot - ConfigService
 * Autor: Vinicius P Barbosa
 * Copyright © 2026.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const crypto = require('crypto');

// Chave e IV para criptografia AES-256-CBC (chave de 32 bytes)
const ENCRYPTION_KEY = Buffer.from('dK$oft_S3cr3tKey_F0r_Encrypt10n!', 'utf-8');
const IV_LENGTH = 16;

// Pools de conexão com as bases MySQL
let centralPool = null;
let dksoftPool = null;

// Caches em memória
const configCache = new Map(); // chave (id ou hash) -> { data, timestamp }
const connCache = new Map(); // id_atendimento -> { data, timestamp }

// TTLs em milissegundos
const CONFIG_CACHE_TTL = 1000 * 60 * 60; // 1 hora
const CONN_CACHE_TTL = 1000 * 60 * 5;    // 5 minutos

// Função para criptografar texto (caminhos, senhas, etc.)
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

// Função para descriptografar texto
function decrypt(text) {
    if (!text) return '';
    try {
        const textParts = text.split(':');
        if (textParts.length < 2) return text; // Retorna o texto original se não estiver no formato iv:ciphertext
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

// Inicializa pools de conexão
function getCentralPool() {
    if (!centralPool) {
        centralPool = mysql.createPool({
            host: process.env.CENTRAL_DB_HOST || 'localhost',
            port: parseInt(process.env.CENTRAL_DB_PORT) || 3306,
            user: process.env.CENTRAL_DB_USER || 'root',
            password: process.env.CENTRAL_DB_PASSWORD || '',
            database: process.env.CENTRAL_DB_NAME || 'chatbot_central',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
    }
    return centralPool;
}

function getDksoftPool() {
    if (!dksoftPool) {
        dksoftPool = mysql.createPool({
            host: process.env.DKSOFT_DB_HOST || 'mysql30-farm1.kinghost.net',
            user: process.env.DKSOFT_DB_USER || 'dksoft19',
            password: process.env.DKSOFT_DB_PASSWORD || 'escola',
            database: process.env.DKSOFT_DB_NAME || 'dksoft19',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
    }
    return dksoftPool;
}

// Invalida o cache de uma escola
function invalidateCache(idOrHash) {
    if (!idOrHash) return;
    const searchKey = String(idOrHash).trim().toLowerCase();
    
    // Deleta diretamente a chave procurada
    configCache.delete(searchKey);
    connCache.delete(searchKey);
    
    // Varre todo o cache para encontrar qualquer entrada com id_atendimento ou hash correspondente e limpa
    for (const [key, entry] of configCache.entries()) {
        if (entry && entry.data) {
            const id = String(entry.data.id_atendimento).trim().toLowerCase();
            const hash = String(entry.data.hash).trim().toLowerCase();
            if (id === searchKey || hash === searchKey) {
                configCache.delete(key);
                connCache.delete(key);
                console.log(`Cache limpo por varredura para chave: ${key}`);
            }
        }
    }
}

// Busca a configuração da escola no banco central do chatbot (escola_configs)
async function getSchoolConfig(idOrHash) {
    if (!idOrHash) return null;
    const strKey = String(idOrHash).trim();
    const now = Date.now();

    // Verifica cache de configuração
    const cached = configCache.get(strKey);
    if (cached && (now - cached.timestamp < CONFIG_CACHE_TTL)) {
        return cached.data;
    }

    const pool = getCentralPool();
    let rows;
    
    // Busca por id_atendimento ou por hash
    if (/^\d+$/.test(strKey)) {
        const [r] = await pool.execute('SELECT * FROM escola_configs WHERE id_atendimento = ?', [parseInt(strKey)]);
        rows = r;
    } else {
        const [r] = await pool.execute('SELECT * FROM escola_configs WHERE hash = ?', [strKey]);
        rows = r;
    }

    if (!rows || rows.length === 0) {
        return null;
    }

    const config = rows[0];

    // Converte show_... fields para booleanos se necessário
    const booleanFields = [
        'show_financeiro', 'show_horarios', 'show_boletim', 
        'show_plataforma', 'show_conteudo', 'show_validador', 'show_interessados'
    ];
    booleanFields.forEach(field => {
        if (config[field] !== undefined) {
            config[field] = !!config[field];
        }
    });

    // Salva no cache sob ambas as chaves (ID e Hash)
    const cacheEntry = { data: config, timestamp: now };
    configCache.set(String(config.id_atendimento), cacheEntry);
    configCache.set(String(config.hash), cacheEntry);

    return config;
}

// Obtém e atualiza as credenciais de conexão do banco da escola a partir do dksoft19
async function getSchoolConnectionConfig(idOrHash) {
    const config = await getSchoolConfig(idOrHash);
    if (!config) {
        throw new Error(`Configurações da escola "${idOrHash}" não encontradas no banco central.`);
    }

    const idAtendimento = config.id_atendimento;
    const now = Date.now();

    // Se as credenciais já estão gravadas no banco de dados central (escola_configs), usamos elas diretamente sem consultar o dksoft19
    if (config.host && config.database_path) {
        const connConfig = {
            host: config.host,
            port: config.port,
            database_path: decrypt(config.database_path),
            banco_dk_encrypted: config.database_path,
            user: config.db_user || 'sysdba',
            senha_dk_encrypted: config.db_password
        };
        // Salva no cache local para futuras consultas rápidas
        connCache.set(String(idAtendimento), { data: connConfig, timestamp: now });
        return connConfig;
    }

    // Verifica se há credenciais válidas no cache
    const cached = connCache.get(String(idAtendimento));
    if (cached && (now - cached.timestamp < CONN_CACHE_TTL)) {
        return cached.data;
    }

    console.log(`Buscando credenciais atualizadas da escola ID ${idAtendimento} no dksoft19...`);
    const dkPool = getDksoftPool();
    
    // Consulta dksoft19 para ver se a escola está ativa e pegar os dados de conexão do Firebird
    const [onlineRows] = await dkPool.execute(
        'SELECT banco_dk, usuario_dk, senha_dk FROM CLIENTES_ONLINE WHERE id_cliente = ?',
        [idAtendimento]
    );

    if (onlineRows.length === 0) {
        throw new Error(`Escola ID ${idAtendimento} não possui conexão online cadastrada no dksoft19.`);
    }

    const onlineData = onlineRows[0];
    const rawBancoDk = onlineData.banco_dk;
    const rawUsuarioDk = onlineData.usuario_dk ? onlineData.usuario_dk.toString().trim() : 'sysdba';
    const rawSenhaDk = onlineData.senha_dk;

    // Criptografa o banco e a senha para manter em memória criptografada
    const bancoDkEncrypted = encrypt(rawBancoDk);
    const senhaDkEncrypted = encrypt(rawSenhaDk);

    // Parse do host, port e database
    let host = '127.0.0.1';
    let port = 3050;
    let database = rawBancoDk;

    const matchSlashPortColon = rawBancoDk.match(/^([^/]+)\/(\d+):(.+)$/);
    if (matchSlashPortColon) {
        host = matchSlashPortColon[1];
        port = parseInt(matchSlashPortColon[2]);
        database = matchSlashPortColon[3];
    } else {
        const matchHostColon = rawBancoDk.match(/^([^:]{2,}):(.+)$/);
        if (matchHostColon) {
            host = matchHostColon[1];
            database = matchHostColon[2];
        }
    }

    const connConfig = {
        host,
        port,
        database_path: database,
        banco_dk_encrypted: bancoDkEncrypted,
        user: rawUsuarioDk,
        senha_dk_encrypted: senhaDkEncrypted
    };

    // Cacheia as credenciais
    connCache.set(String(idAtendimento), { data: connConfig, timestamp: now });

    // Atualiza opcionalmente o banco central com o host e port e caminhos mais recentes
    try {
        const centralPool = getCentralPool();
        await centralPool.execute(
            `UPDATE escola_configs SET 
                host = ?, 
                port = ?, 
                database_path = ?, 
                db_user = ?, 
                db_password = ? 
             WHERE id_atendimento = ?`,
            [host, port, encrypt(database), rawUsuarioDk, senhaDkEncrypted, idAtendimento]
        );
        // Atualiza a config no cache local
        config.host = host;
        config.port = port;
        config.database_path = encrypt(database);
        config.db_user = rawUsuarioDk;
        config.db_password = senhaDkEncrypted;
    } catch (updateErr) {
        console.error(`Erro ao atualizar dados de conexão da escola ID ${idAtendimento} no banco central:`, updateErr.message);
    }

    return connConfig;
}

// Salva ou atualiza as configurações da escola no banco central
async function saveSchoolConfig(configData) {
    const pool = getCentralPool();
    const {
        id_atendimento, hash, cnpj, nome_fantasia,
        portal_aluno_link, cadastro_interessados_link, validador_certificado_link,
        theme, emoji, show_financeiro, show_horarios, show_boletim,
        show_plataforma, show_conteudo, show_validador, show_interessados,
        atendimento_numero, widget_position, widget_text,
        host, port, database_path, db_user, db_password
    } = configData;

    if (!id_atendimento) {
        throw new Error('id_atendimento é obrigatório.');
    }

    const insertQuery = `
        INSERT INTO escola_configs (
            id_atendimento, hash, cnpj, nome_fantasia,
            portal_aluno_link, cadastro_interessados_link, validador_certificado_link,
            theme, emoji, show_financeiro, show_horarios, show_boletim,
            show_plataforma, show_conteudo, show_validador, show_interessados,
            atendimento_numero, widget_position, widget_text, database_path, db_password, host, port, db_user
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            portal_aluno_link = VALUES(portal_aluno_link),
            cadastro_interessados_link = VALUES(cadastro_interessados_link),
            validador_certificado_link = VALUES(validador_certificado_link),
            theme = VALUES(theme),
            emoji = VALUES(emoji),
            show_financeiro = VALUES(show_financeiro),
            show_horarios = VALUES(show_horarios),
            show_boletim = VALUES(show_boletim),
            show_plataforma = VALUES(show_plataforma),
            show_conteudo = VALUES(show_conteudo),
            show_validador = VALUES(show_validador),
            show_interessados = VALUES(show_interessados),
            atendimento_numero = VALUES(atendimento_numero),
            widget_position = VALUES(widget_position),
            widget_text = VALUES(widget_text),
            database_path = CASE WHEN VALUES(database_path) != '' THEN VALUES(database_path) ELSE database_path END,
            db_password = CASE WHEN VALUES(db_password) != '' THEN VALUES(db_password) ELSE db_password END,
            host = CASE WHEN VALUES(host) != '' THEN VALUES(host) ELSE host END,
            port = CASE WHEN VALUES(port) != 0 THEN VALUES(port) ELSE port END,
            db_user = CASE WHEN VALUES(db_user) != '' THEN VALUES(db_user) ELSE db_user END
    `;

    await pool.execute(insertQuery, [
        id_atendimento, hash, cnpj, nome_fantasia,
        portal_aluno_link || 'https://portal.dksoft.com.br/',
        cadastro_interessados_link || '',
        validador_certificado_link || 'https://suportedksoft.com.br/certificado/',
        theme || 'indigo',
        emoji || '🤖',
        show_financeiro !== false,
        show_horarios !== false,
        show_boletim !== false,
        show_plataforma !== false,
        show_conteudo !== false,
        show_validador !== false,
        show_interessados !== false,
        atendimento_numero || '',
        widget_position || 'right',
        widget_text || 'Posso ajudar?',
        database_path || '',
        db_password || '',
        host || '',
        port || 0,
        db_user || ''
    ]);

    // Limpa o cache
    invalidateCache(id_atendimento);
}

// Busca todas as escolas configuradas para inicialização do WhatsApp
async function getAllSchools() {
    const pool = getCentralPool();
    const [rows] = await pool.execute("SELECT * FROM escola_configs");
    return rows;
}

// Map to throttle real-time queries to dksoft19 database (cooldown of 5 minutes)
const lastRealTimeCheckMap = new Map();
const REALTIME_CHECK_COOLDOWN = 1000 * 60 * 5; // 5 minutos

// Atualiza as colunas de controle de pagamento no banco central
async function updateSchoolPaymentInfo(idAtendimento, numeroLancamento, vencimento) {
    const pool = getCentralPool();
    let formattedVenc = null;
    if (vencimento) {
        const d = new Date(vencimento);
        if (!isNaN(d.getTime())) {
            formattedVenc = d.toISOString().split('T')[0];
        }
    }
    await pool.execute(
        'UPDATE escola_configs SET numero_lancamento = ?, vencimento = ? WHERE id_atendimento = ?',
        [numeroLancamento, formattedVenc, idAtendimento]
    );
    invalidateCache(idAtendimento);
}

// Remove as configurações da escola do banco central e limpa caches
async function deleteSchoolConfig(idAtendimento) {
    const pool = getCentralPool();
    await pool.execute('DELETE FROM escola_configs WHERE id_atendimento = ?', [idAtendimento]);
    invalidateCache(idAtendimento);
}

// Verifica se o DKAPP está ativo e a situação é ativa (A) para o cliente no dksoft19
async function verifySchoolDkappStatus(idAtendimento) {
    const dkPool = getDksoftPool();
    const [rows] = await dkPool.execute(
        'SELECT dkapp, situacao FROM TCLIENTES WHERE id_cliente = ?',
        [idAtendimento]
    );
    if (rows.length === 0) {
        return false; // Não localizado -> Inativo
    }
    const client = rows[0];
    const isDkappActive = client.dkapp && client.dkapp.trim().toUpperCase() === 'S';
    const isSituacaoActive = client.situacao && client.situacao.trim().toUpperCase() === 'A';
    return isDkappActive && isSituacaoActive;
}

// Sincroniza a mensalidade de uma escola com o dksoft19
async function syncSchoolPayment(school) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const idAtendimento = school.id_atendimento;
    
    // Primeiro verifica se o DKAPP continua ativo e a situação ativa no dksoft19
    try {
        const isDkappActive = await verifySchoolDkappStatus(idAtendimento);
        if (!isDkappActive) {
            console.log(`[ConfigService - Sinc] Escola ${idAtendimento} inativou o DKAPP no dksoft19. Removendo do banco do chatbot.`);
            await deleteSchoolConfig(idAtendimento);
            return null;
        }
    } catch (dkappErr) {
        console.error(`[ConfigService - Sinc] Erro ao verificar status do DKAPP para escola ${idAtendimento}:`, dkappErr.message);
        // Em caso de erro de conexão com o dksoft19, continuamos para não apagar a escola por falha temporária
    }

    const localVenc = school.vencimento ? new Date(school.vencimento) : null;
    if (localVenc) {
        localVenc.setHours(0, 0, 0, 0);
    }

    const dkPool = getDksoftPool();

    // Caso 1: Vencimento local no passado (atrasado)
    if (localVenc && today.getTime() > localVenc.getTime()) {
        if (!school.numero_lancamento) {
            return school;
        }
        console.log(`[ConfigService - Sinc] Verificando se lançamento ${school.numero_lancamento} da escola ${idAtendimento} foi quitado...`);
        const [rows] = await dkPool.execute(
            "SELECT quitado FROM TCAIXA WHERE numero_lancamento = ? AND id_cliente = ?",
            [school.numero_lancamento, idAtendimento]
        );

        if (rows.length > 0 && rows[0].quitado === 'S') {
            console.log(`[ConfigService - Sinc] Lançamento ${school.numero_lancamento} quitado! Buscando próximo vencimento...`);
            // Busca o próximo vencimento mais recente em aberto
            const [nextRows] = await dkPool.execute(
                "SELECT numero_lancamento, vencimento FROM TCAIXA WHERE id_cliente = ? AND quitado = 'N' ORDER BY vencimento DESC LIMIT 1",
                [idAtendimento]
            );
            if (nextRows.length > 0) {
                const nextVenc = nextRows[0].vencimento;
                const nextNum = nextRows[0].numero_lancamento;
                await updateSchoolPaymentInfo(idAtendimento, nextNum, nextVenc);
            } else {
                await updateSchoolPaymentInfo(idAtendimento, null, null);
            }
            return await getSchoolConfig(idAtendimento);
        }
    } 
    // Caso 2: Vencimento local é NULL (não possui parcelas vencendo registradas)
    else if (!localVenc) {
        console.log(`[ConfigService - Sinc] Escola ${idAtendimento} sem vencimento local. Buscando se há lançamento em aberto no dksoft19...`);
        const [rows] = await dkPool.execute(
            "SELECT numero_lancamento, vencimento FROM TCAIXA WHERE id_cliente = ? AND quitado = 'N' ORDER BY vencimento DESC LIMIT 1",
            [idAtendimento]
        );
        if (rows.length > 0) {
            const newVenc = rows[0].vencimento;
            const newNum = rows[0].numero_lancamento;
            console.log(`[ConfigService - Sinc] Registrando vencimento ${newVenc} e lançamento ${newNum} para escola ${idAtendimento}...`);
            await updateSchoolPaymentInfo(idAtendimento, newNum, newVenc);
            return await getSchoolConfig(idAtendimento);
        }
    }

    return school;
}

// Checagem em tempo real sob demanda na abertura do widget
async function checkAndSyncSchoolPaymentOnDemand(school) {
    if (!school) return null;

    const idAtendimento = school.id_atendimento;
    const localVenc = school.vencimento ? new Date(school.vencimento) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (localVenc) {
        localVenc.setHours(0, 0, 0, 0);
    }

    // Só sincroniza se estiver com vencimento local no passado
    if (localVenc && today.getTime() > localVenc.getTime()) {
        const lastCheck = lastRealTimeCheckMap.get(idAtendimento);
        const now = Date.now();

        if (lastCheck && (now - lastCheck < REALTIME_CHECK_COOLDOWN)) {
            console.log(`[ConfigService - OnDemand] Pulando consulta ao dksoft19 para escola ${idAtendimento} (cooldown ativo).`);
            return school;
        }

        lastRealTimeCheckMap.set(idAtendimento, now);

        try {
            console.log(`[ConfigService - OnDemand] Iniciando checagem em tempo real para escola ${idAtendimento}...`);
            return await syncSchoolPayment(school);
        } catch (err) {
            console.error(`[ConfigService - OnDemand] Erro ao sincronizar pagamento sob demanda da escola ${idAtendimento}:`, err.message);
            return school;
        }
    }

    return school;
}

module.exports = {
    encrypt,
    decrypt,
    getSchoolConfig,
    getSchoolConnectionConfig,
    saveSchoolConfig,
    invalidateCache,
    getAllSchools,
    getDksoftPool,
    updateSchoolPaymentInfo,
    syncSchoolPayment,
    checkAndSyncSchoolPaymentOnDemand,
    deleteSchoolConfig,
    verifySchoolDkappStatus
};
