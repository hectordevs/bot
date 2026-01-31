import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// Global variables
let camera, scene, renderer, controls;
let mixer;
let currentModel = null;
let currentAction = null;
let loadedClips = []; // Array of AnimationClips
const clock = new THREE.Clock();

// UI Elements
const inputModel = document.getElementById('input-model');
const inputAnim = document.getElementById('input-anim');
const animList = document.getElementById('anim-list');
const btnExport = document.getElementById('btn-export');
const spinner = document.getElementById('loading-spinner');
const statusDiv = document.getElementById('status');

init();
animate();

function init() {
    // 1. Scene Setup
    const container = document.getElementById('viewport');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa0a0a0);
    scene.fog = new THREE.Fog(0xa0a0a0, 10, 50);

    // Lights
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5); // Soft white light
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(3, 10, 10);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Grid
    const grid = new THREE.GridHelper(100, 20, 0x000000, 0x000000);
    grid.material.opacity = 0.2;
    grid.material.transparent = true;
    scene.add(grid);

    // Camera
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 2, 5);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.update();

    // Event Listeners
    window.addEventListener('resize', onWindowResize);
    inputModel.addEventListener('change', handleModelUpload);
    inputAnim.addEventListener('change', handleAnimUpload);
    btnExport.addEventListener('click', exportGLB);
}

function showStatus(msg, duration = 2000) {
    statusDiv.innerText = msg;
    statusDiv.style.display = 'block';
    if (duration > 0) {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, duration);
    }
}

function setLoading(isLoading) {
    spinner.style.display = isLoading ? 'block' : 'none';
    if (isLoading) {
        btnExport.disabled = true;
        inputModel.disabled = true;
        inputAnim.disabled = true;
    } else {
        btnExport.disabled = (currentModel === null);
        inputModel.disabled = false;
        inputAnim.disabled = false;
    }
}

// -------------------------------------------------------------------------
// Upload Handling
// -------------------------------------------------------------------------

