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
const db = require('./db');
const ConfigService = require('./ConfigService');

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

// Gerenciamento de sessões em memória
const sessions = {};

// Função para validar a escola na base central MySQL
async function validateSchoolCentral(id_atendimento, cnpj) {
    const dkPool = ConfigService.getDksoftPool();

    try {
        const cleanCnpj = cnpj.replace(/\D/g, '');
        // Busca na tabela tclientes com a coluna dkapp
        const [rows] = await dkPool.execute(
            'SELECT id_cliente, nome, cnpj, dkapp FROM TCLIENTES WHERE id_cliente = ?',
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

// Retorna a lista de opções de menu disponíveis com base na configuração e dados do estudante
async function getAvailableOptions(hash, studentId = null) {
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
        options.push({ id: 'validador', label: 'Validador de Certificado', url: config.validador_certificado_link || 'https://appdksoft.com.br/certificado' });
    }

    // 7. Cadastro de Interessados (Apenas se não identificado e showInteressados ativo)
    if (!studentId && showInteressados) {
        options.push({ id: 'cadastro', label: 'Ainda não sou aluno', url: config.cadastro_interessados_link || 'https://www.dksoft.com.br' });
    }

    // 8. Falar com atendente (Apenas se configurado o número de atendimento)
    if (config.atendimento_numero && config.atendimento_numero.toString().trim() !== '') {
        options.push({ 
            id: 'atendente', 
            label: 'Falar com atendente', 
            url: `https://wa.me/${config.atendimento_numero.toString().replace(/\D/g, '')}` 
        });
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
            extraButtons.push({ id: 'validador', label: 'Validador de Certificado', url: config.validador_certificado_link });
        }
        if (config.show_interessados !== false && config.cadastro_interessados_link) {
            extraButtons.push({ id: 'cadastro', label: 'Ainda não sou aluno', url: config.cadastro_interessados_link });
        }
    }

    return { responseText: response, options, extraButtons };
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
            response = `Aqui estão os boletos pendentes para **${studentName}**:\n\n`;
            
            groupIds.forEach(gId => {
                const group = groups[gId];
                response += `📄 **Contrato: ${group.course.contrato} - ${group.course.nome}**\n`;
                
                group.items.forEach((row, index) => {
                    const vencimento = formatDate(row.VENCIMENTO);
                    const valor = formatCurrency(row.VALOR);
                    const link = row.PJ_LINK ? row.PJ_LINK.toString().trim() : '';
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
                        response += `   🔗 [Clique aqui para abrir o boleto](${link})\n`;
                        if (row.PJ_LINHA_DIGITAVEL) {
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
                        response += `   📞 Entre em contato com a secretaria da escola\n\n`;
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
            return `Não encontrei nenhum boleto pendente cadastrado para **${studentName}**. 🎉\n\nEstá tudo em dia! Se precisar de algo mais, escolha outra opção ou digite **Sair**.`;
        }

        response += `Se precisar de algo mais, escolha outra opção ou digite **Sair**.`;
        return response;
    } catch (err) {
        console.error('Erro ao buscar boletos:', err);
        return `Desculpe, ocorreu um erro ao consultar os boletos no banco de dados. Por favor, tente novamente mais tarde.`;
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
            return `Não encontrei nenhum curso ativo ou em andamento para **${studentName}** no momento. 🤷‍♂️\n\nSe precisar de algo mais, digite **Boleto** ou **Sair**.`;
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

        response += `Se precisar de algo mais, digite **Boleto** ou **Sair** para consultar outro CPF.`;
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
            const anoNascimento = getBirthYear(session.student.dataNascimento) || 'Não cadastrado';
            
            let response = `Aqui estão as credenciais para acesso ao seu Portal do Aluno DKSOFT, **${studentName}**:\n\n`;
            response += `💻 **Portal do Aluno DKSOFT**\n`;
            response += `🔗 Link: **[${portalUrl.replace(/^https?:\/\//i, '')}](${portalUrl})**\n`;
            response += `👤 Login: \`${matricula}\`\n`;
            response += `🔑 Senha: \`${anoNascimento}\`\n\n`;
            
            response += `⏰ **Seus Horários de Aula na Plataforma:**\n${schedulesText}\n\n`;
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
        return `Ocorreu um erro ao consultar as integrações de plataforma no banco de dados. Por favor, tente novamente mais tarde.`;
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

// ROTA DO CHATBOT API
async function chatHandler(req, res) {
    const { sessionId, message, hash } = req.body;
    if (!sessionId || typeof message !== 'string') {
        return res.status(400).json({ error: 'Parâmetros inválidos.' });
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
    if (hash && !session.hash) {
        session.hash = hash;
    }

    const text = message.trim();
    const cleanText = text.toLowerCase();

    // Comando global para reiniciar / sair
    if (cleanText === 'sair' || cleanText === 'limpar' || cleanText === 'novo' || cleanText === 'menu') {
        session.step = 'WELCOME';
        session.intent = null;
        session.students = [];
        session.student = null;
        const greeting = await getGreetingMessage(session.hash);
        return res.json({ 
            response: greeting.responseText,
            options: greeting.options,
            isIdentified: false
        });
    }

    // Real-time status check
    if (session.student) {
        const status = await getStudentStatus(session.hash, session.student.id);
        if (status === 'B') {
            session.student = null;
            session.step = 'WELCOME';
            return res.json({
                response: "Entre em contato com a escola para mais informações",
                options: [],
                isIdentified: false
            });
        } else if (status === 'I') {
            session.student = null;
            session.step = 'WELCOME';
            return res.json({
                response: "Não localizei o cadastro",
                options: [],
                isIdentified: false
            });
        }
    }

    // Fluxo de decisão com base nos estados
    if (session.step === 'WELCOME') {
        const options = await getAvailableOptions(session.hash, session.student ? session.student.id : null);
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
                    return cleanText.includes('financeiro') || cleanText.includes('boleto') || cleanText === 'financeiro' || cleanText === 'boleto';
                } else if (opt.id === 'horarios') {
                    return cleanText.includes('horario') || cleanText.includes('horários') || cleanText.includes('aula');
                } else if (opt.id === 'boletim') {
                    return cleanText.includes('boletim') || cleanText.includes('nota') || cleanText.includes('prova') || cleanText.includes('grade');
                } else if (opt.id === 'plataforma') {
                    return cleanText.includes('plataforma') || cleanText.includes('acesso') || cleanText.includes('login') || cleanText.includes('senha') || cleanText.includes('evolua') || cleanText.includes('om') || cleanText.includes('gillis') || cleanText.includes('dkapp');
                } else if (opt.id === 'conteudo') {
                    return cleanText.includes('conteudo') || cleanText.includes('conteúdo') || cleanText.includes('material') || cleanText.includes('online');
                } else if (opt.id === 'atendente') {
                    return cleanText.includes('atendente') || cleanText.includes('atendimento') || cleanText.includes('falar') || cleanText.includes('suporte');
                }
                return false;
            });
        }

        if (selectedOption) {
            if (selectedOption.id === 'financeiro') {
                session.intent = 'boleto';
                if (session.student) {
                    const responseText = await processBoleto(session.hash, session, session.student.id, session.student.nome);
                    const greeting = await getGreetingMessage(session.hash, session.student.id, session.student.nome);
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
                    const responseText = await processHorarios(session.hash, session, session.student.id, session.student.nome);
                    const greeting = await getGreetingMessage(session.hash, session.student.id, session.student.nome);
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
                    return res.json(await handleBoletimCourseSelection(session.hash, session));
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
                    const responseText = await processPlataforma(session.hash, session, session.student.id, session.student.nome);
                    const greeting = await getGreetingMessage(session.hash, session.student.id, session.student.nome);
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
                    const responseText = await processConteudo(session.hash, session, session.student.id, session.student.nome);
                    const greeting = await getGreetingMessage(session.hash, session.student.id, session.student.nome);
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
                const greeting = await getGreetingMessage(session.hash);
                return res.json({
                    response: `Você pode acessar o **Validador de Certificado** aqui: (${config.validador_certificado_link || 'https://suportedksoft.com.br/certificado'})`,
                    options: greeting.options,
                    isIdentified: false
                });
            } else if (selectedOption.id === 'cadastro') {
                const config = (await ConfigService.getSchoolConfig(session.hash)) || {};
                const greeting = await getGreetingMessage(session.hash);
                return res.json({
                    response: `Acesse nosso site para conhecer: (${config.cadastro_interessados_link || 'https://www.dksoft.com.br'})`,
                    options: greeting.options,
                    isIdentified: false
                });
            } else if (selectedOption.id === 'atendente') {
                const config = (await ConfigService.getSchoolConfig(session.hash)) || {};
                const number = config.atendimento_numero ? config.atendimento_numero.replace(/\D/g, '') : '';
                const responseText = number 
                    ? `Para falar com um atendente, clique no link a seguir: https://wa.me/${number}` 
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

        try {
            const results = await db.execute(session.hash, query, params);

            const cleanedResults = results.map(row => {
                row.SITUACAO = row.SITUACAO ? row.SITUACAO.toString().trim() : '';
                return row;
            });

            const activeOrBlocked = cleanedResults.filter(row => row.SITUACAO !== 'I');

            if (results.length > 0 && activeOrBlocked.length === 0) {
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

            if (activeOrBlocked.length === 1) {
                const row = activeOrBlocked[0];
                if (row.SITUACAO === 'B') {
                    return res.json({
                        response: 'Entre em contato com a escola para mais informações',
                        options: [],
                        isIdentified: false
                    });
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
                await fillStudentSessionData(session.hash, session);

                if (session.intent === 'boletim') {
                    return res.json(await handleBoletimCourseSelection(session.hash, session));
                }

                session.step = 'WELCOME';
                
                let responseText = '';
                if (session.intent === 'boleto') {
                    responseText = await processBoleto(session.hash, session, session.student.id, session.student.nome);
                } else if (session.intent === 'horarios') {
                    responseText = await processHorarios(session.hash, session, session.student.id, session.student.nome);
                } else if (session.intent === 'conteudo') {
                    responseText = await processConteudo(session.hash, session, session.student.id, session.student.nome);
                } else if (session.intent === 'plataforma') {
                    responseText = await processPlataforma(session.hash, session, session.student.id, session.student.nome);
                }

                const greeting = await getGreetingMessage(session.hash, session.student.id, session.student.nome);
                return res.json({ 
                    response: responseText,
                    options: greeting.options,
                    isIdentified: true
                });
            }

            session.students = activeOrBlocked.map(row => ({ 
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

        } catch (err) {
            console.error('Erro ao consultar banco:', err);
            return res.json({ 
                response: 'Ocorreu um erro ao acessar o banco de dados. Certifique-se de que a conexão está configurada corretamente no painel administrativo.',
                options: [],
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
        if (selected.situacao === 'B') {
            return res.json({
                response: 'Entre em contato com a escola para mais informações',
                options: [],
                isIdentified: false
            });
        }

        session.student = selected;
        await fillStudentSessionData(session.hash, session);

        if (session.intent === 'boletim') {
            return res.json(await handleBoletimCourseSelection(session.hash, session));
        }

        session.step = 'WELCOME';

        let responseText = '';
        if (session.intent === 'boleto') {
            responseText = await processBoleto(session.hash, session, session.student.id, session.student.nome);
        } else if (session.intent === 'horarios') {
            responseText = await processHorarios(session.hash, session, session.student.id, session.student.nome);
        } else if (session.intent === 'conteudo') {
            responseText = await processConteudo(session.hash, session, session.student.id, session.student.nome);
        } else if (session.intent === 'plataforma') {
            responseText = await processPlataforma(session.hash, session, session.student.id, session.student.nome);
        }

        const greeting = await getGreetingMessage(session.hash, session.student.id, session.student.nome);
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
            const grades = await db.execute(session.hash, gradesQuery, [selectedCourse.id]);
            
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
                responseText += `**Notas:**\n`;
                
                const normalExams = [];
                const mediaExams = [];
                
                grades.forEach(g => {
                    const isMedia = g.MEDIA && g.MEDIA.toString().trim().toUpperCase() === 'S';
                    const notaFormatted = g.NOTA !== null && g.NOTA !== undefined ? g.NOTA.toString() : 'Sem Nota';
                    const provaNome = g.PROVA_NOME ? g.PROVA_NOME.toString().trim() : 'Prova';
                    const dataStr = g.DATA ? ` (${formatDate(g.DATA)})` : '';
                    
                    if (isMedia) {
                        const moduloNome = g.MODULO_NOME ? g.MODULO_NOME.toString().trim() : '';
                        const label = moduloNome ? `MÉDIA - ${moduloNome}` : provaNome;
                        const examLine = `• **${label}**: ${notaFormatted}${dataStr}`;
                        mediaExams.push(examLine);
                    } else {
                        const examLine = `• **${provaNome}**: ${notaFormatted}${dataStr}`;
                        normalExams.push(examLine);
                    }
                });
                
                normalExams.forEach(line => {
                    responseText += `${line}\n`;
                });
                
                if (mediaExams.length > 0) {
                    responseText += `\n**Médias:**\n`;
                    mediaExams.forEach(line => {
                        responseText += `${line}\n`;
                    });
                }
            }

            session.step = 'WELCOME';
            const greeting = await getGreetingMessage(session.hash, session.student.id, session.student.nome);

            responseText += `\n\nSe precisar de algo mais, escolha outra opção ou digite **Sair**.`;

            return res.json({
                response: responseText,
                options: greeting.options,
                isIdentified: true
            });

        } catch (err) {
            console.error('Erro ao buscar notas do boletim:', err);
            session.step = 'WELCOME';
            const greeting = await getGreetingMessage(session.hash, session.student.id, session.student.nome);
            return res.json({
                response: 'Ocorreu um erro ao buscar as notas do boletim. Por favor, tente novamente.',
                options: greeting.options,
                isIdentified: true
            });
        }
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

// ROTAS DE CONFIGURAÇÃO DO BANCO DE DADOS
app.get('/api/config', async (req, res) => {
    const { hash } = req.query;
    try {
        if (hash) {
            const school = await ConfigService.getSchoolConfig(hash);
            if (school) {
                return res.json(school);
            }
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
        return res.status(400).json({ error: 'O hash da escola é obrigatório.' });
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
        return res.status(400).json({ error: 'O hash da escola é obrigatório para testar conexão.' });
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
        const school = hash ? await ConfigService.getSchoolConfig(hash) : null;

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
            widget_height: 600,
            widget_side: 20,
            widget_bottom: 20
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
        const existingConfig = await ConfigService.getSchoolConfig(hash);

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

        // Inicializa o WhatsApp para esta escola se ainda não estiver ativo
        const savedConfig = await ConfigService.getSchoolConfig(hash);
        if (!whatsappClients[hash]) {
            initWhatsApp(hash, savedConfig);
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
            return res.status(403).json({ error: 'DKAPP_INACTIVE' });
        }

        const customMessages = [
            'ID da escola não localizado.',
            'CNPJ incorreto. Se tiver dúvidas, entre em contato com o suporte.',
            'Necessário ativar o DK Escolar Premium para utilizar o chatbot.'
        ];
        const errorMsg = (err && err.message && customMessages.includes(err.message)) 
            ? err.message 
            : 'Falha na conexão';
        res.status(500).json({ error: errorMsg });
    }
});

// --- INTEGRAÇÃO COM WHATSAPP-WEB.JS MULTI-TENANT ---
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const whatsappClients = {};
const whatsappStatuses = {}; // hash -> status
const whatsappQrData = {}; // hash -> qrData
const isInitializingWhatsApp = {}; // hash -> boolean
const lastManualMessageTime = {}; // recipientId -> timestamp
const sendingAutomatedFor = new Set(); // recipientId

// Helper para limpar a pasta da sessão e evitar travamento de arquivos
function cleanSessionFolder(schoolHash) {
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

function initWhatsApp(schoolHash, schoolConfig) {
    if (isInitializingWhatsApp[schoolHash]) {
        console.log(`[${schoolConfig.nome_fantasia || schoolHash}] WhatsApp Client já está inicializando, ignorando.`);
        return;
    }
    isInitializingWhatsApp[schoolHash] = true;

    console.log(`[${schoolConfig.nome_fantasia || schoolHash}] Inicializando WhatsApp Client...`);
    whatsappStatuses[schoolHash] = 'INITIALIZING';
    whatsappQrData[schoolHash] = null;

    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: `dk_chatbot_session_${schoolHash}`
        }),
        webVersionCache: {
            type: 'local',
            path: './.wwebjs_cache/'
        },
        webVersion: '2.3000.1042751833-alpha',
        deviceName: `Bot ${schoolConfig.nome_fantasia || 'DKSoft'}`,
        authTimeoutMs: 300000,
        puppeteer: {
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        }
    });

    client.on('qr', async (qr) => {
        console.log(`[${schoolConfig.nome_fantasia || schoolHash}] QR Code recebido para WhatsApp.`);
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
    });

    client.on('authenticated', () => {
        console.log(`[${schoolConfig.nome_fantasia || schoolHash}] WhatsApp Client autenticado!`);
        whatsappStatuses[schoolHash] = 'CONNECTED';
        whatsappQrData[schoolHash] = null;
    });

    client.on('auth_failure', (msg) => {
        console.error(`[${schoolConfig.nome_fantasia || schoolHash}] Falha na autenticação:`, msg);
        whatsappStatuses[schoolHash] = 'DISCONNECTED';
        whatsappQrData[schoolHash] = null;
        isInitializingWhatsApp[schoolHash] = false;
        try {
            client.destroy();
        } catch (e) {}
        setTimeout(() => {
            cleanSessionFolder(schoolHash);
        }, 1000);
    });

    client.on('disconnected', async (reason) => {
        console.log(`[${schoolConfig.nome_fantasia || schoolHash}] WhatsApp Client desconectado:`, reason);
        whatsappStatuses[schoolHash] = 'DISCONNECTED';
        whatsappQrData[schoolHash] = null;
        try {
            await client.destroy();
        } catch (e) {}
        isInitializingWhatsApp[schoolHash] = false;
        setTimeout(() => {
            cleanSessionFolder(schoolHash);
            initWhatsApp(schoolHash, schoolConfig);
        }, 1500);
    });

    client.on('message', async (msg) => {
        try {
            if (msg.from.endsWith('@g.us') || msg.isStatus) return;

            const text = msg.body ? msg.body.trim() : '';
            if (!text) return;

            console.log(`[${schoolConfig.nome_fantasia || schoolHash}] Mensagem de WhatsApp de ${msg.from}: "${text}"`);

            const isFirstMessage = !sessions[msg.from];
            const messageToSend = isFirstMessage ? 'menu' : text;
            
            const result = await processChatMessage(msg.from, messageToSend, schoolHash);
            
            sendingAutomatedFor.add(msg.from);
            try {
                await msg.reply(result.response);
            } finally {
                setTimeout(() => {
                    sendingAutomatedFor.delete(msg.from);
                }, 2000);
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
        const activeSchools = await ConfigService.getAllSchools();
        activeSchools.forEach(school => {
            initWhatsApp(school.hash, school);
        });
    } catch (err) {
        console.error('Erro ao inicializar WhatsApp no startup:', err);
    }
}
startWhatsAppForActiveSchools();

// API Endpoints para obter status do WhatsApp e QR Code
app.get('/api/whatsapp/status', (req, res) => {
    const { hash } = req.query;
    if (!hash) {
        return res.status(400).json({ error: 'O hash da escola é obrigatório.' });
    }

    const status = whatsappStatuses[hash] || 'DISCONNECTED';
    const qr = whatsappQrData[hash] || null;
    const client = whatsappClients[hash];
    let connectionInfo = null;

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
        return res.status(400).json({ error: 'O hash da escola é obrigatório.' });
    }

    const client = whatsappClients[hash];
    let schoolConfig = {};
    try {
        schoolConfig = await ConfigService.getSchoolConfig(hash) || {};
    } catch (errConfig) {
        console.error('Erro ao buscar configuração no disconnect:', errConfig);
    }

    try {
        if (client) {
            await client.logout();
            await client.destroy();
        }
    } catch (err) {
        console.error(`Erro ao desconectar WhatsApp da escola ${hash}:`, err);
    }

    whatsappStatuses[hash] = 'DISCONNECTED';
    whatsappQrData[hash] = null;
    isInitializingWhatsApp[hash] = false;

    setTimeout(() => {
        cleanSessionFolder(hash);
        initWhatsApp(hash, schoolConfig);
    }, 1500);

    res.json({ success: true, message: 'WhatsApp desconectado com sucesso!' });
});

// Inicialização do servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
