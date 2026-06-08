import { request } from './client'

export function listProjectDeliveryProjects(payload = {}) {
  return request('/api/project-delivery/projects', {
    method: 'POST',
    body: payload
  })
}

export function getProjectDeliveryDashboard(projectId) {
  return request('/api/project-delivery/dashboard', {
    method: 'POST',
    body: projectId ? { project_id: projectId } : {}
  })
}

export function generateProjectDeliveryPlan(payload = {}) {
  return request('/api/project-delivery/plan/generate', {
    method: 'POST',
    body: payload
  })
}

export function updateProjectDeliveryTask(payload = {}) {
  return request('/api/project-delivery/tasks/update', {
    method: 'POST',
    body: payload
  })
}

export function linkProjectDeliveryMaterials(payload = {}) {
  return request('/api/project-delivery/tasks/link-materials', {
    method: 'POST',
    body: payload
  })
}

export function refreshProjectDeliveryMetrics(payload = {}) {
  return request('/api/project-delivery/metrics/refresh', {
    method: 'POST',
    body: payload
  })
}
