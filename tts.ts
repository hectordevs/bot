import * as ortNs from 'onnxruntime-web';

// Explicitly import WASM files for Parcel to bundle them correctly
// @ts-ignore
import ortWasm from 'url:./wasm_assets/ort-wasm.wasm';
// @ts-ignore
import ortWasmSimd from 'url:./wasm_assets/ort-wasm-simd.wasm';
// @ts-ignore
import ortWasmSimdThreaded from 'url:./wasm_assets/ort-wasm-simd-threaded.wasm';

// Lazy initialization to avoid accessing undefined properties at module load time
let ortInitialized = false;
let ort: typeof ortNs;

function getOrt(): typeof ortNs {
    if (!ortInitialized) {
        ort = ((ortNs as any).default || ortNs) as typeof ortNs;

        // Configure ONNX Runtime
        if (ort.env && ort.env.wasm) {
            ort.env.wasm.numThreads = 1;
            ort.env.wasm.simd = false;
            ort.env.wasm.proxy = false;

            ort.env.wasm.wasmPaths = '/';
        }

        ortInitialized = true;
    }
    return ort;
}

// Helper to safely create a Tensor, ensuring TypeScript sees a constructor
function createTensor(type: string, data: any, dims: number[]) {
    const Tensor = getOrt().Tensor as new (type: string, data: any, dims: number[]) => any;
    return new Tensor(type, data, dims);
}

export const AVAILABLE_LANGS = ['en', 'ko', 'es', 'pt', 'fr'];

export function isValidLang(lang: string) {
    return AVAILABLE_LANGS.includes(lang);
}

export class UnicodeProcessor {
    indexer: any;
    constructor(indexer: any) {
        this.indexer = indexer;
    }

    call(textList: string[], langList: string[]) {
        const processedTexts = textList.map((text, i) => this.preprocessText(text, langList[i]));
        // Use spread to correctly count code points (handles surrogate pairs)
        const textIdsLengths = processedTexts.map(text => [...text].length);
        const maxLen = Math.max(...textIdsLengths);

        const textIds = processedTexts.map(text => {
            const row = new Array(maxLen).fill(0);
            let charIdx = 0;
            // for...of correctly iterates over code points
            for (const char of text) {
                const codePoint = char.codePointAt(0)!;
                let id = this.indexer[codePoint];
                if (id === undefined) id = -1;
                // ROBUSTNESS: Never pass -1 to the model. Use 0 (space) for unknown.
                if (id === -1) id = 0;
                if (charIdx < maxLen) row[charIdx++] = id;
            }
            return row;
        });

        const textMask = this.getTextMask(textIdsLengths);
        return { textIds, textMask };
    }

