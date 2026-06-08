import { request } from './client'

export function loadSchedule() {
  return request('/api/schedule/load', {
    method: 'POST',
    body: {}
  })
}

export function saveSchedule(tasks, members) {
  return request('/api/schedule/save', {
    method: 'POST',
    body: { tasks, members }
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

