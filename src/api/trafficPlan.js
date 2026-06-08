import { request } from './client'

export function fetchTrafficPlanState(payload = {}) {
  return request('/api/traffic-plan/state', {
    method: 'POST',
    body: { action: 'read', ...payload }
  })
}

export function fetchTrafficPlanGroupTasks(payload = {}) {
  return request('/api/traffic-plan/group-tasks', {
    method: 'POST',
    body: payload
  })
}

export function fetchTrafficMaintenanceSources(payload = {}) {
  return request('/api/traffic-plan/maintenance-sources', {
    method: 'POST',
    body: payload
  })
}

export function saveTrafficPlanState(state, payload = {}) {
  return request('/api/traffic-plan/state', {
    method: 'POST',
    body: { state, ...payload }
  })
}

export function resetTrafficPlanState(payload = {}) {
  return request('/api/traffic-plan/reset', {
    method: 'POST',
    body: payload
  })
}

export function deleteTrafficPlanProject(payload = {}) {
  return request('/api/traffic-plan/delete-project', {
    method: 'POST',
    body: payload
  })
}

export function fetchXingtuTrafficVideos(payload) {
  return request('/api/traffic-plan/xingtu-videos', {
    method: 'POST',
    body: payload
  })
}

export function fetchDouyinTrafficStats(payload) {
  return request('/api/traffic-plan/douyin-stats', {
    method: 'POST',
    body: payload
  })
}

export function fetchCrmExecutionCsv(payload = {}) {
  return request('/api/traffic-plan/crm-execution-csv', {
    method: 'POST',
    body: payload
  })
}

export function fetchTrafficMaintenanceState(payload = {}) {
  return request('/api/traffic-plan/maintenance-state', {
    method: 'POST',
    body: { action: 'read', ...payload }
  })
}

export function saveTrafficMaintenanceState(state) {
  return request('/api/traffic-plan/maintenance-state', {
    method: 'POST',
    body: { state, groupName: state?.groupName || '' }
  })
}

export function fetchTrafficPlanV2(payload = {}) {
  return request('/api/traffic-plan/v2/state', {
    method: 'POST',
    body: { action: 'read', ...payload }
  })
}

export function refreshTrafficPlanV2CrmCsv(payload = {}) {
  return request('/api/traffic-plan/v2/crm-refresh-now', {
    method: 'POST',
    body: payload
  })
}

export function fetchTrafficPlanV2CrmStatus(payload = {}) {
  return request('/api/traffic-plan/v2/crm-refresh-status', {
    method: 'POST',
    body: payload
  })
}

export function fetchTrafficPlanV2CrmLoginScreenshot(payload = {}) {
  return request('/api/traffic-plan/v2/crm-login-screenshot', {
    method: 'POST',
    body: payload
  })
}

export function parseTrafficPlanV2Text(payload = {}) {
  return request('/api/traffic-plan/v2/parse-project', {
    method: 'POST',
    body: payload
  })
}

export function createTrafficPlanV2Project(project) {
  return request('/api/traffic-plan/v2/project', {
    method: 'POST',
    body: { project }
  })
}

export function updateTrafficPlanV2Project(project) {
  return request('/api/traffic-plan/v2/update-project', {
    method: 'POST',
    body: { project }
  })
}

export function deleteTrafficPlanV2Project(payload = {}) {
  return request('/api/traffic-plan/v2/delete-project', {
    method: 'POST',
    body: payload
  })
}

export function updateTrafficPlanV2Execution(execution) {
  return request('/api/traffic-plan/v2/execution', {
    method: 'POST',
    body: { execution }
  })
}

export function saveTrafficPlanV2Application(application) {
  return request('/api/traffic-plan/v2/application', {
    method: 'POST',
    body: { application }
  })
}

export function saveTrafficPlanV2Settings(settings) {
  return request('/api/traffic-plan/v2/settings', {
    method: 'POST',
    body: { settings }
  })
}
