import { AutoModelForCausalLM, AutoTokenizer } from '../config/transformers.js';
import { UI } from '../ui/ui-handler.js';

let model = null;
let tokenizer = null;

export async function initModel() {
    try {
        UI.updateStatus("Conectando con Hugging Face y descargando modelo... (esto puede tardar varios minutos dependiendo de tu conexión)", 'normal');
        UI.showProgress();
        console.log("Iniciando carga del modelo Qwen3-0.6B...");

        // Función de callback para el progreso
        const progressCallback = (progress) => {
            // Ignorar eventos que no sean de descarga de archivo si es posible, o manejarlos
            if (!progress) return;
            if (progress.status === 'progress') {
                const percent = Math.round(progress.progress || 0);
                const fileName = progress.file || 'archivo';
                UI.updateProgress(percent, fileName);

                if (percent % 10 === 0) {
                        console.log(`Progreso: ${fileName} - ${percent}%`);
                }
            } else if (progress.status === 'initiate') {
                if (UI.progressText) UI.progressText.innerText = `Iniciando descarga de ${progress.file}...`;
                console.log(`Iniciando descarga: ${progress.file}`);
            } else if (progress.status === 'done') {
                if (UI.progressText) UI.progressText.innerText = `Completado: ${progress.file}`;
                console.log(`Descarga completada: ${progress.file}`);
            }
        };

        // Cargar componentes individualmente para tener control total
        const modelId = 'onnx-community/Qwen3-0.6B-ONNX';

        console.log("Cargando tokenizer...");
        tokenizer = await AutoTokenizer.from_pretrained(modelId, {
            progress_callback: progressCallback,
        });

        console.log("Cargando modelo...");
        // Gracias al interceptor de fetch, 'config.json' se leerá como 'qwen2'
        model = await AutoModelForCausalLM.from_pretrained(modelId, {
            dtype: 'q4f16',
            progress_callback: progressCallback
        });

        UI.hideProgress();
        UI.updateStatus("Modelo cargado y listo para usar.", 'loaded');
        console.log("Modelo cargado exitosamente. Ya puedes usar la función ask().");
        console.log("Ejemplo: ask('Hola mundo', console.log)");

    } catch (err) {
        UI.hideProgress();
        UI.updateStatus("Error crítico cargando el modelo: " + err.message, 'error');
        console.error("Error detallado:", err);
    }
}

export async function ask(prompt, callback) {
    if (!model || !tokenizer) {
        console.warn("El modelo aún se está cargando, por favor espera...");
        alert("El modelo aún se está cargando. Mira el estado en la página.");
        return;
    }

    UI.updateStatus("Generando respuesta...", 'normal');

    try {
        // 1. Construir prompt manualmente
        const promptString = `<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n`;

        // 2. Tokenizar
        const inputs = await tokenizer(promptString);
        console.log("Inputs:", inputs);

        // 3. Generar
        const outputs = await model.generate({
            ...inputs,
            max_new_tokens: 256,
            do_sample: false
        });

        // 4. Decodificar
        const decoded = tokenizer.decode(outputs[0], { skip_special_tokens: true });

        // Limpiar el prompt del resultado si se incluye
        // Normalmente generate incluye el input.
        // Buscamos la respuesta del asistente.
        let responseText = decoded;
        const assistantTag = "assistant";
        if (responseText.includes(assistantTag)) {
            responseText = responseText.split(assistantTag).pop().trim();
        }

        UI.updateStatus("Respuesta generada. Listo para la siguiente pregunta.", 'normal');

        if (callback && typeof callback === 'function') {
            callback(responseText);
        } else {
            console.log("Respuesta:", responseText);
        }
    } catch (err) {
        console.error("Error durante la generación:", err);
        UI.updateStatus("Error generando respuesta: " + err.message, 'error');
        if (callback) callback("Error: " + err.message);
    }
};
