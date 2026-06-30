const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("vsc4educationRepository", {
  apiBase: "http://127.0.0.1:8000/api",
});
