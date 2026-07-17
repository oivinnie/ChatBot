/**
 * DKSOFT Chatbot
 * Autor: Vinicius P Barbosa
 * Copyright © 2026.
 * É proibida a reprodução ou distribuição sem autorização.
 */

process.on('unhandledRejection', (reason, promise) => {
    console.error('Rejeição não capturada em:', promise, 'razão:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Exceção não capturada lançada:', err);
});

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { exec } = require('child_process');
const db = require('./db');
const ConfigService = require('./ConfigService');

// Helper to calculate payment status: overdue (hoje > vencimento) and blocked (hoje > vencimento + 2 dias)
function getSchoolPaymentStatus(school) {
    if (!school) {
        return { overdue: false, blocked: false, blockedMessage: null };
    }

    // Se a franquia estiver bloqueada por alguma unidade atrasada
    if (school.franchise_blocked) {
        const emoji = school.emoji || '🤖';
        return {
            overdue: true,
            blocked: true,
            blockedMessage: `${emoji} Ops, estou sem conexão. Tente novamente mais tarde. Para casos urgentes, entre em contato direto com a escola.`
        };
    }

    if (!school.vencimento) {
        return { overdue: false, blocked: false, blockedMessage: null };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let venc = new Date(school.vencimento);
    if (school.dia_vencimento_franquia) {
        venc.setDate(school.dia_vencimento_franquia);
    }
    venc.setHours(0, 0, 0, 0);

    // Overdue se passou do dia do vencimento
    const overdue = today.getTime() > venc.getTime();

    // Bloqueado se passou de 2 dias do vencimento
    const blockLimit = new Date(venc);
    blockLimit.setDate(blockLimit.getDate() + 2);
    const blocked = today.getTime() > blockLimit.getTime();

    const emoji = school.emoji || '🤖';
    const blockedMessage = blocked 
        ? `${emoji} Ops, estou sem conexão. Tente novamente mais tarde. Para casos urgentes, entre em contato direto com a escola.` 
        : null;

    return { overdue, blocked, blockedMessage };
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Middleware para habilitar CORS (Cross-Origin Resource Sharing)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Serve arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Gerenciamento de sessões em memória
const sessions = {};

// Função para validar a escola na base central MySQL
async function validateSchoolCentral(id_atendimento, cnpj) {
    const dkPool = ConfigService.getDksoftPool();

    try {
        const cleanCnpj = cnpj.replace(/\D/g, '');
        // Busca na tabela tclientes com a coluna dkapp e situacao
        const [rows] = await dkPool.execute(
            'SELECT id_cliente, nome, cnpj, dkapp, situacao FROM TCLIENTES WHERE id_cliente = ?',
            [id_atendimento]
        );

        if (rows.length === 0) {
            throw new Error('ID da escola não localizado.');
        }

        const matchedClient = rows.find(r => {
            const dbCnpjClean = (r.cnpj || '').replace(/\D/g, '');
            return dbCnpjClean === cleanCnpj || r.cnpj === cnpj;
        });

        if (!matchedClient) {
            throw new Error('CNPJ incorreto. Preencha como está no menu "Configurações -> Dados da Empresa" do DKSoft. \n\nSe tiver dúvidas, entre em contato com o suporte.');
        }

        // Verifica se dkapp está ativo (espera-se 'S' ou 's')
        if (!matchedClient.dkapp || matchedClient.dkapp.trim().toUpperCase() !== 'S') {
            throw new Error('DKAPP_INACTIVE');
        }

        // Verifica se a situação está ativa (espera-se 'A')
        if (!matchedClient.situacao || matchedClient.situacao.trim().toUpperCase() !== 'A') {
            throw new Error('DKAPP_INACTIVE');
        }

        // Busca na tabela clientes_online
        const [onlineRows] = await dkPool.execute(
            'SELECT banco_dk, usuario_dk, senha_dk FROM CLIENTES_ONLINE WHERE id_cliente = ?',
            [matchedClient.id_cliente]
        );

        if (onlineRows.length === 0) {
            throw new Error('Necessário migrar para a versão online para utilizar o ChatBot.');
        }

        return {
            id_cliente: matchedClient.id_cliente,
            nome_fantasia: matchedClient.nome ? matchedClient.nome.toString().trim() : '',
            id_atendimento: matchedClient.id_cliente,
            banco_dk: onlineRows[0].banco_dk,
            usuario_dk: onlineRows[0].usuario_dk ? onlineRows[0].usuario_dk.toString().trim() : 'sysdba',
            senha_dk: onlineRows[0].senha_dk
        };
    } catch (err) {
        throw err;
    }
}

// Helpers de formatação
function formatUrl(url) {
    if (!url) return '';
    const trimmed = url.trim();
    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
    }
    return `https://${trimmed}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    // Evita problemas de fuso horário pegando os componentes locais ou UTC corretos
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}/${month}/${year}`;
}

function formatCurrency(val) {
    const num = parseFloat(val);
    if (isNaN(num)) return 'R$ 0,00';
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Retorna se há materiais online globais e se há integrações globais ativas
async function getGlobalOptions() {
    let hasOnlineContent = false;
    let hasActiveIntegration = false;

    // 1. Verificar se há qualquer material cadastrado
    try {
        const result = await db.execute('SELECT COUNT(*) AS CNT FROM MODULOS_MATERIAIS');
        if (result.length > 0 && result[0].CNT > 0) {
            hasOnlineContent = true;
        }
    } catch (err) {
        console.error('Erro ao verificar material online global:', err);
    }

    // 2. Verificar se há integrações ativas (Evolua, OM EAD, Gillis ou DKAPP)
    try {
        const queryParam = `SELECT INTEGRA_EVOLUA, INTEGRA_OM_EAD, INTEGRA_GILLIS, DKAPP FROM PARAMETROS`;
        const paramsRow = await db.execute(queryParam);
        if (paramsRow.length > 0) {
            const params = paramsRow[0];
            const isEvolua = params.INTEGRA_EVOLUA && params.INTEGRA_EVOLUA.toString().trim().toUpperCase() === 'S';
            const isOmEad = params.INTEGRA_OM_EAD && params.INTEGRA_OM_EAD.toString().trim().toUpperCase() === 'S';
            const isGillis = params.INTEGRA_GILLIS && params.INTEGRA_GILLIS.toString().trim().toUpperCase() === 'S';
            const isDkApp = params.DKAPP && params.DKAPP.toString().trim().toUpperCase() === 'S';
            if (isEvolua || isOmEad || isGillis || isDkApp) {
                hasActiveIntegration = true;
            }
        }
    } catch (err) {
        console.error('Erro ao verificar integrações globais:', err);
    }

    return { hasOnlineContent, hasActiveIntegration };
}

const globalOptionsCache = {}; // schoolHash -> { data: options, timestamp: number }
const OPTIONS_CACHE_TTL = 10 * 60 * 1000; // 10 minutos

// Retorna a lista de opções de menu disponíveis com base na configuração e dados do estudante
async function getAvailableOptions(hash, studentId = null) {
    if (!studentId) {
        const now = Date.now();
        const cached = globalOptionsCache[hash];
        if (cached && (now - cached.timestamp < OPTIONS_CACHE_TTL)) {
            return cached.data;
        }
    }
    const config = (await ConfigService.getSchoolConfig(hash)) || {};
    const showFinanceiro = config.show_financeiro !== false;
    const showHorarios = config.show_horarios !== false;
    const showBoletim = config.show_boletim !== false;
    const showPlataforma = config.show_plataforma !== false;
    const showConteudo = config.show_conteudo !== false;
    const showValidador = config.show_validador !== false;
    const showInteressados = config.show_interessados !== false;

    const options = [];

    // 1. Financeiro
    if (showFinanceiro) {
        options.push({ id: 'financeiro', label: 'Financeiro' });
    }
    // 2. Horários
    if (showHorarios) {
        options.push({ id: 'horarios', label: 'Horários' });
    }
    // 3. Boletim
    if (showBoletim) {
        options.push({ id: 'boletim', label: 'Boletim' });
    }
    // 4. Acesso da Plataforma
    if (showPlataforma) {
        let hasIntegration = false;
        try {
            const queryParam = `SELECT INTEGRA_EVOLUA, INTEGRA_OM_EAD, INTEGRA_GILLIS, DKAPP FROM PARAMETROS`;
            const paramsRow = await db.execute(hash, queryParam);
            if (paramsRow.length > 0) {
                const params = paramsRow[0];
                const isEvolua = params.INTEGRA_EVOLUA && params.INTEGRA_EVOLUA.toString().trim().toUpperCase() === 'S';
                const isOmEad = params.INTEGRA_OM_EAD && params.INTEGRA_OM_EAD.toString().trim().toUpperCase() === 'S';
                const isGillis = params.INTEGRA_GILLIS && params.INTEGRA_GILLIS.toString().trim().toUpperCase() === 'S';
                const isDkApp = params.DKAPP && params.DKAPP.toString().trim().toUpperCase() === 'S';
                if (isEvolua || isOmEad || isGillis || isDkApp) {
                    hasIntegration = true;
                }
            }
        } catch (err) {
            console.error('Erro ao verificar integrações:', err);
        }
        if (hasIntegration) {
            options.push({ id: 'plataforma', label: 'Acesso da Plataforma' });
        }
    }
    // 5. Conteúdo Online
    if (showConteudo) {
        let hasContent = false;
        if (studentId) {
            try {
                const queryContent = `
                    SELECT COUNT(*) AS CNT 
                    FROM ALUNO_MODULOS AM 
                    JOIN MODULOS_MATERIAIS MM ON AM.ID_MODULO = MM.ID_MODULO 
                    WHERE AM.ID_ALUNO = ? AND AM.SITUACAO = 'Em Andamento'
                `;
                const contentResult = await db.execute(hash, queryContent, [studentId]);
                if (contentResult.length > 0 && contentResult[0].CNT > 0) {
                    hasContent = true;
                }
            } catch (err) {
                console.error('Erro ao verificar se possui conteúdo online:', err);
            }
        } else {
            // Global check
            try {
                const result = await db.execute(hash, 'SELECT COUNT(*) AS CNT FROM MODULOS_MATERIAIS');
                if (result.length > 0 && result[0].CNT > 0) {
                    hasContent = true;
                }
            } catch (err) {
                console.error('Erro ao verificar material online global:', err);
            }
        }
        if (hasContent) {
            options.push({ id: 'conteudo', label: 'Conteúdo Online' });
        }
    }

    // 6. Validador de Certificado (Sempre visível se showValidador estiver ativo)
    if (showValidador) {
        options.push({ 
            id: 'validador', 
            label: 'Validador de Certificado', 
            url: null 
        });
    }

    // 7. Cadastro de Interessados (Apenas se não identificado e showInteressados ativo)
    if (!studentId && showInteressados) {
        options.push({ 
            id: 'cadastro', 
            label: 'Ainda não sou aluno', 
            url: null 
        });
    }

    // 8. Falar com atendente (Apenas se configurado o número de atendimento)
    if (config.atendimento_numero && config.atendimento_numero.toString().trim() !== '') {
        options.push({ 
            id: 'atendente', 
            label: 'Falar com atendente', 
            url: null 
        });
    }

    if (!studentId) {
        globalOptionsCache[hash] = { data: options, timestamp: Date.now() };
    }
    return options;
}

// Retorna o ano de nascimento a partir de uma data
function getBirthYear(dateVal) {
    if (!dateVal) return '';
    const date = new Date(dateVal);
    if (isNaN(date.getTime())) return '';
    return String(date.getUTCFullYear());
}

// Retorna a saudação inicial do chatbot
async function getGreetingMessage(hash, studentId = null, studentName = null) {
    const config = (await ConfigService.getSchoolConfig(hash)) || {};
    const emoji = config.emoji || '🤖';
    const options = await getAvailableOptions(hash, studentId);
    
    let response = '';
    if (studentId && studentName) {
        response = `Olá **${studentName}**! Fico feliz em falar com você novamente. ${emoji}\n\nComo posso te ajudar hoje?\n\n`;
    } else {
        let nomeFantasia = 'DKSOFT';
        if (config.nome_franquia) {
            nomeFantasia = config.nome_franquia;
            response = `${emoji} Olá! Seja bem-vindo à **${nomeFantasia}**\n\nComo posso te ajudar hoje?\n\n`;
        } else {
            try {
                const result = await db.execute(hash, 'SELECT FIRST 1 NOME_FANTASIA FROM EMPRESA');
                if (result && result.length > 0 && result[0].NOME_FANTASIA) {
                    nomeFantasia = result[0].NOME_FANTASIA.toString().trim();
                }
            } catch (err) {
                console.error('Erro ao buscar NOME_FANTASIA da EMPRESA:', err.message);
            }
            response = `${emoji} Olá! Seja bem-vindo à Instituição **${nomeFantasia}**\n\nComo posso te ajudar hoje?\n\n`;
        }
    }

    options.forEach((opt, idx) => {
        response += `${idx + 1} - **${opt.label}**\n`;
    });

    if (studentId && studentName) {
        response += `\nDigite a opção desejada ou **Sair** para trocar de aluno.`;
    } else {
        response += `\nDigite a opção desejada👇`;
    }

    const extraButtons = [];
    if (!studentId) {
        if (config.show_validador !== false && config.validador_certificado_link) {
            extraButtons.push({ id: 'validador', label: 'Validador de Certificado', url: null });
        }
        if (config.show_interessados !== false && config.cadastro_interessados_link) {
            extraButtons.push({ id: 'cadastro', label: 'Ainda não sou aluno', url: null });
        }
    }

    return { responseText: response, options, extraButtons };
}

// Retorna a mensagem de bloqueio formatada com a opção de falar com atendente e a opção Sair
async function getBlockedResponse(hash) {
    const config = (await ConfigService.getSchoolConfig(hash)) || {};
    const atendimentoNumber = config.atendimento_numero ? config.atendimento_numero.toString().trim() : '';
    const atendenteOptions = [];
    let responseText = "Entre em contato com a escola para mais informações";
    
    let optIndex = 1;
    if (atendimentoNumber) {
        atendenteOptions.push({
            id: 'atendente',
            label: 'Falar com atendente',
            url: null
        });
        responseText += `\n\n${optIndex} - **Falar com atendente**`;
        optIndex++;
    }
    
    // Adiciona o botão Sair
    atendenteOptions.push({
        id: 'sair',
        label: 'Sair',
        url: null
    });
    responseText += `\n${optIndex} - **Sair**`;
    
    responseText += "\n\nDigite a opção desejada👇";
    
    return {
        response: responseText,
        options: atendenteOptions,
        isIdentified: false
    };
}

// Lógica de consulta de Boleto
async function processBoleto(hash, session, studentId, studentName) {
    const coursesQuery = `
        SELECT 
            AC.ID_ALUNO_CURSO, AC.CONTRATO, AC.SITUACAO, AC.PAG_RECORRENTE,
            P.NOME AS PACOTE_NOME, T.NOME AS TURMA_NOME
        FROM ALUNOS_CURSOS AC
        LEFT JOIN PACOTES P ON AC.ID_PACOTE = P.ID_PACOTE
        LEFT JOIN TURMAS T ON AC.ID_TURMA = T.ID_TURMA
        WHERE AC.ID_ALUNO = ?
    `;
    
    try {
        const courses = await db.execute(hash, coursesQuery, [studentId]);
        
        let isFormatoB = true;
        try {
            const pjpRows = await db.execute(hash, 'SELECT FORMATO FROM PARAMETROS_PJ');
            if (pjpRows && pjpRows.length > 0) {
                const formato = pjpRows[0].FORMATO ? pjpRows[0].FORMATO.toString().trim().toUpperCase() : '';
                isFormatoB = (formato === 'B');
            }
        } catch (pjpErr) {
            console.error('Erro ao consultar PARAMETROS_PJ:', pjpErr.message);
        }

        const courseMap = {};
        let hasAcordoCancelamento = false;
        
        courses.forEach(c => {
            const id = c.ID_ALUNO_CURSO;
            const situacao = c.SITUACAO ? c.SITUACAO.toString().trim() : '';
            const contrato = c.CONTRATO ? c.CONTRATO.toString().trim() : 'Sem Contrato';
            const nome = (c.PACOTE_NOME || c.TURMA_NOME || 'Curso').toString().trim();
            
            courseMap[id] = {
                id,
                situacao,
                contrato,
                nome,
                pagRecorrente: c.PAG_RECORRENTE ? c.PAG_RECORRENTE.toString().trim() : ''
            };
            
            if (situacao.toLowerCase() === 'acordo cancelamento') {
                hasAcordoCancelamento = true;
            }
        });

        const caixaQuery = `
            SELECT 
                C.NUMERO_LANCAMENTO, 
                C.VENCIMENTO, 
                C.VALOR, 
                C.QUITADO, 
                C.PJ_LINK, 
                C.PJ_LINHA_DIGITAVEL,
                C.HISTORICO,
                C.AUTENTICACAO,
                C.DOCUMENTO,
                C.HISTORICO_CARNE,
                C.RECORRENTE_MSG,
                C.ID_ALUNO_CURSO
            FROM CAIXA C
            WHERE C.ID_ALUNO = ? 
              AND (C.QUITADO IS NULL OR TRIM(C.QUITADO) <> 'S')
            ORDER BY C.VENCIMENTO ASC
        `;
        
        const rawCaixa = await db.execute(hash, caixaQuery, [studentId]);
        
        // Filtrar e agrupar lançamentos por curso
        const groups = {};
        
        rawCaixa.forEach(row => {
            const courseId = row.ID_ALUNO_CURSO;
            const course = courseMap[courseId] || { situacao: '', contrato: 'Sem Contrato', nome: 'Mensalidades/Taxas Geral', pagRecorrente: '' };
            
            const sit = course.situacao.toLowerCase();
            // Cursos com situação "cancelado" e "acordo cancelamento" não devem ter as parcelas listadas
            if (sit === 'cancelado' || sit === 'acordo cancelamento') {
                return;
            }
            
            const groupKey = courseId || 'geral';
            if (!groups[groupKey]) {
                groups[groupKey] = {
                    course,
                    items: []
                };
            }
            groups[groupKey].items.push(row);
        });

        let response = '';
        const groupIds = Object.keys(groups);
        
        if (groupIds.length > 0) {
            response = `Aqui estão as parcelas pendentes para **${studentName}**:\n\n`;
            
            groupIds.forEach(gId => {
                const group = groups[gId];
                response += `📄 **Contrato: ${group.course.contrato} - ${group.course.nome}**\n`;
                
                group.items.forEach((row, index) => {
                    const vencimento = formatDate(row.VENCIMENTO);
                    const valor = formatCurrency(row.VALOR);
                    let link = row.PJ_LINK ? row.PJ_LINK.toString().trim() : '';
                    if (!isFormatoB && link) {
                        link = link.replace('formato=carne', 'formato=pixcarne');
                    }
                    const historico = row.HISTORICO ? row.HISTORICO.toString().trim() : 'Mensalidade';
                    
                    const isRecorrente = group.course.pagRecorrente && group.course.pagRecorrente.toUpperCase() === 'S';

                    // Mostra o número como normal (ex: 1 - ), não emoji
                    if (isRecorrente) {
                        response += `${index + 1} - **${historico}**\n`;
                        response += `   📅 Vencimento: ${vencimento}\n`;
                        response += `   💰 Valor: ${valor}\n`;
                        response += `   💳 *Esta mensalidade possui cobrança recorrente e será cobrada automaticamente no cartão de crédito cadastrado (Boleto não enviado).*\n\n`;
                    } else if (link) {
                        response += `${index + 1} - **${historico}**\n`;
                        response += `   📅 Vencimento: ${vencimento}\n`;
                        response += `   💰 Valor: ${valor}\n`;
                        if (isFormatoB) {
                            response += `   🔗 [Clique aqui para abrir o boleto](${link})\n`;
                        } else {
                            response += `   🔗 [Clique aqui para pagar via PIX](${link})\n`;
                        }
                        if (isFormatoB && row.PJ_LINHA_DIGITAVEL) {
                            response += `   💳 Linha Digitável: \`${row.PJ_LINHA_DIGITAVEL.toString().trim()}\`\n`;
                        }
                        
                        // Procurar por PIX Copia e Cola
                        let pixCopiaCola = null;
                        const pixFields = ['PJ_LINHA_DIGITAVEL', 'AUTENTICACAO', 'DOCUMENTO', 'HISTORICO_CARNE', 'RECORRENTE_MSG'];
                        for (const field of pixFields) {
                            if (row[field]) {
                                const val = row[field].toString().trim();
                                if (val.startsWith('000201') && val.length >= 80) {
                                    pixCopiaCola = val;
                                    break;
                                }
                            }
                        }
                        
                        if (pixCopiaCola) {
                            response += `   🔑 PIX Copia e Cola: \`${pixCopiaCola}\`\n`;
                        }
                        response += `\n`;
                    } else {
                        response += `${index + 1} - **${historico}**\n`;
                        response += `   📅 Vencimento: ${vencimento}\n`;
                        response += `   💰 Valor: ${valor}\n`;
                        response += `   📞 Entre em contato com a secretaria da escola para mais informações\n\n`;
                    }
                });
            });
        }

        if (hasAcordoCancelamento) {
            if (response) {
                response += `⚠️ **Importante:** Identificamos contrato(s) com a situação "Acordo Cancelamento". Por favor, entre em contato com a escola para mais informações.\n\n`;
            } else {
                response = `Por favor, entre em contato com a escola para mais informações.`;
                return response;
            }
        } else if (!response) {
            return `Não encontrei nenhum boleto pendente cadastrado para **${studentName}**. 🎉\n\nSe precisar de algo mais, escolha outra opção ou digite **Sair**.`;
        }

        response += `Se precisar de algo mais, escolha outra opção ou digite **Sair**.`;
        return response;
    } catch (err) {
        console.error('Erro ao buscar boletos:', err);
        return `Desculpe, ocorreu um erro ao consultar os boletos. Por favor, tente novamente mais tarde.`;
    }
}

// Lógica de consulta de Horários
async function processHorarios(hash, session, studentId, studentName) {
    const queryCursos = `
        SELECT 
            AC.ID_ALUNO_CURSO, 
            AC.AULA_TIPO, 
            AC.ID_TURMA,
            AC.SITUACAO,
            P.NOME AS PACOTE_NOME,
            T.NOME AS TURMA_NOME
        FROM ALUNOS_CURSOS AC
        LEFT JOIN PACOTES P ON AC.ID_PACOTE = P.ID_PACOTE
        LEFT JOIN TURMAS T ON AC.ID_TURMA = T.ID_TURMA
        WHERE AC.ID_ALUNO = ? 
          AND AC.SITUACAO NOT IN ('Cancelado', 'Concluído', 'Acordo Cancelamento')
    `;

    try {
        const cursos = await db.execute(hash, queryCursos, [studentId]);
        if (cursos.length === 0) {
            return `Não encontrei nenhum curso ativo ou em andamento para **${studentName}** no momento. 🤷‍♂️\n\nSe precisar de algo mais, escolha outra opção ou digite **Sair**.`;
        }

        const promises = cursos.map(async (curso) => {
            const queryHorarios = `
                select 
                cast(list(trim(H.DIA)||' das '||H.HORARIO, ', ') as varchar(2000)) as HORARIOS
                from SPHORARIOS_ALUNO_CURSO('N', ?, ?, ?) H
                left join HORARIOS_FUNCIONAMENTO HF on(H.ID_HORARIO = HF.ID_HORARIOS_FUNCIONAMENTO)
                left join HORARIOS_CADASTRO HC on(HF.ID_HORARIO=HC.ID_HORARIO)
            `;
            const params = [curso.ID_ALUNO_CURSO, curso.AULA_TIPO, curso.ID_TURMA];
            const horariosResult = await db.execute(hash, queryHorarios, params);
            
            let horarios = 'Sem horário agendado';
            if (horariosResult.length > 0 && horariosResult[0].HORARIOS) {
                horarios = horariosResult[0].HORARIOS.toString().trim();
            }
            
            const nomeCurso = (curso.PACOTE_NOME || curso.TURMA_NOME || 'Curso').toString().trim();
            return {
                nomeCurso,
                situacao: curso.SITUACAO.toString().trim(),
                horarios
            };
        });

        const schedules = await Promise.all(promises);

        let response = `Aqui estão seus horários de aula agendados para **${studentName}**:\n\n`;
        schedules.forEach((sch) => {
            response += `📖 **Curso:** ${sch.nomeCurso}\n`;
            response += `📌 Situação: ${sch.situacao}\n`;
            response += `⏰ Horários: **${sch.horarios}**\n\n`;
        });

        response += `Se precisar de algo mais, escolha outra opção ou digite **Sair**.`;
        return response;
    } catch (err) {
        console.error('Erro ao buscar horários:', err);
        return `Desculpe, ocorreu um erro ao consultar seus horários de aula. Por favor, tente novamente mais tarde.`;
    }
}

// Formatação de data de nascimento para DDMMYYYY
function formatBirthdate(dateVal) {
    if (!dateVal) return '';
    const date = new Date(dateVal);
    if (isNaN(date.getTime())) return '';
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}${month}${year}`;
}

// Lógica de consulta de Conteúdo Online
async function processConteudo(hash, session, studentId, studentName) {
    const query = `
        SELECT 
            AM.ID_MODULO,
            M.DESCRICAO AS MODULO_NOME,
            MM.DESCRICAO AS MATERIAL_DESCRICAO,
            MM.LINK AS MATERIAL_LINK,
            MM.IMAGEM
        FROM ALUNO_MODULOS AM
        JOIN MODULOS M ON AM.ID_MODULO = M.ID_MODULO
        JOIN MODULOS_MATERIAIS MM ON AM.ID_MODULO = MM.ID_MODULO
        WHERE AM.ID_ALUNO = ? AND AM.SITUACAO = 'Em Andamento'
    `;
    
    try {
        const rows = await db.execute(hash, query, [studentId]);
        if (rows.length === 0) {
            return `Não encontrei nenhum conteúdo online disponível para o módulo em andamento de **${studentName}**. 📚\n\nSe precisar de algo mais, escolha outra opção ou digite **Sair**.`;
        }
        
        let response = `Aqui está o conteúdo online do seu módulo em andamento, **${studentName}**:\n\n`;
        const modules = {};
        rows.forEach(row => {
            const modNome = row.MODULO_NOME.toString().trim();
            if (!modules[modNome]) {
                modules[modNome] = [];
            }
            
            // Corrige o link se necessário
            let rawLink = row.MATERIAL_LINK ? row.MATERIAL_LINK.toString().trim() : '';
            if (rawLink && !/^https?:\/\//i.test(rawLink)) {
                rawLink = 'https://' + rawLink;
            }

            // Processa imagem se houver
            let imageTag = '';
            if (row.IMAGEM && Buffer.isBuffer(row.IMAGEM) && row.IMAGEM.length > 0) {
                const base64 = row.IMAGEM.toString('base64');
                imageTag = `<img src="data:image/png;base64,${base64}" style="max-width: 64px; max-height: 64px; object-fit: contain; border-radius: 8px; margin-top: 8px; display: block;" />`;
            }

            modules[modNome].push({
                desc: row.MATERIAL_DESCRICAO ? row.MATERIAL_DESCRICAO.toString().trim() : 'Material',
                link: rawLink,
                imageTag: imageTag
            });
        });
        
        Object.keys(modules).forEach(modName => {
            response += `📖 **Módulo: ${modName}**\n`;
            modules[modName].forEach(mat => {
                if (mat.link) {
                    response += `   🔗 [${mat.desc}](${mat.link})\n`;
                } else {
                    response += `   📄 ${mat.desc} (Sem link disponível)\n`;
                }
                if (mat.imageTag) {
                    response += `   ${mat.imageTag}\n`;
                }
            });
            response += `\n`;
        });
        
        response += `Se precisar de algo mais, escolha outra opção ou digite **Sair**.`;
        return response;
    } catch (err) {
        console.error('Erro ao buscar conteúdo online:', err);
        return `Desculpe, ocorreu um erro ao consultar os materiais online. Por favor, tente novamente mais tarde.`;
    }
}

// Lógica de consulta de Integração de Plataforma Online
async function processPlataforma(hash, session, studentId, studentName) {
    const queryParam = `SELECT INTEGRA_EVOLUA, INTEGRA_OM_EAD, INTEGRA_GILLIS, DKAPP FROM PARAMETROS`;
    
    try {
        const paramsRow = await db.execute(hash, queryParam);
        if (paramsRow.length === 0) {
            return `**${studentName}**, não consegui consultar seus dados de acesso. Entre em contato com a escola para verificar.`;
        }
        
        const params = paramsRow[0];
        const isEvolua = params.INTEGRA_EVOLUA && params.INTEGRA_EVOLUA.toString().trim().toUpperCase() === 'S';
        const isOmEad = params.INTEGRA_OM_EAD && params.INTEGRA_OM_EAD.toString().trim().toUpperCase() === 'S';
        const isGillis = params.INTEGRA_GILLIS && params.INTEGRA_GILLIS.toString().trim().toUpperCase() === 'S';
        const isDkApp = params.DKAPP && params.DKAPP.toString().trim().toUpperCase() === 'S';
        
        if (!isEvolua && !isOmEad && !isGillis && !isDkApp) {
            return `**${studentName}**, não consegui consultar seus dados de acesso. Entre em contato com a escola para verificar.`;
        }
        
        // Obter os horários de aula do aluno para anexar na resposta
        // LISTANDO APENAS OS HORÁRIOS DA MATRÍCULA QUE POSSUIR OM_EAD_ENVIADO, OU GILLIS_ENVIADO, OU EVOLUA_ID_TRILHA NÃO NULOS
        let schedulesText = 'Sem horários agendados cadastrados.';
        try {
            const queryCursos = `
                SELECT DISTINCT
                    AC.ID_ALUNO_CURSO, AC.AULA_TIPO, AC.ID_TURMA,
                    P.NOME AS PACOTE_NOME, T.NOME AS TURMA_NOME
                FROM ALUNOS_CURSOS AC
                LEFT JOIN PACOTES P ON AC.ID_PACOTE = P.ID_PACOTE
                LEFT JOIN TURMAS T ON AC.ID_TURMA = T.ID_TURMA
                WHERE AC.ID_ALUNO = ? 
                  AND AC.SITUACAO NOT IN ('Cancelado', 'Concluído', 'Acordo Cancelamento')
                  AND (
                     AC.EVOLUA_ID_TRILHA IS NOT NULL
                     OR EXISTS (
                         SELECT 1 FROM ALUNO_MODULOS AM 
                         WHERE AM.ID_ALUNO_CURSO = AC.ID_ALUNO_CURSO 
                           AND (AM.OM_EAD_ENVIADO IS NOT NULL OR AM.GILLIS_ENVIADO IS NOT NULL)
                     )
                  )
            `;

            const cursos = await db.execute(hash, queryCursos, [studentId]);
            if (cursos.length > 0) {
                const promises = cursos.map(async (curso) => {
                    const queryHorarios = `
                        select 
                        cast(list(trim(H.DIA)||' das '||H.HORARIO, ', ') as varchar(2000)) as HORARIOS
                        from SPHORARIOS_ALUNO_CURSO('N', ?, ?, ?) H
                        left join HORARIOS_FUNCIONAMENTO HF on(H.ID_HORARIO = HF.ID_HORARIOS_FUNCIONAMENTO)
                        left join HORARIOS_CADASTRO HC on(HF.ID_HORARIO=HC.ID_HORARIO)
                    `;
                    const hResult = await db.execute(hash, queryHorarios, [curso.ID_ALUNO_CURSO, curso.AULA_TIPO, curso.ID_TURMA]);
                    let h = 'Sem horário agendado';
                    if (hResult.length > 0 && hResult[0].HORARIOS) {
                        h = hResult[0].HORARIOS.toString().trim();
                    }
                    const cNome = (curso.PACOTE_NOME || curso.TURMA_NOME || 'Curso').toString().trim();
                    return `• **${cNome}**: ${h}`;
                });
                const schedulesArr = await Promise.all(promises);
                schedulesText = schedulesArr.join('\n');
            } else {
                schedulesText = 'Sem horários vinculados para integração de plataforma.';
            }
        } catch (errSch) {
            console.error('Erro ao obter horários ', errSch);
        }

        if (isDkApp) {
            const config = (await ConfigService.getSchoolConfig(hash)) || {};
            const portalUrl = config.portal_aluno_link || 'https://portal.dksoft.com.br/';
            
            const matricula = session.student.matricula ? session.student.matricula.trim() : 'Não cadastrada';
            
            let response = `Use os dados abaixo para acessar o Portal do Aluno, **${studentName}**:\n\n`;
            response += `💻 **Portal do Aluno**\n`;
            response += `🔗 Link: **[${portalUrl.replace(/^https?:\/\//i, '')}](${portalUrl})**\n`;
            response += `👤 Login: \`${matricula}\`\n`;
            response += `🔑 Senha: \`Ano do seu nascimento\`\n\n`;
            
            if (isEvolua || isOmEad || isGillis) {
                response += `⏰ **Seus Horários de Aula na Plataforma:**\n${schedulesText}\n\n`;
            }
            
            response += `Se precisar de algo mais, escolha outra opção ou digite **Sair**.`;
            return response;
        }

        const email = session.student.email || 'E-mail não cadastrado';
        const senha = formatBirthdate(session.student.dataNascimento) || 'Data de nascimento não cadastrada';
        const omEadId = session.student.omEadId || 'Entre em contato com a escola para verificar';
        
        let response = `Aqui estão seus dados de acesso, **${studentName}**:\n\n`;
        
        if (isEvolua) {
            response += `💻 **Plataforma Evolua Educação**\n`;
            response += `🔗 Link: **[app2.evoluaeducacao.com.br](https://app2.evoluaeducacao.com.br)**\n`;
            response += `👤 Usuário: \`${email}\`\n`;
            response += `🔑 Senha: \`${senha}\`\n\n`;
        }
        
        if (isOmEad) {
            response += `💻 **Plataforma Ouro Moderno EAD**\n`;
            response += `🔗 Link: **[meuappdecursos.com.br](https://meuappdecursos.com.br/index.php)**\n`;
            response += `👤 Usuário: \`${omEadId}\`\n`;
            response += `🔑 Senha: \`Se for seu primeiro acesso, é sua data de nascimento completa. Ex: ${senha}\`\n\n`;
        }
        
        if (isGillis) {
            let gillisUrl = 'https://portal.gillis.com.br'; // fallback
            try {
                const gillisParam = await db.execute(hash, 'SELECT FIRST 1 URL FROM GILLIS_PARAMETROS');
                if (gillisParam.length > 0 && gillisParam[0].URL) {
                    const rawUrl = gillisParam[0].URL.toString().trim();
                    const match = rawUrl.match(/^(https?:\/\/[^\/]*\.com\.br)/i);
                    gillisUrl = match ? match[1] : rawUrl;
                }
            } catch (errG) {
                console.error('Erro ao buscar URL do Gillis:', errG);
            }
            
            response += `💻 **Plataforma Gillis**\n`;
            response += `🔗 Link: **[${gillisUrl.replace(/^https?:\/\//i, '')}](${gillisUrl})**\n`;
            response += `👤 Usuário: \`${email}\`\n`;
            response += `🔑 Senha: \`${senha}\`\n\n`;
        }
        
        response += `⏰ **Seus Horários de Aula na Plataforma:**\n${schedulesText}\n\n`;
        response += `Se precisar de algo mais, escolha outra opção ou digite **Sair**.`;
        return response;
    } catch (err) {
        console.error('Erro ao processar integrações de plataforma:', err);
        return `Ocorreu um erro ao consultar a integração. Por favor, tente novamente mais tarde.`;
    }
}
// Preenche as informações extras de conteúdo online e integrações do aluno na sessão
async function fillStudentSessionData(hash, session) {
    if (!session.student) return;
    
    // 1. Verificar se possui conteúdo online
    session.hasOnlineContent = false;
    try {
        const queryContent = `
            SELECT COUNT(*) AS CNT 
            FROM ALUNO_MODULOS AM 
            JOIN MODULOS_MATERIAIS MM ON AM.ID_MODULO = MM.ID_MODULO 
            WHERE AM.ID_ALUNO = ? AND AM.SITUACAO = 'Em Andamento'
        `;
        const contentResult = await db.execute(hash, queryContent, [session.student.id]);
        if (contentResult.length > 0 && contentResult[0].CNT > 0) {
            session.hasOnlineContent = true;
        }
    } catch (err) {
        console.error('Erro ao verificar se possui conteúdo online:', err);
    }

    // 2. Verificar se possui integração ativa
    session.hasActiveIntegration = false;
    try {
        const queryParam = `SELECT INTEGRA_EVOLUA, INTEGRA_OM_EAD, INTEGRA_GILLIS FROM PARAMETROS`;
        const paramsRow = await db.execute(hash, queryParam);
        if (paramsRow.length > 0) {
            const params = paramsRow[0];
            const isEvolua = params.INTEGRA_EVOLUA && params.INTEGRA_EVOLUA.toString().trim().toUpperCase() === 'S';
            const isOmEad = params.INTEGRA_OM_EAD && params.INTEGRA_OM_EAD.toString().trim().toUpperCase() === 'S';
            const isGillis = params.INTEGRA_GILLIS && params.INTEGRA_GILLIS.toString().trim().toUpperCase() === 'S';
            if (isEvolua || isOmEad || isGillis) {
                session.hasActiveIntegration = true;
            }
        }
    } catch (err) {
        console.error('Erro ao verificar integrações:', err);
    }
}

// Obtem a situacao atual do aluno no banco de dados
async function getStudentStatus(hash, studentId) {
    try {
        const rows = await db.execute(hash, 'SELECT SITUACAO FROM ALUNOS WHERE ID_ALUNO = ?', [studentId]);
        if (rows.length > 0) {
            return rows[0].SITUACAO ? rows[0].SITUACAO.toString().trim() : '';
        }
    } catch (err) {
        console.error('Erro ao verificar status do aluno:', err);
    }
    return '';
}

// Lógica de seleção de curso para visualização de boletim
async function handleBoletimCourseSelection(hash, session) {
    const coursesQuery = `
        SELECT 
            AC.ID_ALUNO_CURSO, AC.SITUACAO, AC.DATA_INICIAL, AC.PREVISAO_TERMINO, AC.DATA_TERMINO, AC.CONTRATO,
            P.NOME AS PACOTE_NOME, T.NOME AS TURMA_NOME
        FROM ALUNOS_CURSOS AC
        LEFT JOIN PACOTES P ON AC.ID_PACOTE = P.ID_PACOTE
        LEFT JOIN TURMAS T ON AC.ID_TURMA = T.ID_TURMA
        WHERE AC.ID_ALUNO = ? 
          AND (AC.SITUACAO IS NULL OR TRIM(AC.SITUACAO) NOT IN ('Cancelado', 'Acordo Cancelamento'))
        ORDER BY AC.CONTRATO ASC
    `;
    try {
        const courses = await db.execute(hash, coursesQuery, [session.student.id]);
        if (courses.length === 0) {
            session.step = 'WELCOME';
            const greeting = await getGreetingMessage(hash, session.student.id, session.student.nome);
            return {
                response: `Não encontrei nenhum curso ativo ou concluído cadastrado para **${session.student.nome}**.`,
                options: greeting.options,
                isIdentified: true
            };
        }

        session.courses = courses.map(c => ({
            id: c.ID_ALUNO_CURSO,
            situacao: c.SITUACAO ? c.SITUACAO.toString().trim() : '',
            contrato: c.CONTRATO ? c.CONTRATO.toString().trim() : 'Sem Contrato',
            dataInicial: c.DATA_INICIAL,
            previsaoTermino: c.PREVISAO_TERMINO,
            dataTermino: c.DATA_TERMINO,
            nome: (c.PACOTE_NOME || c.TURMA_NOME || 'Curso').toString().trim()
        }));

        session.step = 'AWAITING_COURSE_SELECTION';

        let courseListText = `Para consultar seu Boletim, por favor selecione o curso correspondente:\n\n`;
        session.courses.forEach((c, idx) => {
            courseListText += `${idx + 1} - **${c.contrato} - ${c.nome}** (Situação: ${c.situacao})\n`;
        });
        courseListText += `\nDigite apenas o número correspondente.`;

        const courseOptions = session.courses.map((c, idx) => ({
            id: `course_${c.id}`,
            label: `${c.contrato} - ${c.nome}`
        }));

        return {
            response: courseListText,
            options: courseOptions,
            isIdentified: true
        };
    } catch (err) {
        console.error('Erro ao buscar cursos do aluno para boletim:', err);
        session.step = 'WELCOME';
        const greeting = await getGreetingMessage(hash, session.student.id, session.student.nome);
        return {
            response: 'Ocorreu um erro ao buscar seus cursos. Por favor, tente novamente.',
            options: greeting.options,
            isIdentified: true
        };
    }
}

async function chatHandler(req, res) {
    const { sessionId, message, hash } = req.body;
    if (!sessionId || typeof message !== 'string') {
        return res.status(400).json({ error: 'Parâmetros inválidos.' });
    }

    // Evita processamento concorrente para a mesma sessão (corrida de mensagens no WhatsApp)
    if (sessions[sessionId] && sessions[sessionId].isProcessing) {
        const elapsed = Date.now() - (sessions[sessionId].processingStartedAt || 0);
        if (elapsed < 10000) { // 10 segundos de tolerância
            console.log(`[Session Lock] Ignorando mensagem concorrente para a sessão ${sessionId}: "${message}"`);
            return res.json({
                response: null,
                options: [],
                isIdentified: false,
                ignored: true
            });
        } else {
            console.warn(`[Session Lock] Trava expirada (10s) detectada para a sessão ${sessionId}. Forçando liberação.`);
            sessions[sessionId].isProcessing = false;
        }
    }

    // Inicializa a sessão se não existir
    if (!sessions[sessionId]) {
        sessions[sessionId] = {
            step: 'WELCOME',
            intent: null,
            students: [],
            student: null,
            hash: hash || null
        };
    }

    const session = sessions[sessionId];
    session.isProcessing = true;
    session.processingStartedAt = Date.now();

    // Sobrescreve res.json para liberar a trava de processamento ao responder
    const originalJson = res.json;
    res.json = function(data) {
        session.isProcessing = false;
        return originalJson.apply(this, arguments);
    };

    try {
        // Verifica se a mensalidade está atrasada/bloqueada
        if (hash) {
        try {
            const school = await ConfigService.getSchoolConfig(hash);
            const paymentStatus = getSchoolPaymentStatus(school);
            if (paymentStatus.blocked) {
                return res.json({
                    response: paymentStatus.blockedMessage,
                    options: [],
                    isIdentified: false
                });
            }
        } catch (err) {
            console.error('Erro ao verificar pagamento no chatHandler:', err.message);
        }
    }

    // Inicializa a sessão se não existir
    if (!sessions[sessionId]) {
        sessions[sessionId] = {
            step: 'WELCOME',
            intent: null,
            students: [],
            student: null,
            hash: hash || null
        };
    }

    const session = sessions[sessionId];
    if (hash && session.hash !== hash) {
        session.hash = hash;
        session.student = null;
        session.students = [];
        session.step = 'WELCOME';
        session.intent = null;
        delete session.targetSchoolHash;
        delete session.matchingStudents;
        delete session.matchingSchools;
    }

    const text = message.trim();
    const cleanText = text.toLowerCase();

    // Comando global para reiniciar / sair
    if (cleanText === 'sair' || cleanText === 'limpar' || cleanText === 'novo' || cleanText === 'menu') {
        session.step = 'WELCOME';
        session.intent = null;
        session.students = [];
        session.student = null;
        delete session.targetSchoolHash;
        delete session.matchingStudents;
        delete session.matchingSchools;
        const greeting = await getGreetingMessage(session.hash);
        return res.json({ 
            response: greeting.responseText,
            options: greeting.options,
            isIdentified: false
        });
    }

    // Tratamento para quando o aluno está bloqueado e oferecemos apenas a opção de atendente
    if (session.step === 'BLOCKED_REDIRECT') {
        const hasAtendente = session.availableOptions && session.availableOptions.some(opt => opt.id === 'atendente');
        const indexSair = hasAtendente ? '2' : '1';
        const indexAtendente = '1';
        
        if (hasAtendente && (cleanText === indexAtendente || cleanText.includes('atendente') || cleanText.includes('atendimento') || cleanText.includes('falar') || cleanText.includes('suporte'))) {
            const config = (await ConfigService.getSchoolConfig(session.hash)) || {};
            const number = config.atendimento_numero ? config.atendimento_numero.replace(/\D/g, '') : '';
            const responseText = number 
                ? `Clique nesse link para falar com um atendente da escola via whatsapp: [Abrir WhatsApp](https://wa.me/${number})` 
                : `Desculpe, o número de atendimento não está configurado.`;
            
            session.step = 'WELCOME';
            session.student = null;
            const greeting = await getGreetingMessage(session.hash, null, null);
            return res.json({
                response: responseText,
                options: greeting.options,
                isIdentified: false
            });
        }
        
        // Se escolheu Sair (por índice correspondente ou por palavra-chave)
        if (cleanText === indexSair || cleanText === 'sair' || cleanText === 'limpar' || cleanText === 'novo' || cleanText === 'menu') {
            session.step = 'WELCOME';
            session.student = null;
            const greeting = await getGreetingMessage(session.hash, null, null);
            return res.json({
                response: greeting.responseText,
                options: greeting.options,
                isIdentified: false
            });
        }
        
        // Se digitou qualquer outra coisa, apenas resetamos para WELCOME e deixamos seguir o fluxo normal
        session.step = 'WELCOME';
        session.student = null;
    }

    // Tratamento para quando não há link de cadastro e oferecemos apenas falar com atendente e sair
    if (session.step === 'CADASTRO_REDIRECT') {
        const hasAtendente = session.availableOptions && session.availableOptions.some(opt => opt.id === 'atendente');
        const indexSair = hasAtendente ? '2' : '1';
        const indexAtendente = '1';
        
        if (hasAtendente && (cleanText === indexAtendente || cleanText.includes('atendente') || cleanText.includes('atendimento') || cleanText.includes('falar') || cleanText.includes('suporte'))) {
            const config = (await ConfigService.getSchoolConfig(session.hash)) || {};
            const number = config.atendimento_numero ? config.atendimento_numero.replace(/\D/g, '') : '';
            const responseText = number 
                ? `Clique nesse link para falar com um atendente da escola via whatsapp: [Abrir WhatsApp](https://wa.me/${number})` 
                : `Desculpe, o número de atendimento não está configurado.`;
            
            session.step = 'WELCOME';
            session.student = null;
            const greeting = await getGreetingMessage(session.hash, null, null);
            return res.json({
                response: responseText,
                options: greeting.options,
                isIdentified: false
            });
        }
        
        // Se escolheu Sair (por índice correspondente ou por palavra-chave)
        if (cleanText === indexSair || cleanText === 'sair' || cleanText === 'limpar' || cleanText === 'novo' || cleanText === 'menu') {
            session.step = 'WELCOME';
            session.student = null;
            const greeting = await getGreetingMessage(session.hash, null, null);
            return res.json({
                response: greeting.responseText,
                options: greeting.options,
                isIdentified: false
            });
        }
        
        // Se digitou qualquer outra coisa, apenas resetamos para WELCOME e deixamos seguir o fluxo normal
        session.step = 'WELCOME';
        session.student = null;
    }

    // Real-time status check
    if (session.student) {
        const targetHash = session.targetSchoolHash || session.hash;
        const status = await getStudentStatus(targetHash, session.student.id);
        if (status === 'B') {
            const blocked = await getBlockedResponse(targetHash);
            session.student = null;
            session.step = 'BLOCKED_REDIRECT';
            session.availableOptions = blocked.options;
            return res.json(blocked);
        } else if (status === 'I') {
            session.student = null;
            session.step = 'WELCOME';
            delete session.targetSchoolHash;
            return res.json({
                response: "Não localizei o cadastro",
                options: [],
                isIdentified: false
            });
        }
    }

    // Fluxo de decisão com base nos estados
    if (session.step === 'WELCOME') {
        const targetHash = session.targetSchoolHash || session.hash;
        const options = await getAvailableOptions(targetHash, session.student ? session.student.id : null);
        session.availableOptions = options;

        let selectedOption = null;

        // 1. Mapeamento por índice numérico
        const choiceIdx = parseInt(cleanText) - 1;
        if (!isNaN(choiceIdx) && choiceIdx >= 0 && choiceIdx < options.length) {
            selectedOption = options[choiceIdx];
        }

        // 2. Mapeamento por palavras-chave textuais
        if (!selectedOption) {
            selectedOption = options.find(opt => {
                if (opt.id === 'financeiro') {
                    return cleanText.includes('financeiro') || cleanText.includes('boleto') || cleanText.includes('parcela') || cleanText.includes('mensalidade') || cleanText.includes('carnê') || cleanText.includes('carne') || cleanText.includes('pix');
                } else if (opt.id === 'horarios') {
                    return cleanText.includes('horario') || cleanText.includes('horários') || cleanText.includes('aula') || cleanText.includes('dia');
                } else if (opt.id === 'boletim') {
                    return cleanText.includes('boletim') || cleanText.includes('nota') || cleanText.includes('notas') || cleanText.includes('prova') || cleanText.includes('grade');
                } else if (opt.id === 'plataforma') {
                    return cleanText.includes('plataforma') || cleanText.includes('acesso') || cleanText.includes('login') || cleanText.includes('senha') || cleanText.includes('portal') || cleanText.includes('evolua') || cleanText.includes('ouro') || cleanText.includes('gillis') || cleanText.includes('app');
                } else if (opt.id === 'conteudo') {
                    return cleanText.includes('conteudo') || cleanText.includes('conteúdo') || cleanText.includes('material') || cleanText.includes('pdf') || cleanText.includes('vídeo') || cleanText.includes('video') || cleanText.includes('online');
                } else if (opt.id === 'validador') {
                    return cleanText.includes('validador') || cleanText.includes('validação') || cleanText.includes('validacao') || cleanText.includes('certificado') || cleanText.includes('comprovação') || cleanText.includes('comprovacao');
                } else if (opt.id === 'atendente') {
                    return cleanText.includes('atendente') || cleanText.includes('atendimento') || cleanText.includes('falar') || cleanText.includes('suporte') || cleanText.includes('secretaria') || cleanText.includes('secretária');
                } else if (opt.id === 'cadastro') {
                    return cleanText.includes('cadastro') || cleanText.includes('interessado') || cleanText.includes('matrícula') || cleanText.includes('matricula') || cleanText.includes('inscrição') || cleanText.includes('inscricao') || cleanText.includes('atendente') || cleanText.includes('secretaria') || cleanText.includes('secretária') || cleanText.includes('suporte');
                }
                return false;
            });
        }

        if (selectedOption) {
            if (selectedOption.id === 'financeiro') {
                session.intent = 'boleto';
                if (session.student) {
                    const responseText = await processBoleto(targetHash, session, session.student.id, session.student.nome);
                    const greeting = await getGreetingMessage(targetHash, session.student.id, session.student.nome);
                    return res.json({ 
                        response: responseText,
                        options: greeting.options,
                        isIdentified: true
                    });
                } else {
                    session.step = 'AWAITING_IDENTIFICATION';
                    return res.json({ 
                        response: 'Ótimo! Vou consultar seus boletos. Por favor digite o **CPF** ou o **E-mail** (do aluno ou responsável) para começar.',
                        options: [],
                        isIdentified: false
                    });
                }
            } else if (selectedOption.id === 'horarios') {
                session.intent = 'horarios';
                if (session.student) {
                    const responseText = await processHorarios(targetHash, session, session.student.id, session.student.nome);
                    const greeting = await getGreetingMessage(targetHash, session.student.id, session.student.nome);
                    return res.json({ 
                        response: responseText,
                        options: greeting.options,
                        isIdentified: true
                    });
                } else {
                    session.step = 'AWAITING_IDENTIFICATION';
                    return res.json({ 
                        response: 'Perfeito! Vou verificar seus horários. Por favor digite o **CPF** ou o **E-mail** (do aluno ou responsável) para começar.',
                        options: [],
                        isIdentified: false
                    });
                }
            } else if (selectedOption.id === 'boletim') {
                session.intent = 'boletim';
                if (session.student) {
                    return res.json(await handleBoletimCourseSelection(targetHash, session));
                } else {
                    session.step = 'AWAITING_IDENTIFICATION';
                    return res.json({ 
                        response: 'Ótimo! Vou consultar seu boletim. Para começar, por favor digite o **CPF** ou o **E-mail** (do aluno ou responsável).',
                        options: [],
                        isIdentified: false
                    });
                }
            } else if (selectedOption.id === 'plataforma') {
                session.intent = 'plataforma';
                if (session.student) {
                    const responseText = await processPlataforma(targetHash, session, session.student.id, session.student.nome);
                    const greeting = await getGreetingMessage(targetHash, session.student.id, session.student.nome);
                    return res.json({ 
                        response: responseText,
                        options: greeting.options,
                        isIdentified: true
                    });
                } else {
                    session.step = 'AWAITING_IDENTIFICATION';
                    return res.json({ 
                        response: 'Maravilha! Vou consultar seu login e senha de acesso para a plataforma de aulas. \n\n Por favor digite o **CPF** ou o **E-mail** (do aluno ou responsável) para começar.',
                        options: [],
                        isIdentified: false
                    });
                }
            } else if (selectedOption.id === 'conteudo') {
                session.intent = 'conteudo';
                if (session.student) {
                    const responseText = await processConteudo(targetHash, session, session.student.id, session.student.nome);
                    const greeting = await getGreetingMessage(targetHash, session.student.id, session.student.nome);
                    return res.json({ 
                        response: responseText,
                        options: greeting.options,
                        isIdentified: true
                    });
                } else {
                    session.step = 'AWAITING_IDENTIFICATION';
                    return res.json({ 
                        response: 'Excelente! Vou verificar seu conteúdo online em andamento. Por favor digite o **CPF** ou o **E-mail** (do aluno ou responsável) para começar.',
                        options: [],
                        isIdentified: false
                    });
                }
            } else if (selectedOption.id === 'validador') {
                const config = (await ConfigService.getSchoolConfig(session.hash)) || {};
                const link = config.validador_certificado_link || 'https://suportedksoft.com.br/certificado/';
                const greeting = await getGreetingMessage(session.hash, session.student ? session.student.id : null, session.student ? session.student.nome : null);
                return res.json({
                    response: `Clique no link a seguir para validar seu certificado:\n[Validador de certificado](${link})`,
                    options: greeting.options,
                    isIdentified: !!session.student,
                    redirectUrl: null
                });
            } else if (selectedOption.id === 'cadastro') {
                const config = (await ConfigService.getSchoolConfig(session.hash)) || {};
                const greeting = await getGreetingMessage(session.hash, session.student ? session.student.id : null, session.student ? session.student.nome : null);
                const redirectUrl = config.cadastro_interessados_link && config.cadastro_interessados_link.toString().trim() !== ''
                    ? formatUrl(config.cadastro_interessados_link.toString())
                    : null;
                if (redirectUrl) {
                    return res.json({
                        response: `Clique no link a seguir para se cadastrar:\n[Quero conhecer os cursos](${redirectUrl})\n\nEm breve um atendente retornará o contato 😉`,
                        options: greeting.options,
                        isIdentified: !!session.student,
                        redirectUrl: null
                    });
                } else {
                    const atendimentoNumber = config.atendimento_numero ? config.atendimento_numero.toString().trim() : '';
                    const cadastroOptions = [];
                    let responseText = `Fale com um atendente da escola para realizar seu cadastro.`;
                    
                    let optIndex = 1;
                    if (atendimentoNumber) {
                        cadastroOptions.push({
                            id: 'atendente',
                            label: 'Falar com atendente',
                            url: null
                        });
                        responseText += `\n\n${optIndex} - **Falar com atendente**`;
                        optIndex++;
                    }
                    
                    cadastroOptions.push({
                        id: 'sair',
                        label: 'Sair',
                        url: null
                    });
                    responseText += `\n${optIndex} - **Sair**`;
                    responseText += "\n\nDigite a opção desejada👇";
                    
                    session.step = 'CADASTRO_REDIRECT';
                    session.availableOptions = cadastroOptions;
                    
                    return res.json({
                        response: responseText,
                        options: cadastroOptions,
                        isIdentified: false,
                        redirectUrl: null
                    });
                }
            } else if (selectedOption.id === 'atendente') {
                const config = (await ConfigService.getSchoolConfig(session.hash)) || {};
                const number = config.atendimento_numero ? config.atendimento_numero.replace(/\D/g, '') : '';
                const responseText = number 
                    ? `Clique nesse link para falar com um atendente da escola via whatsapp:\n[Abrir WhatsApp](https://wa.me/${number})` 
                    : `Desculpe, o número de atendimento não está configurado.`;
                const greeting = await getGreetingMessage(session.hash, session.student ? session.student.id : null, session.student ? session.student.nome : null);
                return res.json({
                    response: responseText,
                    options: greeting.options,
                    isIdentified: !!session.student
                });
            }
        } else {
            const greeting = await getGreetingMessage(session.hash, session.student ? session.student.id : null, session.student ? session.student.nome : null);
            const responseText = `Desculpe, não entendi o que você quis dizer. 🤔\n\n${greeting.responseText}`;
            return res.json({
                response: responseText,
                options: greeting.options,
                isIdentified: !!session.student
            });
        }
    }

    if (session.step === 'AWAITING_IDENTIFICATION') {
        const rawInput = text;
        const digits = rawInput.replace(/\D/g, '');
        const lower = rawInput.toLowerCase();
        let formattedCpf = rawInput;
        let formattedCnpj = rawInput;

        if (digits.length === 11) {
            formattedCpf = `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9,11)}`;
        }
        if (digits.length === 14) {
            formattedCnpj = `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12,14)}`;
        }

        let query = '';
        let params = [];

        if (lower.includes('@')) {
            query = `
					SELECT ID_ALUNO, NOME, CPF, EMAIL, RESPONSAVEL_CPF, RESP_EMAIL, DATA_NASCIMENTO, OM_EAD_ID, MATRICULA, SITUACAO
					FROM ALUNOS
					WHERE (
						EMAIL = ? OR RESP_EMAIL = ?
					)
					AND TIPO = 'AL'
					AND SITUACAO NOT IN ('Inativo', 'Bloqueado')
				`;
            params = [lower, lower];
        } else {
            const pRaw = rawInput.slice(0, 18);
            const pDigits = digits.slice(0, 18);
            const pCpf = formattedCpf.slice(0, 18);
            const pCnpj = formattedCnpj.slice(0, 18);

            query = `
				SELECT ID_ALUNO, NOME, CPF, EMAIL, RESPONSAVEL_CPF, RESP_EMAIL, DATA_NASCIMENTO, OM_EAD_ID, MATRICULA, SITUACAO
				FROM ALUNOS
				WHERE (
					CPF = ? OR CPF = ? OR CPF = ? OR CPF = ?
					OR RESPONSAVEL_CPF = ? OR RESPONSAVEL_CPF = ? OR RESPONSAVEL_CPF = ? OR RESPONSAVEL_CPF = ?
				)
				AND TIPO = 'AL'
				AND SITUACAO NOT IN ('Inativo', 'Bloqueado')
			`;
            params = [
                pRaw, pDigits, pCpf, pCnpj,
                pRaw, pDigits, pCpf, pCnpj
            ];
        }
        if (session.hash === 'teste0' || session.hash === '0') {
            query = query.replace(/WHERE\s*\(/i, 'WHERE ID_ALUNO = 1254 AND (');
        }

        try {
            // Busca conexões da franquia ou apenas a atual se for independente
            const schoolsToSearch = await ConfigService.getFranchiseSchools(session.hash);
            
            const searchPromises = schoolsToSearch.map(async (school) => {
                try {
                    const results = await db.execute(school.hash, query, params);
                    return results.map(row => ({
                        ...row,
                        schoolHash: school.hash,
                        schoolName: school.nome_fantasia
                    }));
                } catch (err) {
                    console.error(`Erro ao consultar base da escola ${school.nome_fantasia}:`, err.message);
                    return [];
                }
            });

            const allResultsNested = await Promise.all(searchPromises);
            const allResults = allResultsNested.flat();

            const cleanedResults = allResults.map(row => {
                row.SITUACAO = row.SITUACAO ? row.SITUACAO.toString().trim() : '';
                return row;
            });

            const activeOrBlocked = cleanedResults.filter(row => row.SITUACAO !== 'I');

            if (allResults.length > 0 && activeOrBlocked.length === 0) {
                return res.json({ 
                    response: 'Não localizei o cadastro',
                    options: [],
                    isIdentified: false
                });
            }

            if (activeOrBlocked.length === 0) {
                return res.json({ 
                    response: 'Hmmmm 🤔 \n\n Não encontrei nenhum aluno cadastrado com esse CPF ou E-mail. 🔍\n\nPor favor, digite os dados novamente ou digite **Sair** para voltar ao início.',
                    options: [],
                    isIdentified: false
                });
            }

            const uniqueSchoolHashes = [...new Set(activeOrBlocked.map(row => row.schoolHash))];

            // Caso 1: Encontrado em apenas uma única escola/unidade
            if (uniqueSchoolHashes.length === 1) {
                session.targetSchoolHash = uniqueSchoolHashes[0];
                const schoolMatches = activeOrBlocked.filter(row => row.schoolHash === session.targetSchoolHash);

                if (schoolMatches.length === 1) {
                    const row = schoolMatches[0];
                    if (row.SITUACAO === 'B') {
                        const blocked = await getBlockedResponse(session.targetSchoolHash);
                        session.student = null;
                        session.step = 'BLOCKED_REDIRECT';
                        session.availableOptions = blocked.options;
                        return res.json(blocked);
                    }

                    session.student = { 
                        id: row.ID_ALUNO, 
                        nome: row.NOME.toString().trim(),
                        email: row.EMAIL ? row.EMAIL.toString().trim() : '',
                        dataNascimento: row.DATA_NASCIMENTO ? row.DATA_NASCIMENTO : null,
                        omEadId: row.OM_EAD_ID ? row.OM_EAD_ID.toString().trim() : '',
                        matricula: row.MATRICULA ? row.MATRICULA.toString().trim() : '',
                        situacao: row.SITUACAO
                    };
                    await fillStudentSessionData(session.targetSchoolHash, session);

                    const targetHash = session.targetSchoolHash;
                    if (session.intent === 'boletim') {
                        return res.json(await handleBoletimCourseSelection(targetHash, session));
                    }

                    session.step = 'WELCOME';
                    
                    let responseText = '';
                    if (session.intent === 'boleto') {
                        responseText = await processBoleto(targetHash, session, session.student.id, session.student.nome);
                    } else if (session.intent === 'horarios') {
                        responseText = await processHorarios(targetHash, session, session.student.id, session.student.nome);
                    } else if (session.intent === 'conteudo') {
                        responseText = await processConteudo(targetHash, session, session.student.id, session.student.nome);
                    } else if (session.intent === 'plataforma') {
                        responseText = await processPlataforma(targetHash, session, session.student.id, session.student.nome);
                    }

                    const greeting = await getGreetingMessage(targetHash, session.student.id, session.student.nome);
                    return res.json({ 
                        response: responseText,
                        options: greeting.options,
                        isIdentified: true
                    });
                } else {
                    // Múltiplos alunos (irmãos) na mesma escola
                    session.students = schoolMatches.map(row => ({ 
                        id: row.ID_ALUNO, 
                        nome: row.NOME.toString().trim(),
                        email: row.EMAIL ? row.EMAIL.toString().trim() : '',
                        dataNascimento: row.DATA_NASCIMENTO ? row.DATA_NASCIMENTO : null,
                        omEadId: row.OM_EAD_ID ? row.OM_EAD_ID.toString().trim() : '',
                        matricula: row.MATRICULA ? row.MATRICULA.toString().trim() : '',
                        situacao: row.SITUACAO
                    }));
                    session.step = 'AWAITING_STUDENT_SELECTION';

                    let listResponse = 'Encontrei mais de um aluno associado a esses dados. Por favor, escolha qual aluno você deseja consultar digitando o número correspondente:\n\n';
                    session.students.forEach((s, idx) => {
                        listResponse += `${idx + 1} - **${s.nome}**\n`;
                    });
                    listResponse += '\nDigite apenas o número da opção (ex: "1" ou "2").';

                    const studentOptions = session.students.map((s, idx) => ({
                        id: `student_${s.id}`,
                        label: s.nome
                    }));

                    return res.json({ 
                        response: listResponse,
                        options: studentOptions,
                        isIdentified: false
                    });
                }
            } else {
                // Caso 2: Encontrado em múltiplas escolas da franquia
                session.matchingStudents = activeOrBlocked;
                
                // Mapeia escolas únicas encontradas
                const uniqueSchools = [];
                const seenHashes = new Set();
                for (const match of activeOrBlocked) {
                    if (!seenHashes.has(match.schoolHash)) {
                        seenHashes.add(match.schoolHash);
                        uniqueSchools.push({
                            hash: match.schoolHash,
                            name: match.schoolName
                        });
                    }
                }
                session.matchingSchools = uniqueSchools;
                session.step = 'AWAITING_UNIT_SELECTION';

                let listResponse = 'Identifiquei seu cadastro em mais de uma unidade. Por favor, escolha qual delas você deseja acessar digitando o número correspondente:\n\n';
                uniqueSchools.forEach((s, idx) => {
                    listResponse += `${idx + 1} - **${s.name}**\n`;
                });
                listResponse += '\nDigite apenas o número da opção (ex: "1" ou "2").';

                const unitOptions = uniqueSchools.map((s, idx) => ({
                    id: `school_${s.hash}`,
                    label: s.name,
                    value: String(idx + 1)
                }));

                return res.json({ 
                    response: listResponse,
                    options: unitOptions,
                    isIdentified: false
                });
            }

        } catch (err) {
            console.error('Erro ao consultar bancos:', err);
            return res.json({ 
                response: 'Ops, estou com dificuldade para me conectar 😕.',
                options: [],
                isIdentified: false
            });
        }
    }

    if (session.step === 'AWAITING_UNIT_SELECTION') {
        const choice = parseInt(text);
        if (isNaN(choice) || choice < 1 || choice > session.matchingSchools.length) {
            const unitOptions = session.matchingSchools.map((s, idx) => ({
                id: `school_${s.hash}`,
                label: s.name,
                value: String(idx + 1)
            }));
            return res.json({ 
                response: `Opção inválida. Por favor, escolha um número de 1 a ${session.matchingSchools.length} correspondente à unidade desejada.`,
                options: unitOptions,
                isIdentified: false
            });
        }

        const selectedSchool = session.matchingSchools[choice - 1];
        session.targetSchoolHash = selectedSchool.hash;

        // Filtra os alunos correspondentes apenas para a escola selecionada
        const schoolMatches = session.matchingStudents.filter(row => row.schoolHash === session.targetSchoolHash);

        // Limpa variáveis temporárias
        delete session.matchingSchools;
        delete session.matchingStudents;

        if (schoolMatches.length === 1) {
            const row = schoolMatches[0];
            if (row.SITUACAO === 'B') {
                const blocked = await getBlockedResponse(session.targetSchoolHash);
                session.student = null;
                session.step = 'BLOCKED_REDIRECT';
                session.availableOptions = blocked.options;
                return res.json(blocked);
            }

            session.student = { 
                id: row.ID_ALUNO, 
                nome: row.NOME.toString().trim(),
                email: row.EMAIL ? row.EMAIL.toString().trim() : '',
                dataNascimento: row.DATA_NASCIMENTO ? row.DATA_NASCIMENTO : null,
                omEadId: row.OM_EAD_ID ? row.OM_EAD_ID.toString().trim() : '',
                matricula: row.MATRICULA ? row.MATRICULA.toString().trim() : '',
                situacao: row.SITUACAO
            };
            await fillStudentSessionData(session.targetSchoolHash, session);

            const targetHash = session.targetSchoolHash;
            if (session.intent === 'boletim') {
                return res.json(await handleBoletimCourseSelection(targetHash, session));
            }

            let responseText = '';
            if (session.intent === 'boleto') {
                responseText = await processBoleto(targetHash, session, session.student.id, session.student.nome);
            } else if (session.intent === 'horarios') {
                responseText = await processHorarios(targetHash, session, session.student.id, session.student.nome);
            } else if (session.intent === 'conteudo') {
                responseText = await processConteudo(targetHash, session, session.student.id, session.student.nome);
            } else if (session.intent === 'plataforma') {
                responseText = await processPlataforma(targetHash, session, session.student.id, session.student.nome);
            }

            const greeting = await getGreetingMessage(targetHash, session.student.id, session.student.nome);
            session.step = 'WELCOME';
            return res.json({ 
                response: responseText,
                options: greeting.options,
                isIdentified: true
            });
        } else {
            // Múltiplos alunos (irmãos) na unidade selecionada
            session.students = schoolMatches.map(row => ({ 
                id: row.ID_ALUNO, 
                nome: row.NOME.toString().trim(),
                email: row.EMAIL ? row.EMAIL.toString().trim() : '',
                dataNascimento: row.DATA_NASCIMENTO ? row.DATA_NASCIMENTO : null,
                omEadId: row.OM_EAD_ID ? row.OM_EAD_ID.toString().trim() : '',
                matricula: row.MATRICULA ? row.MATRICULA.toString().trim() : '',
                situacao: row.SITUACAO
            }));
            session.step = 'AWAITING_STUDENT_SELECTION';

            let listResponse = 'Encontrei mais de um aluno associado a esses dados nessa unidade. Por favor, escolha qual aluno você deseja consultar digitando o número correspondente:\n\n';
            session.students.forEach((s, idx) => {
                listResponse += `${idx + 1} - **${s.nome}**\n`;
            });
            listResponse += '\nDigite apenas o número da opção (ex: "1" ou "2").';

            const studentOptions = session.students.map((s, idx) => ({
                id: `student_${s.id}`,
                label: s.nome
            }));

            return res.json({ 
                response: listResponse,
                options: studentOptions,
                isIdentified: false
            });
        }
    }

    if (session.step === 'AWAITING_STUDENT_SELECTION') {
        const choice = parseInt(text);
        if (isNaN(choice) || choice < 1 || choice > session.students.length) {
            const studentOptions = session.students.map((s, idx) => ({
                id: `student_${s.id}`,
                label: s.nome
            }));
            return res.json({ 
                response: `Opção inválida. Por favor, escolha um número de 1 a ${session.students.length} correspondente ao aluno desejado.`,
                options: studentOptions,
                isIdentified: false
            });
        }

        const selected = session.students[choice - 1];
        const targetHash = session.targetSchoolHash || session.hash;
        if (selected.situacao === 'B') {
            const blocked = await getBlockedResponse(targetHash);
            session.student = null;
            session.step = 'BLOCKED_REDIRECT';
            session.availableOptions = blocked.options;
            return res.json(blocked);
        }

        session.student = selected;
        await fillStudentSessionData(targetHash, session);

        if (session.intent === 'boletim') {
            return res.json(await handleBoletimCourseSelection(targetHash, session));
        }

        session.step = 'WELCOME';

        let responseText = '';
        if (session.intent === 'boleto') {
            responseText = await processBoleto(targetHash, session, session.student.id, session.student.nome);
        } else if (session.intent === 'horarios') {
            responseText = await processHorarios(targetHash, session, session.student.id, session.student.nome);
        } else if (session.intent === 'conteudo') {
            responseText = await processConteudo(targetHash, session, session.student.id, session.student.nome);
        } else if (session.intent === 'plataforma') {
            responseText = await processPlataforma(targetHash, session, session.student.id, session.student.nome);
        }

        const greeting = await getGreetingMessage(targetHash, session.student.id, session.student.nome);
        return res.json({ 
            response: responseText,
            options: greeting.options,
            isIdentified: true
        });
    }

    if (session.step === 'AWAITING_COURSE_SELECTION') {
        const choice = parseInt(text);
        if (isNaN(choice) || choice < 1 || choice > session.courses.length) {
            const courseOptions = session.courses.map((c, idx) => ({
                id: `course_${c.id}`,
                label: c.nome
            }));
            return res.json({ 
                response: `Opção inválida. Por favor, escolha um número de 1 a ${session.courses.length} correspondente ao curso desejado.`,
                options: courseOptions,
                isIdentified: true
            });
        }

        const selectedCourse = session.courses[choice - 1];
        const gradesQuery = `
            SELECT 
                PA.NOTA, PA.DATA,
                P.NOME AS PROVA_NOME, P.MEDIA,
                M.DESCRICAO AS MODULO_NOME
            FROM PROVAS_ALUNOS PA
            JOIN PROVAS P ON PA.ID_PROVA = P.ID_PROVA
            LEFT JOIN MODULOS M ON PA.ID_MODULO = M.ID_MODULO
            WHERE PA.ID_ALUNO_CURSO = ?
        `;

        try {
            const targetHash = session.targetSchoolHash || session.hash;
            const grades = await db.execute(targetHash, gradesQuery, [selectedCourse.id]);
            
            const dataInicialStr = formatDate(selectedCourse.dataInicial);
            let terminoStr = '';
            if (selectedCourse.situacao.toUpperCase() === 'FORMADO') {
                terminoStr = `Data de Término: ${formatDate(selectedCourse.dataTermino)}`;
            } else {
                terminoStr = `Previsão de Término: ${formatDate(selectedCourse.previsaoTermino)}`;
            }

            let responseText = `**Curso:** ${selectedCourse.nome}\n`;
            responseText += `📅 Data Inicial: ${dataInicialStr} | ${terminoStr}\n\n`;

            if (grades.length === 0) {
                responseText += `Nenhuma nota registrada para este curso. 📖`;
            } else {
                const modulesMap = new Map();
                
                grades.forEach(g => {
                    const isMedia = g.MEDIA && g.MEDIA.toString().trim().toUpperCase() === 'S';
                    const notaFormatted = g.NOTA !== null && g.NOTA !== undefined ? g.NOTA.toString() : 'Sem Nota';
                    const provaNome = g.PROVA_NOME ? g.PROVA_NOME.toString().trim() : 'Prova';
                    const dataStr = g.DATA ? ` (${formatDate(g.DATA)})` : '';
                    const moduloNome = g.MODULO_NOME ? g.MODULO_NOME.toString().trim() : 'Geral';
                    
                    if (!modulesMap.has(moduloNome)) {
                        modulesMap.set(moduloNome, { normal: [], media: [] });
                    }
                    
                    if (isMedia) {
                        const examLine = `• **${provaNome}**: ${notaFormatted}${dataStr}`;
                        modulesMap.get(moduloNome).media.push(examLine);
                    } else {
                        const examLine = `• **${provaNome}**: ${notaFormatted}${dataStr}`;
                        modulesMap.get(moduloNome).normal.push(examLine);
                    }
                });
                
                modulesMap.forEach((exams, moduloNome) => {
                    responseText += `\n**Módulo: ${moduloNome}**\n`;
                    if (exams.normal.length > 0) {
                        exams.normal.forEach(line => {
                            responseText += `${line}\n`;
                        });
                    } else if (exams.media.length === 0) {
                        responseText += `• Nenhuma nota registrada para este módulo.\n`;
                    }
                    if (exams.media.length > 0) {
                        exams.media.forEach(line => {
                            responseText += `${line}\n`;
                        });
                    }
                });
            }

            session.step = 'WELCOME';
            const greeting = await getGreetingMessage(targetHash, session.student.id, session.student.nome);

            responseText += `\n\nSe precisar de algo mais, escolha outra opção ou digite **Sair**.`;

            return res.json({
                response: responseText,
                options: greeting.options,
                isIdentified: true
            });

        } catch (err) {
            console.error('Erro ao buscar notas do boletim:', err);
            session.step = 'WELCOME';
            const targetHash = session.targetSchoolHash || session.hash;
            const greeting = await getGreetingMessage(targetHash, session.student.id, session.student.nome);
            return res.json({
                response: 'Erro ao consultar boletim.',
                options: greeting.options,
                isIdentified: true
            });
        }
    }
    } catch (err) {
        console.error('Erro grave no processamento do chatHandler:', err);
        if (sessions[sessionId]) {
            sessions[sessionId].isProcessing = false;
        }
        try {
            return res.status(500).json({ error: 'Erro interno ao processar mensagem.' });
        } catch (resErr) {}
    }
}

app.post('/api/chat', chatHandler);

async function processChatMessage(sessionId, message, hash) {
    return new Promise((resolve) => {
        const req = { body: { sessionId, message, hash } };
        const res = {
            status: () => res,
            json: (data) => resolve(data)
        };
        chatHandler(req, res).catch(err => {
            console.error('Erro no processamento interno do chat:', err);
            resolve({ response: 'Desculpe, ocorreu um erro interno.', options: [], isIdentified: false });
        });
    });
}

// CONTROLE DE ACESSO ADMINISTRATIVO PARA FRANQUIAS
const activeAdminTokens = new Set();

function requireAdminAuth(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!token || !activeAdminTokens.has(token)) {
        return res.status(401).json({ error: 'NÃO_AUTORIZADO', message: 'Acesso negado. Faça login.' });
    }
    next();
}

// Servir a página administrativa de franquias
app.get('/admin/franquias', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin_franquias.html'));
});

// Login do suporte
app.post('/api/admin/franquias/login', (req, res) => {
    const { code, password } = req.body;
    if (code === '123456' && password === '3529') {
        const token = crypto.randomBytes(32).toString('hex');
        activeAdminTokens.add(token);
        return res.json({ success: true, token });
    }
    return res.status(401).json({ error: 'LOGIN_INVALIDO', message: 'Código ou senha incorretos.' });
});

// Logout do suporte
app.post('/api/admin/franquias/logout', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token) {
        activeAdminTokens.delete(token);
    }
    res.json({ success: true });
});

