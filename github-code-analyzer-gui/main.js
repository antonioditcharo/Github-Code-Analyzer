const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');
const async = require('async');
const cliProgress = require('cli-progress');

let git;
let Octokit;
let currentProcess = null;
let stopAnalysisFlag = false;
let progressBar; // Ensure progressBar is defined globally

async function loadModules() {
  git = (await import('simple-git')).default();
  Octokit = (await import('@octokit/rest')).Octokit;
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools();
}

app.on('ready', async () => {
  await loadModules();
  createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('run-analysis', async (event, { username, repository, errorType }) => {
  console.log('Run analysis started');
  const localPath = path.join(__dirname, 'repo');
  stopAnalysisFlag = false; // Reset the flag when a new analysis starts

  try {
    await fetchCode(username, repository, localPath);
    const errorLog = await identifyIssues(localPath, errorType, event);
    if (stopAnalysisFlag) return { success: false, message: 'Analysis stopped by user.' };
    await fixIssues(localPath, errorLog);
    await commitAndPushChanges(localPath, 'Automated fixes for identified errors');
    await fs.remove(localPath);

    return { success: true, message: 'Analysis complete!' };
  } catch (error) {
    console.error('Error in run-analysis:', error.message);
    return { success: false, message: error.message };
  } finally {
    // Ensure progressBar is stopped
    if (progressBar) {
      progressBar.stop();
      progressBar = null;
    }
  }
});

ipcMain.on('stop-analysis', (event) => {
  console.log('Stop analysis requested');
  stopAnalysisFlag = true; // Set the flag to stop analysis
  if (currentProcess) {
    console.log('Current process found, killing it');
    currentProcess.kill();
    currentProcess = null;
  }
  event.sender.send('analysis-stopped');
});

const cloneRepository = async (repoUrl, localPath) => {
  if (fs.existsSync(localPath)) await fs.remove(localPath);
  await git.clone(repoUrl, localPath);
};

const fetchCode = async (owner, repo, localPath) => await cloneRepository(`https://github.com/${owner}/${repo}.git`, localPath);

const identifyIssues = async (localPath, errorType, event) => {
  console.log('Identify issues started');
  const checkstyleJarPath = 'C:/Users/Antonio/checkstyle-10.21.0-all.jar';
  const checkstyleConfigPath = path.join(localPath, 'checkstyle.xml');
  const errorLog = [], javaFiles = getJavaFiles(localPath), totalFiles = javaFiles.length, fileTimes = [];
  let processedFiles = 0;
  
  progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  progressBar.start(totalFiles, 0);

  await async.eachLimit(javaFiles, 10, (file, callback) => {
    if (stopAnalysisFlag) {
      console.log('Stopping analysis early in identifyIssues');
      callback();
      return;
    }

    const startTime = Date.now();
    const runCheckstyle = (retries = 3) => {
      currentProcess = exec(`java -jar ${checkstyleJarPath} -c ${checkstyleConfigPath} ${file}`, { encoding: 'utf8' }, (error, stdout, stderr) => {
        if (stopAnalysisFlag) {
          console.log('Stopping analysis early in runCheckstyle');
          callback();
          return;
        }
        if (error && retries > 0) return runCheckstyle(retries - 1);
        if (error) errorLog.push({ file, issues: stderr });
        updateProgress(startTime, event, fileTimes, progressBar, totalFiles, ++processedFiles);
        callback();
      }).on('error', (err) => handleExecError(err, file, errorLog, startTime, event, fileTimes, progressBar, totalFiles, ++processedFiles, callback));
    };
    runCheckstyle();
  });

  console.log('Completed running Checkstyle on all files');
  return errorLog;
};

const handleExecError = (err, file, errorLog, startTime, event, fileTimes, progressBar, totalFiles, processedFiles, callback) => {
  console.log('Handle execution error:', err.message);
  errorLog.push({ file, issues: `Failed to spawn process: ${err.message}` });
  updateProgress(startTime, event, fileTimes, progressBar, totalFiles, processedFiles);
  callback();
};

const updateProgress = (startTime, event, fileTimes, progressBar, totalFiles, processedFiles) => {
  console.log('Updating progress');
  const endTime = Date.now();
  fileTimes.push(endTime - startTime);
  const avgTimePerFile = fileTimes.reduce((acc, cur) => acc + cur, 0) / fileTimes.length;
  const progress = {
    percentage: (processedFiles / totalFiles) * 100,
    eta: avgTimePerFile * (totalFiles - processedFiles),
    processedFiles,
    totalFiles,
  };
  console.log('Sending progress update:', progress);
  if (progressBar) progressBar.update(processedFiles, { eta: avgTimePerFile * (totalFiles - processedFiles) });
  event.sender.send('progress-update', progress);
};

const fixIssues = async (localPath, errorLog) => {
  console.log('Fixing issues');
  for (const { file, issues } of errorLog) {
    let fileContent = await fs.readFile(file, 'utf8');
    if (issues.includes('UnusedImports')) fileContent = fileContent.replace(/import\s+[\w\.]+\s*;\n/g, '');
    await fs.writeFile(file, fileContent);
  }
  console.log('Completed applying fixes to all files');
};

const getJavaFiles = (dir) => fs.readdirSync(dir).reduce((javaFiles, file) => {
  const filePath = path.join(dir, file), stat = fs.statSync(filePath);
  return stat.isDirectory() ? javaFiles.concat(getJavaFiles(filePath)) : filePath.endsWith('.java') ? javaFiles.concat(filePath) : javaFiles;
}, []);

const commitAndPushChanges = async (localPath, commitMessage) => {
  console.log('Committing and pushing changes');
  await git.cwd(localPath).add('./*');
  const statusSummary = await git.status();
  if (statusSummary.staged.length > 0) {
    await git.commit(commitMessage);
    try {
      const branchSummary = await git.branchLocal(), currentBranch = branchSummary.current;
      console.log(`Pushing to branch: ${currentBranch}`);
      await git.push(['-u', 'origin', currentBranch]);
    } catch (error) {
      console.error('Error pushing to Git:', error);
    }
  } else {
    console.log('No changes to commit');
  }
};
