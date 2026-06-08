const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TASK_STATUS = {
  PENDING: 'pending',
  DOWNLOADING: 'downloading',
  COMPLETED: 'completed',
  FAILED: 'failed',
  PAUSED: 'paused',
  CANCELLED: 'cancelled'
};

const MAX_CONCURRENT = 8;
const DEFAULT_CONCURRENT = 3;

class DownloadTask {
  constructor(id, url, savePath) {
    this.id = id;
    this.url = url;
    this.savePath = savePath;
    this.status = TASK_STATUS.PENDING;
    this.progress = 0;
    this.speed = 0;
    this.size = 0;
    this.downloaded = 0;
    this.title = '';
    this.error = null;
    this.process = null;
    this.startTime = null;
    this.pauseTime = null;
    this.totalTime = 0;
  }
}

class DownloadManager {
  constructor(options = {}) {
    this.tasks = new Map();
    this.concurrent = options.concurrent || DEFAULT_CONCURRENT;
    this.saveRoot = options.saveRoot || path.join(process.env.USERPROFILE || '', 'Downloads', 'usagi-downloads');
    this.dyDownloader = options.dyDownloader || 'C:\\Users\\Administrator\\.openclaw\\workspace\\skills\\douyin-video\\douyin_downloader.py';
    this.pythonPath = options.pythonPath || 'python';
    this.activeCount = 0;
    this.eventCallbacks = [];
  }

  generateId() {
    return crypto.randomBytes(8).toString('hex');
  }

  onEvent(callback) {
    this.eventCallbacks.push(callback);
  }

  emitEvent(event, data) {
    this.eventCallbacks.forEach(cb => cb(event, data));
  }