// Listar franquias (e contagem de escolas)
app.get('/api/admin/franquias', requireAdminAuth, async (req, res) => {
    try {
        const pool = ConfigService.getCentralPool();
        const [rows] = await pool.execute(`
            SELECT 
                f.id, 
                f.nome, 
                f.dia_vencimento, 
                f.created_at, 
                COUNT(e.id_atendimento) AS total_escolas,
                GROUP_CONCAT(CONCAT(e.id_atendimento, ' - ', e.nome_fantasia) SEPARATOR '\n') AS lista_escolas
            FROM franquias f
            LEFT JOIN escola_configs e ON e.franquia_id = f.id
            GROUP BY f.id, f.nome, f.dia_vencimento, f.created_at
            ORDER BY f.nome ASC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Erro ao listar franquias:', err);
        res.status(500).json({ error: 'ERRO_INTERNO', message: err.message });
    }
});

// Criar franquia
app.post('/api/admin/franquias', requireAdminAuth, async (req, res) => {
    const { nome, dia_vencimento } = req.body;
    if (!nome || !nome.trim()) {
        return res.status(400).json({ error: 'DADO_INVALIDO', message: 'Nome da franquia é obrigatório.' });
    }
    const diaVenc = dia_vencimento ? parseInt(dia_vencimento) : null;
    try {
        const pool = ConfigService.getCentralPool();
        const [result] = await pool.execute('INSERT INTO franquias (nome, dia_vencimento) VALUES (?, ?)', [nome.trim(), diaVenc]);
        res.json({ id: result.insertId, nome: nome.trim(), dia_vencimento: diaVenc, total_escolas: 0 });
    } catch (err) {
        console.error('Erro ao criar franquia:', err);
        res.status(500).json({ error: 'ERRO_INTERNO', message: err.message });
    }
});

// Editar franquia
app.put('/api/admin/franquias/:id', requireAdminAuth, async (req, res) => {
    const { id } = req.params;
    const { nome, dia_vencimento } = req.body;
    if (!nome || !nome.trim()) {
        return res.status(400).json({ error: 'DADO_INVALIDO', message: 'Nome da franquia é obrigatório.' });
    }
    const diaVenc = dia_vencimento ? parseInt(dia_vencimento) : null;
    try {
        const pool = ConfigService.getCentralPool();
        await pool.execute('UPDATE franquias SET nome = ?, dia_vencimento = ? WHERE id = ?', [nome.trim(), diaVenc, id]);
        
        // Invalida o cache de todas as escolas da franquia modificada
        const [schools] = await pool.execute('SELECT id_atendimento FROM escola_configs WHERE franquia_id = ?', [id]);
        for (const s of schools) {
            ConfigService.invalidateCache(s.id_atendimento);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao atualizar franquia:', err);
        res.status(500).json({ error: 'ERRO_INTERNO', message: err.message });
    }
});

// Excluir franquia
app.delete('/api/admin/franquias/:id', requireAdminAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const pool = ConfigService.getCentralPool();
        // Remove associação nas escola_configs
        await pool.execute('UPDATE escola_configs SET franquia_id = NULL WHERE franquia_id = ?', [id]);
        // Remove a franquia
        await pool.execute('DELETE FROM franquias WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao excluir franquia:', err);
        res.status(500).json({ error: 'ERRO_INTERNO', message: err.message });
    }
});

// Listar escolas para mapeamento de franquia
app.get('/api/admin/franquias/schools', requireAdminAuth, async (req, res) => {
    try {
        const pool = ConfigService.getCentralPool();
        const [rows] = await pool.execute(`
            SELECT id_atendimento, nome_fantasia, franquia_id 
            FROM escola_configs 
            ORDER BY nome_fantasia ASC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Erro ao listar escolas:', err);
        res.status(500).json({ error: 'ERRO_INTERNO', message: err.message });
    }
});

// Associar escola a uma franquia
app.post('/api/admin/franquias/schools/associate', requireAdminAuth, async (req, res) => {
    const { id_atendimento, franquia_id } = req.body;
    if (!id_atendimento) {
        return res.status(400).json({ error: 'DADO_INVALIDO', message: 'ID da escola é obrigatório.' });
    }
    try {
        const pool = ConfigService.getCentralPool();
        const fid = franquia_id ? parseInt(franquia_id) : null;
        await pool.execute('UPDATE escola_configs SET franquia_id = ? WHERE id_atendimento = ?', [fid, id_atendimento]);
        
        // Invalida o cache da escola no ConfigService
        ConfigService.invalidateCache(id_atendimento);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao associar escola à franquia:', err);
        res.status(500).json({ error: 'ERRO_INTERNO', message: err.message });
    }
});

// ROTAS DE CONFIGURAÇÃO DO BANCO DE DADOS
app.get('/api/config', async (req, res) => {
    const { hash } = req.query;
    try {
        if (hash) {
            let school = await ConfigService.getSchoolConfig(hash);
            if (!school) {
                return res.status(404).json({ error: 'SCHOOL_NOT_FOUND', message: 'Escola não encontrada.' });
            }
            school = await ConfigService.checkAndSyncSchoolPaymentOnDemand(school, true);
                const paymentStatus = getSchoolPaymentStatus(school);
                if (paymentStatus.blocked) {
                    return res.status(403).json({
                        error: 'PAYMENT_BLOCKED',
                        message: 'Mensalidade em aberto. Regularize seu chatbot acessando o Portal do Cliente.'
                    });
                }
                const sanitizedSchool = {
                    id_atendimento: school.id_atendimento,
                    hash: school.hash,
                    cnpj: school.cnpj,
                    nome_fantasia: school.nome_fantasia,
                    portal_aluno_link: school.portal_aluno_link,
                    cadastro_interessados_link: school.cadastro_interessados_link,
                    validador_certificado_link: school.validador_certificado_link,
                    theme: school.theme,
                    emoji: school.emoji,
                    show_financeiro: school.show_financeiro,
                    show_horarios: school.show_horarios,
                    show_boletim: school.show_boletim,
                    show_plataforma: school.show_plataforma,
                    show_conteudo: school.show_conteudo,
                    show_validador: school.show_validador,
                    show_interessados: school.show_interessados,
                    atendimento_numero: school.atendimento_numero,
                    widget_position: school.widget_position,
                    widget_text: school.widget_text,
                    vencimento: school.vencimento,
                    overdue: paymentStatus.overdue,
                    blocked: paymentStatus.blocked
                };
                return res.json(sanitizedSchool);
        }
        // Fallback para config padrão
        res.json({
            portal_aluno_link: 'https://portal.dksoft.com.br/',
            cadastro_interessados_link: '',
            validador_certificado_link: 'https://suportedksoft.com.br/certificado/',
            theme: 'indigo',
            emoji: '🤖',
            show_financeiro: true,
            show_horarios: true,
            show_boletim: true,
            show_plataforma: true,
            show_conteudo: true,
            show_validador: true,
            show_interessados: true,
            atendimento_numero: '',
            widget_position: 'right'
        });
    } catch (err) {
        console.error('Erro ao buscar configuração:', err);
        res.status(500).json({ error: 'Erro interno ao buscar as configurações.' });
    }
});

app.post('/api/config', async (req, res) => {
    const { hash, portal_aluno_link, cadastro_interessados_link, validador_certificado_link, theme, emoji, show_financeiro, show_horarios, show_boletim, show_plataforma, show_conteudo, show_validador, show_interessados, atendimento_numero, widget_position, widget_text } = req.body;
    
    if (!hash) {
        return res.status(400).json({ error: 'O id da escola é obrigatório.' });
    }

    try {
        const config = await ConfigService.getSchoolConfig(hash);
        if (!config) {
            return res.status(404).json({ error: 'Escola não encontrada. Por favor, faça a validação primeiro.' });
        }

        const configData = {
            id_atendimento: config.id_atendimento,
            hash: hash,
            cnpj: config.cnpj,
            nome_fantasia: config.nome_fantasia,
            portal_aluno_link: portal_aluno_link || 'https://portal.dksoft.com.br/',
            cadastro_interessados_link: cadastro_interessados_link || '',
            validador_certificado_link: validador_certificado_link || 'https://suportedksoft.com.br/certificado/',
            theme: theme || 'indigo',
            emoji: emoji || '🤖',
            show_financeiro: show_financeiro !== false,
            show_horarios: show_horarios !== false,
            show_boletim: show_boletim !== false,
            show_plataforma: show_plataforma !== false,
            show_conteudo: show_conteudo !== false,
            show_validador: show_validador !== false,
            show_interessados: show_interessados !== false,
            atendimento_numero: atendimento_numero || '',
            widget_position: widget_position || 'right',
            widget_text: widget_text || 'Posso ajudar?'
        };

        await ConfigService.saveSchoolConfig(configData);
        res.json({ success: true, message: 'Configurações gravadas com sucesso!' });
    } catch (err) {
        console.error('Erro ao salvar configuração:', err);
        res.status(500).json({ error: 'Erro interno ao salvar as configurações.' });
    }
});

app.post('/api/config/test', async (req, res) => {
    const { hash } = req.body;
    if (!hash) {
        return res.status(400).json({ error: 'O id da escola é obrigatório para testar conexão.' });
    }

    try {
        const schoolConn = await ConfigService.getSchoolConnectionConfig(hash);
        const testConf = {
            host: schoolConn.host || '127.0.0.1',
            port: parseInt(schoolConn.port) || 3050,
            database: db.decrypt(schoolConn.banco_dk_encrypted),
            user: schoolConn.user || 'sysdba',
            password: db.decrypt(schoolConn.senha_dk_encrypted)
        };

        await db.testConnection(testConf);
        res.json({ success: true, message: 'Conexão estabelecida com sucesso!' });
    } catch (err) {
        console.error('Erro no teste de conexao:', err);
        res.json({ success: false, error: err.message || 'Falha na conexão' });
    }
});

// Retorna as informações do bot (Emoji e Nome Fantasia da Empresa)
app.get('/api/info', async (req, res) => {
    const { hash } = req.query;
    let emoji = '🤖';
    let theme = 'indigo';
    let title = 'Assistente';
    let id_atendimento = '';
    let nome_fantasia = '';
    let logo = null;

    try {
        let school = hash ? await ConfigService.getSchoolConfig(hash) : null;
        if (hash && !school) {
            return res.status(404).json({ error: 'SCHOOL_NOT_FOUND', message: 'Escola não encontrada.' });
        }

        // Verifica se a mensalidade está em dia na abertura do widget (se necessário)
        if (school) {
            school = await ConfigService.checkAndSyncSchoolPaymentOnDemand(school);
        }

        if (school) {
            emoji = school.emoji || '🤖';
            theme = school.theme || 'indigo';
            id_atendimento = school.id_atendimento ? String(school.id_atendimento).trim() : '';
            nome_fantasia = school.nome_fantasia ? String(school.nome_fantasia).trim() : '';
            title = `Assistente ${nome_fantasia}`;
        }

        if (hash && school) {
            try {
                const result = await db.execute(hash, 'SELECT FIRST 1 ID_ATENDIMENTO, NOME_FANTASIA, LOGOTIPO FROM EMPRESA');
                if (result && result.length > 0) {
                    if (result[0].NOME_FANTASIA) {
                        nome_fantasia = result[0].NOME_FANTASIA.toString().trim();
                        title = `Assistente ${nome_fantasia}`;
                    }
                    if (result[0].ID_ATENDIMENTO !== null && result[0].ID_ATENDIMENTO !== undefined) {
                        id_atendimento = result[0].ID_ATENDIMENTO.toString().trim();
                    }
                    if (result[0].LOGOTIPO && Buffer.isBuffer(result[0].LOGOTIPO) && result[0].LOGOTIPO.length > 0) {
                        const logoBase64 = result[0].LOGOTIPO.toString('base64');
                        logo = `data:image/png;base64,${logoBase64}`;
                    }
                }
            } catch (err) {
                console.error('Erro ao buscar NOME_FANTASIA/ID_ATENDIMENTO/LOGOTIPO da EMPRESA para info:', err.message);
            }
        }

        const paymentStatus = getSchoolPaymentStatus(school);

        res.json({ 
            title, 
            emoji, 
            theme,
            id_atendimento,
            nome_fantasia,
            logo,
            widget_position: school ? (school.widget_position || 'right') : 'right',
            widget_text: school ? (school.widget_text || 'Posso ajudar?') : 'Posso ajudar?',
            widget_width: 400,
            widget_height: 680,
            widget_side: 20,
            widget_bottom: 20,
            overdue: paymentStatus.overdue,
            blocked: paymentStatus.blocked,
            blockedMessage: paymentStatus.blockedMessage
        });
    } catch (err) {
        console.error('Erro no api/info:', err);
        res.status(500).json({ error: 'Erro ao carregar informações.' });
    }
});

// Endpoint de validação centralizada de escolas
app.post('/api/escola/validar', async (req, res) => {
    const { id_atendimento, cnpj } = req.body;
    if (!id_atendimento || !cnpj) {
        return res.status(400).json({ error: 'ID da escola e CNPJ são obrigatórios.' });
    }

    try {
        const schoolDetails = await validateSchoolCentral(id_atendimento.trim(), cnpj.trim());
        
        // Gera um hash único para a conexão
        const hash = crypto.createHash('sha256').update(schoolDetails.id_atendimento + '_' + schoolDetails.nome_fantasia + '_' + cnpj.trim()).digest('hex');

        // Verifica se a escola já tem configuração salva
        let existingConfig = await ConfigService.getSchoolConfig(hash);

        // Se já existe e está bloqueada por inadimplência, proíbe o login
        if (existingConfig) {
            existingConfig = await ConfigService.checkAndSyncSchoolPaymentOnDemand(existingConfig, true);
            const paymentStatus = getSchoolPaymentStatus(existingConfig);
            if (paymentStatus.blocked) {
                return res.status(403).json({
                    error: 'PAYMENT_BLOCKED',
                    message: 'Mensalidade em aberto. Regularize seu chatbot acessando o Portal do Cliente.'
                });
            }
        }

        // Parse do host, port e database a partir do banco_dk do dksoft19
        let host = '127.0.0.1';
        let port = 3050;
        let database = schoolDetails.banco_dk;

        const matchSlashPortColon = schoolDetails.banco_dk.match(/^([^/]+)\/(\d+):(.+)$/);
        if (matchSlashPortColon) {
            host = matchSlashPortColon[1];
            port = parseInt(matchSlashPortColon[2]);
            database = matchSlashPortColon[3];
        } else {
            const matchHostColon = schoolDetails.banco_dk.match(/^([^:]{2,}):(.+)$/);
            if (matchHostColon) {
                host = matchHostColon[1];
                database = matchHostColon[2];
            }
        }

        const database_path = ConfigService.encrypt(database);
        const db_password = ConfigService.encrypt(schoolDetails.senha_dk);

        // Salva ou atualiza a escola no banco central (preserva configurações anteriores se existirem)
        const configData = existingConfig ? {
            ...existingConfig,
            id_atendimento: schoolDetails.id_cliente,
            hash: hash,
            cnpj: cnpj.trim(),
            nome_fantasia: schoolDetails.nome_fantasia,
            host,
            port,
            database_path,
            db_user: schoolDetails.usuario_dk,
            db_password
        } : {
            id_atendimento: schoolDetails.id_cliente,
            hash: hash,
            cnpj: cnpj.trim(),
            nome_fantasia: schoolDetails.nome_fantasia,
            portal_aluno_link: 'https://portal.dksoft.com.br/',
            theme: 'indigo',
            emoji: '🤖',
            host,
            port,
            database_path,
            db_user: schoolDetails.usuario_dk,
            db_password
        };

        await ConfigService.saveSchoolConfig(configData);

        // Não inicializa o WhatsApp automaticamente no login; aguarda a ativação manual pelo painel config.
        const savedConfig = await ConfigService.getSchoolConfig(hash);
        if (!whatsappClients[hash]) {
            whatsappStatuses[hash] = 'DISCONNECTED';
        }

        res.json({
            success: true,
            id_atendimento: schoolDetails.id_atendimento,
            nome_fantasia: schoolDetails.nome_fantasia,
            hash: hash
        });
    } catch (err) {
        console.error('Erro na validação da escola:', err);
        if (err.message === 'DKAPP_INACTIVE') {
            try {
                const schoolIdInt = parseInt(id_atendimento);
                if (!isNaN(schoolIdInt)) {
                    const schools = await ConfigService.getAllSchools();
                    const existingSchool = schools.find(s => s.id_atendimento === schoolIdInt);
                    if (existingSchool) {
                        console.log(`[Validation API] Escola ID ${schoolIdInt} está inativa (DKAPP/Situação). Descomissionando e removendo do banco central...`);
                        await destroyWhatsAppClient(existingSchool.hash);
                        try {
                            await cleanSessionFolder(existingSchool.hash);
                        } catch (cleanErr) {}
                        await ConfigService.deleteSchoolConfig(schoolIdInt);
                    }
                }
            } catch (delErr) {
                console.error('[Validation API] Erro ao remover escola inativa no login:', delErr.message);
            }
            return res.status(403).json({ error: 'DKAPP_INACTIVE' });
        }

        const customMessages = [
            'ID da escola não localizado.',
            'CNPJ incorreto. Se tiver dúvidas, entre em contato com o suporte.',
            'Necessário ativar o DK Escolar Premium para utilizar o chatbot.'
        ];
        const errorMsg = (err && err.message && customMessages.includes(err.message)) 
            ? err.message 
            : 'Confira as informações preenchidas e tente novamente.';
        res.status(500).json({ error: errorMsg });
    }
});

// --- INTEGRAÇÃO COM WHATSAPP-WEB.JS MULTI-TENANT ---
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const whatsappClients = {};
const whatsappStatuses = {}; // hash -> status
const whatsappQrData = {}; // hash -> qrData
const isInitializingWhatsApp = {}; // hash -> boolean
const whatsappManualInitRequested = {}; // hash -> boolean
const lastManualMessageTime = {}; // recipientId -> timestamp
const sendingAutomatedFor = new Set(); // recipientId
const clientInitTime = {}; // hash -> timestamp (para reinício programado)

// Rotina preventiva: reinicia clientes ativos há mais de 24 horas durante a madrugada (limpeza de memória do Puppeteer)
setInterval(async () => {
    const now = Date.now();
    const activeHashes = Object.keys(whatsappClients);
    for (const hash of activeHashes) {
        const initTime = clientInitTime[hash];
        if (initTime && (now - initTime > 24 * 60 * 60 * 1000)) {
            // Executa o reinício apenas na madrugada (entre 1h e 5h) para não impactar atendimentos
            const currentHour = new Date().getHours();
            if (currentHour >= 1 && currentHour <= 5) {
                console.log(`[WhatsApp - Cleanup] Cliente ${hash} ativo por mais de 24 horas. Iniciando reinício de manutenção preventiva.`);
                try {
                    const config = await ConfigService.getSchoolConfig(hash);
                    if (config) {
                        await destroyWhatsAppClient(hash);
                        await delay(5000);
                        await initWhatsApp(hash, config);
                    }
                } catch (err) {
                    console.error(`[WhatsApp - Cleanup] Erro no reinício preventivo de ${hash}:`, err.message);
                }
            }
        }
    }
}, 60 * 60 * 1000); // Roda a cada hora

// Helper para matar processos zumbis do Chrome/Chromium de forma automatizada
function killChromiumProcesses() {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') {
            exec('pkill -f chrome || true; pkill -f chromium || true', (err) => {
                // pkill retorna código 1 se nenhum processo for encontrado. Isso é normal e esperado se a memória já estiver limpa.
                if (err && err.code !== 1) {
                    console.log(`[Aviso] Limpeza de processos Chromium finalizada (código ${err.code || 'OK'}): sem processos ativos.`);
                } else {
                    console.log('Processos Chromium zumbis limpos ou inexistentes.');
                }
                resolve();
            });
        } else {
            exec('taskkill /f /im chrome.exe /im chromedriver.exe 2>nul || exit 0', () => {
                resolve();
            });
        }
    });
}

