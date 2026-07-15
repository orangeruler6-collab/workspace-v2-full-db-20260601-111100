module.exports = function createAuthRoutes(deps) {
  const authStore = deps.authStore;

  return {
    '/api/auth/login': function(body, cb) {
      authStore.login(body.username || body.user || '', body.password || '', body._req).then(cb).catch(function(e) {
        cb({ error: e.message });
      });
    },

    '/api/auth/erp-login': function(body, cb) {
      authStore.erpLogin(body.auth_tokens || body.auth_token || body.token || '', body._req).then(cb).catch(function(e) {
        cb({ error: e.message });
      });
    },

    '/api/auth/register': function(body, cb) {
      authStore.register(body, body._req).then(cb).catch(function(e) {
        cb({ error: e.message });
      });
    },

    '/api/auth/me': function(body, cb) {
      cb({ user: body._auth || null });
    },

    '/api/auth/logout': function(body, cb) {
      authStore.logout(body._token || '', body._auth, body._req).then(cb).catch(function(e) {
        cb({ error: e.message });
      });
    }
  };
};
