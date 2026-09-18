// Thin typed-ish wrapper over the admin REST API.

async function req(path, { method = "GET", body, formData } = {}) {
  const res = await fetch(path, {
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    headers:
      body !== undefined ? { "Content-Type": "application/json" } : undefined,
    method,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  cancelJob: (jobId) =>
    req(`/api/generation-jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
      body: {},
    }),
  config: () => req("/api/config"),
  createProject: (name, description) =>
    req("/api/projects", { method: "POST", body: { name, description } }),
  deleteFile: (name, fileName) =>
    req(
      `/api/projects/${encodeURIComponent(name)}/files/${encodeURIComponent(fileName)}`,
      { method: "DELETE" }
    ),
  deleteProject: (name) =>
    req(`/api/projects/${encodeURIComponent(name)}`, { method: "DELETE" }),
  job: (jobId) => req(`/api/generation-jobs/${encodeURIComponent(jobId)}`),
  jobs: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req(`/api/generation-jobs${q ? `?${q}` : ""}`);
  },
  models: () => req("/api/models"),
  project: (name) => req(`/api/projects/${encodeURIComponent(name)}`),
  projects: () => req("/api/projects"),
  rebuild: () => req("/api/rebuild", { method: "POST", body: {} }),
  resumeJob: (jobId) =>
    req(`/api/generation-jobs/${encodeURIComponent(jobId)}/resume`, {
      method: "POST",
      body: {},
    }),
  retryJob: (jobId, stage) =>
    req(`/api/generation-jobs/${encodeURIComponent(jobId)}/retry`, {
      method: "POST",
      body: { stage },
    }),
  saveFile: (name, fileName, content) =>
    req(`/api/projects/${encodeURIComponent(name)}/files`, {
      method: "POST",
      body: { fileName, content },
    }),
  saveSettings: (s) => req("/api/settings", { method: "POST", body: s }),
  settings: () => req("/api/settings"),
  startGeneration: (name, payload) =>
    req(`/api/projects/${encodeURIComponent(name)}/generate`, {
      method: "POST",
      body: payload,
    }),
  upload: (name, formData) =>
    req(`/api/projects/${encodeURIComponent(name)}/upload`, {
      method: "POST",
      formData,
    }),
  uploadAndProcess: (name, formData) =>
    req(`/api/projects/${encodeURIComponent(name)}/upload-and-process`, {
      method: "POST",
      formData,
    }),
};
