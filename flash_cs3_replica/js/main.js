document.addEventListener('DOMContentLoaded', () => {
    // --- Application State ---
    const appState = {
        currentTool: 'brush', // brush, eraser, rect, select
        currentLayer: 0,
        currentFrame: 1,
        strokeColor: '#000000',
        fillColor: '#FFFFFF',
        brushSize: 5,
        isDrawing: false,
        fps: 12,
        isPlaying: false,
        frameScripts: {}, // { frameNum: "javascript code string" }
        playbackInterval: null
    };

    // --- DOM Elements ---
    const canvas = document.getElementById('stage-canvas');
    const ctx = canvas.getContext('2d');
    const toolBtns = document.querySelectorAll('.tool-btn');
    const strokeColorBox = document.getElementById('stroke-color');
    const fillColorBox = document.getElementById('fill-color');
    const currentFrameDisplay = document.getElementById('current-frame-display');
    const layersList = document.getElementById('layers-list');
    const framesGrid = document.getElementById('frames-grid');

    // Actions Panel Elements
    const actionsPanel = document.getElementById('actions-panel');
    const codeEditor = document.getElementById('code-editor');
    const actionsFrameNum = document.getElementById('actions-frame-num');
    const actionsClose = document.getElementById('actions-close');

    // --- Initialization ---
    function init() {
        setupTools();
        setupCanvas();
        setupTimeline();
        setupProperties();
        setupActions();
        setupMenus();
        updateCursor();
    }

    // --- Menubar System ---
    function setupMenus() {
        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const name = item.innerText;
                if (name === 'Control') {
                    togglePlayback();
                } else if (name === 'File') {
                     const action = prompt("File Menu:\nType 'save' to export project (.json)\nType 'open' to load project", "save");
                     if (action && action.toLowerCase() === 'save') {
                         saveProject();
                     } else if (action && action.toLowerCase() === 'open') {
                         openProject();
                     }
                } else if (name === 'Window') {
                    actionsPanel.style.display = actionsPanel.style.display === 'none' ? 'flex' : 'none';
                } else if (name === 'Help') {
                    alert("Flash CS3 Replica (JS Edition)\n\nLimitations:\n- .fla files are NOT supported.\n- Use 'save' to export to .json.\n- Use F9 to write JavaScript actions.");
                }
            });
        });
    }

    // --- File IO ---
    function saveProject() {
        const data = {
            version: '1.0',
            scripts: appState.frameScripts,
            imageData: canvas.toDataURL()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'project.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    function openProject() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.fla';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (file.name.endsWith('.fla')) {
                alert("Error: .fla files are proprietary binary formats and cannot be opened in this web replica.\n\nPlease use the .json format native to this tool.");
                return;
            }

            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    appState.frameScripts = data.scripts || {};

                    // Update visuals
                    for (let i=1; i<=50; i++) {
                        const cell = document.querySelector(`.frame-cell[data-frame="${i}"]`);
                        if (cell) {
                             if (appState.frameScripts[i] && appState.frameScripts[i].trim() !== '') {
                                 cell.classList.add('has-action');
                             } else {
                                 cell.classList.remove('has-action');
                             }
                        }
                    }

                    if (data.imageData) {
                        const img = new Image();
                        img.onload = () => {
                            ctx.clearRect(0,0,canvas.width, canvas.height);
                            ctx.drawImage(img, 0, 0);
                        };
                        img.src = data.imageData;
                    }

                    selectFrame(1);
                    alert("Project loaded successfully.");
                } catch (err) {
                    alert("Error loading project: " + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    // --- Tool System ---
    function setupTools() {
        toolBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelector('.tool-btn.active').classList.remove('active');
                btn.classList.add('active');
                appState.currentTool = btn.dataset.tool;
                updateCursor();
                updatePropertiesPanel();
            });
        });

        strokeColorBox.addEventListener('click', () => {
            appState.strokeColor = appState.strokeColor === '#000000' ? '#FF0000' : '#000000';
            strokeColorBox.style.backgroundColor = appState.strokeColor;
        });
    }

    function updateCursor() {
        if (appState.currentTool === 'brush' || appState.currentTool === 'pencil') {
            canvas.style.cursor = 'crosshair';
        } else if (appState.currentTool === 'select') {
            canvas.style.cursor = 'default';
        } else if (appState.currentTool === 'eraser') {
            canvas.style.cursor = 'cell';
        } else {
            canvas.style.cursor = 'default';
        }
    }

    // --- Canvas Drawing ---
    function setupCanvas() {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        let startX, startY;
        let snapshot;

        canvas.addEventListener('mousedown', (e) => {
            appState.isDrawing = true;
            const rect = canvas.getBoundingClientRect();
            startX = e.clientX - rect.left;
            startY = e.clientY - rect.top;

            ctx.lineWidth = appState.brushSize;
            ctx.strokeStyle = appState.strokeColor;
            ctx.fillStyle = appState.strokeColor;

            if (appState.currentTool === 'brush' || appState.currentTool === 'pencil') {
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.globalCompositeOperation = 'source-over';
            } else if (appState.currentTool === 'eraser') {
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.globalCompositeOperation = 'destination-out';
                ctx.lineWidth = appState.brushSize * 2;
            } else if (appState.currentTool === 'rect') {
                snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
                ctx.globalCompositeOperation = 'source-over';
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!appState.isDrawing) return;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            if (appState.currentTool === 'brush' || appState.currentTool === 'pencil' || appState.currentTool === 'eraser') {
                ctx.lineTo(x, y);
                ctx.stroke();
            } else if (appState.currentTool === 'rect') {
                ctx.putImageData(snapshot, 0, 0);
                const width = x - startX;
                const height = y - startY;
                ctx.fillRect(startX, startY, width, height);
                ctx.strokeRect(startX, startY, width, height);
            }
        });

        window.addEventListener('mouseup', () => {
            if (appState.isDrawing) {
                appState.isDrawing = false;
                ctx.beginPath();
            }
        });
    }

    // --- Timeline System ---
    function setupTimeline() {
        const numFrames = 50;
        const frameWidth = 10;

        framesGrid.style.width = `${numFrames * frameWidth}px`;

        const layerRow = document.createElement('div');
        layerRow.style.height = '20px';
        layerRow.style.display = 'flex';

        for (let i = 1; i <= numFrames; i++) {
            const cell = document.createElement('div');
            cell.className = 'frame-cell';
            cell.dataset.frame = i;

            if (i === 1) {
                cell.style.backgroundColor = '#fff';
                const dot = document.createElement('div');
                dot.style.width = '4px';
                dot.style.height = '4px';
                dot.style.backgroundColor = '#000';
                dot.style.borderRadius = '50%';
                dot.style.margin = '7px auto';
                cell.appendChild(dot);
            } else if (i % 5 === 0) {
                cell.style.backgroundColor = '#eee';
            }

            cell.addEventListener('click', () => {
                selectFrame(i);
            });

            layerRow.appendChild(cell);
        }
        framesGrid.appendChild(layerRow);
    }

    function selectFrame(frameNum) {
        document.querySelectorAll('.frame-cell').forEach(c => {
             c.style.backgroundColor = '';
             if (c.dataset.frame == 1) c.style.backgroundColor = '#fff';
             else if (c.dataset.frame % 5 === 0) c.style.backgroundColor = '#eee';

             if (c.dataset.frame == frameNum) c.style.backgroundColor = '#99ccff';
        });

        appState.currentFrame = frameNum;
        currentFrameDisplay.innerText = frameNum;
        actionsFrameNum.innerText = frameNum;

        codeEditor.value = appState.frameScripts[frameNum] || '';
    }

    function togglePlayback() {
        if (appState.isPlaying) {
            clearInterval(appState.playbackInterval);
            appState.isPlaying = false;
            console.log("Playback stopped");
        } else {
            appState.isPlaying = true;
            console.log("Playback started");
            appState.playbackInterval = setInterval(() => {
                let next = appState.currentFrame + 1;
                if (next > 50) next = 1;

                selectFrame(next);
                executeFrameScript(next);

            }, 1000 / appState.fps);
        }
    }

    function executeFrameScript(frameNum) {
        const code = appState.frameScripts[frameNum];
        if (code && code.trim() !== '') {
            try {
                const func = new Function('app', 'frame', 'canvas', 'ctx', 'stop', 'play', code);
                func(
                    appState,
                    frameNum,
                    canvas,
                    ctx,
                    () => { clearInterval(appState.playbackInterval); appState.isPlaying = false; },
                    () => { togglePlayback(); }
                );
            } catch (err) {
                console.error(`Error in frame ${frameNum} script:`, err);
                clearInterval(appState.playbackInterval);
                appState.isPlaying = false;
                alert(`Script Error (Frame ${frameNum}): ${err.message}`);
            }
        }
    }

    // --- Actions Panel Logic ---
    function setupActions() {
        window.addEventListener('keydown', (e) => {
            if (e.key === 'F9') {
                 actionsPanel.style.display = actionsPanel.style.display === 'none' ? 'flex' : 'none';
            }
        });

        actionsClose.onclick = () => actionsPanel.style.display = 'none';

        codeEditor.addEventListener('input', () => {
             const frame = appState.currentFrame;
             const code = codeEditor.value;
             appState.frameScripts[frame] = code;

             const cell = document.querySelector(`.frame-cell[data-frame="${frame}"]`);
             if (cell) {
                 if (code.trim() !== '') {
                     cell.classList.add('has-action');
                 } else {
                     cell.classList.remove('has-action');
                 }
             }
        });
    }

    // --- Properties Panel ---
    function setupProperties() {
        updatePropertiesPanel();
    }

    function updatePropertiesPanel() {
        const content = document.getElementById('properties-content');
        if (!content) return;

        let html = '';
        if (appState.currentTool === 'brush') {
             html = `
                <div class="prop-group">
                    <label>Brush Tool</label>
                    <div>Color: ${appState.strokeColor}</div>
                    <div>Size: ${appState.brushSize} px</div>
                </div>
             `;
        } else if (appState.currentTool === 'select') {
             html = `
                <div class="prop-group">
                    <label>Selection</label>
                    <div>No object selected</div>
                </div>
             `;
        } else {
             html = `
                <div class="prop-group">
                    <label>Tool</label>
                    <div>${appState.currentTool}</div>
                </div>
             `;
        }
        content.innerHTML = html;
    }

    init();
});