// Helper para limpar a pasta da sessão e evitar travamento de arquivos
async function cleanSessionFolder(schoolHash) {
    const sessionPath = path.join(__dirname, '.wwebjs_auth', `session-dk_chatbot_session_${schoolHash}`);
    try {
        if (fs.existsSync(sessionPath)) {
            console.log(`Limpando pasta de sessão do WhatsApp para a escola ${schoolHash}...`);
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log(`Pasta de sessão da escola ${schoolHash} limpa com sucesso!`);
        }
    } catch (err) {
        console.error(`Erro ao limpar pasta de sessão para a escola ${schoolHash}:`, err.message);
    }
}

// Helper para remover ouvintes e destruir de forma limpa um cliente do WhatsApp
async function destroyWhatsAppClient(schoolHash) {
    const client = whatsappClients[schoolHash];
    if (client) {
        console.log(`[${schoolHash}] Destruindo cliente WhatsApp existente e removendo ouvintes...`);
        try {
            client.removeAllListeners();
            
            // Tenta obter o PID do browser do Puppeteer para garantir a finalização se necessário
            let pid = null;
            if (client.pupBrowser && client.pupBrowser.process()) {
                pid = client.pupBrowser.process().pid;
            }

            // Tenta encerrar graciosamente com timeout de 5 segundos
            try {
                await Promise.race([
                    client.destroy(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout no destroy')), 5000))
                ]);
            } catch (destroyErr) {
                console.warn(`[${schoolHash}] Falha ou timeout ao destruir cliente (prosseguindo para PID-kill):`, destroyErr.message);
            }

            // Se o processo ainda existir em segundo plano, encerra com SIGKILL
            if (pid) {
                try {
                    process.kill(pid, 'SIGKILL');
                    console.log(`[${schoolHash}] Processo Chromium zumbi (PID ${pid}) finalizado.`);
                } catch (killErr) {
                    // Ignora se o processo já tiver sido encerrado
                }
            }
        } catch (err) {
            console.error(`[${schoolHash}] Erro ao destruir cliente:`, err);
        }
        delete whatsappClients[schoolHash];
    }
}

async function initWhatsApp(schoolHash, schoolConfig) {
    if (isInitializingWhatsApp[schoolHash]) {
        console.log(`[${schoolConfig.nome_fantasia || schoolHash}] WhatsApp Client já está inicializando, ignorando.`);
        return;
    }
    isInitializingWhatsApp[schoolHash] = true;

    // Garante a destruição de qualquer cliente anterior da mesma escola
    await destroyWhatsAppClient(schoolHash);

    console.log(`[${schoolConfig.nome_fantasia || schoolHash}] Inicializando WhatsApp Client...`);
    whatsappStatuses[schoolHash] = 'INITIALIZING';
    whatsappQrData[schoolHash] = null;

    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: `dk_chatbot_session_${schoolHash}`,
            dataPath: path.join(__dirname, '.wwebjs_auth')
        }),
        deviceName: 'chatbot',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        authTimeoutMs: 300000,
        puppeteer: {
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--disable-extensions',
                '--disable-default-apps',
                '--mute-audio',
                '--no-default-browser-check',
                '--disable-web-security',
                '--disable-renderer-backgrounding',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-features=CalculateWindowOcclusionForOccludedWindows'
            ]
        }
    });

    client.on('qr', async (qr) => {
        console.log(`[${schoolConfig.nome_fantasia || schoolHash}] QR Code recebido para WhatsApp.`);
        
        // Se a inicialização NÃO foi manual (foi automática no startup),
        // significa que a sessão salva no disco expirou ou é inválida.
        // Devemos limpar a sessão e colocar como DESCONECTADO para liberar recursos e mostrar o botão de Ativar.
        const isManual = whatsappManualInitRequested[schoolHash] === true;
        if (!isManual) {
            console.log(`[${schoolConfig.nome_fantasia || schoolHash}] Sessão expirada/inválida detectada no startup. Destruindo cliente para poupar recursos...`);
            whatsappStatuses[schoolHash] = 'DISCONNECTED';
            whatsappQrData[schoolHash] = null;
            isInitializingWhatsApp[schoolHash] = false;
            
            setTimeout(async () => {
                try {
                    await destroyWhatsAppClient(schoolHash);
                    await cleanSessionFolder(schoolHash);
                } catch (destroyErr) {
                    console.error(`[${schoolHash}] Erro ao destruir cliente zumbi do startup:`, destroyErr.message);
                }
            }, 1000);
            return;
        }

        try {
            whatsappQrData[schoolHash] = await qrcode.toDataURL(qr);
            whatsappStatuses[schoolHash] = 'QR_READY';
        } catch (err) {
            console.error(`[${schoolConfig.nome_fantasia || schoolHash}] Erro ao gerar QR Code:`, err);
        }
    });

    client.on('ready', () => {
        console.log(`[${schoolConfig.nome_fantasia || schoolHash}] WhatsApp Client conectado e pronto!`);
        whatsappStatuses[schoolHash] = 'CONNECTED';
        whatsappQrData[schoolHash] = null;
        isInitializingWhatsApp[schoolHash] = false;
        whatsappManualInitRequested[schoolHash] = false; // Reset da flag de inicialização manual
        clientInitTime[schoolHash] = Date.now(); // Grava timestamp de conexão pronta
    });

    client.on('authenticated', () => {
        console.log(`[${schoolConfig.nome_fantasia || schoolHash}] WhatsApp Client autenticado!`);
        whatsappStatuses[schoolHash] = 'CONNECTED';
        whatsappQrData[schoolHash] = null;
    });

    client.on('auth_failure', async (msg) => {
        console.error(`[${schoolConfig.nome_fantasia || schoolHash}] Falha na autenticação:`, msg);
        whatsappStatuses[schoolHash] = 'DISCONNECTED';
        whatsappQrData[schoolHash] = null;
        isInitializingWhatsApp[schoolHash] = true;
        await destroyWhatsAppClient(schoolHash);
        setTimeout(async () => {
            await cleanSessionFolder(schoolHash);
            isInitializingWhatsApp[schoolHash] = false;
        }, 1000);
    });

    client.on('disconnected', async (reason) => {
        console.log(`[${schoolConfig.nome_fantasia || schoolHash}] WhatsApp Client desconectado inesperadamente:`, reason);
        whatsappStatuses[schoolHash] = 'DISCONNECTED';
        whatsappQrData[schoolHash] = null;
        isInitializingWhatsApp[schoolHash] = true;
        
        await destroyWhatsAppClient(schoolHash);
        
        // Auto-reconexão para desconexões inesperadas (como quedas de rede ou reinício de processos Chromium)
        console.warn(`[WhatsApp - ${schoolHash}] Tentando auto-reconexão automática em 10 segundos...`);
        setTimeout(async () => {
            isInitializingWhatsApp[schoolHash] = false;
            try {
                const freshConfig = await ConfigService.getSchoolConfig(schoolHash);
                if (freshConfig) {
                    await initWhatsApp(schoolHash, freshConfig);
                }
            } catch (reconErr) {
                console.error(`[WhatsApp - ${schoolHash}] Falha ao tentar auto-reconexão após queda de conexão:`, reconErr.message);
            }
        }, 10000); // Aguarda 10 segundos para restabelecer
    });

    client.on('message_create', async (msg) => {
        try {
            if (msg.fromMe) return; // Ignora mensagens enviadas pelo próprio bot/operador
            if (msg.from.endsWith('@g.us') || msg.isStatus) return;

            const text = msg.body ? msg.body.trim() : '';
            if (!text) return;

            // Verifica se o chatbot está suspenso/bloqueado
            try {
                const school = await ConfigService.getSchoolConfig(schoolHash);
                const paymentStatus = getSchoolPaymentStatus(school);
                if (paymentStatus.blocked) {
                    console.log(`[WhatsApp - ${schoolHash}] Mensagem de WhatsApp de ${msg.from} ignorada pois o chatbot está bloqueado por falta de pagamento.`);
                    return;
                }
            } catch (payErr) {
                console.error(`[WhatsApp - ${schoolHash}] Erro ao verificar pagamento no message_create:`, payErr.message);
            }

            console.log(`[${schoolConfig.nome_fantasia || schoolHash}] Mensagem de WhatsApp de ${msg.from}: "${text}"`);

            const isFirstMessage = !sessions[msg.from];
            const messageToSend = isFirstMessage ? 'menu' : text;
            
            const result = await processChatMessage(msg.from, messageToSend, schoolHash);
            
            if (result && result.response) {
                sendingAutomatedFor.add(msg.from);
                try {
                    const isLid = msg.from.endsWith('@lid');
                    if (isLid) {
                        // Envia direto para contatos @lid para evitar falhas do Puppeteer/getChat
                        await client.sendMessage(msg.from, result.response);
                    } else {
                        try {
                            const chat = await msg.getChat();
                            // Marca como visto (blue ticks)
                            await chat.sendSeen();
                            // Simula digitando
                            await chat.sendStateTyping();
                            
                            // Tempo de espera reduzido para respostas rápidas (máximo 800ms)
                            const textLength = result.response.length;
                            const waitTime = Math.min(200 + (textLength * 1) + (Math.random() * 200), 800);
                            await delay(waitTime);
                            
                            await client.sendMessage(msg.from, result.response);
                            await chat.clearState();
                        } catch (chatErr) {
                            console.warn(`[${schoolConfig.nome_fantasia || schoolHash}] Aviso: Simulação de digitação indisponível para ${msg.from} (${chatErr.message || chatErr})`);
                            await client.sendMessage(msg.from, result.response);
                        }
                    }
                } catch (sendErr) {
                    console.error(`[${schoolConfig.nome_fantasia || schoolHash}] Erro crítico ao enviar mensagem de WhatsApp para ${msg.from}:`, sendErr.message);
                    
                    // Se o erro indicar que o navegador ou página do Puppeteer caiu, reinicia o cliente automaticamente
                    const isCrash = sendErr.message && (
                        sendErr.message.includes('closed') || 
                        sendErr.message.includes('Protocol error') || 
                        sendErr.message.includes('Navigation failed') ||
                        sendErr.message.includes('Target closed') ||
                        sendErr.message.includes('destroyed')
                    );
                    if (isCrash) {
                        console.warn(`[WhatsApp - ${schoolHash}] Falha crítica de comunicação com o navegador detectada! Tentando reestabelecer o serviço...`);
                        setTimeout(async () => {
                            try {
                                await destroyWhatsAppClient(schoolHash);
                                const freshConfig = await ConfigService.getSchoolConfig(schoolHash);
                                if (freshConfig) {
                                    await initWhatsApp(schoolHash, freshConfig);
                                }
                            } catch (reconErr) {
                                console.error(`[WhatsApp - ${schoolHash}] Erro ao tentar reinicializar cliente após crash do Puppeteer:`, reconErr.message);
                            }
                        }, 5000);
                    }
                } finally {
                    setTimeout(() => {
                        sendingAutomatedFor.delete(msg.from);
                    }, 2000);
                }
            }
        } catch (err) {
            console.error(`[${schoolConfig.nome_fantasia || schoolHash}] Erro ao processar mensagem do WhatsApp:`, err);
        }
    });

    whatsappClients[schoolHash] = client;

    client.initialize().catch(err => {
        console.error(`[${schoolConfig.nome_fantasia || schoolHash}] Erro ao inicializar WhatsApp Client:`, err);
        whatsappStatuses[schoolHash] = 'DISCONNECTED';
        isInitializingWhatsApp[schoolHash] = false;
    });
}