    preprocessText(text: string, lang: string) {
        // --- MEJORAS PARA ESPAÑOL MEXICANO Y EMOCIONES ---
        if (lang === 'es') {
            // Pronunciación Mexicana: "video" (grave) en vez de "vídeo" (esdrújula, España)
            // Se debe ejecutar ANTES de normalize('NFD') para que coincidan los acentos compuestos.
            text = text.replace(/\bvídeo\b/gi, 'video');
            text = text.replace(/\bchófer\b/gi, 'chofer');
            text = text.replace(/\bfútbol\b/gi, 'futbol');

            // Risa: Normalizar jajaja / hahaha para que suene articulado
            // Convierte secuencias largas de ja/ha en "ja ja ja" espaciado
            text = text.replace(/\b([jh]a){2,}\b/gi, (match) => {
                // Generar 'ja ' repetido, máximo 5 veces para no saturar
                const count = Math.min(Math.floor(match.length / 2), 5);
                return ' ' + 'ja '.repeat(count).trim() + ' ';
            });

            // Gritos / Énfasis: Detectar frases en MAYÚSCULAS (antes de NFD)
            // Si detectamos palabras en mayúsculas seguidas (grito), añadimos énfasis.
            // Regex: Busca palabras de 2+ letras mayúsculas (incluyendo acentos).
            const upperWord = "[A-ZÁÉÍÓÚÑ]{2,}";
            const shoutingRegex = new RegExp(`\\b(${upperWord}(?:\\s+${upperWord})+)`, 'g');

            text = text.replace(shoutingRegex, (match) => {
                 // Añadir signos si no los tiene
                 if (!match.includes('!')) {
                     return ` ¡ ${match} ! `;
                 }
                 return match;
            });
        }

        // CRITICAL: This model indexer uses decomposed characters (NFD)
        // for accents and 'ñ'. NFKC was causing them to be mapped to unknown (id 0).
        text = text.normalize('NFD');

        // ROBUST NUMBER TO WORDS CONVERSION (Spanish focus)
        const units = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
        const teens = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'];
        const tens = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
        const hundreds = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

        const numToWords = (n: number): string => {
            if (n === 0) return 'cero';
            if (n > 999999) return n.toString(); // Fallback for huge numbers

            let result = '';
            if (n >= 1000) {
                const thousands = Math.floor(n / 1000);
                result += (thousands === 1 ? 'mil' : numToWords(thousands) + ' mil') + ' ';
                n %= 1000;
            }
            if (n >= 100) {
                if (n === 100) result += 'cien';
                else result += hundreds[Math.floor(n / 100)] + ' ';
                n %= 100;
            }
            if (n >= 20) {
                result += tens[Math.floor(n / 10)];
                n %= 10;
                if (n > 0) result += (result.endsWith('veinte') ? '' : ' y ') + units[n];
            } else if (n >= 10) {
                result += teens[n - 10];
            } else if (n > 0) {
                result += units[n];
            }
            return result.trim();
        };

        // Apply conversion to all numbers found
        text = text.replace(/\d+/g, (match) => {
            const val = parseInt(match);
            return ` , ${numToWords(val)} , `; // Add comma-pauses for natural phonetics
        });

        // MEJORA AGREGADA: Porcentajes decimales (1.5% → uno punto cinco por ciento)
        text = text.replace(/(\d{1,4}(?:\.\d{1,6})?)%/g, (match, numStr) => {
            let spoken = '';
            if (numStr.includes('.')) {
                const [intPart, decPart] = numStr.split('.');
                spoken += numToWords(parseInt(intPart)) + ' punto ' + numToWords(parseInt(decPart));
            } else {
                spoken += numToWords(parseInt(numStr));
            }
            return ` , ${spoken} por ciento , `;
        });

        // MEJORA AGREGADA: Manejo de × como "por"
        text = text.replace(/×/g, ' por ');

        // MEJORA AGREGADA: Comas como separadores de miles (21,600 → veinti seis mil seiscientos)
        text = text.replace(/(\d{1,3}(?:,\d{3})*)/g, (match) => {
            const clean = match.replace(/,/g, '');
            return numToWords(parseInt(clean));
        });

        // PHONETIC EXPANSION: Help Satia breathe and speak clearly
        text = text
            .replace(/%/g, ' por ciento')
            .replace(/\$/g, 'pesos ')
            .replace(/&/g, ' y ')
            .replace(/\+/g, ' más ')
            // PAUSE HANDLING: Convert ... to a breathy pause (comma with spaces)
            .replace(/\.\.\./g, ' , ')
            .replace(/\.\./g, ' , ');

        // DEEP EMPHASIS: Convert triple signs to phonetic markers for the model
        // Screaming enhancement: !!! -> !! ! for more emphasis
        text = text
            .replace(/!!!/g, ' !! ! ')
            .replace(/\?\?\?/g, ' ?? ? ');

        const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;
        text = text.replace(emojiPattern, '');

        const replacements: Record<string, string> = {
            '–': '-', '‑': '-', '—': '-', '_': ' ',
            '\u201C': '"', '\u201D': '"', '\u2018': "'", '\u2019': "'",
            '´': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ', '→': ' ', '←': ' ',
        };
        for (const [k, v] of Object.entries(replacements)) {
            text = text.replaceAll(k, v);
        }
        text = text.replace(/[♥☆♡©\\]/g, '');

        const exprReplacements: Record<string, string> = {
            '@': ' arroba ', 'e.g.,': 'por ejemplo, ', 'i.e.,': 'es decir, ',
        };
        for (const [k, v] of Object.entries(exprReplacements)) {
            text = text.replaceAll(k, v);
        }

        // CLEANUP (Preserving intentional multiple signs)
        text = text.replace(/ ,/g, ','); text = text.replace(/ \./g, '.');
        text = text.replace(/ (!|¡)/g, '$1'); text = text.replace(/ (\?|¿)/g, '$1');
        text = text.replace(/ ;/g, ';'); text = text.replace(/ :/g, ':');
        text = text.replace(/ '/g, "'");

        while (text.includes('""')) text = text.replace('""', '"');
        while (text.includes("''")) text = text.replace("''", "'");
        while (text.includes('``')) text = text.replace('``', '`');

        text = text.replace(/[ \t]+/g, ' ').trim();

        if (!/[.!?;:,'\"')\]}…。」』】〉》›»]$/.test(text)) text += '.';
        if (!isValidLang(lang)) throw new Error(`Invalid lang: ${lang}`);

        // Add a micro-silence space at the start and end of the tag
        return `<${lang}> ${text} </${lang}>`;
    }

    getTextMask(textIdsLengths: number[]) {
        const maxLen = Math.max(...textIdsLengths);
        return this.lengthToMask(textIdsLengths, maxLen);
    }

    lengthToMask(lengths: number[], maxLen: number | null = null) {
        const actualMaxLen = maxLen || Math.max(...lengths);
        return lengths.map(len => {
            const row = new Array(actualMaxLen).fill(0.0);
            for (let j = 0; j < Math.min(len, actualMaxLen); j++) row[j] = 1.0;
            return [row];
        });
    }
}

