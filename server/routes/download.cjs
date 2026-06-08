const { DownloadManager } = require('../download_manager.cjs');

let manager = null;

function getManager() {
  if (!manager) {
    manager = new DownloadManager({
      concurrent: 3,
      saveRoot: 'F:\\Downloads\\usagi-downloads'
    });
  }
  return manager;
}

function createDownloadRoutes() {
  const routes = {};

  routes['/api/download/add'] = async function(body, cb) {
    try {
      const urls = Array.isArray(body.urls) ? body.urls : [body.url].filter(Boolean);
      if (urls.length === 0) {
        return cb({ ok: false, error: '请提供有效的URL' });
      }
      const tasks = await getManager().addTasks(urls);
      cb({ ok: true, tasks });
    } catch(e) {
      cb({ ok: false, error: e.message });
    }
  };

  routes['/api/download/list'] = function(body, cb) {
    const tasks = getManager().getAllTasks();
    cb({ ok: true, tasks });
  };

  routes['/api/download/status/:id'] = function(body, cb) {
    const task = getManager().getTask(body.params?.id || body.id);
    if (!task) {
      return cb({ ok: false, error: '任务不存在' });
    }
    cb({ ok: true, task });
  };

  routes['/api/download/pause/:id'] = function(body, cb) {
    const id = body.params?.id || body.id;
    const success = getManager().pauseTask(id);
    cb({ ok: success, error: success ? null : '无法暂停任务' });
  };

  routes['/api/download/resume/:id'] = function(body, cb) {
    const id = body.params?.id || body.id;
    const success = getManager().resumeTask(id);
    cb({ ok: success, error: success ? null : '无法恢复任务' });
  };

  routes['/api/download/cancel/:id'] = function(body, cb) {
    const id = body.params?.id || body.id;
    const success = getManager().cancelTask(id);
    cb({ ok: success, error: success ? null : '无法取消任务' });
  };

  routes['/api/download/remove/:id'] = function(body, cb) {
    const id = body.params?.id || body.id;
    const success = getManager().removeTask(id);
    cb({ ok: success });
  };

  routes['/api/download/clear'] = function(body, cb) {
    const ids = getManager().clearCompleted();
    cb({ ok: true, cleared: ids });
  };

  routes['/api/download/config'] = function(body, cb) {
    const m = getManager();
    if (body.concurrent !== undefined) {
      m.setConcurrent(body.concurrent);
    }
    if (body.saveRoot) {
      m.setSaveRoot(body.saveRoot);
    }
    cb({ ok: true, concurrent: m.concurrent, saveRoot: m.saveRoot });
  };

  return routes;
}

module.exports = createDownloadRoutes;