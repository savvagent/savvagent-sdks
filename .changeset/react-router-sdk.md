---
'@savvagent/react-router': major
---

Add `@savvagent/react-router`, the React Router 8 (framework mode) SDK that replaces `@savvagent/remix`. It evaluates flags on the server in loaders, actions and route middleware with a per-request context, and hydrates the results into the `@savvagent/react` provider so the first render shows real values instead of defaults. The `user_id` cookie is ignored unless `trustUserIdCookie` is set; supply the user from your own auth with `getUserId` or `forRequest(request, { userId })`. Peers: `react-router` >=8.5.1 <9, `react` >=19.2.7 <20.
