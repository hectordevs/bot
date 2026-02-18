// Importar una versión estable y conocida de Transformers.js (alpha.19 soporta la mayoría de modelos recientes)
import { pipeline, env, AutoModelForCausalLM, AutoTokenizer } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0-alpha.19';

// Configuración inicial
// Permitir cache para funcionamiento offline en cargas futuras
env.useBrowserCache = true;
// Forzar descarga desde Hugging Face Hub si no está local
env.allowLocalModels = false;

export { pipeline, env, AutoModelForCausalLM, AutoTokenizer };
