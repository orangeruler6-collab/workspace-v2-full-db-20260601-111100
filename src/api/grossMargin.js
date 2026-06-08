async function requestStyleJson(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  }

  try {
    const rawUser = localStorage.getItem('usagi_auth_user')
    if (rawUser) headers['x-usagi-auth-user'] = encodeURIComponent(rawUser)
  } catch (e) {}

  const response = await fetch(`/style-workbench${path}`, {
    ...options,
    headers,
    cache: 'no-store'
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.error) {
    throw new Error(data.error || `HTTP ${response.status}`)
  }
  return data
}

export function getGrossMarginLibrary() {
  return requestStyleJson('/api/gross-margin')
}

export function saveGrossMarginPriceTable(input) {
  return requestStyleJson('/api/gross-margin', {
    method: 'POST',
    body: JSON.stringify({ action: 'savePriceTable', ...input })
  })
}
