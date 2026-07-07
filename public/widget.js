/**
 * DKSOFT Chatbot
 * Autor: Vinicius P Barbosa
 * Copyright © 2026.
 * É proibida a reprodução ou distribuição sem autorização.
 */

(function () {
    // Detecta a URL base do script para suportar carregamento cross-domain
    const scriptEl = document.currentScript;
    const scriptSrc = scriptEl ? scriptEl.src : '';
    const hostUrl = scriptSrc ? new URL(scriptSrc).origin : window.location.origin;

    let hash = '';
    if (scriptSrc) {
        try {
            const urlObj = new URL(scriptSrc);
            hash = urlObj.searchParams.get('hash') || '';
        } catch (e) {
            console.error('Erro ao processar URL do script widget:', e);
        }
    }
    if (!hash) {
        hash = localStorage.getItem('school_hash') || '';
    }

    // Elementos do widget
    let launcher = null;
    let iframeContainer = null;
    let iframe = null;
    let bubble = null;
    let isOpen = false;
    let botEmoji = '🤖';

    // Configuração de temas padrão
    const themeColors = {
        indigo: '#4f46e5',
        blue: '#0284c7',
        green: '#059669',
        pink: '#db2777',
        amber: '#d97706',
        gray: '#374151'
    };

    // Injeta os estilos do widget na página principal
    function injectStyles(config) {
        const position = config.widget_position || 'right';
        const bottom = parseInt(config.widget_bottom) || 20;
        const side = parseInt(config.widget_side) || 20;
        const width = parseInt(config.widget_width) || 400;
        const height = parseInt(config.widget_height) || 600;

        const containerBottom = bottom + 75;

        const style = document.createElement('style');
        style.innerHTML = `
            .dk-chat-widget-launcher {
                position: fixed;
                bottom: ${bottom}px;
                ${position}: ${side}px;
                width: 60px;
                height: 60px;
                border-radius: 50%;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
                cursor: pointer;
                z-index: 999999;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 28px;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                border: none;
                outline: none;
                color: #ffffff;
                user-select: none;
                overflow: hidden;
            }
            .dk-chat-widget-launcher:hover {
                transform: scale(1.08);
                box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
            }
            .dk-chat-widget-launcher:active {
                transform: scale(0.95);
            }
            .dk-chat-widget-bubble {
                position: fixed;
                bottom: ${bottom + 70}px;
                ${position}: ${side + 5}px;
                background: #ffffff;
                color: #0f172a;
                padding: 10px 16px;
                border-radius: 16px;
                font-family: 'Outfit', sans-serif;
                font-size: 13px;
                font-weight: 600;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
                border: 1px solid rgba(0, 0, 0, 0.08);
                z-index: 999999;
                white-space: nowrap;
                user-select: none;
                pointer-events: none;
                opacity: 1;
                transition: opacity 0.2s ease, transform 0.2s ease, display 0.2s ease;
                display: block;
            }
            .dk-chat-widget-bubble::after {
                content: '';
                position: absolute;
                bottom: -6px;
                ${position}: 20px;
                width: 10px;
                height: 10px;
                background: #ffffff;
                border-right: 1px solid rgba(0, 0, 0, 0.08);
                border-bottom: 1px solid rgba(0, 0, 0, 0.08);
                transform: rotate(45deg);
            }
            .dk-chat-widget-container {
                position: fixed;
                bottom: ${containerBottom}px;
                ${position}: ${side}px;
                width: ${width}px;
                height: ${height}px;
                background: #ffffff;
                border-radius: 20px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
                z-index: 999999;
                overflow: hidden;
                display: none;
                opacity: 0;
                transform: translateY(30px) scale(0.95);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                border: 1px solid rgba(0, 0, 0, 0.08);
            }
            .dk-chat-widget-container.open {
                display: block;
                opacity: 1;
                transform: translateY(0) scale(1);
            }
            .dk-chat-widget-iframe {
                width: 100%;
                height: 100%;
                border: none;
                background: transparent;
            }
            @media (max-width: 480px) {
                .dk-chat-widget-container {
                    width: calc(100% - 40px);
                    height: calc(100% - 60px);
                    bottom: 95px;
                    ${position}: 20px;
                    border-radius: 16px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Carrega informações do bot para customizar o widget dinamicamente
    async function initWidget() {
        let primaryColor = '#4f46e5';
        let config = {};

        try {
            const response = await fetch(`${hostUrl}/api/info?hash=${hash}`);
            config = await response.json();
            if (config.emoji) botEmoji = config.emoji;
            if (config.theme && themeColors[config.theme]) {
                primaryColor = themeColors[config.theme];
            }
        } catch (err) {
            console.error('Erro ao carregar tema dinâmico para widget:', err);
        }

        // Injeta os estilos dinâmicos
        injectStyles(config);

        // Criar botão de launcher (sempre com o emoji)
        launcher = document.createElement('button');
        launcher.className = 'dk-chat-widget-launcher';
        launcher.style.backgroundColor = primaryColor;
        launcher.innerHTML = botEmoji;
        document.body.appendChild(launcher);

        // Criar balão de fala "Posso ajudar?" acima do widget
        const bubbleText = (config.widget_text || 'Posso ajudar?').trim().substring(0, 20);
        if (bubbleText) {
            bubble = document.createElement('div');
            bubble.className = 'dk-chat-widget-bubble';
            bubble.textContent = bubbleText;
            document.body.appendChild(bubble);
        }

        // Criar contêiner do iframe
        iframeContainer = document.createElement('div');
        iframeContainer.className = 'dk-chat-widget-container';
        
        iframe = document.createElement('iframe');
        iframe.className = 'dk-chat-widget-iframe';
        iframe.src = `${hostUrl}/index.html?hash=${hash}`;
        iframeContainer.appendChild(iframe);
        
        document.body.appendChild(iframeContainer);

        // Adiciona evento de clique para abrir/fechar o widget
        launcher.onclick = toggleWidget;
    }

    function toggleWidget() {
        isOpen = !isOpen;
        if (isOpen) {
            if (bubble) {
                bubble.style.opacity = '0';
                bubble.style.transform = 'translateY(10px)';
                setTimeout(() => { if (isOpen) bubble.style.display = 'none'; }, 200);
            }
            iframeContainer.style.display = 'block';
            // Força reflow para transição suave
            iframeContainer.offsetHeight;
            iframeContainer.classList.add('open');
            launcher.innerHTML = '✕';
        } else {
            if (bubble) {
                bubble.style.display = 'block';
                bubble.offsetHeight; // force reflow
                bubble.style.opacity = '1';
                bubble.style.transform = 'translateY(0)';
            }
            iframeContainer.classList.remove('open');
            launcher.innerHTML = botEmoji;
            // Oculta após finalizar transição
            setTimeout(() => {
                if (!isOpen) iframeContainer.style.display = 'none';
            }, 300);
        }
    }

    // Aguarda o carregamento do DOM para inicializar
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initWidget();
    } else {
        window.addEventListener('DOMContentLoaded', initWidget);
    }
})();
