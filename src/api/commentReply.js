import { request } from './client'

export function fetchCommentReplyAccounts(payload = {}) {
  return request('/api/comment-reply/accounts', {
    method: 'POST',
    body: payload
  })
}

export function updateCommentReplyAccount(accountId, enabled) {
  return fetchCommentReplyAccounts({
    action: 'update',
    accountId,
    enabled
  })
}

export function collectCommentReply(payload = {}) {
  return request('/api/comment-reply/collect', {
    method: 'POST',
    body: payload
  })
}

export function planCommentReply(payload = {}) {
  return request('/api/comment-reply/plan', {
    method: 'POST',
    body: payload
  })
}

export function sendCommentReply(payload = {}) {
  return request('/api/comment-reply/send', {
    method: 'POST',
    body: payload
  })
}

export function fetchCommentReplyHistory(payload = {}) {
  return request('/api/comment-reply/history', {
    method: 'POST',
    body: payload
  })
}