export class Style {
    ttl: ortNs.Tensor;
    dp: ortNs.Tensor;
    constructor(ttlTensor: ortNs.Tensor, dpTensor: ortNs.Tensor) {
        this.ttl = ttlTensor;
        this.dp = dpTensor;
    }
}

export class TextToSpeech {
    cfgs: any;
    textProcessor: UnicodeProcessor;
    dpOrt: ortNs.InferenceSession;
    textEncOrt: ortNs.InferenceSession;
    vectorEstOrt: ortNs.InferenceSession;
    vocoderOrt: ortNs.InferenceSession;
    sampleRate: number;

    constructor(cfgs: any, textProcessor: UnicodeProcessor, dpOrt: ortNs.InferenceSession, textEncOrt: ortNs.InferenceSession, vectorEstOrt: ortNs.InferenceSession, vocoderOrt: ortNs.InferenceSession) {
        this.cfgs = cfgs;
        this.textProcessor = textProcessor;
        this.dpOrt = dpOrt;
        this.textEncOrt = textEncOrt;
        this.vectorEstOrt = vectorEstOrt;
        this.vocoderOrt = vocoderOrt;
        this.sampleRate = cfgs.ae.sample_rate;
    }

    async _infer(textList: string[], langList: string[], style: Style, totalStep: number, speed: number = 1.05, progressCallback: any = null) {
        const bsz = textList.length;
        const { textIds, textMask } = this.textProcessor.call(textList, langList);
        const textIdsFlat = new BigInt64Array(textIds.flat().map(x => BigInt(x)));
        const textIdsTensor = createTensor('int64', textIdsFlat, [bsz, textIds[0].length]);
        const textMaskFlat = new Float32Array(textMask.flat(2));
        const textMaskTensor = createTensor('float32', textMaskFlat, [bsz, 1, textMask[0][0].length]);

        const dpOutputs = await this.dpOrt.run({ text_ids: textIdsTensor, style_dp: style.dp, text_mask: textMaskTensor });
        const duration = Array.from(dpOutputs.duration.data as Float32Array);
        for (let i = 0; i < duration.length; i++) duration[i] /= speed;

        const textEncOutputs = await this.textEncOrt.run({ text_ids: textIdsTensor, style_ttl: style.ttl, text_mask: textMaskTensor });
        const textEmb = textEncOutputs.text_emb;

        let { xt, latentMask } = this.sampleNoisyLatent(duration, this.sampleRate, this.cfgs.ae.base_chunk_size, this.cfgs.ttl.chunk_compress_factor, this.cfgs.ttl.latent_dim);
        const latentMaskFlat = new Float32Array(latentMask.flat(2));
        const latentMaskTensor = createTensor('float32', latentMaskFlat, [bsz, 1, latentMask[0][0].length]);
        const totalStepTensor = createTensor('float32', new Float32Array(bsz).fill(totalStep), [bsz]);

        for (let step = 0; step < totalStep; step++) {
            if (progressCallback) progressCallback(step + 1, totalStep);
            const currentStepTensor = createTensor('float32', new Float32Array(bsz).fill(step), [bsz]);
            const xtFlat = new Float32Array(xt.flat(2) as number[]);
            const xtTensor = createTensor('float32', xtFlat, [bsz, xt[0].length, xt[0][0].length]);

            const vectorEstOutputs = await this.vectorEstOrt.run({
                noisy_latent: xtTensor, text_emb: textEmb, style_ttl: style.ttl,
                latent_mask: latentMaskTensor, text_mask: textMaskTensor,
                current_step: currentStepTensor, total_step: totalStepTensor
            });
            const denoised = Array.from(vectorEstOutputs.denoised_latent.data as Float32Array);

            const latentDim = xt[0].length;
            const latentLen = xt[0][0].length;
            xt = []; let idx = 0;
            for (let b = 0; b < bsz; b++) {
                const batch = [];
                for (let d = 0; d < latentDim; d++) {
                    const row = [];
                    for (let t = 0; t < latentLen; t++) row.push(denoised[idx++]);
                    batch.push(row);
                }
                xt.push(batch);
            }
        }

        const finalXtFlat = new Float32Array(xt.flat(2) as number[]);
        const finalXtTensor = createTensor('float32', finalXtFlat, [bsz, xt[0].length, xt[0][0].length]);
        const vocoderOutputs = await this.vocoderOrt.run({ latent: finalXtTensor });
        return { wav: Array.from(vocoderOutputs.wav_tts.data as Float32Array), duration };
    }

