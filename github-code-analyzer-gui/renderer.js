// renderer.js

document.getElementById('runButton').addEventListener('click', async () => {
  const output = document.getElementById('output');
  const username = document.getElementById('username').value;
  const repository = document.getElementById('repository').value;
  const errorType = document.getElementById('errorType').value;

  output.textContent = 'Running analysis...';

  try {
    const result = await window.electron.runAnalysis({ username, repository, errorType });
    output.textContent = JSON.stringify(result, null, 2);
  } catch (err) {
    output.textContent = `Error: ${err.message}`;
  }
});

// Handle stopping analysis
document.getElementById('stopButton').addEventListener('click', () => {
  window.electron.stopAnalysis();
  const output = document.getElementById('output');
  output.textContent = 'Analysis stopped.';
});

// Listen for progress updates
window.electron.onProgressUpdate((event, progress) => {
  console.log('Progress update received:', progress);  // Log for debugging
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');

  progressBar.value = progress.percentage;
  progressText.textContent = `Progress: ${progress.percentage.toFixed(2)}% | ETA: ${Math.round(progress.eta / 1000)}s | ${progress.processedFiles}/${progress.totalFiles}`;
});

// Listen for analysis stopped
window.electron.onAnalysisStopped(() => {
  console.log('Analysis stopped');
  const output = document.getElementById('output');
  output.textContent = 'Analysis stopped.';
});