async function handleModelUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);
    showStatus(`Cargando modelo: ${file.name}...`, 0);

    const url = URL.createObjectURL(file);
    const extension = file.name.split('.').pop().toLowerCase();

    try {
        if (currentModel) {
            scene.remove(currentModel);
            currentModel = null;
            mixer = null;
            loadedClips = [];
            animList.innerHTML = ''; // Clear anim list
            currentAction = null;
        }

        let object;
        if (extension === 'fbx') {
            const loader = new FBXLoader();
            object = await loader.loadAsync(url);
        } else if (extension === 'glb' || extension === 'gltf') {
            const loader = new GLTFLoader();
            const gltf = await loader.loadAsync(url);
            object = gltf.scene;
        } else {
            throw new Error("Formato no soportado. Usa FBX o GLB.");
        }

        currentModel = object;

        // Setup Mixer
        mixer = new THREE.AnimationMixer(currentModel);

        // Process existing animations in the model (if any)
        if (object.animations && object.animations.length > 0) {
            object.animations.forEach((clip, index) => {
                // If it has generic name, try to give it something useful, or keep it
                if (clip.name === 'mixamo.com') clip.name = 'original_anim_' + index;
                addClipToList(clip);
            });
        }

        // Add to scene
        scene.add(currentModel);

        // Traverse to fix materials/shadows
        currentModel.traverse(function (child) {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        // Center camera on object?
        // const box = new THREE.Box3().setFromObject(currentModel);
        // const center = box.getCenter(new THREE.Vector3());
        // controls.target.copy(center);
        // controls.update();

        showStatus("Modelo cargado.");
    } catch (err) {
        console.error(err);
        showStatus("Error cargando modelo: " + err.message, 5000);
    } finally {
        setLoading(false);
        URL.revokeObjectURL(url);
    }
}

async function handleAnimUpload(event) {
    if (!currentModel) {
        alert("Primero carga un modelo (Skin).");
        inputAnim.value = ""; // Reset
        return;
    }

    const files = event.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);

    // Process all selected files
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filename = file.name;
        // Clean name: "Idle.fbx" -> "Idle"
        const animName = filename.replace(/\.[^/.]+$/, "");

        showStatus(`Procesando animación: ${animName}...`, 0);

        const url = URL.createObjectURL(file);

        try {
            // Usually Mixamo animations are FBX
            const loader = new FBXLoader();
            const object = await loader.loadAsync(url);

            if (object.animations && object.animations.length > 0) {
                // Take the first animation
                const clip = object.animations[0];

                // RENAME THE CLIP
                // This is crucial for the mixer to distinguish them
                clip.name = animName;

                addClipToList(clip);
            } else {
                console.warn(`El archivo ${filename} no contiene animaciones.`);
            }

        } catch (err) {
            console.error(`Error loading ${filename}:`, err);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    setLoading(false);
    showStatus("Animaciones cargadas.", 2000);
    inputAnim.value = ""; // Reset so we can upload same files again if needed
}

function addClipToList(clip) {
    // Check if exists
    const existingIndex = loadedClips.findIndex(c => c.name === clip.name);
    if (existingIndex !== -1) {
        // Replace
        loadedClips[existingIndex] = clip;
    } else {
        loadedClips.push(clip);
    }

    // Refresh UI list
    renderAnimList();

    // Auto-play the new clip
    playClip(clip.name);
}

function renderAnimList() {
    animList.innerHTML = '';
    loadedClips.forEach(clip => {
        const li = document.createElement('li');
        li.className = 'anim-item';
        if (currentAction && currentAction.getClip().name === clip.name) {
            li.classList.add('active');
        }

        const span = document.createElement('span');
        span.className = 'anim-name';
        span.innerText = clip.name;

        // Remove button? (Maybe later)

        li.appendChild(span);

        li.onclick = () => playClip(clip.name);

        animList.appendChild(li);
    });
}

function playClip(name) {
    const clip = loadedClips.find(c => c.name === name);
    if (!clip || !mixer) return;

    // Determine fade duration
    const fadeDuration = 0.5;

    // Get the new action
    const newAction = mixer.clipAction(clip);

    if (currentAction === newAction) return; // Already playing

    if (currentAction) {
        currentAction.fadeOut(fadeDuration);
    }

    newAction.reset();
    newAction.fadeIn(fadeDuration);
    newAction.play();

    currentAction = newAction;

    // Update UI highlights
    const items = document.querySelectorAll('.anim-item');
    items.forEach(item => {
        if (item.querySelector('.anim-name').innerText === name) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

// -------------------------------------------------------------------------
// Export Logic
// -------------------------------------------------------------------------

function exportGLB() {
    if (!currentModel) return;

    setLoading(true);
    showStatus("Exportando...", 0);

    // Prepare model for export: Attach all loaded animations to the model object
    // GLTFExporter looks at the input object's .animations property
    currentModel.animations = loadedClips;

    const exporter = new GLTFExporter();
    const options = {
        binary: true,
        animations: loadedClips, // Explicitly pass animations too, just in case
        truncateDrawRange: true
    };

    exporter.parse(
        currentModel,
        function (result) {
            if (result instanceof ArrayBuffer) {
                saveArrayBuffer(result, 'character_animado.glb');
                showStatus("Exportación completada.");
            } else {
                showStatus("Error: La exportación no devolvió binario.");
            }
            setLoading(false);
        },
        function (error) {
            console.error('An error happened during export:', error);
            showStatus("Error exportando: " + error.message);
            setLoading(false);
        },
        options
    );
}

function saveArrayBuffer(buffer, filename) {
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}

// -------------------------------------------------------------------------
// Render Loop
// -------------------------------------------------------------------------

function onWindowResize() {
    const container = document.getElementById('viewport');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    if (mixer) mixer.update(delta);

    controls.update();
    renderer.render(scene, camera);
}