    async call(text: string, lang: string, style: Style, totalStep: number, speed = 0.92, silenceDuration = 0.4, progressCallback: any = null) {
        if (style.ttl.dims[0] !== 1) throw new Error('Single speaker only');
        // Reduce maxLen to 180 for more stability in Spanish neural patterns
        const maxLen = lang === 'ko' ? 120 : 180;
        const textList = chunkText(text, maxLen);
        const langList = new Array(textList.length).fill(lang);
        let wavCat: number[] = [];
        let durCat = 0;

        for (let i = 0; i < textList.length; i++) {
            const { wav, duration } = await this._infer([textList[i]], [langList[i]], style, totalStep, speed, progressCallback);
            if (wavCat.length === 0) {
                wavCat = wav; durCat = duration[0];
            } else {
                const silenceLen = Math.floor(silenceDuration * this.sampleRate);
                const silence = new Array(silenceLen).fill(0);
                wavCat = [...wavCat, ...silence, ...wav];
                durCat += duration[0] + silenceDuration;
            }
        }
        return { wav: wavCat, duration: [durCat], tokenDurations: [], sampleRate: this.sampleRate };
    }

    sampleNoisyLatent(duration: number[], sampleRate: number, baseChunkSize: number, chunkCompress: number, latentDim: number) {
        const bsz = duration.length;
        const maxDur = Math.max(...duration);
        const wavLenMax = Math.floor(maxDur * sampleRate);
        const wavLengths = duration.map(d => Math.floor(d * sampleRate));
        const chunkSize = baseChunkSize * chunkCompress;
        const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize);
        const latentDimVal = latentDim * chunkCompress;

        const xt: any[] = [];
        for (let b = 0; b < bsz; b++) {
            const batch = [];
            for (let d = 0; d < latentDimVal; d++) {
                const row = [];
                for (let t = 0; t < latentLen; t++) {
                    const u1 = Math.max(0.0001, Math.random());
                    const u2 = Math.random();
                    row.push(Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2));
                }
                batch.push(row);
            }
            xt.push(batch);
        }
        const latentLengths = wavLengths.map(len => Math.floor((len + chunkSize - 1) / chunkSize));
        const latentMask = this.lengthToMask(latentLengths, latentLen);
        // apply mask
        for (let b = 0; b < bsz; b++) for (let d = 0; d < latentDimVal; d++) for (let t = 0; t < latentLen; t++) xt[b][d][t] *= latentMask[b][0][t];
        return { xt, latentMask };
    }

    lengthToMask(lengths: number[], maxLen: number | null) {
        const actualMaxLen = maxLen || Math.max(...lengths);
        return lengths.map(len => {
            const row = new Array(actualMaxLen).fill(0.0);
            for (let j = 0; j < Math.min(len, actualMaxLen); j++) row[j] = 1.0;
            return [row];
        });
    }
}

