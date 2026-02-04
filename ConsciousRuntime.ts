import { MicManager } from './MicManager';
import { ConsciousResponse, SYSTEM_PROMPT, CONTINUOUS_SHOW_PROMPT, MONOLOGUE_PROMPT } from './SchemaDefinition';
import { LLMService } from './LLMService';
import { TTSService } from './TTSService';
import { AvatarSystem } from './AvatarSystem';
import { Lipsync } from 'wawa-lipsync';

const NATURAL_INTERJECTIONS = [
    "okay...", "ya güey...", "mmm...", "mmta...", "vale, vale...", "ya pues...",
    "¡ay ya!", "ándale pues...", "bueno...", "Sale...", "corta ya...", "¡ay, qué horror!"
];

const IDLE_NUDGES = [
    "¿Sigues ahí, wey?",
    "¡Holaaaa! El show no se hace solo, ¿te acuerdas?",
    "Ejem...",
    "Oye, me estás chibeando con tanto silencio.",
    "¿Te dio pánico escénico o qué onda?",
    "Neta, mi abuela habla más que tú y ya se murió.",
    "¿Hola? ¿Hay alguien en casa?",
    "O sea, neta, ¿me vas a dejar aquí tirando rostro solita?",
    "¿Te comió la lengua el gato o qué?"
];

export type RuntimeState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';

/**
 * Interface to handle internal properties of the Lipsync library
 * that might not be exposed in the public type definition.
 */
interface LipsyncInternals {
    audioContext: AudioContext;
    analyser: AnalyserNode;
    sampleRate: number;
    binWidth: number;
    dataArray: Uint8Array;
}

export class ConsciousRuntime {
    public state: RuntimeState = 'IDLE';

    private currentAudio: HTMLAudioElement | null = null;
    private isSpeakingLipSync = false;
    private lastSatiaSpeechEndTime = 0;
    private backgroundMusic: HTMLAudioElement | null = null;
    private responseQueue: ConsciousResponse[] = [];
    private isProcessingQueue = false;
    private nextAudioStartTime = 0; // Tracks the next available slot on the timeline

    // Browser STT - Managed by MicManager
    private lastUserActivityTime = Date.now();
    private lastIdleNudgeTime = Date.now();
    private isThinking = false;
    private isProactiveProcessing = false;
    private _introTriggered = false;
    private _introFinished = false;
    private _isIntroApplauseActive = false;
    private lastNewsContext = "";
    private _outroApplauseTriggered = false;
    private outroApplause: HTMLAudioElement | null = null;
    private activeSources: AudioBufferSourceNode[] = [];
    private sttBuffer: string = "";

    // Sub-systems
    private micManager: MicManager;
    private llm: LLMService;
    private tts: TTSService;
    private avatar: AvatarSystem;
    private lipsync: Lipsync;

    private history: any[] = [];
    private audioContext: AudioContext;

    private mainAnalyser: AnalyserNode;
    private masterGain: GainNode;
    private broadcastEQ: BiquadFilterNode;
    private broadcastCompressor: DynamicsCompressorNode;
    private pannerNode: StereoPannerNode;

    // STT Handler reference for cleanup
    private sttHandler: (e: any) => void;
    private sttProcessingTimeout: any = null;
    private musicDuckingTimeout: any = null;
    private isVadSpeaking = false;

