# HTTP 完整调用链

每个 API 请求的通用路径：

```
http.createServer((req, res) => {
  ├─ CORS headers (Access-Control-Allow-*)
  ├─ Parse URL + method
  ├─ Route matching:
  │   ├─ Static files: frontend/dist/ (index.html, app.js, *.css, vendor/)
  │   ├─ API routes (/api/*):
  │   │   ├─ Read body (if POST/PUT/DELETE)
  │   │   ├─ Execute handler logic
  │   │   ├─ Mutate global `data` (if applicable)
  │   │   ├─ Fine-grained save (only affected table/file):
  │   │   │   ├─ db.saveLibrary() — anime/episode changes
  │   │   │   ├─ db.savePlaySessions() — play session changes
  │   │   │   ├─ db.updateEpisodeProgress() — single episode update
  │   │   │   ├─ db.updatePlaySession() — single session update
  │   │   │   └─ saveScannedTree() — scanned tree JSON
  │   │   └─ jsonResp(res, status, payload)
  │   └─ Cover/banner/thumbnail routes:
  │       ├─ /covers/* → serveImage() → ffmpeg resize pipeline
  │       ├─ /banners/* → serveImage()
  │       └─ /api/thumbnail → ffmpeg extract → serveImage()
  └─ 404 fallback
})
```
