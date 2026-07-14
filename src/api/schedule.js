import { request } from './client'

export function loadSchedule() {
  return request('/api/schedule/load', {
    method: 'POST',
    body: {}
  })
}

export function loadScheduleRevision() {
  return request('/api/schedule/revision', {
    method: 'POST',
    body: {}
  })
}

export function saveSchedule(tasks, members, options = {}) {
  return request('/api/schedule/save', {
    method: 'POST',
    body: { tasks, members, revision: options.revision }
  })
}

export function loadScheduleTodos() {
  return request('/api/schedule/todos/load', {
    method: 'POST',
    body: {}
  })
}

export function loadScheduleTodoHistory(limit = 200) {
  return request('/api/schedule/todos/history', {
    method: 'POST',
    body: { limit }
  })
}

export function saveScheduleTodo(todo) {
  return request('/api/schedule/todos/save', {
    method: 'POST',
    body: { todo }
  })
}

export function updateScheduleTodoStatus(id, status) {
  return request('/api/schedule/todos/status', {
    method: 'POST',
    body: { id, status }
  })
}

export function deleteScheduleTodo(id) {
  return request('/api/schedule/todos/delete', {
    method: 'POST',
    body: { id }
  })
}

export function uploadScheduleDoc(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result || '')
        const fileData = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
        resolve(await request('/api/schedule/upload-doc', {
          method: 'POST',
          body: {
            name: file.name,
            type: file.type || '',
            file_data: fileData
          }
        }))
      } catch (e) {
        reject(e)
      }
    }
    reader.onerror = () => reject(new Error('file read failed'))
    reader.readAsDataURL(file)
  })
}

export function notifyScheduleHandoff(payload) {
  return request('/api/schedule/notify-handoff', {
    method: 'POST',
    body: payload
  })
}

export function loadUnreadScheduleNotifications() {
  return request('/api/schedule/notifications/unread', {
    method: 'POST',
    body: {}
  })
}

export function markScheduleNotificationsRead(ids) {
  return request('/api/schedule/notifications/read', {
    method: 'POST',
    body: { ids }
  })
}

