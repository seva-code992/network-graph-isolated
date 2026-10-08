export class ApiError extends Error {}

export function createApi(base = '') {
  async function request(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('Could not reach the server. Please try again.');
    }
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try {
        const { detail } = await res.json();
        if (typeof detail === 'string') msg = detail;
        else if (Array.isArray(detail) && detail[0]?.msg) msg = `Invalid input: ${detail[0].msg}`;
      } catch { /* non-JSON error body */ }
      throw new ApiError(msg);
    }
    return res.json();
  }
  return {
    species: () => request('/api/species'),
    experiments: () => request('/api/experiments'),
    lists: () => request('/api/lists'),
    list: (id) => request(`/api/lists/${encodeURIComponent(id)}`),
    parseTsv: (filename, text) => request('/api/lists/parse-tsv', { method: 'POST', body: { filename, text } }),
    createList: (body) => request('/api/lists', { method: 'POST', body }),
    sharedGenes: (lists) => request('/api/graph/shared-genes', { method: 'POST', body: { lists } }),
    graph: (body) => request('/api/graph', { method: 'POST', body }),
  };
}
