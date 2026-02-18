export const UI = {
    statusDiv: null,
    progressContainer: null,
    progressBar: null,
    progressText: null,

    init() {
        this.statusDiv = document.getElementById('status');
        this.progressContainer = document.getElementById('progress-container');
        this.progressBar = document.getElementById('progress-bar');
        this.progressText = document.getElementById('progress-text');
    },

    updateStatus(text, type = 'normal') {
        if (!this.statusDiv) return;
        this.statusDiv.innerText = text;
        this.statusDiv.className = ''; // Reset
        if (type === 'loaded') this.statusDiv.classList.add('loaded');
        if (type === 'error') this.statusDiv.classList.add('error');
    },

    showProgress() {
        if (this.progressContainer) this.progressContainer.style.display = 'block';
    },

    hideProgress() {
         if (this.progressContainer) this.progressContainer.style.display = 'none';
    },

    updateProgress(percent, fileName) {
        if (this.progressBar) this.progressBar.value = percent;
        if (this.progressText) this.progressText.innerText = `Descargando ${fileName}: ${percent}%`;
    }
};
