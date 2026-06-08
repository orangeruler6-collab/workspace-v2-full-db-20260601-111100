import { request } from './client'

export function listIdeas() {
  return request('/api/ideas/list')
}

export function addIdea(payload) {
  return request('/api/ideas/add', {
    method: 'POST',
    body: payload
  })
}

export function updateIdea(payload) {
  return request('/api/ideas/update', {
    method: 'POST',
    body: payload
  })
}

export function deleteIdeaById(id, userName) {
  const body = userName ? { id, user_name: userName } : { id }
  return request('/api/ideas/delete', {
    method: 'POST',
    body
  })
}

export function addIdeaComment(payload) {
  return request('/api/ideas/comment/add', {
    method: 'POST',
    body: payload
  })
}

export function deleteIdeaComment(id, userName) {
  const body = userName ? { id, user_name: userName } : { id }
  return request('/api/ideas/comment/delete', {
    method: 'POST',
    body
  })
}

export function toggleIdeaFavorite(id, favorite) {
  return request('/api/ideas/favorite/toggle', {
    method: 'POST',
    body: { id, favorite }
  })
}

export function recordIdeaClick(id) {
  return request('/api/ideas/click', {
    method: 'POST',
    body: { id }
  })
}
