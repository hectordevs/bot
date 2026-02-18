import { applyNetworkPatch } from './utils/network-patch.js';
import { applyCachePatch } from './utils/cache-patch.js';
import { initModel, ask } from './services/llm-service.js';
import { UI } from './ui/ui-handler.js';

async function boot() {
    // 1. Aplicar parches de red
    applyNetworkPatch();

    // 2. Inicializar UI
    UI.init();

    // 3. Aplicar parches de caché
    await applyCachePatch();

    // 4. Exponer función ask globalmente
    window.ask = ask;

    // 5. Inicializar modelo
    await initModel();
}

// Iniciar
boot();