  ensureSaveDir(dateStr) {
    const saveDir = path.join(this.saveRoot, dateStr);
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }
    return saveDir;
  }

  getDateStr() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  }

  async addTasks(urls) {
    const dateStr = this.getDateStr();
    const saveDir = this.ensureSaveDir(dateStr);
    const results = [];

    for (const url of urls) {
      const id = this.generateId();
      const task = new DownloadTask(id, url.trim(), saveDir);
      this.tasks.set(id, task);
      results.push(this._formatTask(task));
    }

    this.emitEvent('tasksAdded', results);
    this.processQueue();
    return results;
  }

  processQueue() {
    while (this.activeCount < this.concurrent) {
      const pendingTask = this._getNextPendingTask();
      if (!pendingTask) break;
      this._startTask(pendingTask);
    }
  }

  _getNextPendingTask() {
    for (const task of this.tasks.values()) {
      if (task.status === TASK_STATUS.PENDING) {
        return task;
      }
    }
    return null;
  }

  async _startTask(task) {
    task.status = TASK_STATUS.DOWNLOADING;
    task.startTime = Date.now();
    this.activeCount++;
    this.emitEvent('taskStarted', this._formatTask(task));

    const args = [
      this.dyDownloader,
      '--link', task.url,
      '--action', 'download',
      '--output', task.savePath
    ];

    return new Promise((resolve) => {
      task.process = spawn(this.pythonPath, args);

      let output = '';
      let errorOutput = '';

      task.process.stdout.on('data', (data) => {
        output += data.toString();
        this._parseProgress(task, output);
      });

      task.process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      task.process.on('close', (code) => {
        this.activeCount--;
        task.totalTime += (task.pauseTime || Date.now()) - task.startTime;

        if (code === 0 && task.status === TASK_STATUS.DOWNLOADING) {
          task.status = TASK_STATUS.COMPLETED;
          task.progress = 100;
          this.emitEvent('taskCompleted', this._formatTask(task));
        } else if (task.status === TASK_STATUS.PAUSED) {
          // 暂停状态保持
        } else if (task.status === TASK_STATUS.CANCELLED) {
          // 取消状态保持
        } else {
          task.status = TASK_STATUS.FAILED;
          task.error = errorOutput || `exit code: ${code}`;
          this.emitEvent('taskFailed', this._formatTask(task));
        }

        this.processQueue();
        resolve();
      });

      task.process.on('error', (err) => {
        this.activeCount--;
        task.status = TASK_STATUS.FAILED;
        task.error = err.message;
        task.totalTime += (task.pauseTime || Date.now()) - task.startTime;
        this.emitEvent('taskFailed', this._formatTask(task));
        this.processQueue();
        resolve();
      });
    });
  }

  _parseProgress(task, output) {
    // 解析douyin_downloader的输出，提取进度信息
    // 格式可能是: [下载中] 45% 2.3MB/s 剩余30秒
    const progressMatch = output.match(/(\d+)%\s*([\d.]+\w*\/s)/);
    if (progressMatch) {
      task.progress = parseInt(progressMatch[1], 10);
      task.speed = progressMatch[2];
      this.emitEvent('taskProgress', this._formatTask(task));
    }

    // 解析标题
    const titleMatch = output.match(/标题[：:]\s*(.+)/);
    if (titleMatch) {
      task.title = titleMatch[1].trim();
    }
  }

  pauseTask(id) {
    const task = this.tasks.get(id);
    if (!task || task.status !== TASK_STATUS.DOWNLOADING) {
      return false;
    }

    if (task.process) {
      task.process.kill('SIGSTOP');
      task.pauseTime = Date.now();
      task.totalTime += task.pauseTime - task.startTime;
    }
    task.status = TASK_STATUS.PAUSED;
    this.activeCount--;
    this.emitEvent('taskPaused', this._formatTask(task));
    this.processQueue();
    return true;
  }

  resumeTask(id) {
    const task = this.tasks.get(id);
    if (!task || task.status !== TASK_STATUS.PAUSED) {
      return false;
    }

    if (task.process) {
      task.process.kill('SIGCONT');
      task.startTime = Date.now();
    }
    task.status = TASK_STATUS.DOWNLOADING;
    task.pauseTime = null;
    this.activeCount++;
    this.emitEvent('taskResumed', this._formatTask(task));
    this.processQueue();
    return true;
  }

  cancelTask(id) {
    const task = this.tasks.get(id);
    if (!task) {
      return false;
    }

    if (task.process) {
      task.process.kill('SIGTERM');
      task.process = null;
    }
    task.status = TASK_STATUS.CANCELLED;
    if (task.status === TASK_STATUS.DOWNLOADING) {
      this.activeCount--;
    }
    this.emitEvent('taskCancelled', this._formatTask(task));
    this.processQueue();
    return true;
  }

  removeTask(id) {
    const task = this.tasks.get(id);
    if (!task) {
      return false;
    }

    if (task.process) {
      task.process.kill('SIGTERM');
    }
    this.tasks.delete(id);
    this.emitEvent('taskRemoved', { id });
    return true;
  }

  clearCompleted() {
    const completedIds = [];
    for (const [id, task] of this.tasks) {
      if (task.status === TASK_STATUS.COMPLETED || task.status === TASK_STATUS.FAILED || task.status === TASK_STATUS.CANCELLED) {
        completedIds.push(id);
      }
    }
    completedIds.forEach(id => this.tasks.delete(id));
    this.emitEvent('tasksCleared', { ids: completedIds });
    return completedIds;
  }

  getTask(id) {
    return this._formatTask(this.tasks.get(id));
  }

  getAllTasks() {
    const tasks = [];
    for (const task of this.tasks.values()) {
      tasks.push(this._formatTask(task));
    }
    return tasks;
  }

  setConcurrent(count) {
    if (count >= 1 && count <= MAX_CONCURRENT) {
      this.concurrent = count;
      this.processQueue();
      return true;
    }
    return false;
  }

  setSaveRoot(path) {
    if (fs.existsSync(path) && fs.statSync(path).isDirectory()) {
      this.saveRoot = path;
      return true;
    }
    return false;
  }

  _formatTask(task) {
    if (!task) return null;
    return {
      id: task.id,
      url: task.url,
      savePath: task.savePath,
      status: task.status,
      progress: task.progress,
      speed: task.speed,
      size: task.size,
      downloaded: task.downloaded,
      title: task.title,
      error: task.error,
      totalTime: task.totalTime
    };
  }
}

module.exports = { DownloadManager, TASK_STATUS };