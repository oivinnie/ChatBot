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
            hash = urlObj.searchParams.get('i') || urlObj.searchParams.get('hash') || '';
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
        const height = parseInt(config.widget_height) || 750;

        const containerBottom = bottom + 75;

        const style = document.createElement('style');
        style.id = 'dk-widget-styles';
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
            @media (max-width: 768px) {
                .dk-chat-widget-launcher {
                    bottom: 15px !important;
                    ${position}: 15px !important;
                }
                .dk-chat-widget-bubble {
                    bottom: 85px !important;
                    ${position}: 20px !important;
                }
                .dk-chat-widget-container {
                    width: calc(100% - 30px) !important;
                    max-width: 450px !important;
                    height: auto !important;
                    top: 15px !important;
                    bottom: 90px !important;
                    ${position}: 15px !important;
                    border-radius: 16px !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    let throbberEl = null;

    function showThrobber() {
        if (throbberEl) return;
        
        if (!document.getElementById('dk-throbber-animation')) {
            const anim = document.createElement('style');
            anim.id = 'dk-throbber-animation';
            anim.innerHTML = `
                @keyframes dk-throbber-spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(anim);
        }

        throbberEl = document.createElement('div');
        throbberEl.id = 'dk-chat-widget-throbber';
        throbberEl.style.position = 'fixed';
        throbberEl.style.bottom = '30px';
        throbberEl.style.right = '30px';
        throbberEl.style.width = '30px';
        throbberEl.style.height = '30px';
        throbberEl.style.borderRadius = '50%';
        throbberEl.style.border = '3px solid rgba(0, 0, 0, 0.08)';
        throbberEl.style.borderTopColor = '#4f46e5';
        throbberEl.style.animation = 'dk-throbber-spin 1s infinite linear';
        throbberEl.style.zIndex = '999999';
        
        document.body.appendChild(throbberEl);
    }

    function hideThrobber() {
        if (throbberEl) {
            throbberEl.remove();
            throbberEl = null;
        }
    }

    function buildWidget(config, primaryColor) {
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
        iframe.src = `${hostUrl}/index.html?i=${hash}&iframe=true`;
        iframeContainer.appendChild(iframe);
        
        document.body.appendChild(iframeContainer);

        // Adiciona evento de clique para abrir/fechar o widget
        launcher.onclick = toggleWidget;
    }

    function updateWidgetIfChanged(config, newConfig) {
        let needsUpdate = false;
        
        let newBotEmoji = newConfig.emoji || '🤖';
        if (newBotEmoji !== botEmoji) {
            botEmoji = newBotEmoji;
            needsUpdate = true;
        }

        let newPrimary = '#4f46e5';
        if (newConfig.theme && themeColors[newConfig.theme]) {
            newPrimary = themeColors[newConfig.theme];
        }

        if (newConfig.widget_text !== config.widget_text || 
            newConfig.widget_height !== config.widget_height || 
            newConfig.widget_width !== config.widget_width ||
            newConfig.widget_position !== config.widget_position ||
            newConfig.widget_bottom !== config.widget_bottom ||
            newConfig.widget_side !== config.widget_side) {
            needsUpdate = true;
        }

        if (needsUpdate) {
            const oldStyle = document.querySelector('style[id="dk-widget-styles"]');
            if (oldStyle) oldStyle.remove();
            
            injectStyles(newConfig);
            
            if (launcher) {
                launcher.style.backgroundColor = newPrimary;
                if (!isOpen) launcher.innerHTML = botEmoji;
            }
            if (bubble) {
                const newBubbleText = (newConfig.widget_text || 'Posso ajudar?').trim().substring(0, 20);
                bubble.textContent = newBubbleText;
            }
        }
    }

    // Carrega informações do bot para customizar o widget dinamicamente
    async function initWidget() {
        let primaryColor = '#4f46e5';
        let config = {};

        const cacheKey = `bot_info_${hash}`;
        const cachedConfig = localStorage.getItem(cacheKey);
        
        let hasCache = false;
        if (cachedConfig) {
            try {
                config = JSON.parse(cachedConfig);
                if (config.emoji) botEmoji = config.emoji;
                if (config.theme && themeColors[config.theme]) {
                    primaryColor = themeColors[config.theme];
                }
                hasCache = true;
            } catch (e) {
                console.error('Erro ao ler cache do widget config:', e);
            }
        }

        if (hasCache) {
            buildWidget(config, primaryColor);
        } else {
            showThrobber();
        }

        // Faz a requisição para obter configurações atualizadas
        try {
            const res = await fetch(`${hostUrl}/api/info?i=${hash}`);
            if (res.status === 404) {
                localStorage.removeItem(cacheKey);
                if (launcher) launcher.remove();
                if (bubble) bubble.remove();
                if (iframeContainer) iframeContainer.remove();
                hideThrobber();
                return;
            }
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            
            const newConfig = await res.json();
            localStorage.setItem(cacheKey, JSON.stringify(newConfig));
            
            if (!hasCache) {
                hideThrobber();
                if (newConfig.emoji) botEmoji = newConfig.emoji;
                if (newConfig.theme && themeColors[newConfig.theme]) {
                    primaryColor = themeColors[newConfig.theme];
                }
                buildWidget(newConfig, primaryColor);
            } else {
                updateWidgetIfChanged(config, newConfig);
            }
        } catch (err) {
            console.error('Erro ao atualizar tema dinâmico para widget:', err);
            if (!hasCache) {
                hideThrobber();
                buildWidget(config, primaryColor);
            }
        }
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
