// Runs at Constellation's old address after the move: sends every request to the same path at the new address,
// so tracker links, review links, the Brand Library link, calendar subscriptions and app updates keep working.
export default {
  fetch(request, env) {
    const url = new URL(request.url)
    return Response.redirect(env.TARGET + url.pathname + url.search, 308)
  }
}
