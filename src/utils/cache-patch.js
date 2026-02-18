export async function applyCachePatch() {
    // Intentar parchear la caché existente por si se descargó una versión no válida
    try {
        const cacheName = 'transformers-cache';
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();

        // Se usa una estructura más simple: buscar directamente si la solicitud está en caché
        // pero `cache.keys()` devuelve Request objects, no strings.
        // Iteramos sobre las claves para encontrar la correcta
        for (const request of keys) {
            if (request.url.includes('onnx-community/Qwen3-0.6B-ONNX') && request.url.endsWith('config.json')) {
                console.log("Encontrado config.json en caché, verificando...", request.url);
                const response = await cache.match(request);

                // Necesitamos clonar la respuesta antes de leer el JSON si queremos reutilizarla,
                // aunque aquí vamos a reemplazarla.
                const data = await response.clone().json();

                if (data.model_type === 'qwen3') {
                    console.log("Detectado model_type incorrecto en caché (qwen3). Parcheando a qwen2...");
                    data.model_type = 'qwen2';

                    const newResponse = new Response(JSON.stringify(data), {
                        status: response.status,
                        statusText: response.statusText,
                        headers: { 'Content-Type': 'application/json' }
                    });

                    await cache.put(request, newResponse);
                    console.log("Caché actualizada con éxito. Reiniciando carga...");
                } else {
                    console.log("Config en caché ya es correcto (qwen2).");
                }
            }
        }
    } catch (e) {
        console.warn("No se pudo acceder o parchear la caché (esto es normal en primera carga o modo incógnito):", e);
    }
}