// Inicializa o WhatsApp para todas as escolas configuradas no startup
async function startWhatsAppForActiveSchools() {
    try {
        // Mata processos Chromium travados em segundo plano antes do boot
        await killChromiumProcesses();
        
        const activeSchools = await ConfigService.getAllSchools();
        activeSchools.forEach(school => {
            // Verifica se existe pasta de sessão salva para esta escola
            const sessionPath = path.join(__dirname, '.wwebjs_auth', `session-dk_chatbot_session_${school.hash}`);
            if (fs.existsSync(sessionPath)) {
                console.log(`[Startup] Sessão ativa encontrada para a escola [${school.nome_fantasia || school.hash}], iniciando WhatsApp...`);
                initWhatsApp(school.hash, school);
            } else {
                console.log(`[Startup] Nenhuma sessão ativa encontrada para a escola [${school.nome_fantasia || school.hash}], aguardando ativação manual.`);
                whatsappStatuses[school.hash] = 'DISCONNECTED';
            }
        });
    } catch (err) {
        console.error('Erro ao inicializar WhatsApp no startup:', err);
    }
}
startWhatsAppForActiveSchools();

// API Endpoints para obter status do WhatsApp e QR Code
app.get('/api/whatsapp/status', async (req, res) => {
    const { hash } = req.query;
    if (!hash) {
        return res.status(400).json({ error: 'O hash da escola é obrigatório.' });
    }

    let status = whatsappStatuses[hash] || 'DISCONNECTED';
    const qr = whatsappQrData[hash] || null;
    const client = whatsappClients[hash];
    let connectionInfo = null;

    // Se o status for DISCONNECTED e não estiver inicializando, tenta iniciar o cliente apenas se 'init=true' for passado
    const shouldInit = req.query.init === 'true';
    if (status === 'DISCONNECTED' && !isInitializingWhatsApp[hash] && shouldInit) {
        try {
            const schoolConfig = await ConfigService.getSchoolConfig(hash);
            if (schoolConfig) {
                console.log(`[${schoolConfig.nome_fantasia || hash}] Tentando inicializar o WhatsApp via chamada de status...`);
                whatsappManualInitRequested[hash] = true; // Marca como inicialização manual para exibir o QR Code
                // Chama a inicialização de forma assíncrona
                initWhatsApp(hash, schoolConfig);
                status = 'INITIALIZING';
                whatsappStatuses[hash] = 'INITIALIZING';
            }
        } catch (err) {
            console.error('Erro ao reinicializar WhatsApp via rota de status:', err);
        }
    }

    if (status === 'CONNECTED' && client && client.info) {
        connectionInfo = {
            pushname: client.info.pushname,
            wid: client.info.wid ? client.info.wid.user : null
        };
    }
    res.json({
        status,
        qr,
        info: connectionInfo
    });
});

