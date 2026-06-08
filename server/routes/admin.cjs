const createLogger = require('../lib/logger.cjs');

const logger = createLogger('routes:admin');

module.exports = function createAdminRoutes(deps) {
  const authStore = deps.authStore;

  function logAdmin(body, action, targetId, summary, metadata) {
    return authStore.logOperation({
      auth: body._auth,
      req: body._req,
      module: 'adminUsers',
      action: action,
      target_type: 'user',
      target_id: targetId,
      summary: summary,
      metadata: metadata || {}
    }).catch(function(e) {
      logger.warn('admin audit failed', e);
    });
  }

  return {
    '/api/admin/users': function(body, cb) {
      authStore.listUsers().then(function(users) {
        cb({ users: users, modules: authStore.DEFAULT_MEMBER_PERMISSIONS });
      }).catch(function(e) {
        cb({ error: e.message });
      });
    },

    '/api/admin/users/create': function(body, cb) {
      authStore.createUser(body).then(function(result) {
        if (!result.error && result.user) {
          logAdmin(body, 'user.create', result.user.id, '新建用户：' + result.user.username, {
            username: result.user.username,
            role: result.user.role,
            permissions: result.user.permissions
          });
        }
        cb(result);
      }).catch(function(e) {
        cb({ error: e.message });
      });
    },

    '/api/admin/users/update': function(body, cb) {
      authStore.updateUser(body).then(function(result) {
        if (!result.error && result.user) {
          logAdmin(body, 'user.update', result.user.id, '更新用户：' + result.user.username, {
            username: result.user.username,
            role: result.user.role,
            active: result.user.active,
            permissions: result.user.permissions
          });
        }
        cb(result);
      }).catch(function(e) {
        cb({ error: e.message });
      });
    },

    '/api/admin/users/reset-password': function(body, cb) {
      authStore.resetPassword(body).then(function(result) {
        if (!result.error) {
          logAdmin(body, 'user.reset_password', body.id, '重置用户密码', { id: body.id });
        }
        cb(result);
      }).catch(function(e) {
        cb({ error: e.message });
      });
    },

    '/api/admin/users/delete': function(body, cb) {
      authStore.deleteUser(body).then(function(result) {
        if (!result.error && result.ok) {
          logAdmin(body, 'user.delete', body.id, '删除用户：' + (result.username || body.id), {
            id: body.id,
            username: result.username || ''
          });
        }
        cb(result);
      }).catch(function(e) {
        cb({ error: e.message });
      });
    },

    '/api/admin/logs': function(body, cb) {
      authStore.listLogs(body || {}).then(cb).catch(function(e) {
        cb({ error: e.message });
      });
    }
  };
};
