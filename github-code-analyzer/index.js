const simpleGit = require('simple-git');
const { Octokit } = require("@octokit/rest");
const fs = require("fs-extra");
const path = require("path");
const { exec } = require('child_process');
const cliProgress = require('cli-progress');
const async = require('async');

const git = simpleGit();
const octokit = new Octokit({
    auth: "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"  // Replace this with your actual GitHub token
});

async function cloneRepository(repoUrl, localPath) {
    if (fs.existsSync(localPath)) {
        await fs.remove(localPath);
    }
    await git.clone(repoUrl, localPath);
}

async function fetchCode(owner, repo, localPath) {
    await cloneRepository(`https://github.com/${owner}/${repo}.git`, localPath);
    console.log(`Repository cloned to ${localPath}`);
}

async function identifyIssues(localPath) {
    const checkstyleJarPath = 'C:/Users/Antonio/checkstyle-10.21.0-all.jar';
    const checkstyleConfigPath = path.join(localPath, 'checkstyle.xml');
    const errorLog = [];

    const javaFiles = getJavaFiles(localPath);
    const totalFiles = javaFiles.length;
    let processedFiles = 0;
    const fileTimes = [];

    const progressBar = new cliProgress.SingleBar({
        format: 'Progress [{bar}] {percentage}% | ETA: {eta_formatted} | {value}/{total}',
    }, cliProgress.Presets.shades_classic);
    progressBar.start(totalFiles, 0);

    await async.eachLimit(javaFiles, 10, (file, callback) => {
        let callbackCalled = false; // Ensure the callback is only called once

        const startTime = Date.now();

        const runCheckstyle = (retries = 3) => {
            const child = exec(`java -jar ${checkstyleJarPath} -c ${checkstyleConfigPath} ${file}`, { encoding: 'utf8' }, (error, stdout, stderr) => {
                if (error) {
                    if (retries > 0) {
                        if (!callbackCalled) {
                            runCheckstyle(retries - 1);
                        }
                    } else {
                        console.error(`Failed to process ${file} after multiple attempts: ${stderr}`);
                        errorLog.push({ file, issues: stderr });
                    }
                }
                if (!callbackCalled) {
                    const endTime = Date.now();
                    fileTimes.push(endTime - startTime);
                    const avgTimePerFile = fileTimes.reduce((acc, cur) => acc + cur, 0) / fileTimes.length;
                    processedFiles++;
                    progressBar.update(processedFiles, { eta: avgTimePerFile * (totalFiles - processedFiles) });

                    callbackCalled = true;
                    callback();
                }
            });

            child.on('error', (err) => {
                console.error(`Failed to spawn process for ${file}: ${err}`);
                if (!callbackCalled) {
                    errorLog.push({ file, issues: `Failed to spawn process: ${err.message}` });
                    processedFiles++;
                    const endTime = Date.now();
                    fileTimes.push(endTime - startTime);
                    const avgTimePerFile = fileTimes.reduce((acc, cur) => acc + cur, 0) / fileTimes.length;
                    progressBar.update(processedFiles, { eta: avgTimePerFile * (totalFiles - processedFiles) });
                    
                    callbackCalled = true;
                    callback();
                }
            });
        };
        runCheckstyle();
    });

    progressBar.stop();
    console.log('Completed running Checkstyle on all files');
    return errorLog;
}

async function fixIssues(localPath, errorLog) {
    errorLog.forEach(entry => {
        const { file, issues } = entry;
        console.log(`Applying fixes to ${file}...`);

        let fileContent = fs.readFileSync(file, 'utf8');
        if (issues.includes('UnusedImports')) {
            fileContent = fileContent.replace(/import\s+[\w\.]+\s*;\n/g, '');  // Remove unused imports
        }
        fs.writeFileSync(file, fileContent);
    });
    console.log('Completed applying fixes to all files');
}

function getJavaFiles(dir) {
    let javaFiles = [];
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            javaFiles = javaFiles.concat(getJavaFiles(filePath));
        } else if (filePath.endsWith('.java')) {
            javaFiles.push(filePath);
        }
    });
    return javaFiles;
}

async function commitAndPushChanges(localPath, commitMessage) {
    await git.cwd(localPath).add('./*');
    const statusSummary = await git.status();
    if (statusSummary.staged.length > 0) {
        await git.commit(commitMessage);
        try {
            const branchSummary = await git.branchLocal();
            const currentBranch = branchSummary.current;
            console.log(`Pushing to branch: ${currentBranch}`);
            await git.push(['-u', 'origin', currentBranch]);
        } catch (error) {
            console.error('Error pushing to Git:', error);
        }
    } else {
        console.log('No changes to commit');
    }
}

async function main() {
    const owner = 'antonioditcharo';  // Replace this with your GitHub username
    const repo = 'RuneLite-Wealth-Tracker';  // Replace this with your repository name
    const localPath = path.join(__dirname, 'repo');

    await fetchCode(owner, repo, localPath);
    console.log('Starting issue identification...');
    const errorLog = await identifyIssues(localPath);
    console.log('Issues identified. Starting to apply fixes...');
    await fixIssues(localPath, errorLog);
    console.log('Fixes applied. Committing and pushing changes...');
    await commitAndPushChanges(localPath, 'Automated fixes for identified errors');
    await fs.remove(localPath);

    console.log('Repository analyzed, fixed, updated, and cleaned up successfully!');
}

main();