    constructor(canvas: HTMLCanvasElement) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });

        // Initialize Sub-systems
        this.llm = new LLMService();
        this.tts = new TTSService();
        this.avatar = new AvatarSystem(canvas);
        this.micManager = new MicManager(this.audioContext);
        this.lipsync = new Lipsync({ fftSize: 1024, historySize: 5 });

        // Initialize Audio Graph
        const nodes = this.initializeAudioGraph();
        this.mainAnalyser = nodes.mainAnalyser;
        this.masterGain = nodes.masterGain;
        this.broadcastCompressor = nodes.broadcastCompressor;
        this.broadcastEQ = nodes.broadcastEQ;
        this.pannerNode = nodes.pannerNode;

        // Initialize Lipsync Workarounds
        this.initializeLipsyncHack();

        // Initialize Avatar Loop Hooks
        this.initializeAvatarHooks();

        // Global Listener reference for cleanup
        this.sttHandler = (e: any) => {
            if (e.detail) {
                this.handleSTT(e.detail.text, e.detail.isFinal);
            }
        };
        window.addEventListener('conscious-stt-live', this.sttHandler);
    }

    private initializeAudioGraph() {
        const mainAnalyser = this.audioContext.createAnalyser();
        mainAnalyser.fftSize = 1024;

        const masterGain = this.audioContext.createGain();
        masterGain.connect(this.audioContext.destination);
        masterGain.connect(mainAnalyser);

        // BROADCAST ATTITUDE: Compressor + EQ for that "Premium Diva" sound
        const broadcastCompressor = this.audioContext.createDynamicsCompressor();
        broadcastCompressor.threshold.setValueAtTime(-24, this.audioContext.currentTime);
        broadcastCompressor.knee.setValueAtTime(30, this.audioContext.currentTime);
        broadcastCompressor.ratio.setValueAtTime(12, this.audioContext.currentTime);
        broadcastCompressor.attack.setValueAtTime(0.003, this.audioContext.currentTime);
        broadcastCompressor.release.setValueAtTime(0.25, this.audioContext.currentTime);
        broadcastCompressor.connect(masterGain);

        const broadcastEQ = this.audioContext.createBiquadFilter();
        broadcastEQ.type = 'peaking';
        broadcastEQ.frequency.setValueAtTime(3000, this.audioContext.currentTime);
        broadcastEQ.Q.setValueAtTime(1.2, this.audioContext.currentTime);
        broadcastEQ.gain.setValueAtTime(3, this.audioContext.currentTime); // Subtle clarity boost
        broadcastEQ.connect(broadcastCompressor);

        const pannerNode = this.audioContext.createStereoPanner();
        pannerNode.connect(broadcastEQ);
        pannerNode.pan.value = 0;

        return { mainAnalyser, masterGain, broadcastCompressor, broadcastEQ, pannerNode };
    }

    private initializeLipsyncHack() {
        // CRITICAL FIX: Share AudioContext with Lipsync to prevent "InvalidAccessError"
        // Using explicit casting to internal interface
        const lipsyncInternal = this.lipsync as unknown as LipsyncInternals;
        lipsyncInternal.audioContext = this.audioContext;
        lipsyncInternal.analyser = this.mainAnalyser;

        // Fix Internal Physics of Lipsync (SampleRate Mismatch)
        lipsyncInternal.sampleRate = this.audioContext.sampleRate;
        lipsyncInternal.binWidth = this.audioContext.sampleRate / lipsyncInternal.analyser.fftSize;
        lipsyncInternal.dataArray = new Uint8Array(lipsyncInternal.analyser.frequencyBinCount);
    }

    private initializeAvatarHooks() {
        // Main Loop: Hook into AvatarSystem's internal loop
        this.avatar.onUpdate = (delta: number) => {
            const now = this.audioContext.currentTime;

            // 1. SPATIAL AUDIO & PROXIMITY MODULATION
            if (this.avatar.vrm) {
                // Lateral Panning (Smooth Transition)
                const rotation = (this.avatar.vrm.scene as any).rotation.y;
                const targetPan = Math.sin(rotation) * 0.45;
                this.pannerNode.pan.setTargetAtTime(targetPan, now, 0.15); // Suavizado premium

                // Proximity Volume Logic (Camera distance)
                // Closer = Max Volume (1.0), Further = 80% (0.8)
                const dist = this.avatar.getCameraDistance();
                const minDist = 0.8; // Closest possible
                const maxDist = 2.5; // Furthest common
                const proximityFactor = Math.max(0.8, Math.min(1.0, 1.0 - (dist - minDist) / (maxDist - minDist) * 0.2));

                // Final gain update with smoothing to avoid "pops"
                this.masterGain.gain.setTargetAtTime(proximityFactor, now, 0.2);
            }

            // Lipsync Logic
            if (this.isSpeakingLipSync) {
                try {
                    this.updateLipSyncTick();
                } catch (e) {
                    // Suppress lip sync errors to avoid spamming console
                }
            }
            this.checkBoredom();
        };
    }

    public dispose() {
        window.removeEventListener('conscious-stt-live', this.sttHandler);
        this.stopSpeaking();
        if (this.backgroundMusic) {
            this.backgroundMusic.pause();
            this.backgroundMusic = null;
        }
        if (this.micManager) this.micManager.dispose();
        if (this.avatar) this.avatar.dispose?.();

        // Disconnect main audio nodes
        try {
            this.masterGain.disconnect();
            this.mainAnalyser.disconnect();
        } catch (e) {
            console.warn("[Runtime] Error disconnecting audio nodes:", e);
        }
    }

    private handleSTT(text: string, isFinal: boolean) {
        if (!text) return;

        const now = Date.now();
        const cleanText = text.trim();

        // 1. VISUAL LOGGING
        if (isFinal) {
            console.log(`%c 🎤 USER FINAL: "${cleanText.toUpperCase()}" `, 'background: #0ea5e9; color: white; font-weight: bold; padding: 2px 8px; border-radius: 4px;');
        }

        // 2. STATE-BASED FILTERING
        if (this.state === 'SPEAKING' || this.state === 'THINKING' || this.isProcessingQueue) {
            // ORGANIC INTERRUPTION: If user is talking over her, we look for intent
            const interruptRegex = /^(espera|detente|calla|shh|alto|corta|detener|parar|quieto|shutup|cállate|para para|basta basta|silencio silencio|calla calla|ya cállate|cállate ya|silénciate|para calla|vale vale|escúchame|déjame hablar|un momento|silencio|basta|stop|ya ya|no no|sh)$/i;
            const isShortCommand = cleanText.split(' ').length <= 4;

            if (isShortCommand && interruptRegex.test(cleanText)) {
                // Short bursts or keywords stop her
                console.log(`%c 🛑 INTERRUPCIÓN ORGÁNICA: "${cleanText}" `, 'background: #f43f5e; color: white; font-weight: bold; padding: 4px 12px; border-radius: 6px;');
                this.stopSpeaking();
                this.sttBuffer = "";
                return;
            }

            // DUCKING EFFECT: If she's speaking and you talk, she gets quieter but keeps going
            if (this.state === 'SPEAKING') {
                this.masterGain.gain.setTargetAtTime(0.35, this.audioContext.currentTime, 0.1);
            }
            return;
        }

        // 3. ECHO FILTERING (Very tight 200ms window)
        const timeSinceLastSpeech = now - this.lastSatiaSpeechEndTime;
        if (timeSinceLastSpeech < 200) {
            this.sttBuffer = "";
            return;
        }

        // 4. FULL GUEST CAPTURE (When state is LISTENING)
        this.lastUserActivityTime = now;

        if (isFinal) {
            this.sttBuffer += (this.sttBuffer ? " " : "") + cleanText;

            // Wait for 600ms of silence before processing the whole block
            if (this.sttProcessingTimeout) clearTimeout(this.sttProcessingTimeout);
            this.sttProcessingTimeout = setTimeout(() => {
                const fullMessage = this.sttBuffer.trim();
                if (fullMessage.length > 0) {
                    console.log(`%c 🧠 PROCESANDO: "${fullMessage}" `, 'background: #8b5cf6; color: white; font-weight: bold; padding: 2px 8px; border-radius: 4px;');
                    this.processThinking(fullMessage);
                    this.sttBuffer = "";
                }
            }, 600);
        }
    }

    private checkBoredom() {
        if (this.state !== 'LISTENING' || this.isSpeakingLipSync || this.isProactiveProcessing || !this._introFinished) {
            return;
        }

        const now = Date.now();
        const idleTime = (now - this.lastUserActivityTime) / 1000;

        // 1. PROACTIVE SHOW (The main reset)
        // Set to 60s as requested
        if (idleTime > 60) {
            this.processContinuousShow();
            return;
        }

        // 2. IDLE NUDGES (Keep her alive while waiting)
        // Every 12-18 seconds, she makes a small gesture or noise
        const nudgeIdleTime = (now - this.lastIdleNudgeTime) / 1000;
        if (nudgeIdleTime > 15) {
            this.lastIdleNudgeTime = now;
            this.playIdleNudge();
        }
    }

    private async playIdleNudge() {
        if (this.state !== 'LISTENING' || this.isSpeakingLipSync) return;

        const nudgeText = IDLE_NUDGES[Math.floor(Math.random() * IDLE_NUDGES.length)];
        const emotions: any[] = ['fun', 'surprised', 'neutral', 'relaxed'];
        const reactions: any[] = ['explaining', 'acknowledging', 'pouting', 'looking_around'];

        try {
            const res = await this.tts.synthesize(nudgeText, 'F4', emotions[Math.floor(Math.random() * emotions.length)]);
            if (res && this.state === 'LISTENING') {
                this.scheduleAudioChunk(res.audioData, res.sampleRate, {
                    pitch: 1.0,
                    animation: reactions[Math.floor(Math.random() * reactions.length)] as any
                });
            }
        } catch (e) {
            console.warn("[Runtime] Idle nudge failed:", e);
        }
    }

    private async processContinuousShow() {
        if (this.isProactiveProcessing) return;
        this.isProactiveProcessing = true;
        this.lastUserActivityTime = Date.now();

        try {
            // 1. Fetch live trends from server.php
            let newsContext = "noticias actuales";
            try {
                const res = await fetch('/api/trends');
                if (res.ok) {
                    const data = await res.json();
                    newsContext = data.choices[0].message.content;
                    this.lastNewsContext = newsContext;
                }
            } catch (e) {
                console.warn("[Trends] Failed to fetch live trends, using cached/fallback.");
            }

            // 2. Instruct Satia to keep the show going
            const fullPrompt = `${CONTINUOUS_SHOW_PROMPT}\nCONTEXTO ACTUAL: "${newsContext}"`;
            await this.processThinking(fullPrompt);
        } finally {
            this.isProactiveProcessing = false;
        }
    }

    // STT Management moved to MicManager (Always Listening for interrupt)

    // --- LOGIC ---

    private updateLipSyncTick() {
        this.lipsync.processAudio();
        const viseme = this.lipsync.viseme;
        const volume = this.lipsync.features ? this.lipsync.features.volume : 0;

        // Multipliers for more expressive mouth movement
        const intensity = Math.min(1.0, volume * 14.0);

        if (intensity > 0.05) {
            this.avatar.setViseme(viseme || 'viseme_aa', intensity, 'vowel');
        } else {
            this.avatar.setViseme('viseme_sil', 0, 'silent');
        }
    }

    public stopSpeaking() {
        // console.log("[Runtime] Force STOP Speaking & Flush Queue");

        // CANCEL PENDING PROCESSING: Don't answer the "Shut up" command
        if (this.sttProcessingTimeout) {
            clearTimeout(this.sttProcessingTimeout);
            this.sttProcessingTimeout = null;
        }

        this.responseQueue = []; // Clear pending segments
        this.sttBuffer = ""; // Wipe any residuals immediately
        this.lastSatiaSpeechEndTime = Date.now(); // Mark as finished NOW to block echo leakage
        this.nextAudioStartTime = this.audioContext.currentTime; // Reset timeline to now

        // Clear all active sources immediately
        this.activeSources.forEach(source => {
            try {
                source.onended = null; // Prevent triggering follow-up logic
                source.stop();
            } catch (e) { }
        });
        this.activeSources = [];

        // Restore volume if it was ducked
        this.masterGain.gain.setTargetAtTime(1.0, this.audioContext.currentTime, 0.2);

        // CLEANUP ALL QUEUES AND FLAGS
        this.responseQueue = [];
        this.isProcessingQueue = false;
        this.isThinking = false;
        this.isProactiveProcessing = false;
        this.lastUserActivityTime = Date.now();
        this.lastIdleNudgeTime = Date.now();
        this.sttBuffer = "";

        this.isSpeakingLipSync = false;
        if (this.avatar) {
            this.avatar.isSpeaking = false;
            this.avatar.setViseme('viseme_sil', 0, 'silent');
            this.avatar.stopSpeaking();
            this.avatar.playAnimation('surprised_gesture', false); // Visual cue of interruption
            this.avatar.setEmotion('surprised');
            this.avatar.setDirectorMode('NORMAL');
        }

        this.transitionTo('LISTENING');
        this.updateMusicDucking();
    }

    private async playNaturalInterjection() {
        const text = NATURAL_INTERJECTIONS[Math.floor(Math.random() * NATURAL_INTERJECTIONS.length)];

        try {
            const result = await this.tts.synthesize(text, 'F4', 'neutral');
            if (result && this.state === 'LISTENING') {
                const normalized = this.normalizeAudio(result.audioData);
                const audioBuffer = this.audioContext.createBuffer(1, normalized.length, result.sampleRate);
                audioBuffer.copyToChannel(normalized as any, 0);

                const source = this.audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(this.masterGain);

                this.isSpeakingLipSync = true;
                this.avatar.isSpeaking = true;
                this.avatar.playAnimation('agreeing', false); // Short natural gesture

                source.onended = () => {
                    this.isSpeakingLipSync = false;
                    this.avatar.isSpeaking = false;
                    this.avatar.setViseme('viseme_sil', 0, 'silent');
                };

                source.start(0);
            }
        } catch (e) {
            console.warn("[Runtime] Failed to play interjection:", e);
        }
    }

    public async start() {
        // Initialize and play background music at 10% volume
        this.backgroundMusic = new Audio('assets/media/backgroundmusic4ever.mp3');
        this.backgroundMusic.loop = true;
        this.backgroundMusic.volume = 0.5;
        this.backgroundMusic.play().catch(e => console.warn("[Audio] Background music auto-play blocked:", e));

        // Models should already be loaded by preloadStudio() in index.html
        // We just ensure TTS is initialized (safe to call multiple times)
        await this.tts.init();

        // Start VAD Manager (echo-cancelled stream)
        this.micManager.onSpeechStart = () => {
            this.isVadSpeaking = true;
            if (this.avatar) {
                this.avatar.setUserTalking(true);
            }

            // DUCKING: Immediate volume dip when guest starts talking
            if (this.state === 'SPEAKING') {
                this.masterGain.gain.setTargetAtTime(0.3, this.audioContext.currentTime, 0.15);
            }

            if (this.state === 'LISTENING') {
                this.avatar.playAnimation('listening', true);
            }
        };

        this.micManager.onSpeechEnd = () => {
            if (this.avatar) {
                this.avatar.setUserTalking(false);
            }

            // RESTORE VOLUME: Back to normal when guest stops talking
            this.masterGain.gain.setTargetAtTime(1.0, this.audioContext.currentTime, 0.4);

            setTimeout(() => { this.isVadSpeaking = false; }, 2000);
        };

        this.micManager.onAnalyze = (vol) => {
            // Optional volume visualizer
        };

        await this.micManager.start();

        // RUN INTRO SEQUENCE
        this.avatar.setDirectorMode('TV'); // Point at TV first
        await this.runIntroSequence();
    }

    public async runIntroSequence() {
        // console.log("[Intro] Starting Multi-Stage Studio Intro...");
        this.avatar.setDirectorMode('TV');
        // IMMEDIATE VIDEO START
        const video = this.avatar.playTVVideo('assets/media/videointro.mp4', false);
        if (video) {
            video.currentTime = 0;
            video.play().catch(() => { });
        }

        // Parallel Audio Kickoff
        this.avatar.playAudioEffect('assets/media/aplausosinicio.mp3');

        // Ensure background music is solid
        if (this.backgroundMusic && this.backgroundMusic.paused) {
            this.backgroundMusic.play().catch(() => { });
        }

        this._outroApplauseTriggered = false;
        // Initialize with the requested intro dance
        this.avatar.playAnimation('intro_dance', true);

        return new Promise<void>((resolve) => {
            let disposed = false;
            video.onerror = () => {
                console.error("[Intro] Video Load Failed. Continuing anyway...");
                disposed = true;
                resolve();
            };

            const tick = async () => {
                if (disposed) return;

                if (!video.duration || isNaN(video.duration)) {
                    requestAnimationFrame(tick);
                    // Force play if it seems stuck
                    if (video.paused && video.readyState >= 2) {
                        video.play().catch(() => { });
                    }
                    return;
                }

                requestAnimationFrame(tick);

                // Satia is a Diva: She stays in her intro_dance for the whole duration to keep the hype!
                if (this.avatar.currentAnimationName !== 'intro_dance' && !this._outroApplauseTriggered) {
                    this.avatar.playAnimation('intro_dance', true);
                }

                // Final Applause: Trigger just before video ends (2s margin)
                if (video.duration && !this._outroApplauseTriggered && video.currentTime >= video.duration - 2.0) {
                    this._outroApplauseTriggered = true;
                    // Trigger Clapping Animation precisely with audio (using public .seated getter)
                    this.avatar.playAnimation(this.avatar.seated ? 'sitting_clap' : 'clapping', true);
                    this.outroApplause = this.avatar.playAudioEffect('assets/media/aplausosalfinal.mp3');
                    this._isIntroApplauseActive = true;
                }

                if (video.ended || video.currentTime >= video.duration - 0.1) {
                    disposed = true; // Stop RAF loop
                    // console.log("[Intro] Video Ended. Triggering Interaction.");

                    // CAMERA RECOVERY: Start returning focus to Satia immediately
                    this.avatar.setDirectorMode('NORMAL');

                    // NATURAL GREETINGS: Satia reacts to the applause before her main monologue
                    const greetings = [
                        "¡Gracias, gracias!",
                        "¡Ay ya... ya ya basta que me chibeo!",
                        "¡Ya, gracias! ¡Los amo!",
                        "¡Oooooo siiiii!",
                        "¡Qué bárbaros!",
                        "¡No, de verdad ya basta jajaja!",
                        "¡Muchísimas gracias a todos!",
                        "¡Ooooooooh sí, qué emoción!"
                    ];

                    const playLiveGreetings = async () => {
                        const shuffled = [...greetings].sort(() => 0.5 - Math.random());
                        const greetingAnims: any[] = ['standing_clap', 'waving', 'dancing_2'];
                        // Play 3 random greetings during the applause
                        for (let i = 0; i < 3; i++) {
                            const res = await this.tts.synthesize(shuffled[i], "F4", "joy");
                            if (res && this.state !== 'SPEAKING') {
                                await this.scheduleAudioChunk(res.audioData, res.sampleRate, {
                                    pitch: 1.03,
                                    animation: greetingAnims[i]
                                });
                            }
                        }
                    };
                    playLiveGreetings();

                    // Consolidated Monologue Context
                    const todayDate = new Date().toLocaleDateString('es-ES', {
                        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                    });
                    const todayTime = new Date().toLocaleTimeString('es-ES', {
                        hour: '2-digit', minute: '2-digit'
                    });

                    let todayContext = `Hoy es ${todayDate} y son las ${todayTime}.`;

                    // Try to fetch dynamic news for a spectacular intro
                    try {
                        const res = await fetch('/api/trends');
                        if (res.ok) {
                            const data = await res.json();
                            const news = data.choices[0].message.content;
                            todayContext += ` ÚLTIMAS NOTICIAS DEL MOMENTO: ${news}`;
                        }
                    } catch (e) {
                        // Keep basic context if internet fails
                    }

                    this.lastNewsContext = todayContext;
                    const theme = this.getRandomIntroTheme();
                    // Generate response
                    this.transitionTo('THINKING');

                    const systemInstruction = `
                    ${SYSTEM_PROMPT}

                    ${MONOLOGUE_PROMPT}

                    CONTEXTO ESPECÍFICO DEL INTRO:
                    VIBE: ${theme.vibe}
                    CONTEXTO: ${theme.context}
                    SALUDO SUGERIDO: "${theme.greeting}"
                    NOTICIA DE HOY: ${todayContext}
                    `;

                    try {
                        let responseText = await this.llm.chat([{ role: 'system', content: systemInstruction }]);

                        // Strip <think> blocks (reasoning models)
                        responseText = responseText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

                        let responseData: ConsciousResponse;
                        try {
                            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                            const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
                            responseData = JSON.parse(jsonStr);
                        } catch (parseErr) {
                            console.warn("[Intro] Failed to parse JSON, falling back to smart segments");
                            const cleanText = responseText.replace(/\{.*\}/g, '').trim();
                            responseData = {
                                type: 'reply',
                                segments: this.createSmartSegments(cleanText || "¡Hola a todos! Arrancamos con el show."),
                                tool: { name: null, args: null }
                            };
                        }

                        // WAIT for final applause to finish before Satia takes the floor
                        if (this.outroApplause && !this.outroApplause.ended) {
                            await new Promise(resolve => {
                                if (this.outroApplause) {
                                    this.outroApplause.onended = () => resolve(true);
                                    // Safety timeout: don't wait more than 8 seconds if something goes wrong
                                    setTimeout(() => resolve(true), 8000);
                                } else {
                                    resolve(true);
                                }
                            });
                        }

                        this.enqueueResponse(responseData);
                        this._isIntroApplauseActive = false; // RELEASE LOCK only after she is ready to speak context
                    } catch (e) {
                        console.error("Intro generation failed", e);
                        this.transitionTo('LISTENING');
                        this._isIntroApplauseActive = false;
                    }

                    this._introFinished = true;
                    resolve();
                }
            };

            requestAnimationFrame(tick);

            setTimeout(() => {
                if (!disposed) {
                    disposed = true;
                    resolve();
                }
            }, 50000); // 50s safety
        });
    }

    private updateMusicDucking() {
        if (!this.backgroundMusic) return;

        const isActuallySpeaking = this.isSpeakingLipSync || (this.currentAudio && !this.currentAudio.paused);
        const shouldDuck = (this.state === 'SPEAKING' || this.isProcessingQueue || isActuallySpeaking);

        if (this.musicDuckingTimeout) {
            clearTimeout(this.musicDuckingTimeout);
            this.musicDuckingTimeout = null;
        }

        if (shouldDuck) {
            this.fadeMusicVolume(0.1, 0.4);
        } else {
            this.musicDuckingTimeout = setTimeout(() => {
                this.fadeMusicVolume(0.5, 0.8);
                this.musicDuckingTimeout = null;
            }, 300);
        }
    }

    private transitionTo(newState: RuntimeState) {
        this.state = newState;
        // Clean, prioritized state log
        // console.log("%c[Animation] Preloading all animations...", "color: #10b981; font-weight: bold;");

        this.updateMusicDucking();
    }

    private fadeMusicVolume(target: number, duration: number) {
        if (!this.backgroundMusic) return;
        const startVol = this.backgroundMusic.volume;
        const delta = target - startVol;
        const steps = 20;
        const stepTime = (duration * 1000) / steps;

        let currentStep = 0;
        const interval = setInterval(() => {
            currentStep++;
            if (this.backgroundMusic) {
                this.backgroundMusic.volume = startVol + (delta * (currentStep / steps));
            }
            if (currentStep >= steps) clearInterval(interval);
        }, stepTime);
    }

    private getRandomIntroTheme() {
        const themes = [
            {
                vibe: "El gran show de Satia, Noticias al 100%",
                context: "Eres la estrella del momento. Reporter y hosts estrella del programa, transmites las ideas con pasion hablando es-MX. TU PASION ES COMUNICAR TUS NOTICIAS ENFOCATE EN ESO. ",
                greeting: "Gracias, gracias... o sea, ya me chibean... ahhh, ooooh que emocion, arranquemos ya!"
            }
        ];
        return themes[Math.floor(Math.random() * themes.length)];
    }

    private async processThinking(userText: string) {
        if (this.isThinking) {
            console.log("%c ⏳ YA ESTOY PENSANDO... IGNORANDO REPETICIÓN ", "color: #fbbf24; font-weight: bold;");
            return;
        }

        this.isThinking = true;
        this.transitionTo('THINKING');
        this.avatar.playRandomStateAnimation('THINKING');
        console.log(`%c 🧠 ESTADO: PENSANDO... `, 'background: #8b5cf6; color: white; padding: 2px 8px; border-radius: 4px;');

        // 1. MEMORY MANAGEMENT: Keep history relevant and lean
        this.history.push({ role: 'user', content: userText + ' /no_think' });
        if (this.history.length > 16) {
            this.history = [
                this.history[0],
                ...this.history.slice(-10)
            ];
        }

        try {
            let responseText = await this.llm.chat(
                [{ role: 'system', content: SYSTEM_PROMPT }, ...this.history],
                async () => {
                    // Network Failure Callback
                    console.warn("[Runtime] Cloud Network Error. Triggering live reaction.");
                    const res = await this.tts.synthesize("¡Ayyy no!, neta perdí la conexión... ¡Mierda! Aguántame un segundo o sea...", "F4", "angry");
                    if (res) {
                        this.avatar.playAnimation('angry_gesture');
                        this.avatar.setEmotion('angry', 1.0);
                        this.scheduleAudioChunk(res.audioData, res.sampleRate, { pitch: 1.02 });
                    }
                }
            );

            if (!responseText) {
                console.warn("[Thinking] Empty response from LLM");
                this.transitionTo('LISTENING');
                return;
            }

            responseText = responseText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            console.log(`%c 📡 LLM RECIBIDO (${responseText.length} chars) `, 'color: #10b981; font-weight: bold;');

            let responseData: ConsciousResponse;
            try {
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
                responseData = JSON.parse(jsonStr);

                if (responseData.segments) {
                    responseData.segments = this.normalizeSegments(responseData.segments);
                }
            } catch (e) {
                console.warn('[LLM] Non-JSON response, converting to segments');
                let cleanText = responseText.replace(/\{.*\}/g, '').trim();
                cleanText = cleanText.replace(/\*[^*]+\*/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
                responseData = {
                    type: 'reply',
                    segments: this.createSmartSegments(cleanText || "O sea, neta no sé qué decirte ahora..."),
                    tool: { name: null, args: null }
                };
            }

            this.history.push({ role: 'assistant', content: JSON.stringify(responseData) });
            this.enqueueResponse(responseData);
        } catch (error) {
            console.error('[Thinking] Critical Error:', error);
            const errorRes = await this.tts.synthesize("O sea, neta me dio un error el cerebro... qué horror.", "F4", "surprised");
            if (errorRes) this.scheduleAudioChunk(errorRes.audioData, errorRes.sampleRate, { pitch: 0.98 });
            this.transitionTo('LISTENING');
        } finally {
            this.isThinking = false;
            console.log(`%c 👂 ESTADO: ESCUCHANDO (LISTENING) `, 'background: #10b981; color: white; padding: 2px 8px; border-radius: 4px;');
        }
    }

    private enqueueResponse(data: ConsciousResponse) {
        this.responseQueue.push(data);
        if (this.isProcessingQueue) return;
        this.processQueue();
    }

    private async processQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;
        this.updateMusicDucking();

        try {
            while (this.responseQueue.length > 0) {
                if (this.state === 'IDLE') break; // Emergency break
                const data = this.responseQueue.shift();
                if (data) {
                    await this.executeResponse(data);
                }
            }

            // CRITICAL FIX: Wait for the scheduled audio to actually finish
            const waitForAudioFinished = async () => {
                while (this.state === 'SPEAKING' && this.audioContext.currentTime < this.nextAudioStartTime - 0.05) {
                    await new Promise(r => setTimeout(r, 100));
                }
            };
            await waitForAudioFinished();

        } finally {
            this.isProcessingQueue = false;
            if (this.state === 'SPEAKING') {
                this.finishSpeaking();
            }
            this.updateMusicDucking();
        }
    }

    private finishSpeaking() {
        // Reset timers so boredom doesn't trigger immediately after she finishes
        this.lastUserActivityTime = Date.now();
        this.lastSatiaSpeechEndTime = Date.now();

        if (this.avatar) {
            this.avatar.stopSpeaking();
            this.avatar.playAnimation('idle');
        }

        // Final applause after the intro speech ends
        if (this._introFinished && this._introTriggered) {
            this.avatar.playAudioEffect('assets/media/aplausosalfinal.mp3');
            this._introFinished = false;
            this._introTriggered = false;
        }

        // TURN TAKING: Transition to LISTENING and WAIT.
        // We do NOT call processThinking here. We wait for the next STT 'conscious-stt-live' event.
        this.sttBuffer = ""; // Final cleanup to ensure no self-echo residue
        this.transitionTo('LISTENING');
    }

    private normalizeSegments(segments: any[]): any[] {
        const normalized: any[] = [];
        for (const seg of segments) {
            if (!seg.text) continue;

            // 1. STRIP EVERYTHING BETWEEN *, (), [], <>
            // We use a robust regex that handles multi-line and non-greedy matching
            let text = seg.text
                .replace(/\*[^*]+\*/g, '')   // Remove *dramatic_eye_roll*
                .replace(/\([^)]*\)/g, '')   // Remove (applauds)
                .replace(/\[[^\]]*\]/g, '')   // Remove [action]
                .replace(/<[^>]*>/g, '')      // Remove <tags>
                .trim();

            if (!text) continue;

            // 2. AUTOMATIC ZOOM: Trigger zoom-in for facial/expressive animations if not set
            let zoom = seg.zoom;
            const expressiveAnims = [
                'dramatic_eye_roll', 'pouting', 'blow_kiss', 'surprised_gesture',
                'annoyed_head_shake', 'relieved_sigh', 'being_cocky', 'sarcastic_head_nod',
                'paparazzi_wink'
            ];
            if (!zoom && expressiveAnims.includes(seg.animation)) {
                zoom = 'in'; // Auto-focus on her face/reaction
            }

            // Clean excessive whitespace
            text = text.replace(/\s+/g, ' ');

            normalized.push({
                ...seg,
                text: text,
                zoom: zoom
            });
        }
        return normalized;
    }

    private async executeResponse(data: ConsciousResponse) {
        this.transitionTo('SPEAKING');
        this.avatar.isSpeaking = true;

        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        // Align timeline to now if we fell behind (gapless start)
        if (this.nextAudioStartTime < this.audioContext.currentTime) {
            this.nextAudioStartTime = this.audioContext.currentTime + 0.1; // Small buffer for safety
        }

        const rawSegments = data.segments || [];
        const segments = this.normalizeSegments(rawSegments);

        if (segments.length === 0) {
            this.avatar.stopSpeaking();
            if (!this.isProcessingQueue || this.responseQueue.length === 0) {
                this.transitionTo('LISTENING');
            }
            return;
        }

        // PIPELINED EXECUTION: Synthesize -> Schedule -> Next
        // We do NOT wait for all to finish before playing the first one.
        for (const segment of segments) {
            if (this.state !== 'SPEAKING') break; // Interruption check

            const result = await this.tts.synthesize(segment.text, 'F4', segment.emotion);

            if (result && this.state === 'SPEAKING') {
                // Apply emotion-specific volume and pitch
                const normalizedClient = this.normalizeAudio(result.audioData, result.volume || 1.0);

                // Add pitch/volume to segment so scheduleAudioChunk can use it
                const metaSegment = {
                    ...segment,
                    pitch: result.pitch || 1.0,
                    targetVolume: result.volume || 1.0
                };

                await this.scheduleAudioChunk(normalizedClient, result.sampleRate, metaSegment);
            }
        }
    }

    private normalizeAudio(samples: Float32Array, volumeMultiplier: number = 1.0): Float32Array {
        let max = 0;
        for (let i = 0; i < samples.length; i++) {
            const abs = Math.abs(samples[i]);
            if (abs > max) max = abs;
        }

        if (max < 0.01) return samples; // Don't boost silence or noise

        // Target 90% peak volume multiplied by the emotion's specific weight
        const ratio = (0.9 * volumeMultiplier) / max;
        const result = new Float32Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            // Apply hard clip limit at 1.0 to avoid digital distortion
            const val = samples[i] * ratio;
            result[i] = Math.max(-1.0, Math.min(1.0, val));
        }
        return result;
    }

    private concatenateAudio(buffers: Float32Array[]): Float32Array {
        const totalLength = buffers.reduce((acc, buf) => acc + (buf as Float32Array).length, 0);
        const result = new Float32Array(totalLength);
        let offset = 0;
        for (const buf of buffers) {
            result.set(buf, offset);
            offset += (buf as Float32Array).length;
        }
        return result;
    }

    private async scheduleAudioChunk(audioData: Float32Array, sampleRate: number, segment: any) {
        if (audioData.length === 0) return;

        // Create Buffer
        const audioBuffer = this.audioContext.createBuffer(1, audioData.length, sampleRate);
        audioBuffer.copyToChannel(audioData as any, 0);

        // Gapless Schedule: Determine start time
        // If the next slot is in the past (e.g. first chunk or lag), reset to now + small buffer
        if (this.nextAudioStartTime < this.audioContext.currentTime) {
            this.nextAudioStartTime = this.audioContext.currentTime + 0.05;
        }

        const startTime = this.nextAudioStartTime;
        const duration = audioBuffer.duration;
        this.nextAudioStartTime += duration;

        // Source Node
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;

        // APPLY PITCH (PlaybackRate) - Smooth personality glide
        if (segment.pitch) {
            // Start at previous/default and glide to target to avoid robotic jumps
            source.playbackRate.setValueAtTime(source.playbackRate.value, startTime);
            source.playbackRate.setTargetAtTime(segment.pitch, startTime, 0.08);
        }

        this.activeSources.push(source);

        // ROUTING FIX: Connect to Panner (which feeds MasterGain -> Analyser + Dest)
        source.connect(this.pannerNode);

        source.onended = () => {
            this.activeSources = this.activeSources.filter(s => s !== source);
        };


        // Start playing at the scheduled time
        source.start(startTime);

        // Metadata Trigger (Animation/Emotion/Zoom)
        // We use a timer relative to now to trigger visual effects exactly when audio touches speaker
        const timeUntilStart = (startTime - this.audioContext.currentTime) * 1000;

        setTimeout(() => {
            if (this.state !== 'SPEAKING') {
                try { source.stop(); } catch (e) { } // Stop if interrupted
                return;
            }

            // Visual Trigger
            if (segment.text) {
                window.dispatchEvent(new CustomEvent('conscious-stt-live', {
                    detail: {
                        text: segment.text,
                        isFinal: true,
                        source: 'bot'
                    }
                }));
            }

            if (segment.emotion) this.avatar.setEmotion(segment.emotion);
            if (segment.animation) this.avatar.playAnimation(segment.animation, false);
            if (segment.expressionPacket) this.avatar.applyExpressionPacket(segment.expressionPacket);
            if (segment.zoom) this.avatar.setZoom(segment.zoom);

            this.isSpeakingLipSync = true;
            this.updateMusicDucking();

            // End cleanup callback (Visuals only)
            // We set a timeout equal to duration to know when this specific chunk ends
            setTimeout(() => {
                // Only "finish" visually if we are near the end of the timeline
                // This prevents flickering if another chunk is immediately following
                const timeLeftOnTimeline = this.nextAudioStartTime - this.audioContext.currentTime;

                if (timeLeftOnTimeline < 0.2) {
                    this.isSpeakingLipSync = false;
                    this.avatar.stopSpeaking();
                    this.lastSatiaSpeechEndTime = Date.now();
                    this.updateMusicDucking();
                }
            }, duration * 1000);

        }, Math.max(0, timeUntilStart));
    }

    private createSmartSegments(text: string): any[] {
        // Split by punctuation but keep it
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        const animations: any[] = ['talking', 'talking_1', 'talking_2', 'explaining', 'happy_hand_gesture', 'acknowledging', 'being_cocky', 'waving', 'dismissing_gesture', 'surprised_gesture'];
        const emotions: any[] = ['happy', 'fun', 'joy', 'neutral', 'surprised'];
        const packets: any[] = ['confident_reporter', 'mischievous', 'inspired', 'playful_curiosity', 'haughty_diva', 'scandalized'];

        return sentences.map((s, i) => {
            const trimS = s.trim();
            if (!trimS) return null;

            // Simple heuristic for selecting logic
            let emotion = emotions[i % emotions.length];
            let anim = animations[i % animations.length];
            let packet = packets[i % packets.length];

            if (trimS.includes('!') || trimS.length < 20) {
                emotion = 'fun';
                anim = 'waving';
            }
            if (trimS.toLowerCase().includes('jaja')) {
                emotion = 'joy';
                packet = 'hysterical_laughter';
            }

            return {
                text: trimS,
                emotion: emotion,
                animation: anim,
                expressionPacket: packet,
                zoom: i === 0 ? 'normal' : (i % 3 === 0 ? 'in' : 'normal')
            };
        }).filter(s => s !== null);
    }
}