app.post('/api/whatsapp/disconnect', async (req, res) => {
    const { hash } = req.body;
    if (!hash) {
        return res.status(400).json({ error: 'O código da escola é obrigatório. Entre novamente pelo painel admin.' });
    }

    const client = whatsappClients[hash];
    let schoolConfig = {};
    try {
        schoolConfig = await ConfigService.getSchoolConfig(hash) || {};
    } catch (errConfig) {
        console.error('Erro ao buscar configuração no disconnect:', errConfig);
    }

    whatsappStatuses[hash] = 'DISCONNECTING';
    whatsappQrData[hash] = null;
    isInitializingWhatsApp[hash] = true;

    try {
        if (client) {
            client.removeAllListeners();
            // Tenta efetuar o logout na página com timeout de 5 segundos para evitar travamentos
            try {
                await Promise.race([
                    client.logout(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout no logout')), 5000))
                ]);
            } catch (logoutErr) {
                console.warn(`[${hash}] Falha ou timeout no logout do WhatsApp:`, logoutErr.message);
            }
        }
    } catch (err) {
        console.error(`Erro ao desconectar WhatsApp da escola ${hash}:`, err);
    }
    await destroyWhatsAppClient(hash);

    setTimeout(async () => {
        await cleanSessionFolder(hash);
        whatsappStatuses[hash] = 'DISCONNECTED';
        isInitializingWhatsApp[hash] = false;
        // Não reinicializa automaticamente; aguarda o usuário clicar em "Ativar"
    }, 1500);

    res.json({ success: true, message: 'WhatsApp desconectado com sucesso!' });
});

// Rotina de Sincronização Diária de Pagamentos
async function runAllSchoolsPaymentSync() {
    console.log('[Payment Sync] Iniciando rotina diária de sincronização de pagamentos...');
    try {
        const schools = await ConfigService.getAllSchools();
        for (const school of schools) {
            try {
                const result = await ConfigService.syncSchoolPayment(school);
                if (result === null) {
                    console.log(`[Payment Sync] Escola ID ${school.id_atendimento} foi removida por DKAPP inativo. Limpando conexões do WhatsApp...`);
                    await destroyWhatsAppClient(school.hash);
                    try {
                        await cleanSessionFolder(school.hash);
                    } catch (cleanErr) {
                        console.warn(`[Payment Sync] Alerta ao limpar pasta da escola ${school.id_atendimento}:`, cleanErr.message);
                    }
                }
            } catch (schoolErr) {
                console.error(`[Payment Sync] Erro ao sincronizar escola ID ${school.id_atendimento}:`, schoolErr.message);
            }
        }
        console.log('[Payment Sync] Rotina diária de sincronização concluída.');
    } catch (err) {
        console.error('[Payment Sync] Erro na rotina diária de sincronização de pagamentos:', err.message);
    }
}

function scheduleNextDailySync() {
    const now = new Date();
    const nextSync = new Date(now);
    nextSync.setHours(2, 0, 0, 0);

    // Se já passou das 2h da manhã de hoje, agenda para amanhã
    if (now.getTime() >= nextSync.getTime()) {
        nextSync.setDate(nextSync.getDate() + 1);
    }

    const delay = nextSync.getTime() - now.getTime();
    console.log(`[Payment Sync] Próxima sincronização diária agendada para: ${nextSync.toString()} (em ${Math.round(delay / 1000 / 60)} minutos)`);

    setTimeout(async () => {
        try {
            await runAllSchoolsPaymentSync();
        } catch (err) {
            console.error('[Payment Sync] Erro na sincronização programada:', err.message);
        }
        scheduleNextDailySync();
    }, delay);
}

function startDailyPaymentSync() {
    // Roda uma vez no startup (5 segundos após iniciar)
    setTimeout(runAllSchoolsPaymentSync, 5000);
    // Programa as execuções diárias recorrentes para as 2h da manhã
    scheduleNextDailySync();
}
startDailyPaymentSync();

// Inicialização do servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
