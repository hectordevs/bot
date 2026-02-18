export function applyNetworkPatch() {
    const originalFetch = window.fetch;
    window.fetch = async function(url, options) {
        // Convertir URL object a string si es necesario
        const urlString = url.toString();

        // Detectar si estamos pidiendo el config.json de Qwen3
        if (urlString.includes('onnx-community/Qwen3-0.6B-ONNX') && urlString.endsWith('config.json')) {
            console.log("Interceptando fetch de config.json para parchear model_type...");
            try {
                // Hacemos la petición real
                const response = await originalFetch(url, options);
                if (!response.ok) return response;

                // Obtenemos el JSON
                const data = await response.json();

                // Parcheamos el tipo de modelo
                if (data.model_type === 'qwen3') {
                    console.log("Parcheando model_type: qwen3 -> qwen2");
                    data.model_type = 'qwen2';
                }

                // Retornamos una nueva respuesta con el JSON modificado
                // IMPORTANTE: No pasar response.headers originales, ya que pueden contener
                // Content-Length o Content-Encoding que no coincidirán con el nuevo cuerpo.
                return new Response(JSON.stringify(data), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
            } catch (err) {
                console.error("Error en interceptor de fetch:", err);
                return originalFetch(url, options);
            }
        }

        return originalFetch(url, options);
    };
}