export async function loadVoiceStyle(voiceStylePaths: any[], verbose = false) {
    const bsz = voiceStylePaths.length;
    let firstStyle;
    if (typeof voiceStylePaths[0] === 'object') firstStyle = voiceStylePaths[0];
    else { const res = await fetch(voiceStylePaths[0]); firstStyle = await res.json(); }

    const ttlDims = firstStyle.style_ttl.dims;
    const dpDims = firstStyle.style_dp.dims;
    const ttlSize = bsz * ttlDims[1] * ttlDims[2];
    const dpSize = bsz * dpDims[1] * dpDims[2];
    const ttlFlat = new Float32Array(ttlSize);
    const dpFlat = new Float32Array(dpSize);

    for (let i = 0; i < bsz; i++) {
        let vs;
        if (typeof voiceStylePaths[i] === 'object') vs = voiceStylePaths[i];
        else { const r = await fetch(voiceStylePaths[i]); vs = await r.json(); }
        ttlFlat.set(vs.style_ttl.data.flat(Infinity), i * ttlDims[1] * ttlDims[2]);
        dpFlat.set(vs.style_dp.data.flat(Infinity), i * dpDims[1] * dpDims[2]);
    }
    return new Style(createTensor('float32', ttlFlat, [bsz, ttlDims[1], ttlDims[2]]), createTensor('float32', dpFlat, [bsz, dpDims[1], dpDims[2]]));
}

export async function loadTextToSpeech(onnxDir: any, sessionOptions = {}, progressCallback: any = null) {
    const cfgs = onnxDir.ttsJson ? onnxDir.ttsJson : await (await fetch(`${onnxDir}/tts.json`)).json();
    let dpPath, textEncPath, vectorEstPath, vocoderPath;
    if (typeof onnxDir === 'object' && onnxDir.durationPredictor) {
        dpPath = onnxDir.durationPredictor; textEncPath = onnxDir.textEncoder;
        vectorEstPath = onnxDir.vectorEstimator; vocoderPath = onnxDir.vocoder;
    } else {
        dpPath = `${onnxDir}/duration_predictor.onnx`; textEncPath = `${onnxDir}/text_encoder.onnx`;
        vectorEstPath = `${onnxDir}/vector_estimator.onnx`; vocoderPath = `${onnxDir}/vocoder.onnx`;
    }

    const sess = [];
    for (const [i, p] of [dpPath, textEncPath, vectorEstPath, vocoderPath].entries()) {
        if (progressCallback) progressCallback(['DP', 'TE', 'VE', 'VO'][i], i, 4);
        sess.push(await getOrt().InferenceSession.create(p, sessionOptions));
    }
    const textProc = new UnicodeProcessor(onnxDir.unicodeIndexer ? onnxDir.unicodeIndexer : await (await fetch(`${onnxDir}/unicode_indexer.json`)).json());
    return { textToSpeech: new TextToSpeech(cfgs, textProc, sess[0], sess[1], sess[2], sess[3]), cfgs };
}

function chunkText(text: string, maxLen = 200) {
    const paragraphs = text.trim().split(/\n\s*\n+/).filter(p => p.trim());
    const chunks = [];
    for (let paragraph of paragraphs) {
        const sentences = paragraph.split(/(?<!\b[A-Z]\.)(?<=[.!?])\s+/);
        let current = "";
        for (let s of sentences) {
            if (current.length + s.length + 1 <= maxLen) current += (current ? " " : "") + s;
            else { if (current) chunks.push(current.trim()); current = s; }
        }
        if (current) chunks.push(current.trim());
    }
    return chunks;
}
