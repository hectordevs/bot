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
        fps: 12
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

    // --- Initialization ---
    function init() {
        setupTools();
        setupCanvas();
        setupTimeline();
        setupProperties();
        updateCursor();
    }

    // --- Tool System ---
    function setupTools() {
        toolBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                // Update UI
                document.querySelector('.tool-btn.active').classList.remove('active');
                btn.classList.add('active');

                // Update State
                appState.currentTool = btn.dataset.tool;
                console.log('Tool selected:', appState.currentTool);

                updateCursor();
                updatePropertiesPanel();
            });
        });

        // Basic Color Click (just toggles for demo)
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
            canvas.style.cursor = 'cell'; // Approximation
        } else {
            canvas.style.cursor = 'default';
        }
    }

    // --- Canvas Drawing ---
    function setupCanvas() {
        // Fix for high DPI displays could go here, but keeping it simple for replica
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
            ctx.fillStyle = appState.strokeColor; // Use stroke color for fill in this simple demo

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
                // Restore previous state to avoid trails
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
                ctx.beginPath(); // Reset path
            }
        });
    }

    // --- Timeline System ---
    function setupTimeline() {
        // Create a simple grid
        const numFrames = 50;
        const frameWidth = 10;

        // Setup Grid CSS
        framesGrid.style.width = `${numFrames * frameWidth}px`;

        // Create headers or just simple cells for Layer 1
        const layerRow = document.createElement('div');
        layerRow.style.height = '20px';
        layerRow.style.display = 'flex';

        for (let i = 1; i <= numFrames; i++) {
            const cell = document.createElement('div');
            cell.className = 'frame-cell';
            cell.dataset.frame = i;
            if (i === 1) {
                // Initial keyframe dot
                cell.style.backgroundColor = '#fff';
                const dot = document.createElement('div');
                dot.style.width = '4px';
                dot.style.height = '4px';
                dot.style.backgroundColor = '#000';
                dot.style.borderRadius = '50%';
                dot.style.margin = '7px auto';
                cell.appendChild(dot);
            } else if (i % 5 === 0) {
                cell.style.backgroundColor = '#eee'; // slight tint for every 5th
            }

            cell.addEventListener('click', () => {
                selectFrame(i);
            });

            layerRow.appendChild(cell);
        }
        framesGrid.appendChild(layerRow);
    }

    function selectFrame(frameNum) {
        // Visual update only
        document.querySelectorAll('.frame-cell').forEach(c => c.style.backgroundColor = '');

        // Restore specific styles
        document.querySelectorAll('.frame-cell').forEach(c => {
             if (c.dataset.frame == 1) return; // Keep keyframe style logic separate in full app
             if (c.dataset.frame % 5 === 0) c.style.backgroundColor = '#eee';
        });

        const selectedCell = document.querySelector(`.frame-cell[data-frame="${frameNum}"]`);
        if (selectedCell) {
            selectedCell.style.backgroundColor = '#99ccff'; // Selection blue
        }

        appState.currentFrame = frameNum;
        currentFrameDisplay.innerText = frameNum;
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
                    <div>Smoothing: 50</div>
                </div>
             `;
        } else if (appState.currentTool === 'select') {
             html = `
                <div class="prop-group">
                    <label>Selection</label>
                    <div>X: 0.0</div>
                    <div>Y: 0.0</div>
                    <div>W: 0.0</div>
                    <div>H: 0.0</div>
                </div>
             `;
        } else {
             html = `
                <div class="prop-group">
                    <label>${appState.currentTool.charAt(0).toUpperCase() + appState.currentTool.slice(1)}</label>
                    <div>Settings not available in replica</div>
                </div>
             `;
        }
        content.innerHTML = html;
    }

    // Run
    init();
});
